# Requirements Document

## Introduction

Adopt **Langfuse cloud** as the secondary, analytics-grade sink for every Claude
call the app makes from `packages/ai`. Phase 1 delivers **read-only tracing** —
a thin wrapper around `createClaudeClient` plus per-call-site metadata
injection — so we can answer cost, latency, cache-hit-ratio, and per-prompt-
version questions in a dashboard within minutes, and pivot from a single user
submission to the exact prompt + tool-use output that produced it.

The existing per-user rate-limiting and cost accounting
(`Upstash` counters, `generation_jobs.cost_usd_estimate`,
`packages/ai/src/cost-model.ts`) remain authoritative and untouched. Langfuse
is added strictly alongside them.

This spec implements Section 7 "Phase 1 — Read-only tracing" of
`docs/llm-observability.md`. Phases 2 (prompt registry, datasets) and 3 (online
evals) are explicitly deferred.

## Alignment with Product Vision

Per `.claude/steering/product.md`, the project is a "portfolio-quality"
serverless AI app that scales to public use without re-architecting. Phase 1
serves three product goals already documented in steering:

1. **Cost-controlled AI** (`tech.md` §1, §10): Langfuse surfaces per-feature
   cost drift before it shows up on the AWS bill, complementing the Upstash
   rate-limit ceiling.
2. **Iterating on prompts safely**: every Claude surface in the app
   (`evaluate`, `annotate`, `generate`, `validate`, plus `theory-generate` /
   `theory-validate`) is prompt-driven; without per-prompt-version cohorting
   we cannot tell whether a prompt edit regressed quality, latency, or cost.
3. **Portfolio-quality observability**: matches the existing CI/CD discipline
   (no console click-ops, IaC-managed secrets) by managing Langfuse keys in
   AWS Secrets Manager + Vercel env, not bespoke files.

### Scope

Per `docs/llm-observability.md` FR-1, "every call to `client.messages.create`
in `packages/ai` is traced." Since the proposal was written, `packages/ai`
gained `theory-generate.ts` and `theory-validate.ts`; the live annotation
path migrated from `annotateText` to `streamAnnotation` (uses
`messages.stream`, not `messages.create`). This spec scopes in:

- All **live** AI surfaces: `evaluateAnswer`, `streamAnnotation`,
  `generateBatch`, `validateDraft`, `generateTheoryTopic`,
  `validateTheoryDraft`.
- All **Lambda** call sites: `infra/lambda/src/routes/exercises.ts`,
  `infra/lambda/src/generation/handler.ts`,
  `infra/lambda/src/annotate-stream/handler.ts`.

Out of scope (explicit):

- The legacy `annotateText` function (no live callers; will be deleted with
  `more-responsive-reading` task 13).
- The CLI scripts `packages/db/scripts/generate-exercises.ts` and
  `generate-theory.ts` — they are developer tools, not the runtime app.
  Tracing them would muddy production dashboards. (May be revisited if
  Phase 2 needs CLI-run dataset replay.)
- Replacing `cost-model.ts` or `generation_jobs.cost_usd_estimate`. Both
  stay authoritative; Langfuse cost is reported separately and treated as
  derived.
- CloudWatch logs continue to be the error/runtime-log sink. Langfuse is
  analytics-grade only.

## Requirements

### Requirement 1 — Wrapper client, single integration point

**User Story:** As the engineer maintaining `packages/ai`, I want a single
thin wrapper around `createClaudeClient` that swaps in an observed Anthropic
client when Langfuse env vars are present, so that adding or removing
tracing is a one-line change with zero impact on the pure AI surface
functions (`evaluate.ts`, `annotate.ts`, `generate.ts`, `validate.ts`,
`theory-generate.ts`, `theory-validate.ts`).

#### Acceptance Criteria

1. WHEN `packages/ai` is imported THEN it SHALL export a new function
   `createObservedClaudeClient(apiKey)` that returns an `Anthropic`-shape
   client.
2. IF `process.env.LANGFUSE_PUBLIC_KEY` is unset or empty THEN
   `createObservedClaudeClient` SHALL return a vanilla `new Anthropic({ apiKey })`
   (byte-identical behavior to today).
3. IF both `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` are present THEN
   `createObservedClaudeClient` SHALL return a Langfuse-observed Anthropic
   client that records each `messages.create` / `messages.stream` call as a
   Langfuse trace generation.
4. WHEN any of `infra/lambda/src/routes/exercises.ts`,
   `infra/lambda/src/generation/handler.ts`, or
   `infra/lambda/src/annotate-stream/handler.ts` constructs an Anthropic
   client THEN it SHALL call `createObservedClaudeClient` (not
   `createClaudeClient`).
5. WHEN any of the six AI surface functions (`evaluateAnswer`,
   `streamAnnotation`, `generateBatch`, `validateDraft`,
   `generateTheoryTopic`, `validateTheoryDraft`) is invoked THEN its public
   signature SHALL NOT change — they keep accepting an `Anthropic` instance
   so unit tests continue to pass a mock without observability awareness.

### Requirement 2 — Per-trace metadata at every call site

**User Story:** As an engineer debugging a feedback-quality bug, I want
every trace to carry enough metadata that I can filter dashboards by
language, CEFR level, exercise type, and prompt version, and pivot directly
from a `submissionId` to the matching trace, so that "the feedback was
wrong on submission `sub_abc123`" becomes a one-click jump.

#### Acceptance Criteria

1. WHEN `evaluateAnswer` is called from `routes/exercises.ts` THEN the
   resulting trace SHALL carry: `userId`, `submissionId` (the future history
   row id — see AC 7), `language`, `cefrLevel`, `exerciseType`,
   `promptVersion=EVALUATION_SYSTEM_PROMPT_VERSION`, `model`, `temperature`,
   `feature='evaluate'`, `env`, and AWS Lambda `requestId`.
2. WHEN `streamAnnotation` is called from `annotate-stream/handler.ts` THEN
   the resulting trace SHALL carry: `userId`, `language`, `cefrLevel`
   (= `calibration.cefr`), `promptVersion=ANNOTATE_SYSTEM_PROMPT_VERSION`,
   `model`, `temperature`, `feature='annotate'`, `env`, `requestId`, and
   `candidateCount`.
3. WHEN `generateBatch` is called from `generation/handler.ts` THEN the
   resulting trace SHALL carry: `language`, `cefrLevel`, `exerciseType`,
   `promptVersion=GENERATION_PROMPT_VERSION`, `model`, `temperature`,
   `feature='generate'`, `env`, `jobId`, and `cellKey`.
4. WHEN `validateDraft` is called from the generation pipeline THEN the
   resulting trace SHALL carry: `language`, `cefrLevel`, `exerciseType`,
   `promptVersion=VALIDATION_PROMPT_VERSION`, `model`, `temperature`,
   `feature='validate'`, `env`, `jobId`, `cellKey`, and `exerciseId` (the
   draft id under validation).
5. WHEN `generateTheoryTopic` is called THEN the resulting trace SHALL carry
   the equivalent generate-side metadata with `feature='generate-theory'`.
6. WHEN `validateTheoryDraft` is called THEN the resulting trace SHALL carry
   the equivalent validate-side metadata with `feature='validate-theory'`.
7. WHEN a user submission's `evaluateAnswer` trace is created THEN
   `submissionId` SHALL be set to the value the row will be given when
   inserted into `user_exercise_history` so the DB row and the trace cross-
   reference 1:1. (Concrete shape — DB-side id, deterministic uuid, or
   ULID minted before the Claude call — is a design decision deferred to
   the Design phase of the spec workflow.)
8. WHEN `userId` is set on a user-facing trace THEN it SHALL be the Clerk
   opaque user id (`user_xxx` in production, `dev_user_001` locally) and
   NOT any email, name, or other PII.
9. WHEN `env` is set on a trace THEN it SHALL be `prod` if running in the
   production CDK stack, `dev` otherwise (covers the dev stack and local
   Lambda dev).

### Requirement 3 — Frozen tag schema v1

**User Story:** As the person who pins dashboards on day one, I want the tag
schema frozen and documented before any dashboard is built, so that adding
a new feature later doesn't break existing dashboard filters.

#### Acceptance Criteria

1. WHEN a trace is created from any Phase-1 call site THEN it SHALL carry
   tags drawn from this fixed vocabulary (exact strings, no synonyms):
   - `feature`: `evaluate` | `annotate` | `generate` | `validate` |
     `generate-theory` | `validate-theory`
   - `language`: `en` | `es` | `de` | `tr`
   - `cefrLevel`: `A1` | `A2` | `B1` | `B2` | `C1` | `C2`
   - `exerciseType`: `cloze` | `translation` | `vocab_recall` | `reading` |
     `theory` | `null`
   - `model`: literal model id (e.g. `claude-sonnet-4-5`,
     `claude-haiku-4-5-20251001`)
   - `env`: `prod` | `dev`
2. WHEN a trace is created THEN `userId` SHALL be set via Langfuse's
   first-class user field (NOT as a tag), so the built-in per-user view
   works without bespoke filtering.
3. WHEN a tag value is unknown or not applicable (e.g. `exerciseType` on a
   theory trace) THEN the tag SHALL be omitted rather than set to a
   sentinel string — except `exerciseType=null` which is allowed for
   surfaces that do not have a single type.

### Requirement 4 — Token usage captured in 4 buckets

**User Story:** As the cost owner, I want each trace's token usage broken
into input / cache-write / cache-read / output, so that the existing
`ClaudeUsageBreakdown` mapping in `cost-model.ts` is preserved end-to-end
and the cache-read ratio is visible per call site.

#### Acceptance Criteria

1. WHEN any Claude call resolves successfully THEN the resulting trace
   generation SHALL record four separate token counts: `inputTokens`,
   `cacheCreationInputTokens`, `cacheReadInputTokens`, `outputTokens` —
   the same field names as `ClaudeUsageBreakdown` in
   `packages/ai/src/cost-model.ts`.
2. WHEN a Langfuse dashboard groups traces by `feature` and `language` THEN
   it SHALL be possible to derive
   `cacheReadInputTokens / (inputTokens + cacheCreationInputTokens +
   cacheReadInputTokens)` per group without bespoke client code.
3. IF Langfuse's built-in cost model does not match Sonnet 4.5 pricing as
   defined in `SONNET_4_5_PRICING` THEN the integration SHALL pass an
   explicit per-token-bucket USD cost computed via `estimateCostUsd` so
   the Langfuse-reported cost agrees with `generation_jobs.cost_usd_estimate`
   to within rounding (≤ $0.0001 per generation).

### Requirement 5 — Tool-use payload as trace output

**User Story:** As an engineer debugging "Claude returned the wrong
evaluation," I want the structured tool-use `input` (the parsed evaluation /
annotation / draft / validation object) to appear in the trace's output
field, not the raw `content` array, so that the most useful payload is one
click away.

#### Acceptance Criteria

1. WHEN a Claude call returns a single `tool_use` block (the case for
   `evaluate`, `validate`, `generate`, `theory-*`) THEN the trace
   generation's `output` SHALL be the parsed tool-use input object (e.g.
   the validated `EvaluationResult`), not the raw `content[]`.
2. WHEN `streamAnnotation` runs THEN the trace's output SHALL be the array
   of validated `WordFlag` items yielded over the stream (collected at
   stream end), and the trace SHALL also include `flaggedCount` and
   `stop_reason` so truncation cases (`AnnotateStreamMaxTokensError`) are
   distinguishable from clean completions.
3. WHEN a Claude call throws (network error, malformed tool use, validation
   parser rejection) THEN the trace generation SHALL record the error
   message and status, and the calling code path SHALL still return its
   normal error response (no observability error reaches the user).

### Requirement 6 — Lambda flush without latency tax

**User Story:** As a user submitting an answer, I do not want tracing to
add measurable latency to my evaluation; as the engineer, I do not want to
lose traces when Lambda freezes between invocations.

#### Acceptance Criteria

1. WHEN a Lambda invocation completes successfully on the Hono API path
   (`infra/lambda/src/index.ts`) THEN a `flushAsync` call SHALL be issued
   in an after-response hook with a hard 200 ms timeout, before the Lambda
   handler returns control to the runtime.
2. WHEN a Lambda invocation completes on the streaming-annotate path
   (`infra/lambda/src/annotate-stream/handler.ts`) THEN `flushAsync` SHALL
   be called after the terminal SSE event is written and before the
   `streamifyResponse` callback returns.
3. WHEN the generation Lambda finishes processing one SQS record THEN
   `flushAsync` SHALL be called before the handler emits its
   `batchItemFailures` response (so each batch invocation drains its
   buffer).
4. WHEN observed end-to-end p95 latency of `POST /exercises/:id/submit`
   is measured with `LANGFUSE_PUBLIC_KEY` set vs. unset THEN the delta
   SHALL be ≤ 25 ms p95 (per `docs/llm-observability.md` NFR-1).
5. IF a `flushAsync` call exceeds its 200 ms budget THEN the timeout SHALL
   be honored (no awaiting beyond it) and a warning SHALL be logged with
   `feature` and `requestId`; the user-facing response SHALL NOT be delayed.

### Requirement 7 — Observability never fails the request

**User Story:** As the engineer on-call, I want a Langfuse outage to be a
non-event — no degraded UX, no failed evaluations, no failed generation
jobs — so that adding observability cannot itself become an incident.

#### Acceptance Criteria

1. IF the Langfuse SDK throws synchronously during client construction
   THEN `createObservedClaudeClient` SHALL log the error and return a
   plain unwrapped Anthropic client (graceful degrade to no-trace mode).
2. IF the Langfuse SDK throws during a trace start/update/flush THEN the
   wrapping logic SHALL catch and `console.warn` (one log per
   invocation, not per event) and the underlying Claude call SHALL still
   resolve / reject on its own merits.
3. IF `flushAsync` rejects or times out THEN the Lambda handler SHALL log
   a warning and return its normal response code — no 5xx attributable
   to Langfuse.
4. WHEN unit tests run with `LANGFUSE_PUBLIC_KEY` unset (the default in
   `vitest`) THEN every existing test in `packages/ai` and
   `infra/lambda` SHALL continue to pass without modification.

### Requirement 8 — Two Langfuse projects, env-isolated keys

**User Story:** As the engineer keeping prod and dev clean, I want prod
traces and dev/local traces routed to separate Langfuse projects, so that
my own local debugging never pollutes the production dashboards.

#### Acceptance Criteria

1. WHEN the production CDK stack (`LanguageDrillStack`) is deployed THEN
   `language-drill/LANGFUSE_PUBLIC_KEY` and
   `language-drill/LANGFUSE_SECRET_KEY` SHALL be read from AWS Secrets
   Manager and injected into each Lambda function's environment.
2. WHEN the dev CDK stack (`LanguageDrillStack-dev`) is deployed THEN
   `language-drill-dev/LANGFUSE_PUBLIC_KEY` and
   `language-drill-dev/LANGFUSE_SECRET_KEY` SHALL be read from AWS
   Secrets Manager and injected into each Lambda function's environment.
3. WHEN `pnpm dev:api` or `pnpm dev:stream` starts locally THEN
   `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` SHALL be loaded from
   `.env` (which the existing dev entry points already source), pointing
   at the `language-drill-dev` Langfuse project — NOT the prod project.
4. WHEN `LANGFUSE_BASE_URL` is unset THEN the integration SHALL default
   to `https://cloud.langfuse.com`. WHEN it is set THEN that value SHALL
   be used (supports a future self-host pivot without code changes).

### Requirement 9 — Dashboard acceptance: five day-one use cases

**User Story:** As the spec author, I will not consider this Phase 1 done
until the five concrete questions from `docs/llm-observability.md` §6 can
be answered from a Langfuse dashboard in under 60 seconds of clicking.

#### Acceptance Criteria

1. WHEN traces have been flowing for ≥ 1 day THEN a chart of "yesterday's
   evaluation cost and average score, broken down by language" SHALL be
   achievable using only Langfuse's built-in metric + group-by selectors
   (no bespoke SQL, no API export).
2. WHEN given a `submissionId` from `user_exercise_history` THEN it SHALL
   be possible to locate the matching trace and view the exact prompt,
   user answer, and tool-use output within 60 seconds.
3. WHEN `EVALUATION_SYSTEM_PROMPT_VERSION` is bumped from `2026-05-08` to
   `2026-05-09` THEN a comparison view SHALL show p95 latency and average
   `grammarAccuracy` for the two cohorts side-by-side.
4. WHEN `generate` and `validate` traces from the same job share an
   `exerciseId` tag THEN it SHALL be possible to compute a per-cell
   (language × cefrLevel × exerciseType) validation-rejection rate
   from cross-trace aggregation.
5. WHEN the evaluation system prompt is unchanged THEN the cache-read
   ratio for `feature='evaluate'` SHALL be visible as a single dashboard
   metric, week-over-week comparable.

### Requirement 10 — Prompt version exports

**User Story:** As an engineer about to edit a prompt, I want a single
exported constant per prompt that I bump in the same PR as the prompt
change, so that the new trace cohort is immediately distinguishable from
the old one in dashboards.

#### Acceptance Criteria

1. WHEN `packages/ai/src/index.ts` is imported THEN it SHALL export the
   following constants (string literals): `EVALUATION_SYSTEM_PROMPT_VERSION`,
   `ANNOTATE_SYSTEM_PROMPT_VERSION`, `GENERATION_PROMPT_VERSION`,
   `VALIDATION_PROMPT_VERSION`, `THEORY_GENERATION_PROMPT_VERSION`,
   `THEORY_VALIDATION_PROMPT_VERSION`.
2. WHEN a prompt constant in `prompts.ts`, `annotate.ts`,
   `generation-prompts.ts`, `validation-prompts.ts`, `theory-prompts.ts`,
   or `theory-validation-prompts.ts` is meaningfully edited (semantic
   change to the system prompt) THEN the corresponding `*_VERSION`
   constant SHALL be bumped in the same PR.
3. WHEN a `*_VERSION` constant changes value THEN any cached system
   prompt at the Anthropic side SHALL be invalidated automatically
   because the cached system text changes — no manual cache flush needed.
4. WHEN this spec is closed THEN either `.github/pull_request_template.md`
   or the relevant section of `CLAUDE.md` SHALL contain a checklist item
   reminding the author to bump the matching `*_VERSION` constant when
   any prompt is edited. (Design decides which file; only one is required.)

## Non-Functional Requirements

### Performance

- **Tracing latency tax ≤ 25 ms p95** on `POST /exercises/:id/submit` and on
  the streaming-annotate Lambda (Req 6.4). Measured by running the route
  with `LANGFUSE_PUBLIC_KEY` set and unset against the same fixture set.
- **Flush hard cap 200 ms.** Beyond that, dropped traces are preferred to
  delayed responses (Req 6.5).
- **Streaming-annotate TTFF unchanged.** The SSE writer must emit its first
  `flag` event no later than it does today; the trace generation may close
  later (on stream end) but MUST NOT block the per-flag writes.

### Security

- **PII boundary** (`docs/llm-observability.md` NFR-3): Langfuse receives
  Clerk `userId` (opaque), the user's raw answer text (necessary for eval
  debugging), and exercise/annotation content. It does NOT receive email,
  name, or any other Clerk profile field.
- **Secrets in AWS Secrets Manager + `.env`** only. Never committed.
  Matches the existing secret-handling pattern in CLAUDE.md.
- **No new inbound surface**: Langfuse SDK calls go outbound from Lambda
  to `cloud.langfuse.com`. CORS, JWT auth, and API Gateway config are
  unchanged.

### Reliability

- **Observability never breaks the request** (Req 7): a Langfuse outage,
  5xx, or SDK exception MUST NOT fail an evaluation, a generation, a
  validation, or an annotation. All SDK calls are wrapped in try/catch.
- **No-op when keys absent** (Req 1 AC 2): a fresh checkout without
  Langfuse env vars MUST run all tests and `pnpm dev` exactly as it did
  before this spec.
- **Reversibility** (`docs/llm-observability.md` NFR-5): removing Langfuse
  means deleting `packages/ai/src/observability.ts`, the three call-site
  swaps, and two env-var entries. No schema changes, no caller signature
  changes.

### Usability (operator-facing)

- **Cost-ceiling visibility**: aim to stay under 25k traces/month
  (half of Langfuse cloud free tier) through Phase 2. When crossed,
  Phase-1 design must leave a clear path to enable sampling on the
  highest-volume call site (`generate`) via `LANGFUSE_SAMPLE_RATE`
  env var — implementation deferred unless / until needed.
- **Dashboard pinned, not just possible**: the five day-one use cases in
  Req 9 MUST be pinned as named dashboards in the Langfuse project before
  this spec is considered done — not just "achievable in principle."

## Open Questions for Design Phase

These mirror `docs/llm-observability.md` §8 and must be answered (or
explicitly deferred) when drafting `design.md`:

1. **`submissionId` shape** (Req 2 AC 7). Three candidates: (a) reuse a
   DB-side autoincrement / uuid issued by `userExerciseHistory`, observed
   after insert; (b) mint a ULID/uuid client-side before the Claude call
   and use it as the history row's id on insert; (c) mint server-side
   inside `evaluate.ts` and return it as part of the response. Option (b)
   is the simplest pivot path (trace exists even on Claude failure) but
   requires a schema decision.
2. **`generate` sampling**. Generation is the highest-volume call site;
   if a week at sample rate 1.0 risks pushing us past 25k traces/month,
   wire `LANGFUSE_SAMPLE_RATE` from env to the SDK in `observability.ts`.
   Defer the actual rate decision to post-deploy measurement.
3. **Storing user answers verbatim**. Currently scoped in (NFR-3) because
   eval debugging needs them. Confirm the privacy policy in `apps/web`
   covers this before any public launch — revisit before Phase 4.
4. **Trace retention vs. eval-dataset workflow**. Langfuse cloud free tier
   retains 30 days; the Phase-2 dataset workflow may need longer. Decide
   in Phase 2 whether to export weekly to S3.
5. **Mobile (Phase 4) trace flow**. When Expo lands and calls the API,
   traces flow through Lambda exactly like web. Confirm this assumption
   when mobile work begins; no Phase-1 code change.

Source-doc free-tier number is 50k traces/month; the 25k operational
target in the Usability section is half of that, intentionally.

