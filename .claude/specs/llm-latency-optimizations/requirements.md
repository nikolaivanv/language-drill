# Requirements Document

## Introduction

Three independent, low-risk improvements to LLM response latency on the language-drill backend, plus one piece of forward-looking documentation. The work targets two user-facing AI surfaces — **drill answer evaluation** (`POST /exercises/:id/submit`) and **deep annotation** (`POST /read/annotate-span`) — both of which today block on a non-streaming Claude (Sonnet) call before returning anything.

The three changes are:

1. **Stream deep-annotation cards.** The deep-card call currently runs non-streaming on API Gateway, so the learner waits for the entire card JSON (~500–1500 output tokens, ~8–13 s of generation) before seeing anything. Reusing the streaming + incremental tool-input machinery already proven by the skim pass (`streamAnnotation` / SSE writer / `fetchSse`), emit card fields progressively so the definition appears in well under a second and the heavier sections (morphology, synonyms, collocations) fill in afterward. Delivery changes only — the final card is the same validated `DeepCard`.
2. **Swap the evaluation model to Haiku 4.5.** Change the answer-evaluation model from `claude-sonnet-4-6` to `claude-haiku-4-5-20251001` (a ~2–3× speedup on a small, bounded output), gated by the existing `pnpm eval:export` / `pnpm eval` Langfuse-dataset harness so quality is measured before the swap ships. Fully reversible by reverting one constant.
3. **Tune Anthropic SDK timeout / retries.** Neither evaluation nor deep annotation sets an explicit `timeout` or `maxRetries`, so both inherit the SDK default (2 retries with exponential backoff) — which can silently triple tail latency on a transient blip. Set explicit, surface-appropriate values on the evaluate, read-span, and annotate-stream calls to tighten p99.

The fourth deliverable is **documentation only**: capture the postponed Groq / Cerebras fast-inference exploration in a `docs/` markdown file so the rationale and the eval-harness-gated evaluation plan are not lost.

## Alignment with Product Vision

`tech.md` positions the app as "AI-heavy" with answer evaluation and explanations as real-time, metered, latency-sensitive surfaces, and names **Anthropic prompt caching** and **cost control** as first-class concerns. Faster evaluation and progressively-rendered deep cards directly improve the core "active production practice" loop (submit answer → get feedback) and the reading-comprehension loop (tap a word → understand it) without touching the CEFR progress spine or any scoring semantics. Item 2 additionally reduces per-evaluation cost (Haiku is materially cheaper than Sonnet), reinforcing the documented cost-control goal. All changes are backend-only and reversible, consistent with the "portfolio-quality, don't re-architect" constraint.

## Requirements

### Requirement 1 — Progressive streaming of deep-annotation cards

**User Story:** As a learner reading a passage, I want a tapped word's (or selected phrase's / sentence's) deep card to start appearing almost immediately and fill in as it generates, so that I am not staring at a spinner for ~10 seconds before any content shows.

#### Acceptance Criteria

1. WHEN a learner requests a deep annotation for a span THEN the system SHALL stream the resulting `DeepCard` over Server-Sent Events, emitting each top-level card field as soon as it is fully formed rather than withholding the whole card until generation completes.
2. WHEN the deep-card stream is in progress THEN the frontend SHALL render the fields received so far (e.g. `surface`, `lemma`, `pos`, `contextualSense`, `definition`) before the later optional sections (`morphology`, `synonyms`, `collocations`, `extraExample`) have arrived.
3. WHEN the upstream model stream completes successfully THEN the system SHALL emit a terminal `done` event carrying the fully assembled card, and the assembled card SHALL be identical in shape and content to what the non-streaming path would have produced (validated by `DeepCardSchema` / `parseSpanResult`).
4. IF the upstream model response is truncated (`stop_reason: "max_tokens"`) or otherwise fails to assemble into a schema-valid `DeepCard` THEN the system SHALL emit a terminal `error` event with code `AI_UNAVAILABLE` and SHALL NOT emit a `done` event.
5. IF the upstream model call fails *after* one or more fields have already been streamed to the client THEN the system SHALL emit a terminal `error` event (code `AI_UNAVAILABLE`) and the client SHALL discard the partial card and surface the inline error + retry affordance — a partially-streamed card SHALL NOT be presented as a complete result.
6. WHEN the client aborts the request mid-stream (e.g. the learner taps a different span) THEN the system SHALL abort the upstream model call and SHALL NOT emit a terminal event for the aborted request; the absence of a terminal event SHALL be observable in tests (no `done`/`error` frame written after abort within the test's read window).
7. WHEN the deep-card stream exceeds the streaming Lambda's soft deadline THEN the system SHALL abort the upstream call and emit a terminal `error` event before the runtime hard-kills the invocation (mirroring the skim pass's soft-deadline behavior).
8. WHEN exactly one terminal event (`done` or `error`) has been written for a request THEN the system SHALL NOT write a second terminal event (the single-terminal wire-protocol invariant already enforced by the SSE writer).

### Requirement 2 — Preserve deep-annotation correctness and side effects under streaming

**User Story:** As the system owner, I want the move to streaming to preserve every behavior the current `/read/annotate-span` route guarantees, so that caching, rate limiting, persistence, and metering keep working exactly as before.

#### Acceptance Criteria

1. WHEN a span annotation is requested for a SAVED entry whose `span_annotations` already holds the `"start:end"` key THEN the system SHALL return the cached card with NO model call and NO new metering, delivering it over the same streaming response shape as a freshly generated card.
2. WHEN the request body or span offsets are invalid (empty/out-of-range span, malformed body, unsupported language) THEN the system SHALL reject the request with the same validation semantics and error codes the current route returns (`VALIDATION_ERROR`, `UNSUPPORTED_LANGUAGE`).
3. WHEN a deep annotation is requested THEN the system SHALL enforce the dedicated `read_span_annotation` daily rate-limit bucket (separate from `ai_evaluation` / `read_annotation`) and return `RATE_LIMIT_EXCEEDED` when the limit is reached.
4. WHEN the span type is needed THEN the system SHALL recompute it server-side from the character offsets (never trust the client), preserving the current `resolveSpanType` behavior.
5. WHEN a deep card is successfully generated for a SAVED entry THEN the system SHALL write the card back into that entry's `span_annotations` keyed by `"start:end"`, scoped to `entryId + userId`, best-effort (a write-back failure is logged and swallowed, never failing an already-successful response).
6. WHEN a deep card is successfully generated by a real (non-cached) model call THEN the system SHALL insert exactly one `read_span_annotation` usage row, best-effort, and SHALL NOT meter cache hits, failures, OR client-aborted requests (an abort consumes no rate-limit token).
7. WHEN the deep call runs THEN the system SHALL wrap it in `withLlmTrace` with the existing `annotate-span` feature metadata and `READ_SPAN_PROMPT_VERSION`, and SHALL flush observability exactly once per invocation on every exit path.
8. WHEN a learner taps a span whose card was resolved earlier in the same session THEN the client SHALL render it from existing client state / query cache without issuing a new streamed request (preserving the current within-session no-refetch behavior).

### Requirement 3 — Evaluation model swapped to Haiku 4.5, gated by the eval harness

**User Story:** As a learner submitting a drill answer, I want my feedback to come back faster, so that the submit→feedback loop feels responsive — without a drop in scoring or error-detection quality.

#### Acceptance Criteria

1. WHEN an answer is submitted for evaluation THEN the system SHALL call `claude-haiku-4-5-20251001` instead of `claude-sonnet-4-6`, with the evaluation system prompt, forced tool use, `temperature: 0`, structured output schema, and ephemeral prompt caching all unchanged.
2. WHEN the model is changed THEN a candidate evaluation run SHALL be executed against a Langfuse dataset via `pnpm eval:export` + `pnpm eval`, and the resulting quality/cost/latency summary SHALL be captured for comparison against the Sonnet baseline before the change is considered shippable.
3. IF the Haiku evaluation run shows a quality regression versus the Sonnet baseline beyond an agreed bar — as a concrete starting threshold: a drop of more than 5% in the dataset's aggregate `score` agreement with the baseline, OR any visible regression in error-detection (errors the Sonnet baseline caught that Haiku misses on the dataset) — THEN the change SHALL be revertible by restoring the single model constant, with no other code dependent on the model choice. (The exact bar is confirmed at design approval; the threshold here makes the ship/revert decision measurable rather than a pure judgment call.)
4. WHEN the model constant is changed THEN the change SHALL be accompanied by an in-code comment documenting why evaluation now runs on Haiku (mirroring the existing precedent comment on the annotate/skim `STREAM_MODEL`), so the rationale is discoverable at the call site.
5. WHEN deciding whether to bump `EVALUATION_SYSTEM_PROMPT_VERSION` THEN the system SHALL treat a model-only change as NOT a prompt-body edit: the Langfuse trace records the model natively, so the prompt-version cohort tag SHALL only be bumped if the prompt body itself changes (this requirement documents the decision so the CLAUDE.md "bump on prompt edit" rule is not misapplied to a model swap).

### Requirement 4 — Explicit SDK timeout and retry tuning

**User Story:** As the system owner, I want every interactive Claude call to fail fast and bound its retries, so that a transient upstream blip cannot silently triple the latency a waiting user experiences.

#### Acceptance Criteria

1. WHEN the evaluation call is made THEN the system SHALL pass an explicit request timeout and an explicit `maxRetries` value sized for an interactive, user-waiting surface — target `maxRetries: 1` and a request timeout in the ~15–20 s range (tighter than the SDK default of 2 retries with exponential backoff); exact values confirmed at design approval. The R4 values are chosen with the Requirement 3 model (Haiku 4.5) in mind, since its latency/retry profile differs from Sonnet's.
2. WHEN the deep-annotation (read-span) call is made THEN the system SHALL pass an explicit request timeout and `maxRetries` value appropriate to its (now-streaming) interactive use — target `maxRetries: 1`, with the timeout coordinated with the streaming soft deadline rather than fighting it.
3. WHEN the annotate-stream (skim) call is made THEN the system SHALL pass an explicit `maxRetries` value (target `maxRetries: 1`), and any configured request timeout SHALL be consistent with the existing 25 s soft deadline / 29 s Lambda ceiling (i.e. SDK retry behavior must not push total wall-clock past the soft deadline without the deadline catching it).
4. WHEN timeout/retry values are introduced THEN they SHALL be expressed as named constants with explaining comments, co-located with each call site, rather than as bare literals.
5. WHEN an SDK timeout or exhausted-retry error is thrown THEN the existing error handling SHALL continue to surface it as the surface's current failure response (`502 AI_UNAVAILABLE` for evaluate/read-span; terminal `error` SSE frame for streams) with no change to the observable error contract.

### Requirement 5 — Document the postponed Groq / Cerebras exploration

**User Story:** As a future maintainer, I want the reasoning behind deferring Groq/Cerebras fast-inference and the plan for evaluating it later written down, so that the idea and its trade-offs are not lost.

#### Acceptance Criteria

1. WHEN the spec work is implemented THEN a markdown document SHALL exist under `docs/` capturing: the opportunity (very-high-throughput inference for larger outputs such as deep cards), why it is deferred, the trade-offs (non-Claude model families, loss of Anthropic prompt caching, prompt re-tuning + re-validation, new provider/secret/observability wiring, availability risk), and the fact that the throughput advantage scales with output size (so deep annotation benefits more than evaluation).
2. WHEN the document describes the evaluation plan THEN it SHALL specify that any candidate Groq/Cerebras model is to be benchmarked head-to-head through the existing `pnpm eval` harness (quality/cost/latency) before adoption, and that the AI Gateway is not a natural fit because the calls run in Lambda, not on Vercel.
3. WHEN the document is added THEN it SHALL be cross-referenced from this spec and SHALL not modify any runtime code path.

> **Delivered:** [`docs/llm-fast-inference-exploration.md`](../../../docs/llm-fast-inference-exploration.md) — captures the opportunity (throughput scales with output size → deep cards benefit more than evaluation), why it's deferred, the trade-offs (non-Claude families, loss of Anthropic prompt caching, prompt re-tuning + re-validation, new provider/secret/observability wiring, availability risk), the `pnpm eval` head-to-head gate, and why the Vercel AI Gateway isn't a fit (calls run in Lambda, not on Vercel).

## Non-Functional Requirements

### Performance
- Deep-annotation time-to-first-rendered-field SHALL be dominated by model time-to-first-token (sub-second under normal conditions), replacing the current ~8–13 s block-until-complete wait; total time to the fully assembled card SHALL be no worse than the current non-streaming path.
- Evaluation end-to-end latency SHALL improve materially (target ~2–3× on generation) with the Haiku swap, with no regression to the bounded 1024-token output budget.
- Timeout/retry tuning SHALL reduce p99 tail latency on transient upstream errors and SHALL NOT increase median latency on the happy path.

### Security
- Streaming the deep card SHALL preserve the existing Clerk JWT verification on the streaming Function URL and the server-authoritative span-type / ownership checks; no span data SHALL be returned for an entry the user does not own.
- No new secrets are introduced by items 1–4; the Groq/Cerebras document (item 5) is descriptive only and introduces no credentials.

### Reliability
- The single-terminal-event wire-protocol invariant SHALL hold for the deep-card stream exactly as it does for the skim stream.
- Observability SHALL flush exactly once per streaming invocation on all paths (success, error, abort, validation short-circuit, cache hit).
- The Haiku swap and the timeout/retry tuning SHALL each be independently revertible without touching the other changes.

### Usability
- The deep-card UI SHALL show partial content as it streams without layout thrash, and SHALL preserve the existing inline error + retry affordance on `AI_UNAVAILABLE` / `RATE_LIMIT_EXCEEDED` / `VALIDATION_ERROR`.
- Cached and freshly-streamed cards SHALL be visually indistinguishable to the learner once fully rendered.

### Maintainability
- Item 1 SHALL maximize reuse of the existing streaming primitives (`streamAnnotation` pattern, `createSseWriter`, `fetchSse`, the soft-deadline/abort/flush scaffolding) rather than introducing a parallel streaming stack.
- New streaming-parse logic SHALL avoid adding a third-party partial-JSON dependency unless justified, following the project's "prefer minimal, maintained deps" guidance.
