# Implementation Plan

## Task Overview

Strict bottom-up build. The shared tokenizer and frequency-lookup primitives land first; the streaming Claude caller and SSE wire schemas follow; the Lambda handler, CDK construct, and client hook compose them. The Next.js page integration is the final user-visible step. Each task touches 1–3 files, runs to a clean `pnpm typecheck` + `pnpm test` from the repo root, and references the requirements + design sections it implements.

## Steering Document Compliance

Tests are co-located with the code they exercise (`packages/.../*.test.ts`, `apps/web/.../*.test.tsx`) — matching the read-collect spec's convention. No task introduces a new general-purpose UI primitive. No task modifies the existing Hono router beyond deleting the obsolete `POST /read/annotate` handler (read-collect's other four routes are untouched). All new server work lives under `infra/lambda/src/annotate-stream/`; all new client work under `apps/web/app/(dashboard)/read/` and `packages/api-client/`.

**Documentation-only requirements / cross-cutting concerns:** Requirement 5.10 (stream closed without terminal event → `AnnotatedError`) is verified by tests in task 25; Requirement 6.5 (concurrent-rate-limit acceptance) is a non-implementation invariant inherited unchanged from the existing handler.

## Atomic Task Requirements

- **File Scope**: 1–3 related files maximum.
- **Time Boxing**: 15–30 minutes.
- **Single Purpose**: one testable outcome.
- **Specific Files**: exact paths.
- **Agent-Friendly**: minimal cross-file context-switching.

## Task Format Guidelines

- Checkbox format: `- [ ] Task number. Task description`.
- Each task lists files, an implementation outline, requirement refs, and any leverage paths.

## Tasks

### Phase 1 — Shared tokenizer

- [x] 1. Move `tokenize` to `packages/shared/src/tokenize.ts`
  - Files: `packages/shared/src/tokenize.ts` (new), `packages/shared/src/index.ts` (modify — add `export * from './tokenize';`)
  - Copy the function body from `apps/web/app/(dashboard)/read/_lib/tokenize.ts` verbatim, **then** add two behavioral changes inside the per-token branch: if `part.length === 1` OR `/^\d+$/u.test(part)`, emit `kind: 'sep'` (not `'word'`). Keep the rest of the algorithm and exported types identical.
  - Purpose: server pre-filter and client renderer share one tokenizer; numeric and single-char tokens are excluded from candidate set (Req 1.3).
  - _Leverage: `apps/web/app/(dashboard)/read/_lib/tokenize.ts`_
  - _Requirements: 1.3_

- [x] 2. Add `tokenize` tests in `packages/shared/src/tokenize.test.ts`
  - File: `packages/shared/src/tokenize.test.ts` (new)
  - Port existing test cases from `apps/web/app/(dashboard)/read/_lib/tokenize.test.ts`. Add new cases: digit-only token (`"2024"`) → `kind: 'sep'`; single-char token (`"a"`) → `kind: 'sep'`; mixed-script tokens unchanged; round-trip reconstruction (`tokens.map(t => t.raw).join('') === input`) still holds with the new behavior.
  - Purpose: lock the contract before any consumer ships.
  - _Leverage: `apps/web/app/(dashboard)/read/_lib/tokenize.test.ts`_
  - _Requirements: 1.3_

- [x] 3. Re-point web consumers and delete the old file
  - Files: `apps/web/app/(dashboard)/read/_components/annotated-text.tsx` (modify — import from `@language-drill/shared`), delete `apps/web/app/(dashboard)/read/_lib/tokenize.ts`, delete `apps/web/app/(dashboard)/read/_lib/tokenize.test.ts` (its cases already moved to task 2).
  - Run `pnpm typecheck` from the repo root — must pass.
  - Purpose: enforce single source of truth.
  - _Requirements: 1.3_

### Phase 2 — Frequency dictionary

- [x] 4. Add per-language stopword files in `packages/ai/src/frequency/stopwords-{es,de,tr}.json`
  - Files: `packages/ai/src/frequency/stopwords-es.json` (new), `packages/ai/src/frequency/stopwords-de.json` (new), `packages/ai/src/frequency/stopwords-tr.json` (new)
  - Each file is a JSON array of lowercased closed-class words: articles, copulas, common conjunctions, prepositions, pronouns, modal/auxiliary verbs. Aim for 40–80 entries per language. Lists may be sourced from the existing `ANNOTATE_SYSTEM_PROMPT` per-language hints + minor expansion.
  - Purpose: pre-filter stopword check (Req 1.4).
  - _Leverage: `packages/ai/src/annotate.ts:122-145` (current per-language stopword hints in the system prompt)_
  - _Requirements: 1.4_

- [x] 5. Build the frequency-dictionary build script in `packages/ai/scripts/build-frequency.ts`
  - File: `packages/ai/scripts/build-frequency.ts` (new)
  - One-shot Node script (`tsx` invocation) that reads three local TSV inputs at `packages/ai/scripts/sources/{es,de,tr}.tsv` (format: `surface_form<TAB>lemma<TAB>rank[<TAB>cefr]`) and writes `packages/ai/src/frequency/{es,de,tr}.json` in the design's `Record<surface_form, { lemma, rank, cefr? }>` shape.
  - Skip rows where `surface_form` is empty or contains whitespace. Lowercase keys. Cap at top 50k entries per language.
  - Document at the top of the file: "Run with `pnpm --filter @language-drill/ai build:frequency`. Source TSVs are not checked in (see docs/data-sources.md)."
  - Add `"build:frequency": "tsx scripts/build-frequency.ts"` to `packages/ai/package.json` scripts.
  - Purpose: reproducible offline build of the dictionaries (Req 1.2).
  - _Requirements: 1.2_

- [x] 6a. **(Manual)** Source the three corpora and write `docs/data-sources.md`
  - File: `docs/data-sources.md` (new)
  - One-time human task — NOT agent-completable. Download ES OpenSubtitles, DE Leipzig, TR Wikipedia frequency lists; convert each to `packages/ai/scripts/sources/{es,de,tr}.tsv` (format defined by task 5).
  - `docs/data-sources.md` documents: corpus URLs, license terms (must be redistributable / public domain), one-line conversion notes, and the date the snapshot was taken.
  - Source TSVs are NOT checked into git (kept on the maintainer's machine); only the docs and the produced JSON outputs are.
  - Purpose: explicit handoff between human-curated data and the build script.
  - _Requirements: 1.2, 1.9_

- [x] 6b. Generate `es.json` / `de.json` / `tr.json` by running the build script
  - Files: `packages/ai/src/frequency/es.json` (new — generated), `packages/ai/src/frequency/de.json` (new — generated), `packages/ai/src/frequency/tr.json` (new — generated)
  - Run `pnpm --filter @language-drill/ai build:frequency` (the script from task 5). Commit the three generated JSON files.
  - Verify each file is ≤ 2 MB pre-gzip (Req 1.2). If a file exceeds, lower the per-language cap in `build-frequency.ts` (task 5) and re-run.
  - Purpose: ship the v1 dictionaries.
  - _Requirements: 1.2_

- [x] 7. Implement the lookup module in `packages/ai/src/frequency/index.ts`
  - File: `packages/ai/src/frequency/index.ts` (new)
  - At module init, `import` the three JSON files and three stopword files as JS literals (esbuild inlines). Construct `Set<string>` for stopwords.
  - Export `FrequencyEntry`, `FrequencyLookup` types from the design.
  - Export `loadFrequency(language: LearningLanguage): FrequencyLookup` returning `{ lookup, isStopword }`. `lookup` is `(form) => freqMap[form] ?? null`; `isStopword` is `(form) => stopwordSet.has(form)`.
  - Purpose: O(1) candidate evaluation server-side (Req 1.1, 1.2).
  - _Leverage: `packages/ai/src/index.ts` (export pattern), `@language-drill/shared` `LearningLanguage`_
  - _Requirements: 1.1, 1.2, 1.5_

- [x] 8. Add frequency-lookup tests in `packages/ai/src/frequency/frequency.test.ts`
  - File: `packages/ai/src/frequency/frequency.test.ts` (new)
  - Cases per language: `lookup('the-most-common-form')` → entry with `rank <= 100`; `lookup('clearly-rare-or-fake')` → `null`; `isStopword(<known closed-class>)` → `true`; `isStopword(<content word>)` → `false`; module-init does not throw on any of the three languages.
  - Error-mode case: with a stubbed import returning a non-object value, `loadFrequency` SHALL throw at module init (defense for design §Error Handling row "Frequency file load fails").
  - Determinism case: calling `lookup(x)` and `isStopword(x)` repeatedly returns identical results — no randomness (Req 1.7).
  - Purpose: smoke-test the data + lookup; lock fail-fast init.
  - _Requirements: 1.1, 1.4, 1.7, NFR Reliability_

- [x] 9. Re-export frequency from `@language-drill/ai`
  - File: `packages/ai/src/index.ts` (modify)
  - Add `export * from './frequency';`
  - Purpose: expose the lookup to the Lambda handler package.
  - _Requirements: 1.1_

### Phase 3 — Streaming Claude caller

- [x] 10. Add the streaming-JSON-array helper in `packages/ai/src/annotate.ts`
  - File: `packages/ai/src/annotate.ts` (modify — add a new internal export `extractNewItems(buffer: string, alreadyYielded: number): unknown[]`)
  - Tracks brace depth + in-string flag (handling `\"` escape). Returns parsed top-level array items at indices `>= alreadyYielded`.
  - Does NOT try to fully parse arbitrary JSON — only watches for the close-brace of an array element at depth 1 inside the `flagged` array.
  - Purpose: progressive parse of Claude's `input_json_delta` stream (Req 4.3).
  - _Requirements: 4.3_

- [x] 11. Add `extractNewItems` + `buildAnnotateUserPrompt` tests in `packages/ai/src/annotate-stream.test.ts`
  - File: `packages/ai/src/annotate-stream.test.ts` (new)
  - **`extractNewItems` cases:** (a) single complete item arrives in one buffer chunk; (b) item split across two chunks; (c) escaped quote inside `example` string mid-chunk — must NOT terminate string early; (d) deeply-nested structures (none currently in our schema, but defensive); (e) malformed/incomplete JSON returns `[]` without throwing.
  - **`buildAnnotateUserPrompt` cases (from task 12):** (a) given a candidate list, the rendered user message contains every `matchedForm` exactly once; (b) lemmas (when non-null) are included alongside the surface form; (c) language code appears in the prompt header; (d) empty candidate list is rejected by an upstream assertion (this code path is unreachable in the handler, but the assertion is the failsafe).
  - Purpose: protect the load-bearing parser AND lock the prompt-shape contract.
  - _Requirements: 4.3, 4.5, 4.8_

- [x] 12. Replace `ANNOTATE_SYSTEM_PROMPT` with the enrichment-only variant in `packages/ai/src/annotate.ts`
  - File: `packages/ai/src/annotate.ts` (modify)
  - Remove the "Selection Rule" section entirely. Add a new "Enrichment Task" section: "You will receive a passage AND a list of words from that passage. For EACH word in the list, emit one tool-use entry with lemma / pos / gloss / example / freq / cefr. Do not add words that are not in the list. Do not skip words that are in the list."
  - Keep "Surface Form Requirement", "Per-Language Guidance", "Tool Use" sections unchanged.
  - Rewrite `buildAnnotateUserPrompt` to accept the new `AnnotateStreamInput` shape (passage + candidates array) and embed the candidate list as a numbered list inside the user message.
  - Purpose: shift selection from LLM to server (Req 4.5).
  - _Requirements: 4.5_

- [x] 13. Implement `streamAnnotation` async generator in `packages/ai/src/annotate.ts`
  - File: `packages/ai/src/annotate.ts` (modify — replace the existing `annotateText` export)
  - Signature: `export async function* streamAnnotation(client: Anthropic, input: AnnotateStreamInput): AsyncIterable<AnnotateStreamEvent>`.
  - Use `client.messages.stream({ model: 'claude-sonnet-4-5', max_tokens: 8192, ..., tools: [ANNOTATE_TOOL], tool_choice: { type: 'tool', name: ANNOTATE_TOOL_NAME }, temperature: 0, system: [{ type: 'text', text: ENRICHMENT_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }] }, { signal: input.signal })`. The `8192` is PR #49's empirical worst-case budget for 40 entries (~150–200 tokens each).
  - For each `content_block_delta` event with `delta.type === 'input_json_delta'`, append to buffer, call `extractNewItems`, validate each item via `WordFlagSchema + matchedForm`. On success → yield `{ kind: 'flag', flag }`. On `WordFlagSchema.parse` failure → `console.warn` and drop (Req 4.8).
  - On end of stream → check `finalMessage.stop_reason`. If `'max_tokens'`, `console.warn('[streamAnnotation] truncated by max_tokens', { yielded })` and throw a dedicated error (the handler maps it to `AI_UNAVAILABLE` per design §Error Handling). Otherwise yield `{ kind: 'done', flaggedCount }`.
  - Purpose: streamed enrichment with single-item-at-a-time yielding + explicit truncation detection (Req 4.1–4.4, 4.6–4.9).
  - _Leverage: existing `ANNOTATE_TOOL` schema, `WordFlagSchema`, `createClaudeClient`; PR #49's truncation-detection pattern in `packages/ai/src/annotate.ts` (current main)_
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.6, 4.7, 4.8, 4.9_

- [x] 14. Add `streamAnnotation` integration test in `packages/ai/src/annotate-stream.test.ts`
  - File: `packages/ai/src/annotate-stream.test.ts` (modify — extend Task 11 file)
  - Mock the Anthropic SDK by stubbing `client.messages.stream` to return an async iterator of crafted `input_json_delta` events.
  - Cases: (a) two complete items end-to-end → yields `flag`, `flag`, `done`; (b) AbortSignal fired mid-stream → iteration ends without `done`; (c) a malformed item between two valid ones → middle item dropped, others succeed; (d) Anthropic SDK throws → exception propagates out of the iterator.
  - Purpose: integration-level guarantee for the async generator (Req 4.1–4.9).
  - _Requirements: 4.1, 4.2, 4.8, 4.9_

- [x] 15. Remove obsolete `annotateText` and `parseAnnotateResult` exports
  - File: `packages/ai/src/index.ts` (modify)
  - Replace `export { annotateText, ... }` with `export { streamAnnotation, ... }`.
  - Remove `parseAnnotateResult` from the public exports — the streaming generator now does validation inline.
  - Purpose: clean break (no live consumers per requirements compatibility note).
  - _Requirements: 4.2_

### Phase 4 — SSE wire schemas

- [x] 16. Replace `AnnotateResponseSchema` with per-event schemas in `packages/api-client/src/schemas/read.ts`
  - File: `packages/api-client/src/schemas/read.ts` (modify)
  - Delete `AnnotateResponseSchema` and the `AnnotateResponse` type.
  - Add `AnnotateMetaEventSchema = z.object({ calibration: z.object({ cefr: z.nativeEnum(CefrLevel), top: z.number().int().nonnegative() }), candidateCount: z.number().int().nonnegative() })`.
  - Add `AnnotateFlagEventSchema = WordFlagSchema.extend({ matchedForm: z.string().min(1).max(120) })`.
  - Add `AnnotateDoneEventSchema = z.object({ flaggedCount: z.number().int().nonnegative() })`.
  - Add `AnnotateErrorEventSchema = z.object({ code: z.enum(['AI_UNAVAILABLE', 'VALIDATION_ERROR', 'RATE_LIMIT_EXCEEDED', 'UNSUPPORTED_LANGUAGE']), message: z.string() })`.
  - Export the inferred types `AnnotateMetaEvent`, `AnnotateFlagEvent`, `AnnotateDoneEvent`, `AnnotateErrorEvent`. Keep `AnnotateRequestSchema` unchanged.
  - Purpose: typed wire contract (Req 3.2, 3.4, 3.5, 3.7, 3.8, 3.11).
  - _Leverage: `packages/api-client/src/schemas/read.ts:34-42` (current envelope), `@language-drill/shared` `WordFlagSchema`_
  - _Requirements: 3.2, 3.4, 3.5, 3.7, 3.8, 3.11_

- [x] 17. Add event-schema tests in `packages/api-client/src/schemas/read.test.ts`
  - File: `packages/api-client/src/schemas/read.test.ts` (new OR modify if exists)
  - For each event schema: parse a happy-path payload, then a payload missing a required field (expect `safeParse.success === false`). For `AnnotateErrorEventSchema`, assert each of the four `code` values parses and an unknown code fails.
  - Purpose: lock the wire contract.
  - _Requirements: 3.2, 3.8_

### Phase 5 — Streaming Lambda

- [x] 18. Add Clerk JWT verification in `infra/lambda/src/annotate-stream/jwt.ts`
  - File: `infra/lambda/src/annotate-stream/jwt.ts` (new)
  - Add `@clerk/backend` to `infra/lambda/package.json` dependencies (`pnpm --filter @language-drill/lambda add @clerk/backend`).
  - Export `verifyClerkJwt(authHeader: string | undefined): Promise<string | null>`. Strips `Bearer ` prefix, calls `verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY, audience: 'language-drill', authorizedParties: [...] })`. Returns the `sub` claim on success; `null` on any failure (missing header, malformed, expired, wrong audience).
  - Caches a module-level Clerk client; never throws — the caller's null check is the boundary.
  - Purpose: JWT verification without API Gateway authorizer (Design §`jwt.ts`).
  - _Requirements: 5 (NFR Security)_

- [x] 19. Add JWT tests in `infra/lambda/src/annotate-stream/jwt.test.ts`
  - File: `infra/lambda/src/annotate-stream/jwt.test.ts` (new)
  - Stub `@clerk/backend`'s `verifyToken`. Cases: (a) valid token → returns sub; (b) expired token → null; (c) wrong audience → null; (d) missing/empty Authorization header → null; (e) malformed Bearer prefix → null.
  - Purpose: secure happy + sad paths.
  - _Requirements: NFR Security_

- [x] 20. Add SSE writer in `infra/lambda/src/annotate-stream/sse.ts`
  - File: `infra/lambda/src/annotate-stream/sse.ts` (new)
  - Export `createSseWriter(responseStream)` returning `{ openSse, writeEvent, writeTerminal, errorJson, cors200, close, terminated }` per design §`sse.ts`.
  - `openSse`: calls `awslambda.HttpResponseStream.from(responseStream, { statusCode: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' } })`.
  - `writeEvent(type, payload)`: writes `event: <type>\ndata: <JSON>\n\n`.
  - `writeTerminal(type, payload)`: if `terminated`, throws synchronously. Else writes and sets `terminated = true`.
  - `errorJson(status, body)`: non-SSE branch — `awslambda.HttpResponseStream.from(responseStream, { statusCode: status, headers: { 'content-type': 'application/json' } })` + `write(JSON.stringify(body))` + `end()`.
  - `cors200`: 204 with the CORS allow-list headers; Function URL handles preflight separately but the handler must not 500 on OPTIONS.
  - Purpose: wire-protocol invariant enforced in writer (Req 3.1, 3.3, 3.9).
  - _Requirements: 3.1, 3.3, 3.9_

- [x] 21. Add SSE writer tests in `infra/lambda/src/annotate-stream/sse.test.ts`
  - File: `infra/lambda/src/annotate-stream/sse.test.ts` (new)
  - Stub `responseStream` as an object collecting writes into a buffer.
  - Cases: (a) `writeEvent('meta', {...})` produces the expected `event: meta\ndata: ...\n\n` bytes; (b) `writeTerminal('done', ...)` then `writeTerminal('error', ...)` — second call throws; (c) `errorJson(429, { code: 'RATE_LIMIT_EXCEEDED' })` writes JSON, not SSE; (d) headers include `cache-control: no-cache, no-transform`.
  - Purpose: cover the wire-protocol invariant tests (Req 3.1, 3.3).
  - _Requirements: 3.1, 3.3_

- [x] 22. Implement the candidate-list pipeline in `infra/lambda/src/annotate-stream/pipeline.ts`
  - File: `infra/lambda/src/annotate-stream/pipeline.ts` (new)
  - Export `buildCandidateList({ userId, language, text }): Promise<{ candidates, calibration }>`.
  - Dispatch in parallel: `selectProficiency = db.select(...).from(userLanguageProfiles).where(...).limit(1)` and `vocabPromise = db.select({ word, lemma }).from(userVocabulary).where(...)`. Use `Promise.all([selectProficiency, vocabPromise])`.
  - Run `tokenize(text)` → take `kind === 'word'` only.
  - Dedupe by `key` (first-seen order). For each: skip if stopword; skip if `freq.lookup(key)?.rank <= topRank`. Else collect with `{ matchedForm: key, lemma: entry?.lemma ?? null, effectiveRank: entry?.rank ?? topRank + 1 }` — unknown-to-corpus forms are demoted just behind the topRank threshold so they don't crowd out actually-rare known words (per design §Pre-filter step 4).
  - IF candidates empty after pre-filter → return `{ candidates: [], calibration }` immediately (Req 2.5).
  - ELSE: filter candidates dropping any whose `lemma` OR `matchedForm` matches a row in vocab.
  - **Sort by `effectiveRank` descending (rarest first); take the first 40** (PR #49 empirical cap; was 50 in earlier design drafts).
  - Strip `effectiveRank` before returning — the SSE wire shape doesn't carry it.
  - Return `{ candidates, calibration: { cefr: proficiencyLevel, top: topRank } }`.
  - Purpose: pre-filter + post-filter + parallel queries + rarest-first cap (Req 1, 2).
  - _Leverage: `@language-drill/shared` `tokenize`, `READ_CEFR_TOP_RANK`; `@language-drill/ai/frequency`; Drizzle schemas_
  - _Requirements: 1.1, 1.4, 1.5, 1.6, 1.8, 2.1, 2.2, 2.3, 2.4, 2.5_

- [x] 23. Add pipeline tests in `infra/lambda/src/annotate-stream/pipeline.test.ts`
  - File: `infra/lambda/src/annotate-stream/pipeline.test.ts` (new)
  - Mock the DB (Drizzle `db.select(...).from(...).where(...)` chain). Cases:
    - (a) two known low-rank words + one rare word + one stopword + one in vocab → candidates has just the rare word.
    - (b) all words below `topRank` → empty candidates AND no second DB query was issued.
    - (c) all candidates in vocab → empty candidates.
    - (d) duplicate surface forms in text → deduped (first-seen wins).
    - (e) **vocab query throws** → handler falls through with empty vocab list; candidates pass through unchanged; the error is logged (assert via `console.error` spy). Mirrors design §Error Handling row 10.
    - (f) determinism: calling `buildCandidateList` twice with the same input yields the same candidate order (Req 1.7).
    - (g) **A1 worst case (PR #49 scenario)**: 60 above-`topRank` words after dedupe — assert exactly 40 are returned, and they are the 40 rarest by `freq.rank`. Mix in 10 unknown-to-corpus forms; assert known-rare words rank ahead of unknowns (effective-rank demotion).
    - (h) **All-unknown case**: 50 unknown-to-corpus forms with no known-rare alternatives → still capped at 40 by first-seen order; no crash on missing `freq.lookup` result.
  - Purpose: server-side filter contract + 40-cap ordering + unknown-demotion (PR #49 scenarios).
  - _Requirements: 1.5, 1.6, 1.7, 2.4, 2.5, 2.7, NFR Reliability_

- [x] 23b. Wrap the vocab query in `pipeline.ts` with a graceful catch
  - File: `infra/lambda/src/annotate-stream/pipeline.ts` (modify — extends task 22)
  - Wrap `vocabPromise` in `.catch((err) => { console.error('[annotate-stream] vocab query failed', err); return []; })` so a failed vocab query degrades to "no post-filter" instead of taking down the request. This matches the design's Error Handling row 10.
  - Purpose: graceful degradation when the vocab query errors.
  - _Requirements: NFR Reliability, §Error Handling_

- [x] 24a. Handler skeleton + pre-stream gates in `infra/lambda/src/annotate-stream/handler.ts`
  - File: `infra/lambda/src/annotate-stream/handler.ts` (new)
  - Import the three frequency JSONs **at the top of the file** (Req 4.7 cold-start positioning).
  - Wrap with `awslambda.streamifyResponse(async (event, responseStream) => { ... })`.
  - Implement gates in order, each returning early: (1) OPTIONS preflight → `writer.cors200()`; (2) method != POST → `errorJson(405, ...)`; (3) parse body via `AnnotateRequestSchema.safeParse` → 400 with `code: 'VALIDATION_ERROR'`; (4) language === 'EN' → 400 with `code: 'UNSUPPORTED_LANGUAGE'`; (5) `verifyClerkJwt(event.headers.authorization)` → 401 on null; (6) rate-limit `usage_events` count query (mirrors `routes/read.ts:118-128`) → 429 with `code: 'RATE_LIMIT_EXCEEDED'`.
  - Each of these uses `errorJson` (non-SSE) — `openSse` is NOT yet called.
  - After gate (6), call `writer.openSse()` and leave a TODO comment "task 24b: pipeline + Claude stream goes here". The handler is callable end-to-end at this point only for the pre-stream branches.
  - Purpose: pre-stream gates land first; can be tested independently (Req 3.10, 5, 6.1).
  - _Leverage: sibling `jwt.ts`, `sse.ts`; `@language-drill/db` `db`, `usageEvents`; existing rate-limit query in `infra/lambda/src/routes/read.ts:118-128`_
  - _Requirements: 3.10, 6.1, NFR Security_

- [x] 24b. Streaming loop + usage row + terminal events in `handler.ts`
  - File: `infra/lambda/src/annotate-stream/handler.ts` (modify — replace the TODO from 24a)
  - (7) `buildCandidateList(userId, body.data)` → `writer.writeEvent('meta', { calibration, candidateCount })`. (8) If `candidates.length === 0` → `writer.writeTerminal('done', { flaggedCount: 0 })`, return. (9) Create `AbortController`; `responseStream.on('close', () => abort.abort())`. (10) `let flaggedCount = 0`; `for await (const ev of streamAnnotation(client, { passage, language, proficiencyLevel, candidates, signal: abort.signal }))` → if `ev.kind === 'flag'`: `writer.writeEvent('flag', ev.flag); flaggedCount++`. (11) After iterator end: try { `await db.insert(usageEvents).values({ userId, eventType: 'read_annotation', metadata: { language, textLength: text.length, candidateCount: candidates.length, flaggedCount } })` } catch (err) { `console.error('[annotate-stream] usage insert failed', err)`; do NOT throw }. (12) `writer.writeTerminal('done', { flaggedCount })`.
  - Wrap step (10) in `try/catch`: if the iterator throws, `if (!writer.terminated) writer.writeTerminal('error', { code: 'AI_UNAVAILABLE', message: 'Evaluation temporarily unavailable' })`. The writer's `terminated` flag is the single source of truth — never double-emit.
  - Purpose: the heart of the streaming pipeline (Req 3.3, 4 all, 6.2–6.4).
  - _Leverage: `@language-drill/ai` `createClaudeClient`, `streamAnnotation`, `loadFrequency`; sibling `pipeline.ts`_
  - _Requirements: 3.3, 4.1, 4.2, 4.4, 4.6, 4.8, 4.9, 6.2, 6.3, 6.4_

- [x] 25. Add handler tests in `infra/lambda/src/annotate-stream/handler.test.ts`
  - File: `infra/lambda/src/annotate-stream/handler.test.ts` (new)
  - Stub `responseStream` to collect writes. Stub Clerk, Anthropic, DB. Cases:
    - Valid POST, two flags → `meta`, `flag`, `flag`, `done` in order; `usage_events` insert called once with `candidateCount` field.
    - Empty candidate list → `meta` + `done`; no DB insert; no Claude call.
    - All candidates filtered by vocab → same as above.
    - Pre-stream 429 → JSON response, not SSE.
    - JWT invalid → JSON 401.
    - Method OPTIONS → 204 with CORS headers from a `*.vercel.app` origin.
    - Mid-stream Claude throws → `meta`, `flag` (those already produced), `error`; no `done`; no usage row.
    - **`stop_reason: max_tokens` from the Anthropic SDK** → `streamAnnotation` throws the dedicated truncation error → handler emits `error` with `code: 'AI_UNAVAILABLE'`; partial flags retained on the client side; no usage row. (PR #49 belt-and-braces observability — should not occur given the 40-candidate cap.)
    - `writeTerminal` called twice → second call throws (invariant from Req 3.3).
  - Purpose: end-to-end behavior at the Lambda boundary.
  - _Requirements: 3.1, 3.3, 3.6, 3.10, 4.8, 4.9, 6.1, 6.2, 6.3, 6.4_

- [x] 26. Delete the obsolete `POST /read/annotate` handler from `infra/lambda/src/routes/read.ts`
  - Files: `infra/lambda/src/routes/read.ts` (modify), `infra/lambda/src/routes/read.test.ts` (modify)
  - Remove the entire `read.post('/read/annotate', ...)` block (`routes/read.ts:89-186`) and its imports of `annotateText` and `createClaudeClient`. The four other routes (`POST /read/entries`, `GET /read/entries`, `GET /read/entries/:id`, `PUT /read/entries/:id/bank`) remain untouched.
  - Delete the corresponding tests in `read.test.ts`. Keep entry / bank tests intact.
  - Confirm `pnpm test --filter @language-drill/lambda` is green.
  - Purpose: single endpoint owns annotation (the new Function URL).
  - _Requirements: §Overview, §Code Reuse_

### Phase 6 — CDK construct

- [x] 26b. Extract the shared CORS allow-list to `packages/shared/src/cors.ts`
  - Files: `packages/shared/src/cors.ts` (new — export `FALLBACK_ORIGINS = ['https://*.vercel.app', 'https://langdrill.app', 'https://www.langdrill.app']`), `packages/shared/src/index.ts` (modify — re-export), `infra/lambda/src/index.ts` (modify — replace the inline `FALLBACK_ORIGINS` array at lines 16-20 with `import { FALLBACK_ORIGINS } from '@language-drill/shared'`).
  - Purpose: single source of truth so the Function URL CORS list and the API Gateway CORS list cannot drift (validator finding).
  - _Leverage: `infra/lambda/src/index.ts:16-20`_
  - _Requirements: §Architecture_

- [x] 27. Add `AnnotateStreamLambdaConstruct` in `infra/lib/constructs/annotate-stream-lambda.ts`
  - File: `infra/lib/constructs/annotate-stream-lambda.ts` (new)
  - Mirror `LambdaConstruct` structure (secrets-prefix prop, secret reads, env, esbuild aliases). Add `@clerk/backend` to the alias list if the existing pattern doesn't pick it up automatically (verify after writing).
  - Entry: `path.join(__dirname, '../../lambda/src/annotate-stream/handler.ts')`.
  - `runtime: NODEJS_20_X`, `timeout: Duration.seconds(29)`, `memorySize: 512`.
  - Add `new lambda.FunctionUrl(this, 'Url', { function: this.handler, authType: FunctionUrlAuthType.NONE, invokeMode: InvokeMode.RESPONSE_STREAM, cors: { allowedOrigins: FALLBACK_ORIGINS_FOR_CDK, allowedMethods: [HttpMethod.POST, HttpMethod.OPTIONS], allowedHeaders: ['Authorization', 'Content-Type'], maxAge: Duration.hours(1) } })`. Import `FALLBACK_ORIGINS_FOR_CDK` from `@language-drill/shared` (added in task 26b) so the two CORS lists cannot drift.
  - Export the function URL on the construct as `public readonly functionUrl: string`.
  - Grant the same secret reads (`databaseUrl.grantRead(this.handler)` etc.) as `LambdaConstruct`.
  - Purpose: CDK construct for the streaming Lambda + Function URL (Design §CDK construct).
  - _Leverage: `infra/lib/constructs/lambda.ts`, `packages/shared/src/cors.ts` (from task 26b)_
  - _Requirements: §Architecture, §CDK construct_

- [x] 28. Add construct snapshot test in `infra/lib/constructs/annotate-stream-lambda.test.ts`
  - File: `infra/lib/constructs/annotate-stream-lambda.test.ts` (new)
  - Synth a minimal Stack instantiating the construct with stub secrets; assert: a Lambda function exists with `Timeout: 29` and `MemorySize: 512`; a `AWS::Lambda::Url` resource exists with `InvokeMode: RESPONSE_STREAM` and `AuthType: NONE`; CORS config includes `https://*.vercel.app`.
  - Purpose: lock the CDK output shape.
  - _Leverage: `infra/lib/constructs/scheduler-lambda.test.ts` (existing CDK assertion test pattern)_
  - _Requirements: §CDK construct_

- [x] 29. Wire `AnnotateStreamLambdaConstruct` into `infra/lib/stack.ts`
  - File: `infra/lib/stack.ts` (modify)
  - Instantiate `new AnnotateStreamLambdaConstruct(this, 'AnnotateStream', { secretsPrefix: props.secretsPrefix })`.
  - Add `new CfnOutput(this, 'AnnotateStreamUrl', { value: stream.functionUrl, description: 'Function URL for /read/annotate streaming endpoint' })`.
  - Purpose: expose the URL for the deploy workflow.
  - _Leverage: existing `CfnOutput` usage in `infra/lib/constructs/api-gateway.ts`_
  - _Requirements: §CI/CD wiring_

- [x] 30. Update CDK stack snapshot
  - Files: `infra/test/__snapshots__/stack.snapshot.test.ts.snap` (modify — auto-regenerated)
  - Run `pnpm --filter @language-drill/infra test -- -u`; verify the only diff lines are additions for the new Lambda function, the Function URL, and the new `CfnOutput`. No existing resource shape changes.
  - Purpose: keep the snapshot test honest.
  - _Requirements: §CDK construct_

### Phase 7 — Client SSE plumbing

- [x] 31. Add the POST-SSE fetch helper in `packages/api-client/src/sse-client.ts`
  - File: `packages/api-client/src/sse-client.ts` (new)
  - Export `fetchSse(url, init): AsyncIterable<{ type: string; data: string }>`.
  - Call `fetch(url, init)`. If `response.status >= 400`, throw `new Error(response.status)` after attempting to parse the JSON body and attaching `status` + `body` to the error (matches existing `fetchClient.ts` error pattern). If `content-type` is NOT `text/event-stream*`, also throw.
  - Otherwise stream `response.body` with a `TextDecoderStream` + line buffer. Split on `\n\n`. For each frame, parse `event:` and `data:` lines (ignore other lines). Yield `{ type, data }`.
  - Pass `init.signal` through to `fetch` so AbortController cancellation works.
  - Purpose: native-fetch SSE consumer (Design §`sse-client.ts`).
  - _Leverage: `packages/api-client/src/fetchClient.ts:32-49` (error-shape pattern)_
  - _Requirements: 5.2, 5.6, 5.7_

- [x] 32. Add sse-client tests in `packages/api-client/src/sse-client.test.ts`
  - File: `packages/api-client/src/sse-client.test.ts` (new)
  - Stub global `fetch` with a `ReadableStream` of pre-encoded UTF-8 chunks. Cases: (a) two events in one chunk; (b) one event split across two chunks; (c) blank-line frame between events; (d) malformed `data:` line is ignored; (e) non-`text/event-stream` content-type throws; (f) 429 response throws with `status` attached; (g) abort mid-stream propagates.
  - Purpose: defend the SSE parser against split-frame edge cases.
  - _Requirements: 5.2, 5.6_

- [x] 33. Implement `useReadAnnotateStream` hook in `packages/api-client/src/hooks/useReadAnnotateStream.ts`
  - File: `packages/api-client/src/hooks/useReadAnnotateStream.ts` (new)
  - Export `useReadAnnotateStream({ baseUrl, getToken })` returning `{ state, start, abort, reset }` per design §Components.
  - Use `useReducer` with actions `START | META | FLAG | DONE | ERROR | ABORTED | RESET`. State shape from design §useReadAnnotateStream.
  - `start({ language, text })`: build URL, get JWT via `getToken({ template: 'api' })`, create `AbortController`, run `for await (const ev of fetchSse(...))`. Parse each event's `data` via the matching Zod schema; dispatch the corresponding action.
  - On JSON-error throw from `fetchSse` (i.e. 429/400/401): dispatch `ERROR` with `{ code, message, status }`.
  - On stream end **without** `DONE` or `ERROR` dispatched: dispatch `ERROR` with `{ code: 'AI_UNAVAILABLE' }` and retain `flaggedMap` (Req 5.10).
  - Purpose: client-side state machine for the stream (Req 5).
  - _Leverage: `packages/api-client/src/sse-client.ts`, the event schemas from task 16_
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.9, 5.10_

- [x] 34. Add hook tests in `packages/api-client/src/hooks/useReadAnnotateStream.test.ts`
  - File: `packages/api-client/src/hooks/useReadAnnotateStream.test.ts` (new)
  - With `@testing-library/react` `renderHook`, mock `fetchSse` to yield prepared events. Cases: happy path (meta → 2× flag → done → state `complete`); rate-limit 429 (state `error`, status 429, flaggedMap empty); mid-stream error (partial flags retained, state `error`); abort (state remains last value, abort propagates); body closed without done/error (state `error`, code `AI_UNAVAILABLE`, partial flags retained).
  - Purpose: state-machine contract (Req 5).
  - _Requirements: 5.4, 5.6, 5.7, 5.10_

- [x] 35. Delete the legacy `useReadAnnotate` hook and update exports
  - Files: delete `packages/api-client/src/hooks/useReadAnnotate.ts`, delete `packages/api-client/src/hooks/useReadAnnotate.test.ts`, modify `packages/api-client/src/index.ts` (replace `useReadAnnotate` export with `useReadAnnotateStream`).
  - Purpose: clean break (no live consumers).
  - _Requirements: §Overview (compatibility note)_

### Phase 8 — Page integration

- [x] 36. Add streaming actions to `read-page-reducer.ts`
  - Files: `apps/web/app/(dashboard)/read/_state/read-page-reducer.ts` (modify), `apps/web/app/(dashboard)/read/_state/read-page-reducer.test.ts` (modify)
  - Add a `annotateStream` slice to the reducer state. Add actions `ANNOTATE_START`, `ANNOTATE_META`, `ANNOTATE_FLAG`, `ANNOTATE_DONE`, `ANNOTATE_ERROR`, `ANNOTATE_RESET`.
  - When the page derives `flaggedMap` for the annotated view: prefer `state.annotateStream.flaggedMap` while `phase !== 'idle'`; fall back to the persisted entry's `flaggedWords` when viewing history.
  - Update reducer tests to cover the new actions and the derived-flaggedMap precedence.
  - Purpose: reducer covers streaming UI state.
  - _Requirements: 5.3, 5.4, 5.5, 5.6_

- [x] 37. Add the progress strip to `AnnotatedView`
  - Files: `apps/web/app/(dashboard)/read/_components/annotated-view.tsx` (modify), `apps/web/app/(dashboard)/read/_components/calibration-strip.tsx` (modify if exists, else new in same task)
  - Render two states in the calibration strip:
    - **Streaming**: "annotating · {flaggedCount} / {candidateCount}" with a determinate progress indicator (no new UI primitive — just `t-mono` text + a CSS-only progress bar div).
    - **Complete**: existing calibration eyebrow ("~{cefr}+ calibration"), with the suffix " · no above-level words" when `flaggedCount === 0` (Req §NFR Usability).
  - The reader pane span re-render must NOT shift layout — use background-color-only highlight (Req §NFR Usability).
  - Purpose: the visible UX win.
  - _Leverage: existing `AnnotatedView` and calibration-strip components_
  - _Requirements: 5.3, 5.5, NFR Usability_

- [x] 38. Wire `useReadAnnotateStream` into `apps/web/app/(dashboard)/read/page.tsx`
  - File: `apps/web/app/(dashboard)/read/page.tsx` (modify)
  - Replace the existing `useReadAnnotate` import with `useReadAnnotateStream`. Read `process.env.NEXT_PUBLIC_ANNOTATE_STREAM_URL` for `baseUrl`. Pass `getToken` from `useAuth()`.
  - `handleAnnotate`: dispatch `PASTE_SUBMIT` (a new view-transition action that switches to `annotated` view immediately with the raw text — Req 5.1), then `annotate.start({ language, text })`.
  - `handleSave`: gate `disabled` on `annotate.state.phase !== 'complete'` (Req 5.8).
  - `handlePasteNew` / `handleCancel` / route change: call `annotate.abort()` to cancel any in-flight stream (Req 5.7).
  - Purpose: immediate paint, streaming render, gated save.
  - _Requirements: 5.1, 5.5, 5.7, 5.8_

- [x] 39. Update page tests in `apps/web/app/(dashboard)/read/page.test.tsx`
  - File: `apps/web/app/(dashboard)/read/page.test.tsx` (modify)
  - Replace `useReadAnnotate` mock with `useReadAnnotateStream`. Update fixtures to dispatch streaming actions.
  - Cases: (a) clicking "annotate →" with valid text → view immediately switches to `annotated` and reader shows the raw text BEFORE any flags arrive; (b) progress strip renders during streaming with `0 / candidateCount` then increments; (c) **save button is disabled during `streaming` phase, enabled on `done`, AND remains disabled on `error`** (Req 5.8); (d) `error` event surfaces `AnnotatedError` AND retains streamed flags; (e) clicking "+ paste new" mid-stream calls `abort`.
  - Purpose: the UX flow contract.
  - _Requirements: 5.1, 5.3, 5.5, 5.6, 5.7, 5.8_

### Phase 9 — Local dev + CI/CD

- [x] 40. Add local streaming-Lambda dev server in `infra/lambda/src/annotate-stream/dev.ts`
  - File: `infra/lambda/src/annotate-stream/dev.ts` (new)
  - Node `http.createServer` listening on `process.env.STREAM_PORT ?? '3002'`. On every request, synthesize a `LambdaFunctionURLEvent` (method, path, headers, body), invoke `streamifyResponse(handler)` directly with a stub `responseStream` that pipes writes to the HTTP response. Honor `process.env.DEV_USER_ID` to skip Clerk JWT verification (same convention as `infra/lambda/src/dev.ts`).
  - Add a `dev:stream` script in `infra/lambda/package.json` running this entry with `tsx --watch`.
  - Add a parallel runner in the repo-root `package.json` `dev` script so `pnpm dev` brings up API (3001) + stream (3002) + web (3000).
  - Purpose: local development without a deployed Function URL.
  - _Leverage: `infra/lambda/src/dev.ts` (existing pattern)_
  - _Requirements: §Local development_

- [x] 41. Wire `NEXT_PUBLIC_ANNOTATE_STREAM_URL` for `pnpm dev:web`
  - Files: root `package.json` (modify) — update the `dev:web` script to inline `NEXT_PUBLIC_ANNOTATE_STREAM_URL=http://localhost:3002` alongside `NEXT_PUBLIC_API_URL=http://localhost:3001`. Update `apps/web/.env.example` to document the new var with a placeholder.
  - Purpose: local web app talks to local streaming Lambda.
  - _Requirements: §Local development_

- [x] 42. Add CFN-output → Vercel env wiring in `.github/workflows/deploy.yml`
  - File: `.github/workflows/deploy.yml` (modify)
  - After the existing `cdk deploy` step and before `vercel deploy`, add a job step that reads the `AnnotateStreamUrl` output via `aws cloudformation describe-stacks`, then runs `vercel env rm NEXT_PUBLIC_ANNOTATE_STREAM_URL <env> --yes || true` followed by `echo "<url>" | vercel env add NEXT_PUBLIC_ANNOTATE_STREAM_URL <env>`.
  - Apply to both production and preview environments via job matrix (matches the existing pattern for the `LanguageDrillStack` / `LanguageDrillStack-dev` deploys).
  - Purpose: env var auto-syncs on every deploy (Design §CI/CD).
  - _Leverage: existing `deploy.yml` job structure_
  - _Requirements: §CI/CD wiring_

### Phase 10 — Cross-Lambda contract, docs, manual verification

- [x] 43. Cross-Lambda contract test for Req 2.6
  - File: `infra/lambda/src/annotate-stream/cross-lambda-contract.test.ts` (new)
  - Hits the **existing** `POST /read/entries` handler (the read-collect Hono route) with a fixture payload, then invokes `buildCandidateList` for the same user + language with a passage containing one of the just-saved words. Asserts that word is NOT in the returned candidate list — i.e. the post-filter observes rows written by the other Lambda.
  - The test runs against an in-memory mocked DB shared between both code paths (or a real Neon test branch behind `INTEGRATION=1`).
  - Purpose: lock the cross-Lambda invariant that the requirements doc identifies as Req 2.6.
  - _Leverage: `infra/lambda/src/routes/read.ts:198+` (POST /read/entries handler), `infra/lambda/src/annotate-stream/pipeline.ts` (task 22)_
  - _Requirements: 2.6_

- [x] 44. Update `CLAUDE.md` and `docs/architecture.md` for the streaming endpoint
  - Files: `CLAUDE.md` (modify), `docs/architecture.md` (modify if present, else skip the second file)
  - In CLAUDE.md, under "API Gateway auth architecture", add a note: "The `POST /read/annotate` endpoint is served by a **separate** Lambda Function URL with `InvokeMode: RESPONSE_STREAM` (not API Gateway) because the response is SSE. JWT verification happens inside that Lambda via `@clerk/backend`."
  - Add `NEXT_PUBLIC_ANNOTATE_STREAM_URL` to the Vercel environment-variable table.
  - Document the new local-dev port (`3002`) under "Running Locally".
  - Purpose: keep onboarding doc honest.
  - _Requirements: §Architecture, §Local development_

- [ ] 45. **(Manual)** End-to-end verification of NFR performance budgets
  - Not a code task — a deploy + measure step. Run after every task above is merged.
  - Deploy the worktree branch to `LanguageDrillStack-dev`. Open the dev frontend in a Vercel preview.
  - **Cold case:** wait ≥10 minutes for Lambda container to recycle. Paste a 1500-char Spanish passage. Record (a) time-to-passage-paint (target ≤ 100 ms — pure client-side), (b) time-to-first-flag (target ≤ 6 s p95), (c) time-to-done (target ≤ 18 s p95).
  - **Warm case:** immediately paste a second passage (same shape). Record the three numbers again (warm targets: 100 ms / 3 s / 12 s p95).
  - **Empty-candidate case:** paste a passage of only A1 closed-class words. Confirm browser shows `meta` + `done` with `flaggedCount: 0` AND CloudWatch shows **no** Anthropic SDK call AND no `usage_events` row inserted.
  - **All-vocab case:** paste a passage where every above-A1 lemma is already in `user_vocabulary`. Same expectations as the empty-candidate case.
  - Record results in `docs/perf/more-responsive-reading-2026-MM-DD.md`. Fail the task and file follow-up issues for any breached target.
  - Purpose: validate the NFR Performance budgets (only realistically testable on real AWS infrastructure).
  - _Requirements: §NFR Performance_
