# Implementation Plan

## Task Overview

The work is sequenced smallest-blast-radius first so each layer lands green before the next depends on it:

1. **SDK timeout/retries (Req 4)** — extend `createObservedClaudeClient`; cheap, isolated, unblocks the model swap and the stream call sites.
2. **Haiku swap (Req 3)** — one constant + comment + tests; the eval-harness gate is a separate, explicitly-flagged validation step.
3. **Deep-card streaming (Req 1, 2)** — the bulk: `packages/ai` primitives (`extractCompletedFields`, `streamSpan`) → annotate-stream handler deep flow + path dispatch → Hono route removal → `api-client` schemas + hook → web page/reducer wiring → E2E mock.
4. **Docs (Req 5)** — the Groq/Cerebras writeup.
5. **Whole-suite gate** — `pnpm lint && pnpm typecheck && pnpm test`, then the eval-harness gate for the Haiku decision.

Each task writes/updates tests in the module's existing test file and runs them before being marked complete (per CLAUDE.md Testing rules). The deep-card flow keeps the same DB side effects, rate-limit bucket, and observability the removed Hono route had.

## Steering Document Compliance

- **`packages/ai`** owns Claude wrappers/prompts → primitives, model/timeout constants, model swap.
- **`infra/lambda/src/annotate-stream/`** owns the SSE runtime → deep flow, path dispatch, dev-server routing.
- **`packages/api-client`** owns shared hooks + Zod schemas → stream hook + event schemas.
- **`apps/web/app/(dashboard)/read/`** owns the read UI → reducer action + page wiring + E2E.
- **No `*_PROMPT_VERSION` bump** anywhere (no prompt-body edit — Req 3.5).
- Tests live in each module's existing `*.test.ts(x)` file; no orphaned test files.

## Atomic Task Requirements
**Each task must meet these criteria for optimal agent execution:**
- **File Scope**: Touches 1-3 related files maximum
- **Time Boxing**: Completable in 15-30 minutes
- **Single Purpose**: One testable outcome per task
- **Specific Files**: Must specify exact files to create/modify
- **Agent-Friendly**: Clear input/output with minimal context switching

## Task Format Guidelines
- Use checkbox format: `- [ ] Task number. Task description`
- **Specify files**: Always include exact file paths to create/modify
- Reference requirements using: `_Requirements: X.Y_`
- Reference existing code to leverage using: `_Leverage: path/to/file.ts_`

## Tasks

### Phase A — SDK timeout / retries (Req 4)

- [x] 1. Extend `createObservedClaudeClient` to accept client options
  - File: `packages/ai/src/observability.ts`
  - Change signature to `createObservedClaudeClient(apiKey: string, opts?: { timeout?: number; maxRetries?: number }): Anthropic`; pass `{ apiKey, ...opts }` to `new Anthropic(...)` before the `wrapAnthropic` branch. Omitting `opts` must be behavior-identical to today.
  - Purpose: one robust place to set per-surface timeout/retries that survives the Langfuse Proxy wrapper.
  - _Leverage: packages/ai/src/observability.ts (existing factory + wrapAnthropic)_
  - _Requirements: 4.1, 4.2, 4.3, 4.4_

- [x] 2. Add `createObservedClaudeClient` options test
  - File: `packages/ai/src/observability.test.ts`
  - Assert (Langfuse-disabled path) that `timeout`/`maxRetries` reach the constructed `Anthropic` client, and that calling with no `opts` is unchanged. Run the file's tests.
  - _Leverage: packages/ai/src/observability.test.ts_
  - _Requirements: 4.1, 4.4_

### Phase B — Evaluation model swap (Req 3)

- [x] 3. Swap the evaluation model to Haiku 4.5 with timeout/retries
  - Files: `packages/ai/src/evaluate.ts`, `infra/lambda/src/routes/exercises.ts`
  - In `evaluate.ts`: change `MODEL` to `"claude-haiku-4-5-20251001"`; add a rationale comment mirroring the `STREAM_MODEL` precedent comment in `annotate.ts`; add named constants `EVAL_REQUEST_TIMEOUT_MS` (~15000–20000) and `EVAL_MAX_RETRIES = 1`; apply them either via the client (pass through the route's `createObservedClaudeClient` call) or as `messages.create(params, { maxRetries: EVAL_MAX_RETRIES, timeout: EVAL_REQUEST_TIMEOUT_MS })`. Do NOT bump `EVALUATION_SYSTEM_PROMPT_VERSION` (no prompt-body edit). If the timeout/retries are applied at the client, update the `createObservedClaudeClient(...)` call in `exercises.ts` to pass the options.
  - Purpose: faster, cheaper evaluation; fail-fast tail.
  - _Leverage: packages/ai/src/annotate.ts (STREAM_MODEL comment precedent), packages/ai/src/evaluate.ts, infra/lambda/src/routes/exercises.ts_
  - _Requirements: 3.1, 3.4, 3.5, 4.1, 4.5_

- [x] 4. Update evaluation tests for the new model + retry options
  - File: `packages/ai/src/evaluate.test.ts`
  - Assert the request uses `claude-haiku-4-5-20251001` and passes the expected `maxRetries`/`timeout`; keep all tool-use/schema/parse assertions unchanged. Run the file's tests.
  - _Leverage: packages/ai/src/evaluate.test.ts_
  - _Requirements: 3.1, 4.1, 4.5_

### Phase C — `packages/ai` streaming primitives (Req 1)

- [x] 5. Implement `extractCompletedFields` partial-JSON parser
  - File: `packages/ai/src/annotate.ts` (add alongside `extractNewItems`)
  - `export function extractCompletedFields(buffer: string, alreadyEmitted: number): Array<{ key: string; value: unknown }>` — scan a partial tool-input object for fully-closed top-level `"key": value` pairs (string/number/bool/object/array) using the same depth + in-string + escape tracking as `extractNewItems`; return only entries beyond `alreadyEmitted`; never throw (skip a malformed fragment, retry next call).
  - Purpose: object-property sibling of `extractNewItems` for single-object streaming.
  - _Leverage: packages/ai/src/annotate.ts (extractNewItems scanner)_
  - _Requirements: 1.1, 1.2_

- [x] 6. Add byte-boundary contract tests for `extractCompletedFields`
  - File: `packages/ai/src/annotate.test.ts` (or the existing `annotate-stream`/extractNewItems test file)
  - Split a known word-card JSON at every byte boundary; assert each top-level key emitted exactly once, in order, never duplicated; nested objects/arrays emitted only when fully closed; malformed fragment skipped not thrown. Run the tests.
  - _Leverage: existing extractNewItems contract tests in packages/ai_
  - _Requirements: 1.1, 1.2_

- [x] 7. Implement `streamSpan` generator + `ReadSpanStreamMaxTokensError`
  - File: `packages/ai/src/read-span.ts`
  - Add `ReadSpanStreamEvent` union (`field` | `done`), `ReadSpanStreamMaxTokensError` (mirror `AnnotateStreamMaxTokensError`), and `export async function* streamSpan(client, input & { signal? })`. Reuse `getPromptOrFallback`, `pickSpanTool`, `MODEL`, `MAX_TOKENS`, `buildSpanUserPrompt`. Use `client.messages.stream(params, { signal, maxRetries: 1 })` (no client timeout — defer to the soft deadline); accumulate `input_json_delta`; `yield {kind:"field"}` per `extractCompletedFields`; on `finalMessage()` throw `ReadSpanStreamMaxTokensError` if `stop_reason === "max_tokens"`, else `yield {kind:"done", card: parseSpanResult(finalToolInput)}`. Keep non-streaming `annotateSpan` intact.
  - Purpose: streaming counterpart to `annotateSpan` with authoritative final validation.
  - _Leverage: packages/ai/src/annotate.ts (streamAnnotation, AnnotateStreamMaxTokensError), packages/ai/src/read-span.ts (annotateSpan, parseSpanResult, pickSpanTool)_
  - _Requirements: 1.1, 1.3, 1.4, 1.5, 4.2_

- [x] 8. Add `streamSpan` unit tests
  - File: `packages/ai/src/read-span.test.ts`
  - Mock the Anthropic stream to yield scripted `input_json_delta` chunks + `finalMessage`; assert ordered `field` events then a `done` whose card equals `parseSpanResult(fullInput)`; assert `ReadSpanStreamMaxTokensError` on `stop_reason: "max_tokens"`; assert abort via `signal`. Run the tests.
  - _Leverage: packages/ai/src/read-span.test.ts, streamAnnotation tests_
  - _Requirements: 1.1, 1.3, 1.4, 1.5_

- [x] 8.1. Set `maxRetries: 1` on the skim `streamAnnotation` call
  - Files: `packages/ai/src/annotate.ts`, `packages/ai/src/annotate.test.ts`
  - Add `maxRetries: 1` (named constant + comment, no client `timeout` — defer to the soft deadline) to the existing `client.messages.stream(params, { signal })` options object in `streamAnnotation`, so the skim stream matches the deep stream's retry posture. Update the stream test to assert the option is passed. Run the tests.
  - Purpose: complete Req 4.3 for the skim path (the deep path is covered by task 7).
  - _Leverage: packages/ai/src/annotate.ts (streamAnnotation call site)_
  - _Requirements: 4.3_

- [x] 9. Export the new streaming symbols from the `packages/ai` barrel
  - File: `packages/ai/src/index.ts`
  - Re-export `streamSpan`, `ReadSpanStreamMaxTokensError`, `ReadSpanStreamEvent`, and `extractCompletedFields`. Run `pnpm --filter @language-drill/ai typecheck`.
  - _Leverage: packages/ai/src/index.ts_
  - _Requirements: 1.1_

### Phase D — annotate-stream handler deep flow (Req 1, 2)

- [x] 10. Extend the SSE writer with a `field` event type
  - File: `infra/lambda/src/annotate-stream/sse.ts`
  - Add `"field"` to `SseEventType`. No other change (terminal types/invariant unchanged). Update/extend the writer's test if it pins the event-type union.
  - _Leverage: infra/lambda/src/annotate-stream/sse.ts_
  - _Requirements: 1.1, 1.8_

- [x] 11. Add the deep-span request schema
  - File: `infra/lambda/src/annotate-stream/handler.ts` (or a small `annotate-stream/schemas.ts`)
  - `AnnotateSpanStreamRequest` Zod: `text` (1..`READ_TEXT_MAX_CHARS`), `language` (full `Language` enum; EN → `UNSUPPORTED_LANGUAGE`), `start` int ≥0, `end` int, `entryId?` `z.string().uuid()`. Cross-field `start < end <= text.length` validated in the flow → `VALIDATION_ERROR`.
  - _Leverage: infra/lambda/src/routes/read.ts (AnnotateSpanBodySchema), handler.ts (AnnotateRequestSchema)_
  - _Requirements: 2.2, 2.4_

- [x] 12. Extract shared handler gates + flush into reusable helpers
  - File: `infra/lambda/src/annotate-stream/handler.ts`
  - Refactor gates 1–5 (OPTIONS, method, JSON parse, EN check, JWT) and the `try/finally` flush into small helpers callable by both the skim and deep flows, with NO behavior change to the existing skim path. Keep skim tests green.
  - Purpose: enable path dispatch without duplicating the gates.
  - _Leverage: infra/lambda/src/annotate-stream/handler.ts_
  - _Requirements: 1.7, 2.7_

> **Implementer note:** Task 13 is the highest-risk unit in this plan; it is split into 13a (pre-model gates, no Claude call) and 13b (the stream loop + side effects) for time-boxing. Slow down here and lean on task 16's test net.

- [x] 13a. Deep-flow pre-model gates: validation, span type, cache hit, rate-limit, profile
  - File: `infra/lambda/src/annotate-stream/deep-flow.ts` (new)
  - `handleDeepSpan(event, writer, userId, …)` up to (not including) the model call: validate offsets (`start < end <= text.length`) → `VALIDATION_ERROR`; `resolveSpanType`; **cache hit** (saved entry's `span_annotations["start:end"]`) → `openSse()`, one `field` per top-level key + terminal `done`, NO model call / NO meter; else **dedicated rate-limit** query on `eventType = 'read_span_annotation'` with named `READ_SPAN_DAILY_LIMIT = 150` (NOT the skim 50-bucket) → `RATE_LIMIT_EXCEEDED`; resolve CEFR profile with B1 `DEFAULT_PROFICIENCY_LEVEL` fallback (`isCefrLevel`). Leave a clear seam where 13b plugs in the stream.
  - Purpose: every server-authoritative pre-model decision, isolated from the model call.
  - _Leverage: infra/lambda/src/routes/read.ts (cache/rate-limit/profile SQL), infra/lambda/src/routes/read-span-utils.ts (resolveSpanType)_
  - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [x] 13b. Deep-flow model stream + side effects: trace, streamSpan loop, write-back, meter, terminal
  - File: `infra/lambda/src/annotate-stream/deep-flow.ts` (continue from 13a)
  - Reuse soft-deadline (`SOFT_DEADLINE_MS`) + `responseStream.on("close")` abort; `withLlmTrace({ feature:"annotate-span", promptVersion: READ_SPAN_PROMPT_VERSION, … })` running the `streamSpan` loop (write each `field`, collect the final `done` card); on success best-effort write-back into `read_entries.span_annotations` (scoped id+user) + best-effort meter exactly one `read_span_annotation` usage row + terminal `done`; on throw/abort/deadline → terminal `error` `AI_UNAVAILABLE` iff `!writer.terminated`; no meter on abort.
  - Purpose: the streaming model call and all post-success side effects, preserving the removed route's behavior.
  - _Leverage: infra/lambda/src/annotate-stream/handler.ts (soft-deadline/abort/trace pattern), infra/lambda/src/routes/read.ts (write-back/meter SQL), packages/ai (streamSpan, withLlmTrace, createObservedClaudeClient)_
  - _Requirements: 1.1, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 2.5, 2.6, 2.7_

- [x] 14. Wire path dispatch into the handler
  - File: `infra/lambda/src/annotate-stream/handler.ts`
  - After the shared gates, branch on `event.requestContext?.http?.path` (fallback `rawPath`): `endsWith('/read/annotate-span')` → `handleDeepSpan`, else the existing skim flow. Keep the skim path reachable at the bare base URL.
  - _Leverage: handler.ts, deep-flow.ts_
  - _Requirements: 1.1_

- [x] 15. Route the deep path in the local dev server
  - File: `infra/lambda/src/annotate-stream/dev.ts`
  - Ensure the dev server forwards `POST /read/annotate-span` to the handler with `requestContext.http.path` set (it already sets `path = url.pathname`); confirm `DEV_USER_ID` auth bypass applies to the deep path too. Manually smoke `pnpm dev:stream` if practical.
  - _Leverage: infra/lambda/src/annotate-stream/dev.ts_
  - _Requirements: 1.1, 2.4_

- [x] 16. Add handler/deep-flow integration tests
  - File: `infra/lambda/src/annotate-stream/handler.test.ts` (or extend the existing annotate-stream test) — migrate the relevant `read.test.ts` deep cases here
  - Cover: path routing (skim vs deep); cache-hit emits `field`+`done` with no `streamSpan` call and no meter; offset/EN/body validation; dedicated `read_span_annotation` rate-limit at 150 (not 50); write-back SQL only for saved entries; exactly one usage row on a real call; no meter on abort; flush-once on every path; single-terminal invariant. Mock `streamSpan` + DB. Run the tests.
  - _Leverage: infra/lambda/src/routes/read.test.ts, existing annotate-stream tests_
  - _Requirements: 1.4, 1.5, 1.6, 1.7, 1.8, 2.1, 2.2, 2.3, 2.5, 2.6, 2.7_

- [x] 17. Remove the Hono `/read/annotate-span` route
  - Files: `infra/lambda/src/routes/read.ts`, `infra/lambda/src/routes/read.test.ts`
  - Delete the `POST /read/annotate-span` handler and any now-unused imports/constants (`annotateSpan`, `AnnotateSpanBodySchema`, `READ_SPAN_DAILY_LIMIT` if unused here, etc.); remove/relocate its `read.test.ts` cases (covered by task 16). Keep all other read routes. Run `read.test.ts`.
  - _Leverage: infra/lambda/src/routes/read.ts, read.test.ts_
  - _Requirements: 1.1_

### Phase E — `api-client` schemas + streaming hook (Req 1, 2)

- [x] 18. Add deep-stream SSE event schemas
  - File: `packages/api-client/src/schemas/read.ts`
  - Add `AnnotateSpanFieldEventSchema = z.object({ key: z.string(), value: z.unknown() })` and `AnnotateSpanDoneEventSchema = z.object({ card: DeepCardSchema })` (+ inferred types); reuse `AnnotateErrorEventSchema`. Remove the now-unused `AnnotateSpanResponseSchema` only if nothing else imports it (otherwise leave). Update `schemas/read.test.ts` to round-trip the new events. Run tests.
  - _Leverage: packages/api-client/src/schemas/read.ts (existing Annotate*EventSchema), packages/shared DeepCardSchema_
  - _Requirements: 1.1, 1.3_

- [x] 19. Implement `useReadAnnotateSpanStream` hook
  - File: `packages/api-client/src/hooks/useReadAnnotateSpanStream.ts` (new)
  - Mirror `useReadAnnotateStream`: `"use client"`, `useReducer` + `runStream` + `handleFrame` over `fetchSse`; POST to `${baseUrl.replace(/\/$/,'')}/read/annotate-span`; state `idle | streaming(partial, span) | complete(card, span) | error(error, span)`; merge `field` into `partial`; on `done` → `complete` + `onResolved(card, span)`; abort silent; stream-end-without-terminal → `AI_UNAVAILABLE`; map 401/429/400 via `mapStatusToCode`.
  - Purpose: progressive client consumer for the deep card.
  - _Leverage: packages/api-client/src/hooks/useReadAnnotateStream.ts, packages/api-client/src/sse-client.ts_
  - _Requirements: 1.1, 1.2, 1.3, 1.5_

- [x] 20. Add `useReadAnnotateSpanStream` tests + barrel export
  - Files: `packages/api-client/src/hooks/useReadAnnotateSpanStream.test.ts` (new), `packages/api-client/src/index.ts`
  - Drive `handleFrame` with `field`/`done`/`error` frames: assert progressive `partial`, terminal `complete` firing `onResolved`, partial discard on mid-stream error, abort silence. Add the new hook to the barrel export. **Do NOT delete `useReadAnnotateSpan` here** — the web page still imports it until task 22; deleting now would break the build. Run tests.
  - _Leverage: packages/api-client/src/hooks/useReadAnnotateStream.test.ts_
  - _Requirements: 1.2, 1.3, 1.5, 2.8_

### Phase F — web read page wiring (Req 1, 2)

- [x] 21. Add a progressive `DEEP_CARD_FIELD` action to the read-page reducer
  - File: `apps/web/app/(dashboard)/read/_state/read-page-reducer.ts`
  - Add a `DEEP_CARD_FIELD` (or `DEEP_CARD_PROGRESS`) action that merges a streamed `{ key, value }` into the open deep-card slice's partial card while `status` is the streaming state; keep `DEEP_CARD_RESOLVED`/`DEEP_CARD_ERROR`/`OPEN_DEEP_CARD`/`DISMISS_DEEP_CARD` semantics. Update `read-page-reducer.test.ts`. Run tests.
  - _Leverage: apps/web/app/(dashboard)/read/_state/read-page-reducer.ts_
  - _Requirements: 1.2, 1.3_

- [x] 22. Swap the read page to the streaming span hook and retire the old hook
  - Files: `apps/web/app/(dashboard)/read/page.tsx`, `packages/api-client/src/hooks/useReadAnnotateSpan.ts` (delete), `packages/api-client/src/hooks/useReadAnnotateSpan.test.ts` (delete), `packages/api-client/src/index.ts` (drop the old export)
  - Replace `useReadAnnotateSpan({ fetchFn })` with `useReadAnnotateSpanStream({ baseUrl: process.env.NEXT_PUBLIC_ANNOTATE_STREAM_URL ?? '', getToken, onResolved })` (remove the old import); before `start(span)`, short-circuit on a `spanAnnotations` session-map hit (dispatch `DEEP_CARD_RESOLVED`, no stream); dispatch `DEEP_CARD_FIELD` on partial updates and `DEEP_CARD_RESOLVED`/`DEEP_CARD_ERROR` on terminal; in `onResolved`, write the card through into `['readEntry', entryId]` query cache for saved entries (replacing the old `onSuccess`). Now that the page no longer imports it, delete `useReadAnnotateSpan` + its test and remove its barrel export. This is the deterministic deletion point (task 20 only added the new export).
  - Purpose: progressive deep-card UX preserving cache/within-session behavior; remove the dead mutation hook in the same step that frees it.
  - _Leverage: apps/web/app/(dashboard)/read/page.tsx (existing handleDeep*/getToken/entry cache), useReadAnnotateStream usage as the pattern_
  - _Requirements: 1.1, 1.2, 1.5, 2.8_

- [x] 23. Update read page component tests
  - File: `apps/web/app/(dashboard)/read/page.test.tsx`
  - Replace the `mockUseReadAnnotateSpan` mutation mock with a `useReadAnnotateSpanStream` state mock; assert progressive render (a field visible mid-stream), terminal card, error/retry, and the repeat-tap cache short-circuit (no `start` call). Run tests.
  - _Leverage: apps/web/app/(dashboard)/read/page.test.tsx_
  - _Requirements: 1.2, 1.5, 2.8_

- [x] 23.1. Render the streamed `partial` in the deep-card loading branch (Req 1.2)
  - Files: `apps/web/app/(dashboard)/read/_components/word-card-body.tsx`, `apps/web/app/(dashboard)/read/_components/__tests__/word-popover.test.tsx`
  - Gap surfaced during task 23: the reducer's `loading` slice carries `partial: Partial<DeepCard>` and the page now merges streamed fields into it (tasks 21/22), but `DeepCardContent`'s `loading` branch renders only `<DeepCardSkeleton />`, so the streamed `partial` is never displayed — Req 1.2 ("render the fields received so far … before the later optional sections") is unmet for cold/phrase/sentence taps (flagged taps are covered by the skim preview). Add a `DeepCardPartial` preview that renders the top-level text fields present so far (headword `surface`; the primary meaning — word `contextualSense` / phrase `idiomaticMeaning` / sentence `translation`; the secondary line — word `definition` / phrase `literal`) above the "looking it up…" caption, and falls back to `<DeepCardSkeleton />` when `partial` has no displayable field yet (preserving instant-open + the empty-`partial` tests). Wire it into the `loading` branch only — do NOT touch the skim-preview-during-load path for flagged words (Req 3.1). Add component tests: empty `partial` → skeleton; populated `partial` → fields visible while still "looking it up…". Run tests.
  - Purpose: make the deep card actually stream-in field-by-field, satisfying Req 1.2 and giving task 24's E2E "a field renders before `done`" something real to observe.
  - _Leverage: apps/web/app/(dashboard)/read/_components/word-card-body.tsx (DeepCardSkeleton, DeepCardContent), the resolved layouts (DeepWordCardBody/PhraseCardBody/SentenceCardBody) for field labels_
  - _Requirements: 1.2_

- [x] 24. Update the deep-card E2E mock to SSE
  - File: `apps/web/e2e/tests/authenticated/read.spec.ts`
  - Replace the JSON `**/read/annotate-span` route mocks with an SSE response (`text/event-stream` emitting `field`→`done` frames) against the Function URL path; assert a field renders before `done`, the final card is correct, and the error/retry path works.
  - _Leverage: apps/web/e2e/tests/authenticated/read.spec.ts (existing annotate-span mocks)_
  - _Requirements: 1.1, 1.2, 1.3, 1.5_

### Phase G — CDK output wording (Req 1)

- [x] 25. Update the Function URL CFN output description
  - Files: `infra/lib/stack.ts`, `infra/lib/constructs/annotate-stream-lambda.test.ts`
  - Update the `AnnotateStreamUrl` output description to note it now serves both `/read/annotate` and `/read/annotate-span`; confirm the construct test still pins `InvokeMode: RESPONSE_STREAM` / `AuthType: NONE` and synths. No functional construct change. Run the construct test.
  - _Leverage: infra/lib/stack.ts, infra/lib/constructs/annotate-stream-lambda.test.ts_
  - _Requirements: 1.1_

### Phase H — Documentation (Req 5)

- [x] 26. Write the Groq/Cerebras fast-inference exploration doc
  - File: `docs/llm-fast-inference-exploration.md` (new)
  - Capture: the opportunity (very-high-throughput inference, benefit scales with output size → deep cards > evaluation); why deferred; trade-offs (non-Claude families, loss of Anthropic prompt caching, prompt re-tuning + re-validation, new provider/secret/observability wiring, availability risk); the plan to benchmark any candidate head-to-head via `pnpm eval` (quality/cost/latency) before adoption; why AI Gateway isn't a natural fit (calls run in Lambda, not Vercel). Cross-link from this spec's requirements. No runtime code touched.
  - _Leverage: docs/ existing structure; this spec's requirements.md Req 5_
  - _Requirements: 5.1, 5.2, 5.3_

### Phase I — Gates

- [x] 27. Whole-suite green gate
  - Run from repo root: `pnpm lint && pnpm typecheck && pnpm test`. Fix any failures introduced by the above. Report X passed / Y failed.
  - _Leverage: package.json scripts_
  - _Requirements: all_

- [x] 28. Eval-harness gate for the Haiku swap (validation step, may require maintainer creds)
  - Run `pnpm eval:export` (Sonnet-baseline dataset) then `pnpm eval` with the Haiku candidate; compare `./eval-runs/*.json` quality/cost/latency to the Sonnet baseline against the Req 3.3 bar (>5% score-agreement drop OR any error-detection regression → revert the single `MODEL` constant). Record the outcome. Requires `ANTHROPIC_API_KEY` + Langfuse creds + a populated dataset; if unavailable in this environment, hand off to the maintainer with the exact commands.
  - _Leverage: pnpm eval:export, pnpm eval (CLAUDE.md eval workflow)_
  - _Requirements: 3.2, 3.3_
