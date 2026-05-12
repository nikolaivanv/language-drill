# Requirements Document

## Introduction

`/read` currently blocks the user behind a single 8–15-second synchronous Claude call: paste a passage, wait, then see the annotated reader. Under load — cold Lambda, cross-region Neon, long passages — the call exceeds the 15 s Lambda timeout and surfaces in the browser as "Failed to fetch" (see PR #48 for the timeout-budget fix and CloudWatch root cause).

This spec replaces that blocking call with a **responsive pipeline** that:

1. Renders the pasted passage immediately so the user can start reading while annotation runs (**async pipeline**).
2. Streams flagged words back via Anthropic's server-side streaming + partial-JSON tool-use, so words tint progressively rather than appearing in one batch (**streaming render**).
3. Replaces the LLM's "which words are above-level?" judgment with a server-side **frequency-dictionary pre-filter**. Claude is only asked about candidate words the dictionary flagged — the call's output is smaller and faster.
4. **Post-filters** flagged candidates against the user's `user_vocabulary` rows for the active language so words the user has already saved are never re-flagged.

The four changes compose: pre-filter shrinks the LLM's job, post-filter personalizes the result, streaming + async make wall-clock latency mostly invisible.

Scope is intentionally narrow:

- IN: `POST /read/annotate` (`infra/lambda/src/routes/read.ts`), `annotateText` (`packages/ai/src/annotate.ts`), `useReadAnnotate` (`packages/api-client/src/hooks/useReadAnnotate.ts`), `apps/web/app/(dashboard)/read/page.tsx` reducer + `AnnotatedView`, frequency-list assets (`packages/ai/src/frequency/`).
- OUT: streaming for any other AI endpoint (`/exercises/:id/submit`, generation pipeline), drill-weaving from `user_vocabulary`, audio/speaking surfaces, mobile/Expo. Saved-entry retrieval (`GET /read/entries/:id`) and the `read_entries.flagged_words` JSONB shape are NOT being changed by this spec — that path is read-from-DB, with no LLM call to stream.

**Compatibility note:** the app has no live users and no API clients outside the web app, so the wire change is free to be a clean break — the previous `AnnotateResponseSchema` JSON envelope is simply deleted. We do not maintain it as a fallback.

## Alignment with Product Vision

- **Active production over passive consumption** (`product.md` §2.1): faster annotation means more sessions get started rather than abandoned. The post-filter against `user_vocabulary` is the first step toward "saved words are personally tracked, not re-asked", which is the production-practice spine.
- **Honest progress, no gamification** (`product.md` §2.2): the user's growing `user_vocabulary` invisibly shrinks the flagged set as they learn. No "X words mastered this week" UI is added — just fewer annotations on words they've banked.
- **Polyglot scope** (`product.md` §2.3): frequency lists and post-filter are per-language. ES/DE/TR ship together; EN remains unsupported as a learning language.
- **Cost discipline** (`tech.md` §13): the pre-filter is the main lever. A 2,000-char passage produces ~30 candidate above-level words instead of ~300 word-form tokens of LLM-evaluated input. Output tokens — the dominant latency factor for tool-use responses — drop proportionally.

## Requirements

### Requirement 1 — Frequency-dictionary pre-filter

**User Story:** As the annotation backend, I want to decide which words are "above-level" with a local frequency lookup instead of asking Claude, so that the LLM call is smaller, faster, and free of frequency-hallucination risk.

#### Acceptance Criteria

1. WHEN the server receives `POST /read/annotate` with `{ text, language }`, THEN it SHALL tokenize the passage server-side and produce a deduplicated list of candidate surface forms whose lemma rank is strictly rarer than `topRank` for the user's CEFR level, before any Claude call is made.
2. The package `@language-drill/ai` SHALL ship a per-language frequency list (`packages/ai/src/frequency/{es,de,tr}.json` or equivalent) keyed by lemma, with `{ rank: number, cefr?: CefrLevel }` values. The asset SHALL be loaded once at module init and SHALL NOT exceed 2 MB per language when bundled.
3. Tokenization SHALL preserve diacritics, lowercase the surface form, and split on Unicode word boundaries. Punctuation, numerals, and single-character tokens SHALL be discarded.
4. Closed-class words (articles, copulas, conjunctions, prepositions, pronouns, modal/auxiliary verbs) SHALL be discarded by a per-language stopword list co-located with the frequency file.
5. WHEN a surface form is not found in the frequency list, THEN it SHALL be treated as a candidate (unknown ≈ rare) and forwarded to the Claude enrichment step.
6. WHEN the candidate list is empty after pre-filter, THEN the server SHALL emit the `meta` event followed immediately by `done` (no `flag` events) WITHOUT calling Claude. The handler SHALL NOT increment the `read_annotation` rate-limit counter in this case.
7. The pre-filter MUST be deterministic given the same `(text, language, proficiencyLevel)` triple — no randomness, no LLM, no external network call.
8. The `topRank` value used by the pre-filter SHALL be the existing `READ_CEFR_TOP_RANK` map already exported from `packages/shared/src/read.ts` by the read-collect spec. No new CEFR→rank mapping SHALL be introduced.
9. Lemmatization strategy per language is a design.md responsibility. The requirement is "lookup by lemma when one can be derived; fall back to surface-form lookup otherwise" — Turkish agglutination and German compounding are explicitly acknowledged as cases the design must address.

### Requirement 2 — User-vocabulary post-filter

**User Story:** As a learner who has already saved a word, I want it to stop being flagged in new passages so the annotated view focuses on what I still need to learn.

#### Acceptance Criteria

1. WHEN the server builds the candidate list (Requirement 1), THEN it SHALL load the user's `user_vocabulary` lemmas for `(userId, language)` and drop any candidate whose `lemma` matches a row's `lemma` OR whose `matchedForm` matches a row's `word`.
2. The post-filter SHALL run AFTER the frequency pre-filter and BEFORE the Claude enrichment call, so already-known words never enter the LLM's input.
3. WHEN `user_vocabulary` returns zero rows, THEN the candidate list SHALL pass through unchanged.
4. The post-filter query SHALL select only `(word, lemma)` for the active language and SHALL run in parallel with the proficiency-level lookup (`Promise.all` with the existing two queries in `routes/read.ts:118`).
5. The post-filter SHALL be skipped (no DB call) when the candidate list from the pre-filter is empty.
6. The persisted entry (`POST /read/entries`) SHALL continue to insert the saved words into `user_vocabulary`; future annotations of new passages SHALL observe those rows on the next call.
7. WHEN the candidate list is empty AFTER the post-filter (every candidate matched a `user_vocabulary` row), THEN the server SHALL emit `meta` followed by `done` without calling Claude AND SHALL NOT write a `usage_events` row — mirrors Requirement 1.6.

### Requirement 3 — Streaming wire protocol

**User Story:** As the read page, I want to receive flagged words one at a time as Claude produces them, so I can tint matches in the DOM without waiting for the full response.

#### Acceptance Criteria

1. WHEN the client POSTs to `/read/annotate`, THEN the server SHALL respond with `Content-Type: text/event-stream` (Server-Sent Events) and `Cache-Control: no-cache, no-transform`. The body SHALL be a sequence of newline-delimited `event:`/`data:` pairs.
2. The protocol SHALL define exactly these event types: `meta`, `flag`, `done`, `error`.
3. Event ordering SHALL be: exactly one `meta` event first, then zero or more `flag` events, then exactly one of `done` or `error` as the terminal event. The server SHALL NOT emit a `flag` before `meta`, SHALL NOT emit both `done` and `error`, and SHALL NOT emit any event after the terminal one.
4. The `meta` event SHALL carry `{ calibration: { cefr: CefrLevel, top: number }, candidateCount: number }`. `candidateCount` is the size of the pre-filtered + post-filtered list and is used by the client to render a determinate progress indicator.
5. Each `flag` event SHALL carry exactly one flagged word: `{ matchedForm: string, lemma: string, pos: string, gloss: string, example: string, freq: number, cefr: CefrLevel }`. Order SHALL be the order Claude produces tool-use array items.
6. WHEN two `flag` events arrive with the same `matchedForm`, THEN the client SHALL apply last-write-wins semantics by key. The server MAY dedupe upstream but is not required to.
7. The `done` event SHALL carry `{ flaggedCount: number }`.
8. WHEN any unrecoverable failure occurs (Claude error, JSON parse error, network), THEN the server SHALL emit a single `error` event with payload `{ code: 'AI_UNAVAILABLE' | 'VALIDATION_ERROR' | 'RATE_LIMIT_EXCEEDED' | 'UNSUPPORTED_LANGUAGE', message: string }` and close the stream.
9. The server SHALL flush each event immediately, with no batching window. The wire transport (API Gateway HTTP API integration vs. Lambda Function URL with response streaming vs. Lambda Web Adapter) is a design.md responsibility — this requirement defines the contract, not the platform mechanism.
10. Rate-limit (429) and validation (400) checks that fire BEFORE the stream starts SHALL be returned as normal JSON responses with the existing status codes — they do not need stream semantics because no work has been started.
11. The `AnnotateResponseSchema` Zod envelope SHALL be removed from `packages/api-client/src/schemas/read.ts` and replaced by per-event Zod schemas. `WordFlagSchema` / `FlaggedMapSchema` exports from `@language-drill/shared` continue to exist (they describe the persisted `read_entries.flagged_words` JSONB shape, which is not being reshaped).

### Requirement 4 — Streaming Claude call

**User Story:** As the annotation backend, I want to stream Claude's tool-use output, so each flagged word can be forwarded to the client as soon as it's produced.

#### Acceptance Criteria

1. WHEN `annotateText` is called, THEN it SHALL use the Anthropic SDK's streaming API (`client.messages.stream`) with the same tool-use schema and `tool_choice` as today.
2. The function signature SHALL change from `Promise<AnnotateOutput>` to an async iterator yielding `{ kind: 'flag', flag: WordFlag & { matchedForm: string } } | { kind: 'done', flaggedCount: number }`. Errors SHALL be thrown — the caller maps them to the wire `error` event.
3. WHEN the Anthropic stream emits a partial tool-use JSON delta that completes a single array item in `flagged`, THEN the function SHALL parse that item, validate it against `WordFlagSchema + matchedForm`, and yield a `flag` event. Partial deltas that do not complete an item SHALL NOT yield.
4. The user prompt to Claude SHALL be modified to pass only the **candidate words list** (from Requirements 1 + 2) instead of the full passage. The prompt instructs Claude to "for each of the following words found in the passage, emit a flag entry with lemma/pos/gloss/example" — purely an enrichment task, not a selection task.
5. The system prompt SHALL be revised so that the "Selection Rule" section no longer instructs Claude to filter by frequency/CEFR (selection now happens server-side). Per-language morphology guidance and tool-use instructions SHALL remain.
6. `max_tokens` SHALL be `8192` — chosen empirically by PR #49 to cover a worst-case 40-entry enrichment response (~150–200 tokens per `WordFlag` × 40 ≈ 7k tokens, with headroom). The original spec value of `2048` was too low; PR #49 hit `stop_reason: max_tokens` silently and surfaced as a 502.
7. The system prompt SHALL keep its `cache_control: ephemeral` marker so the warmed prefix continues to be re-used across calls.
8. WHEN a single tool-use array item fails `WordFlagSchema + matchedForm` validation, THEN the function SHALL drop that item silently AND log it at `console.warn` level; the stream SHALL continue with subsequent items. One bad item from the LLM SHALL NOT abort the whole annotation.
9. WHEN the client disconnects mid-stream (`AbortController.abort()` or TCP close), THEN the server SHALL abort the upstream Anthropic stream (`AbortController` passed into the SDK call) AND SHALL NOT write a `usage_events` row. Tokens already consumed by Anthropic are accepted as sunk cost; the goal is to prevent runaway generation for an abandoned client.

### Requirement 5 — Client-side async + streaming render

**User Story:** As a learner, I want the passage to appear immediately when I click "annotate", and watch flagged words tint in real time, so the wait never blocks me from reading.

#### Acceptance Criteria

1. WHEN the user clicks "annotate →" with valid input, THEN the page SHALL transition to the `annotated` view IMMEDIATELY with the raw pasted text rendered (no flagged tints yet) before any network response has returned.
2. The client SHALL open the SSE stream via `fetch(... , { method: 'POST', body, headers })` and consume the response body as a `ReadableStream`. `EventSource` SHALL NOT be used because POST + Authorization headers are required.
3. WHEN a `meta` event arrives, THEN the reducer SHALL store `calibration` and `candidateCount`. The header strip in `AnnotatedView` SHALL show "annotating · 0 / <candidateCount>" with a determinate progress indicator.
4. WHEN a `flag` event arrives, THEN the reducer SHALL merge that one word into `state.flaggedMap` and the reader SHALL re-render — only the newly flagged surface form's spans SHALL gain the tint class (other words SHALL NOT re-render). Progress SHALL update to "annotating · N / candidateCount".
5. WHEN the `done` event arrives, THEN the header strip SHALL switch from "annotating…" to the normal calibration eyebrow ("~<CEFR>+ calibration"). The save-button affordance SHALL become enabled.
6. WHEN an `error` event arrives, THEN the reducer SHALL surface the existing `AnnotatedError` component for that error code AND SHALL retain whatever flagged words have already streamed in — the user is not punished for a partial failure.
7. WHEN the user clicks "edit text" or navigates away mid-stream, THEN the fetch SHALL be aborted via `AbortController` and any in-flight events SHALL be discarded. No partial save SHALL occur.
8. The save flow (Requirement 8 of the read-collect spec) SHALL be disabled until either `done` or `error` has been received — a partial annotation is not a save-worthy state.
9. The existing `useReadAnnotate` mutation hook SHALL be reshaped into a streaming hook exposing `{ start, abort, state: 'idle' | 'streaming' | 'complete' | 'error', flaggedMap, candidateCount, flaggedCount, error }`. TanStack Query is not the right primitive for streams — the hook SHALL manage its own state. The exact hook name is design.md's call.
10. WHEN the response body closes WITHOUT a `done` or `error` event having been received (TCP reset, Lambda crash, integration timeout), THEN the client SHALL surface `AnnotatedError` with `code: 'AI_UNAVAILABLE'` AND SHALL retain whatever flagged words have already streamed in.

### Requirement 6 — Rate limiting and usage events

**User Story:** As the backend, I want the existing daily evaluation cap to continue working with the streaming pipeline, so cost controls don't regress.

#### Acceptance Criteria

1. The 429 rate-limit check (`DAILY_EVAL_LIMIT`, `routes/read.ts:141`) SHALL run BEFORE the stream is opened. WHEN the cap is exceeded, THEN the server SHALL respond with the existing JSON 429 shape, NOT an SSE stream.
2. The `usage_events` insert SHALL run on the `done` event path only — exactly once per successful streamed annotation. WHEN the stream ends via `error`, THEN no usage row SHALL be written (matches today's 502 behavior).
3. WHEN the candidate list is empty after pre-filter + post-filter (Requirement 1.6), THEN no `usage_events` row SHALL be written because no Claude call was made.
4. The `metadata` JSON on the usage row SHALL gain a `candidateCount` field alongside the existing `language`, `textLength`, `flaggedCount`.
5. The daily cap is enforced at request start (before the stream opens). N concurrent in-flight requests from the same user MAY transiently exceed the cap by up to N − 1; this is accepted as the cost of not gating on a distributed counter. Today's handler has the same property and no regression is being introduced.

## Non-Functional Requirements

### Performance

- **Time-to-passage-paint** SHALL be ≤ 100 ms after click (client-side only — no network).
- **Time-to-first-flag** (`flag` event 1 visible) SHALL be ≤ 3 s p95 on a warm Lambda, ≤ 6 s p95 on a cold Lambda, for a 2,000-char passage.
- **Time-to-done** SHALL be ≤ 12 s p95 on a warm Lambda, ≤ 18 s p95 on a cold Lambda, for a 2,000-char passage with 30 candidate words. Cold-Lambda budget is given headroom because Neon WebSocket handshake adds 1–3 s on the first query (the PR #48 root cause).
- The frequency-dictionary lookup SHALL complete in ≤ 50 ms p99 for a 2,000-char passage (single-pass tokenization + map lookups).
- The streamed response SHALL produce flagged events with no more than 50 ms of server-side buffering between the SDK delta and the wire flush.

### Security

- The SSE endpoint SHALL keep the existing Clerk JWT requirement; `OPTIONS` preflight SHALL continue to bypass the authorizer (no change).
- Frequency lists SHALL NOT contain user data — they are read-only static assets bundled with the Lambda.
- The `user_vocabulary` query SHALL filter by the authenticated `userId` exclusively; no cross-user leakage.

### Reliability

- WHEN the Anthropic stream drops mid-response, THEN the server SHALL emit `error` with `code: 'AI_UNAVAILABLE'` AND SHALL log the underlying SDK error to CloudWatch. The client SHALL preserve already-streamed flags (Requirement 5.6).
- WHEN the Lambda's 29 s timeout is reached mid-stream, the API Gateway integration timeout SHALL cause the connection to close; the client's `AbortController` SHALL catch this and surface `AnnotatedError` with `code: 'AI_UNAVAILABLE'`.
- Frequency-list and stopword loading SHALL fail fast at module init if the JSON is malformed (Lambda init crash > silent wrong-list behavior).

### Usability

- The progress indicator in the header strip SHALL be visually distinct from the existing calibration eyebrow so the user can tell at a glance whether annotation is still running.
- The reader pane SHALL NOT shift layout when a `flag` event tints a span — the highlight is a background-color change only, no width/height impact.
- WHEN annotation completes with zero flags (in-level passage), THEN the calibration eyebrow SHALL read "~<CEFR>+ calibration · no above-level words" so the user understands the silence is intentional, not a bug.
