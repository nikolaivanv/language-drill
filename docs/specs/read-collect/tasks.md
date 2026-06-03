# Implementation Plan

## Task Overview

Phase J — Read & Collect — is a strict bottom-up build: shared types and constants land first; the DB schema and migration follow; Claude annotation, Lambda routes, and api-client schemas/hooks build on those; the web page composes the lot at the end. Tasks are ordered so each one can be opened in isolation, completed in 15–30 minutes by an experienced developer, and verified with the standard `pnpm typecheck` + `pnpm test` pair from the repo root.

## Steering Document Compliance

Every task lists exactly the files it creates or modifies. Tests are co-located alongside the code they exercise (matches the existing convention in `packages/db/src/schema/*.test.ts`, `packages/api-client/src/hooks/*.test.ts`, and `apps/web/app/**/__tests__/`). No task introduces new general-purpose UI primitives — all components reuse `apps/web/components/ui/`. No task changes shared infrastructure (`db.ts`, `authMiddleware`, CORS) or breaks existing endpoints.

**Documentation-only requirements:** Requirement 13 (deferred drill weaving — `user_vocabulary` is populated but no drill code reads it yet) and Requirement 15 (lowercase copy + Caveat font + accent chip variant) have no dedicated implementation task. They are scoping/copy guarantees verified by code review during tasks 9 (`POST /read/entries` confirms only `user_vocabulary` is touched, no drill-side code), 23 (`EmptyView` Caveat eyebrow), 28 (`WordBankRail` accent `Chip` for "from your reading"), 32 (`SaveToast` lowercase copy), and 33 (no `streak`, `xp`, `level`-as-gamification, or `lessons` strings appear anywhere in the page).

## Atomic Task Requirements

**Each task must meet these criteria for optimal agent execution:**
- **File Scope**: Touches 1–3 related files maximum
- **Time Boxing**: Completable in 15–30 minutes
- **Single Purpose**: One testable outcome per task
- **Specific Files**: Exact file paths to create/modify
- **Agent-Friendly**: Clear input/output with minimal context switching

## Task Format Guidelines

- Use checkbox format: `- [ ] Task number. Task description`
- **Specify files**: Always include exact file paths to create/modify
- **Include implementation details** as bullet points
- Reference requirements using: `_Requirements: X.Y, Z.A_`
- Reference existing code to leverage using: `_Leverage: path/to/file.ts_`

## Tasks

### Phase 1 — Shared package (constants and Zod types)

- [x] 1. Create shared constants and schemas in `packages/shared/src/read.ts`
  - File: `packages/shared/src/read.ts` (new)
  - Export `READ_TEXT_MAX_CHARS = 2000`, `READ_TITLE_MAX_CHARS = 120`, `READ_SOURCE_MAX_CHARS = 200`, `READ_PREVIEW_CHARS = 120`, `READ_HISTORY_LIMIT = 50`
  - Export `READ_CEFR_TOP_RANK` as `{ A1: 750, A2: 1500, B1: 3000, B2: 5000, C1: 8000, C2: 12000 } as const satisfies Record<CefrLevel, number>`
  - Export `WordFlagSchema` (Zod object with `lemma`, `pos`, `gloss`, `example`, `freq`, `cefr`) and inferred `WordFlag` type
  - Export `FlaggedMapSchema = z.record(z.string().min(1), WordFlagSchema)` and inferred `FlaggedMap`
  - Purpose: single source of truth for client + server constants
  - _Leverage: `packages/shared/src/index.ts` (existing `CefrLevel` enum + Zod usage)_
  - _Requirements: 4.7, 5.1, 5.2, 5.10, 12.6_

- [x] 2. Re-export read module + add tests in `packages/shared/src/index.ts` and `packages/shared/src/read.test.ts`
  - Files: `packages/shared/src/index.ts` (modify — add `export * from './read';`), `packages/shared/src/read.test.ts` (new)
  - Tests: `READ_TEXT_MAX_CHARS === 2000`, `READ_CEFR_TOP_RANK` is monotonic A1→C2, `WordFlagSchema.safeParse({})` fails, `WordFlagSchema.safeParse({...validShape})` succeeds, `FlaggedMapSchema.parse({ aldea: validFlag })` round-trips
  - Purpose: lock the shared contract in tests so future drift is caught
  - _Leverage: `packages/shared/src/index.test.ts` (existing test layout for the shared package)_
  - _Requirements: 4.7, 5.1, 5.2, 5.10_

### Phase 2 — DB schema and migration

- [x] 3. Create read tables in `packages/db/src/schema/read.ts`
  - File: `packages/db/src/schema/read.ts` (new)
  - Define `readEntries` `pgTable` per design §Drizzle schema: id (uuid pk), userId (text fk users.id), language, title (default ''), source (default ''), text, flaggedWords (jsonb typed `Record<string, WordFlag>`), bank (jsonb typed `string[]` default `[]`), pastedAt (timestamptz default now())
  - Define `userVocabulary` `pgTable`: id, userId (text fk users.id ON DELETE CASCADE), language, word, lemma, source, sourceReadEntryId (uuid fk readEntries.id ON DELETE SET NULL), pos, gloss, exampleSentence, frequencyRank (integer nullable), cefrBand, addedAt
  - Indexes: `read_entries_user_lang_pasted_at_idx` on `(userId, language, desc(pastedAt))` (use `desc` from `drizzle-orm`); `user_vocabulary_user_lang_word_uq` unique on `(userId, language, word)`; `user_vocabulary_user_lang_idx` on `(userId, language)`
  - Purpose: schema definitions matching the design doc
  - _Leverage: `packages/db/src/schema/sessions.ts` (jsonb typed pattern), `packages/db/src/schema/progress.ts` (index DSL with `.on(...)`), `packages/shared/src/read.ts` (`WordFlag` type)_
  - _Requirements: 12.1, 12.2, 12.3, 12.6, 12.7_

- [x] 4. Re-export read tables and add schema smoke test
  - Files: `packages/db/src/schema/index.ts` (modify — add re-exports for `readEntries` and `userVocabulary`; add their inferred types if pattern in module dictates), `packages/db/src/schema/read.test.ts` (new)
  - Tests: import the table objects, assert `readEntries.flaggedWords` is defined, assert `userVocabulary` has the unique constraint key in its third-arg result, assert `userVocabulary.userId` reference config indicates `onDelete: 'cascade'`
  - Update the index header comment block to mention the two new indexes
  - Purpose: integrate the new tables into the package's public surface
  - _Leverage: `packages/db/src/schema/index.ts` (existing re-export structure + comment block)_
  - _Requirements: 12.4_

- [x] 5. Generate and hand-verify migration `0004_*.sql`
  - Files: `packages/db/migrations/0004_*.sql` (new — generated), `packages/db/migrations/meta/_journal.json` (modified — generated)
  - Run `pnpm --filter @language-drill/db db:generate` from the repo root
  - Hand-verify against the design checklist: exactly two `CREATE TABLE`s; unique constraint on `(user_id, language, word)`; descending index on `(user_id, language, pasted_at DESC)`; both FKs to `users(id)`; only `user_vocabulary.user_id` is `ON DELETE CASCADE`; `source_read_entry_id` is `ON DELETE SET NULL`; no DDL touches existing tables
  - Run `pnpm db:migrate` against a local Neon branch to confirm it applies cleanly (expected: forward-only, no errors)
  - Purpose: persist the schema diff in version control + journal
  - _Leverage: `packages/db/migrations/0003_careful_young_avengers.sql` (Phase E migration as a structural reference)_
  - _Requirements: 12.5, NFR Reliability_

### Phase 3 — AI annotation prompt

- [x] 6. Create annotation prompt and tool schema in `packages/ai/src/annotate.ts`
  - File: `packages/ai/src/annotate.ts` (new)
  - Export `ANNOTATE_TOOL_NAME = 'submit_annotated_words'` and `ANNOTATE_TOOL` (Anthropic tool with input_schema requiring `flagged: array<{ matchedForm, lemma, pos, gloss, example, freq, cefr }>` per design §Claude prompt + tool)
  - Export `ANNOTATE_SYSTEM_PROMPT` describing the rule (flag form/lemma rarer than `top_rank` AND/OR CEFR band > user's level), banning closed-class words, requiring `matchedForm` to be the exact lowercased surface form, plus per-language guidance for ES/DE/TR with one-shot examples each
  - Export `parseAnnotateResult(input: unknown): AnnotateOutput`: destructure `matchedForm` from each item before `WordFlagSchema.parse(rest)`; validate `matchedForm` separately as `z.string().min(1).max(120)`; dedupe duplicates by first-seen
  - Export `annotateText(client, { text, language, proficiencyLevel, topRank })` that calls `client.messages.create` with `cache_control: { type: 'ephemeral' }` on the system prompt, `tool_choice: { type: 'tool', name: ANNOTATE_TOOL_NAME }`, `temperature: 0`, and routes through `parseAnnotateResult`
  - Purpose: encapsulate the Claude annotation pipeline
  - _Leverage: `packages/ai/src/evaluate.ts`, `packages/ai/src/prompts.ts` (system prompt + tool patterns + cache_control + tool_choice usage)_
  - _Requirements: 5.1, 5.2, 5.3, 5.7, 5.8, 5.10_

- [x] 7. Re-export annotation API and add tests `packages/ai/src/annotate.test.ts`
  - Files: `packages/ai/src/index.ts` (modify — add exports for `ANNOTATE_TOOL`, `ANNOTATE_TOOL_NAME`, `ANNOTATE_SYSTEM_PROMPT`, `annotateText`, `parseAnnotateResult`, types), `packages/ai/src/annotate.test.ts` (new)
  - Tests with mocked Anthropic client: (a) `annotateText` registers the system prompt with `cache_control: { type: 'ephemeral' }`; (b) tool name is `submit_annotated_words`; (c) `parseAnnotateResult` accepts the shape returned by the tool; (d) parser rejects flags missing required fields; (e) duplicate `matchedForm` entries dedupe by first-seen
  - Purpose: lock the prompt-cache pattern + parser correctness
  - _Leverage: `packages/ai/src/evaluate.test.ts`_
  - _Requirements: 5.3, 5.7_

### Phase 4 — Lambda router

- [x] 8. Create read router skeleton + `POST /read/annotate` in `infra/lambda/src/routes/read.ts`
  - File: `infra/lambda/src/routes/read.ts` (new)
  - Hono sub-app, `LearningLanguageEnum = z.enum([Language.ES, Language.DE, Language.TR])` (own copy per the comment in `routes/sessions.ts:27–30`), `read.use('/read/*', authMiddleware)`
  - `POST /read/annotate`: Zod-parse `{ text, language }` (400 on validation), reject `EN` with 400 `UNSUPPORTED_LANGUAGE`; `Promise.all` for usage count (`gte(usageEvents.createdAt, oneDayAgo)` and `eventType IN ('ai_evaluation', 'read_annotation')`) and `userLanguageProfiles` lookup (fallback `CefrLevel.B1`); return 429 `RATE_LIMIT_EXCEEDED` if cap exceeded; call `annotateText`, catch and return 502 `AI_UNAVAILABLE`; INSERT `usage_events` with `eventType: 'read_annotation'` and `metadata: { language, textLength, flaggedCount }`; return `{ flagged, calibration: { cefr, top } }`
  - Purpose: stand up the router and the highest-traffic write route
  - _Leverage: `infra/lambda/src/routes/exercises.ts` (DAILY_EVAL_LIMIT, oneDayAgo pattern, AI failure handling, usage_events insert), `infra/lambda/src/routes/sessions.ts` (LearningLanguageEnum copy, DEFAULT_PROFICIENCY_LEVEL pattern, authMiddleware mount)_
  - _Requirements: 5.1, 5.4, 5.5, 5.6, 5.7, 5.8, 5.10_

- [x] 9. Add `POST /read/entries` handler in `infra/lambda/src/routes/read.ts`
  - File: `infra/lambda/src/routes/read.ts` (modify)
  - Zod-parse `{ language, title, source, text, flagged, bank }` reusing `WordFlagSchema` and `FlaggedMapSchema` from `@language-drill/shared`; require `bank.length >= 1`; enforce `text.length <= READ_TEXT_MAX_CHARS`; validate `every(bank, b => b in flagged)` (400 on any failure)
  - `await db.transaction(async (tx) => { … })`: INSERT `readEntries` RETURNING `id, pastedAt`; build `user_vocabulary` rows from `flagged[bankWord]` for every `bankWord`; one bulk `tx.insert(userVocabulary).values(rows).onConflictDoUpdate({ target: [userVocabulary.userId, userVocabulary.language, userVocabulary.word], set: { lemma, source, sourceReadEntryId, pos, gloss, exampleSentence, frequencyRank, cefrBand, addedAt: sql\`now()\` } })`
  - Return 201 `{ id, pastedAt }`
  - Purpose: persist a freshly-annotated entry plus its bank in one atomic transaction
  - _Leverage: `infra/lambda/src/routes/sessions.ts` (route handler structure, validation), Drizzle `db.transaction` API (already available via neon-serverless WebSocket pool — see `packages/db/src/client.ts` comment)_
  - _Requirements: 8.1, 9.3, 12.3, NFR Performance_

- [x] 10. Add `GET /read/entries` handler in `infra/lambda/src/routes/read.ts`
  - File: `infra/lambda/src/routes/read.ts` (modify)
  - Zod-parse `language` from query (`LearningLanguageEnum`)
  - One SELECT projecting `id`, `title`, `source`, `pastedAt`, plus three SQL templates: `preview = sql<string>\`substring(${readEntries.text} from 1 for ${READ_PREVIEW_CHARS})\``, `savedCount = sql<number>\`jsonb_array_length(${readEntries.bank})\``, `flaggedCount = sql<number>\`(select count(*)::int from jsonb_each(${readEntries.flaggedWords}))\``
  - `WHERE userId AND language` ; ORDER BY `pasted_at DESC, id DESC`; LIMIT `READ_HISTORY_LIMIT`
  - Return `{ entries: ReadEntrySummary[] }`
  - Purpose: history list endpoint, capped + ordered as Requirement 10 specifies
  - _Leverage: `infra/lambda/src/routes/sessions.ts` (Drizzle SELECT with `sql` templates)_
  - _Requirements: 10.1, NFR Performance_

- [x] 11. Add `GET /read/entries/:id` and `PUT /read/entries/:id/bank` handlers in `infra/lambda/src/routes/read.ts`
  - File: `infra/lambda/src/routes/read.ts` (modify)
  - `GET /read/entries/:id`: SELECT WHERE `id AND user_id`; on miss `c.header('Cache-Control', 'no-store')` + 404 `ENTRY_NOT_FOUND`; on hit return full entry shape per Requirement 10.2
  - `PUT /read/entries/:id/bank`: Zod-parse `{ bank: z.array(z.string().min(1)) }` (allows empty); SELECT `flagged_words, bank` for `(id, user_id)` (404 + Cache-Control header on miss); validate `every(newBank, b => b in flagged_words)` (400 `UNKNOWN_FLAGGED_WORD`); compute `addedWords` set difference; `await db.transaction`: UPDATE `readEntries.bank`; if `addedWords.length > 0`, single bulk upsert into `user_vocabulary`; return 200 `{ id, bank }`
  - Purpose: complete the route surface for entry reads + bank edits
  - _Leverage: `infra/lambda/src/routes/sessions.ts` 404 + Cache-Control pattern (`sessions.ts:477,503`)_
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 10.2_

- [x] 12. Mount read router in `infra/lambda/src/index.ts`
  - File: `infra/lambda/src/index.ts` (modify)
  - Add `import read from './routes/read';` next to existing route imports
  - Add `app.route('/', read);` next to existing route mounts (after `progress`, before `webhooks`)
  - Purpose: expose the new endpoints on the Lambda's request graph
  - _Leverage: `infra/lambda/src/index.ts` (existing route mounts)_
  - _Requirements: 1.1, 5.1, 8.1, 9.1, 10.1, 10.2_

- [x] 13a. Add annotate + rate-limit integration tests in `infra/lambda/src/routes/read.test.ts`
  - File: `infra/lambda/src/routes/read.test.ts` (new)
  - Mock `annotateText` from `@language-drill/ai`; reuse the test harness shape from `routes/sessions.test.ts`
  - Cases: annotate happy path (asserts response shape + one `usage_events` row with `eventType: 'read_annotation'` and metadata containing `language`/`textLength`/`flaggedCount`); annotate `EN` → 400 `UNSUPPORTED_LANGUAGE`; annotate when 50 prior usage rows exist (mix of `ai_evaluation` + `read_annotation` within the rolling 24h window) → 429 `RATE_LIMIT_EXCEEDED`; annotate Claude throw → 502 `AI_UNAVAILABLE` + zero usage rows; missing user-language profile falls back to B1 calibration
  - Purpose: lock the annotation wire contract + rate-limit semantics
  - _Leverage: `infra/lambda/src/routes/sessions.test.ts` (auth-mock + db-mock harness pattern)_
  - _Requirements: 5.1, 5.4, 5.6, 5.7, 5.8, 11.4_

- [x] 13b. Add entries CRUD + bank-update integration tests in `infra/lambda/src/routes/read.test.ts`
  - File: `infra/lambda/src/routes/read.test.ts` (modify — append new `describe` blocks)
  - Cases: save happy path (asserts rows in both `read_entries` and `user_vocabulary`; cross-language scoping); save with empty bank → 400; save with unknown bank word → 400 `VALIDATION_ERROR`; save with text > 2,000 → 400; bank update happy (replaced bank, upsert added words only, removed words DO NOT delete vocab rows); bank update for cross-user entry → 404 + `Cache-Control: no-store`; bank update with unknown bank word → 400 `UNKNOWN_FLAGGED_WORD`; list endpoint orders `pasted_at DESC, id DESC`, caps at 50, scopes by language; list endpoint preview is 120 chars (or shorter for short texts); single-entry endpoint 404 + `Cache-Control: no-store` for cross-user
  - Purpose: lock the entries CRUD + bank semantics
  - _Leverage: `infra/lambda/src/routes/sessions.test.ts`_
  - _Requirements: 8.1, 9.1, 9.2, 9.3, 9.5, 10.1, 10.2_

### Phase 5 — API client schemas and hooks

- [x] 14. Add api-client read schemas in `packages/api-client/src/schemas/read.ts` + tests
  - Files: `packages/api-client/src/schemas/read.ts` (new), `packages/api-client/src/schemas/read.test.ts` (new)
  - Define `AnnotateRequestSchema`, `AnnotateResponseSchema`, `SaveReadEntryRequestSchema`, `SaveReadEntryResponseSchema`, `UpdateBankRequestSchema`, `UpdateBankResponseSchema`, `ReadEntrySummarySchema`, `ReadEntriesResponseSchema`, `ReadEntryResponseSchema` per design §Shared schemas
  - Tests: round-trip parse for every schema (success path + at least one rejection case per schema, e.g. text > 2000, missing CEFR, malformed UUID)
  - Purpose: typed, validated wire contracts for the hooks
  - _Leverage: `packages/api-client/src/schemas/preferences.ts` (LearningLanguageEnum + Zod patterns), `packages/api-client/src/schemas/today.ts` (response schema layout)_
  - _Requirements: 5.1, 5.2, 8.1, 9.1, 10.1, 10.2_

- [x] 15. Add `useReadAnnotate` hook in `packages/api-client/src/hooks/useReadAnnotate.ts` + test
  - Files: `packages/api-client/src/hooks/useReadAnnotate.ts` (new), `packages/api-client/src/hooks/useReadAnnotate.test.ts` (new)
  - `useReadAnnotate({ fetchFn })` returns a `useMutation<AnnotateResponse, Error, AnnotateRequest>` POSTing JSON to `/read/annotate`, parsing the response with `AnnotateResponseSchema`
  - Tests: success path (renders no errors), Zod parse failure throws, error response surfaces via `mutation.error`
  - Purpose: client-side annotation entry point
  - _Leverage: `packages/api-client/src/hooks/useExercise.ts` (`useSubmitAnswer` mutation pattern), `packages/api-client/src/hooks/useExercise.test.ts`_
  - _Requirements: 4.6, 5.1, 5.2_

- [x] 16. Add `useReadEntries` and `useReadEntry` hooks in `packages/api-client/src/hooks/useReadEntries.ts` + test
  - Files: `packages/api-client/src/hooks/useReadEntries.ts` (new), `packages/api-client/src/hooks/useReadEntries.test.ts` (new)
  - `useReadEntries({ fetchFn, language })` → `useQuery<ReadEntriesResponse>` keyed `['readEntries', language]`, `staleTime: 60_000`
  - `useReadEntry({ fetchFn, id, enabled })` → `useQuery<ReadEntryFull>` keyed `['readEntry', id]`, `staleTime: Infinity`
  - Tests: each hook fires the right URL, parses with the response schema, gates `enabled`
  - Purpose: read-only history + single-entry queries
  - _Leverage: `packages/api-client/src/hooks/useTodayPlan.ts` (query layout, staleTime), `packages/api-client/src/hooks/useDebrief.ts` (single-resource query layout)_
  - _Requirements: 1.4, 10.1, 10.2_

- [x] 17. Add `useSaveReadEntry` and `useUpdateReadBank` mutations in `packages/api-client/src/hooks/useReadEntryMutations.ts` + test
  - Files: `packages/api-client/src/hooks/useReadEntryMutations.ts` (new), `packages/api-client/src/hooks/useReadEntryMutations.test.ts` (new)
  - `useSaveReadEntry({ fetchFn, queryClient })`: POST `/read/entries`; on success invalidate `['readEntries', language]` AND `queryClient.setQueryData(['readEntry', newId], ephemeralEntry)` (so the page can switch from ephemeral to persisted without a round-trip)
  - `useUpdateReadBank({ fetchFn, queryClient })`: PUT `/read/entries/:id/bank`; `onMutate` snapshot prior cache and apply optimistic update on `['readEntry', id]`; `onError` rollback to snapshot; `onSuccess` invalidate `['readEntries', language]` to refresh saved counts
  - Tests: optimistic update path applies + rolls back on error; success-path invalidations fire
  - Purpose: write path for entries and bank edits, with optimistic UX
  - _Leverage: `packages/api-client/src/hooks/useSession.ts` (`useCompleteSession` mutation pattern)_
  - _Requirements: 8.1, 8.4, 9.1, 9.6, 11.6_

- [x] 18. Re-export read hooks and schemas from `packages/api-client/src/index.ts`
  - File: `packages/api-client/src/index.ts` (modify)
  - Add exports for all schemas, types, and hooks introduced in tasks 14–17
  - Run `pnpm --filter @language-drill/api-client typecheck` to confirm the public surface compiles
  - Purpose: expose read APIs to consumers (apps/web)
  - _Leverage: `packages/api-client/src/index.ts` (existing export structure)_
  - _Requirements: 5.1, 8.1, 9.1, 10.1, 10.2_

### Phase 6 — Web helpers and reducer

- [x] 19. Add `tokenize` helper in `apps/web/app/(dashboard)/read/_lib/tokenize.ts` + test
  - Files: `apps/web/app/(dashboard)/read/_lib/tokenize.ts` (new), `apps/web/app/(dashboard)/read/_lib/tokenize.test.ts` (new)
  - `tokenize(text: string): TokenSpan[]` where `TokenSpan = { kind: 'word' | 'sep'; raw: string; key: string }`. The `key` is `raw.toLowerCase().replace(/[\p{P}]/gu, '')` for words; empty for separators
  - Split using a Unicode-aware regex covering ASCII punctuation plus ES `¿¡`, DE `„ " « »`, TR `… ;` and the em-dash. Use a single `String.prototype.split` regex with a capturing group so the separators stay in the output.
  - ≥ 12 cases per design: ASCII period; em-dash; ES `¿¡`; DE `„ "`; TR `…`; mixed `;` `:`; consecutive whitespace; Unicode letters (ñ, ä, ı); empty string; whitespace-only string; long sentence with mixed punctuation; punctuation-only string
  - Purpose: stable, locale-tolerant tokenization shared by `AnnotatedText`
  - _Leverage: no leverage — new helper (the prototype's tokenizer in `read.jsx:175–198` only handles the ES set; this task introduces the Unicode-aware version)_
  - _Requirements: 6.10_

- [x] 20. Add `calibration-copy` helper in `apps/web/app/(dashboard)/read/_lib/calibration-copy.ts` + test
  - Files: `apps/web/app/(dashboard)/read/_lib/calibration-copy.ts` (new), `apps/web/app/(dashboard)/read/_lib/calibration-copy.test.ts` (new)
  - `calibrationCopy(level: CefrLevel | null): { eyebrow: string; explanation: string; topRank: number | null }`
  - For non-null: `eyebrow = "~${level}+ calibration"`, `explanation = "showing words rarer than top-${READ_CEFR_TOP_RANK[level]} · refined by your known set"`, `topRank = READ_CEFR_TOP_RANK[level]`
  - For null: `eyebrow = "your calibration"`, `explanation = "showing words above your current band"`, `topRank = null`
  - Tests: 6 CefrLevel cases + 1 null case
  - Purpose: keep copy generation pure for testability and SSR safety
  - _Leverage: `packages/shared/src/read.ts` (`READ_CEFR_TOP_RANK`)_
  - _Requirements: 3.4, 6.2_

- [x] 21. Add page-level reducer in `apps/web/app/(dashboard)/read/_state/read-page-reducer.ts` + test
  - Files: `apps/web/app/(dashboard)/read/_state/read-page-reducer.ts` (new), `apps/web/app/(dashboard)/read/_state/read-page-reducer.test.ts` (new)
  - Export `ReadPageState`, `Action` (15 variants per design), `initialState`, `readPageReducer`, and selectors `selectShouldShowEmpty`, `selectShouldShowAnnotatedSkeleton`, `selectActiveEntry`
  - Implement each action per design §Page-level state machine (especially: `LOAD_ENTRY` clears `activeWord`, `saveToast`, `inlineError`; `ENTRY_PERSISTED` sets `activeEntryId` AND shows save toast in one step; `SET_BANK_FROM_ENTRY` is the rollback action)
  - ≥ 20 unit tests covering every action and the three selectors
  - Purpose: pure state machine ready for integration into the page
  - _Leverage: `apps/web/app/(dashboard)/drill/_components/session-reducer.ts` (discriminated-union reducer pattern)_
  - _Requirements: 1.3, 1.4, 2.1–2.7, 4.1–4.8, 6.4, 6.6, 7.6, 8.1, 8.7, 11.6_

### Phase 7 — UI components

- [x] 22. Add `ReadTopBar` in `apps/web/app/(dashboard)/read/_components/read-top-bar.tsx` + test
  - Files: `read-top-bar.tsx`, `__tests__/read-top-bar.test.tsx`
  - Props: `view`, `onChange(view)`, `historyCount`. Renders eyebrow + `t-display-m` title on the left, three `Button size="sm"`s on the right (current text · history `{count}` · + paste new)
  - Active button uses `variant="primary"`; others use the default ghost variant
  - `aria-current="page"` on the active button per Requirement 14.6
  - Bottom border-rule via `border-b border-rule pb-[14px]`
  - Tests: each click fires `onChange` with the right view; `aria-current` is set on the active button; `historyCount` renders inside the badge (or "—" placeholder when undefined)
  - Purpose: the constant header above every view
  - _Leverage: `apps/web/components/ui/button.tsx`_
  - _Requirements: 2.1, 2.5, 2.6, 14.6_

- [x] 23. Add `EmptyView` in `apps/web/app/(dashboard)/read/_components/empty-view.tsx` + test
  - Files: `empty-view.tsx`, `__tests__/empty-view.test.tsx`
  - Props: `onPaste()`, `cefrToken: CefrLevel | null`. Renders the centered hero (max-width 640, top margin 60), Caveat eyebrow ("read in the wild"), `t-display-l` title, body paragraph, primary lg CTA "paste a text →"
  - "How it works" card below: dashed border, paper-2 background, `t-micro` heading, ordered list with the 4 steps. Step 2's `~CEFR+` token comes from `cefrToken` (fallback "your current band" when null)
  - Tests: clicking CTA calls `onPaste`; null cefrToken shows fallback text; non-null shows e.g. "~B1+"
  - Purpose: first-launch landing
  - _Leverage: `apps/web/components/ui/button.tsx`, design system Caveat utility class_
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 24. Add `PasteView` in `apps/web/app/(dashboard)/read/_components/paste-view.tsx` + test
  - Files: `paste-view.tsx`, `__tests__/paste-view.test.tsx`
  - **Title/source decision (v1):** Render a SINGLE "title or source" `Input` matching the prototype (`read.jsx:136–143`). The reducer's `paste.title` field stores the combined string; the reducer's `paste.source` is always `''`. The save mutation in task 17 sends `{ title: paste.title, source: '' }` to satisfy `SaveReadEntryRequestSchema`. The `READ_SOURCE_MAX_CHARS` constant exists for forward-compat but is not enforced by any UI in v1; the title input enforces `maxLength={READ_TITLE_MAX_CHARS}` (120). If a future iteration splits these into two fields, only this component + the reducer's `PASTE_FIELD` action need touching.
  - Props: `paste`, `onChange(field, value)`, `onCancel()`, `onAnnotate()`, `isLoading`, `errorBody`. Renders eyebrow, title, single combined "title or source" input (`maxLength={READ_TITLE_MAX_CHARS}`)
  - Textarea with min-height 240px, Fraunces 16px / 1.6 (utility classes) — no `maxLength` (counter goes accent at 2,001 to match the prototype)
  - Char counter `aria-live="polite"`; flips to `--accent` color + " · too long" suffix at length > `READ_TEXT_MAX_CHARS`
  - Action row: ghost "cancel" + primary "annotate →"; both disabled while `isLoading`; "annotate →" also disabled when `text.trim().length === 0` or `text.length > READ_TEXT_MAX_CHARS`
  - Tip strip below action row with the reworded copy from Requirement 4.9
  - When `errorBody` is non-null, render an inline error card above the textarea per Requirement 11.2 / 11.3 / 11.4 (the visual treatment is shared with `AnnotatedError`; PasteView passes the same props through)
  - Tests: typing 1,500 chars enables CTA; typing 2,001 chars disables CTA + flips counter color; clicking cancel/annotate fires the callbacks; `isLoading` disables both buttons; `errorBody` renders the error card
  - Purpose: the paste-text form
  - _Leverage: `apps/web/components/ui/input.tsx`, `textarea.tsx`, `button.tsx`, `packages/shared/src/read.ts` (constants)_
  - _Requirements: 4.1–4.7, 4.9, 14.5_

- [x] 25a. Add `IntensityToggle` in `apps/web/app/(dashboard)/read/_components/intensity-toggle.tsx` + test
  - Files: `intensity-toggle.tsx`, `__tests__/intensity-toggle.test.tsx`
  - WAI-ARIA `role="radiogroup"` with two `role="radio"` children ("subtle" / "assertive"); ArrowLeft/Right cycles selection; Enter / Space activates the focused option; active option fills `--ink` with `--paper` text per the prototype
  - Props: `{ value: 'subtle' | 'assertive', onChange: (v) => void }`
  - Tests: ArrowRight from "subtle" moves focus AND fires onChange with 'assertive'; ArrowLeft from "assertive" returns to 'subtle'; Enter on focused radio fires `onChange`; `aria-checked` reflects the active option
  - Purpose: keyboard-accessible intensity toggle
  - _Leverage: `apps/web/components/ui/button.tsx`_
  - _Requirements: 6.4, 14.1_

- [x] 25b. Add `CalibrationStrip` in `apps/web/app/(dashboard)/read/_components/calibration-strip.tsx` + test
  - Files: `calibration-strip.tsx`, `__tests__/calibration-strip.test.tsx`
  - Pure render of `Chip` (eyebrow text from `calibrationCopy`) + `t-small` explanation + ghost "adjust" button (clicking is a no-op per Requirement 6.11)
  - Props: `{ eyebrow: string, explanation: string }` — both already computed by `calibrationCopy(level)` from task 20
  - Tests: renders both strings; clicking "adjust" produces no observable state change (handler is undefined or a no-op)
  - Purpose: pure presentational strip
  - _Leverage: `apps/web/components/ui/chip.tsx`, `button.tsx`_
  - _Requirements: 6.2, 6.11_

- [x] 26a. Add `.rd-word` styles in `apps/web/app/(dashboard)/read/_components/word-flag-styles.module.css`
  - File: `apps/web/app/(dashboard)/read/_components/word-flag-styles.module.css` (new)
  - Define exactly the four intensity / state classes from the prototype's `injectReadStyles` block (`read.jsx:430–483`) using CSS variables already exposed by the design system (`--accent`, `--accent-2`, `--accent-soft`, `--hilite-soft`, `--ink`, `--paper`):
    - `.word` — base reset (no border, transparent background, inherit font, 2px radius, transition)
    - `.subtle` — dotted underline `--accent`, 1.5px thickness, 4px offset; `:hover` solid underline + `--accent-soft` background
    - `.assertive` — amber wash gradient (linear-gradient with `--hilite-soft`), 1px horizontal padding; `:hover` flat `--hilite-soft`
    - `.saved.subtle` — 2px solid `--accent` underline, `--accent-2` color, 500 weight
    - `.saved.assertive` — flat `--accent-soft` pill, 1px outer halo, `--accent-2` color, 500 weight
    - `.active` — filled `--ink` background, `--paper` text, 3px radius, 0 3px padding, no underline (overrides all other classes via `!important` since it must beat both intensity and saved)
  - Purpose: keep the styles separate from the React tree so `AnnotatedText` stays pure markup
  - _Leverage: `read.jsx:430–483` (prototype CSS)_
  - _Requirements: 6.4, 6.5, 6.6_

- [x] 26b. Add `AnnotatedText` in `apps/web/app/(dashboard)/read/_components/annotated-text.tsx` + test
  - Files: `annotated-text.tsx`, `__tests__/annotated-text.test.tsx`
  - Props: `text`, `flaggedMap`, `intensity`, `bankSet: Set<string>`, `activeWord: string | null`, `onWordClick(word, rect)`. Calls `tokenize(text)`; renders each `word` token as `<button className={cn(styles.word, styles[intensity], inBank && styles.saved, isActive && styles.active)}>{token.raw}</button>` when `flaggedMap[token.key]` is set; otherwise plain text fragment
  - Click handler: `e.currentTarget.getBoundingClientRect()`, then call `onWordClick(token.key, rect)` so the parent computes popover position relative to its own container
  - Imports the CSS Module from task 26a — no inline `<style>` tag, no global stylesheet edit
  - Tests: a flagged word renders as a button with the expected class set; a non-flagged token renders as text; clicking a flagged button fires `onWordClick` with the correct word + a `DOMRect`; switching `intensity` swaps the class; setting `bankSet` adds the saved class; setting `activeWord` adds the active class
  - Purpose: the rendered passage with click affordances
  - _Leverage: `apps/web/app/(dashboard)/read/_lib/tokenize.ts`, task 26a CSS module, `apps/web/lib/cn.ts`_
  - _Requirements: 6.2, 6.4, 6.5, 6.6, 6.10, 14.2_

- [x] 27. Add `WordPopover` in `apps/web/app/(dashboard)/read/_components/word-popover.tsx` + test
  - Files: `word-popover.tsx`, `__tests__/word-popover.test.tsx`
  - Props: `entry: WordFlag`, `word`, `x`, `y`, `containerWidth`, `inBank`, `onSave()`, `onSkip()`, `onClose()`
  - Layout: pointer triangle (top edge, aligned to word center), header (lemma `Fraunces 22px` + POS italic + CEFR mono right-aligned), gloss row, divider, body (`t-micro` + Fraunces 15px example), divider, footer (mono "freq #N" + ghost "skip" + primary "+ save to bank" / accent "✓ saved · undo")
  - Position: `left = clamp(8, x - W/2, containerWidth - W)`; `top = y`. `e.stopPropagation()` on click to prevent the parent's outside-click from dismissing
  - Auto-focus first focusable element (skip button) on mount when opened by keyboard; `Escape` calls `onClose`
  - Tests: clicking save fires `onSave`; clicking skip fires `onSkip`; `Escape` fires `onClose`; clamp pinning at left edge (x=0) and right edge (x = containerWidth)
  - Purpose: the word-meaning popover
  - _Leverage: `apps/web/components/ui/button.tsx`_
  - _Requirements: 7.1–7.7, 14.3_

- [x] 28. Add `WordBankRail` in `apps/web/app/(dashboard)/read/_components/word-bank-rail.tsx` + test
  - Files: `word-bank-rail.tsx`, `__tests__/word-bank-rail.test.tsx`
  - Props: `bank: string[]`, `flaggedMap: FlaggedMap`, `onRemove(word)`. Sticky `<aside>` (top: 24, max-height calc(100vh - 80px)), card surface
  - Header: `t-display-s` "word bank" + mono count. Subtitle: "marked from this passage"
  - Empty state: dashed-border message "tap a highlighted word to see its meaning, then save it here."
  - List: vertical stack of paper-2 rows (lemma + gloss + CEFR badge + "×" remove)
  - Footer: "saved words appear in cloze, vocab recall, and translation drills tagged" + inline accent `Chip` "from your reading"
  - Tests: empty state visible at bank=[]; renders one row per bank word; clicking × fires `onRemove`
  - Purpose: the right-rail bank visualizer
  - _Leverage: `apps/web/components/ui/card.tsx`, `chip.tsx`, `button.tsx`_
  - _Requirements: 6.3, 8.7, 8.8_

- [x] 29. Add `AnnotatedSkeleton` and `AnnotatedError` in `apps/web/app/(dashboard)/read/_components/`
  - Files: `annotated-skeleton.tsx`, `annotated-error.tsx`, `__tests__/annotated-skeleton.test.tsx`, `__tests__/annotated-error.test.tsx`
  - `AnnotatedSkeleton`: title + source rows in their final position; "annotating…" `Chip` near the title; text as shimmer-tinted spans with deterministic widths (e.g., `seedRandom('skeleton-N')` → widths in [40px, 100px]) so SSR matches client
  - `AnnotatedError`: paper-2 `Card` with heading "couldn't annotate this", body containing the server `error` field, two ghost `Button`s "edit text" and "try again". Disable "try again" when `kind === 'rateLimit'` (Requirement 11.4)
  - Tests for `AnnotatedSkeleton`: renders chip + at least one shimmer span. For `AnnotatedError`: renders body; "try again" is disabled when `kind === 'rateLimit'`
  - Purpose: loading + error fallbacks for the annotated view
  - _Leverage: `apps/web/components/ui/card.tsx`, `chip.tsx`, `button.tsx`_
  - _Requirements: 11.1, 11.2, 11.3, 11.4_

- [x] 30a. Add `AnnotatedFooter` in `apps/web/app/(dashboard)/read/_components/annotated-footer.tsx` + test
  - Files: `annotated-footer.tsx`, `__tests__/annotated-footer.test.tsx`
  - Props: `flaggedCount`, `savedCount`, `onClearBank()`, `onSave()`, `isSaving`. Renders the footer summary row (mono "N flagged · N saved · M skipped" — `M = flagged - saved`), ghost "clear bank" button (disabled when `savedCount === 0`), primary "save N to bank →" (label includes `savedCount`; disabled when `savedCount === 0` OR `isSaving`)
  - Also exports `<ZeroFlaggedStrip onPasteNew />` (separate sub-component): sage `--ok-soft` strip "this passage is well within your level — nice." + ghost CTA "paste something harder?"
  - Tests: footer disables both buttons at `savedCount === 0`; clicking save / clearBank fires the callbacks; `isSaving` disables save; `ZeroFlaggedStrip` clicks fire `onPasteNew`
  - Purpose: isolates the two mutually-exclusive bottom-row variants for testability
  - _Leverage: `apps/web/components/ui/button.tsx`_
  - _Requirements: 6.2, 6.9, 8.1, 8.7_

- [x] 30b. Add `AnnotatedView` in `apps/web/app/(dashboard)/read/_components/annotated-view.tsx` + test
  - Files: `annotated-view.tsx`, `__tests__/annotated-view.test.tsx`
  - Props per design (entry, bank, intensity, activeWord, popover position, callbacks). 2-col CSS grid `minmax(0, 1fr) 280px`, gap `s-6`, `align-items: start`. Composes `IntensityToggle`, `CalibrationStrip`, `AnnotatedText`, `WordPopover`, `WordBankRail`, and either `AnnotatedFooter` (≥ 1 flagged word) or `ZeroFlaggedStrip` (0 flagged) from task 30a
  - Outside-click handler on the `.rd-text` container dismisses the popover (calls `onPopoverClose`); the popover itself stops propagation
  - When `Object.keys(entry.flaggedWords).length === 0`, hide the rail and render `ZeroFlaggedStrip` instead of `AnnotatedFooter`
  - Tests: renders rail + reader + footer when flagged count ≥ 1; zero-flagged path hides rail + renders `ZeroFlaggedStrip`; outside-click fires `onPopoverClose`
  - Purpose: the central reader composition
  - _Leverage: tasks 25a, 25b, 26b, 27, 28, 30a components, `apps/web/components/ui/`_
  - _Requirements: 6.1, 6.7, 6.9_

- [x] 31. Add `HistoryView` and `HistoryEmptyState` in `apps/web/app/(dashboard)/read/_components/`
  - Files: `history-view.tsx`, `history-empty-state.tsx`, `__tests__/history-view.test.tsx`, `__tests__/history-empty-state.test.tsx`
  - `HistoryView`: max-width 800; eyebrow + `t-display-m` "past texts"; vertical stack of cards per Requirement 10.3 (title Fraunces 18px 500 + source line + Fraunces-italic preview; right column mono "N flagged" + ok-`Chip` "N saved"). Clicking a card fires `onOpen(entryId)`
  - `HistoryEmptyState`: per Requirement 10.5 — `t-small` empty message + primary "+ paste new" CTA
  - Tests: each card renders the right counts; clicking fires `onOpen`; empty state shows CTA
  - Purpose: the history-of-passages screen
  - _Leverage: `apps/web/components/ui/card.tsx`, `chip.tsx`, `button.tsx`_
  - _Requirements: 10.3, 10.5_

- [x] 32. Add `SaveToast` and `InlineErrorToast` in `apps/web/app/(dashboard)/read/_components/`
  - Files: `save-toast.tsx`, `inline-error-toast.tsx`, `__tests__/save-toast.test.tsx`, `__tests__/inline-error-toast.test.tsx`
  - `SaveToast`: `role="status"`, `aria-live="polite"`, fixed bottom-center 80px, max-width 540, ink bg / paper text, sage circle ✓, body "**N words added** to your bank.\nyour next session will weave them in.", outlined "see next session" + "×" dismiss
  - `InlineErrorToast`: `role="status"`, `aria-live="polite"`, fixed bottom-right, accent variant, kind-driven copy ("couldn't update — try again" for `kind: 'bank'`; "couldn't save — try again" for `kind: 'save'`); auto-dismiss is parent-driven
  - Tests: `SaveToast` renders the count and routes "see next session" via callback; `InlineErrorToast` renders the right body for each kind
  - Purpose: fixed-position notification layers
  - _Leverage: `apps/web/components/ui/button.tsx`_
  - _Requirements: 8.2, 8.3, 11.6, 14.4_

### Phase 8 — Page integration

- [x] 33. Rewrite `/read` page in `apps/web/app/(dashboard)/read/page.tsx`
  - File: `apps/web/app/(dashboard)/read/page.tsx` (modify — replaces the placeholder)
  - Mark `'use client'`; use `useActiveLanguage`, `useAuth().getToken({ template: 'api' })`, `useMemo` for `fetchFn`
  - `useReducer(readPageReducer, initialState)`; query `useReadEntries({ fetchFn, language })`; conditionally call `useReadEntry({ id: state.activeEntryId, enabled: state.activeEntryId !== null })`
  - Bind `useReadAnnotate`, `useSaveReadEntry`, `useUpdateReadBank` mutations
  - **Required `useEffect`s** (enumerated so the implementer doesn't re-derive them):
    1. **Resolve most-recent entry on language change:** when `entriesQuery.data` resolves AND `state.activeEntryId === null` AND there is at least one entry for the active language, dispatch `LOAD_ENTRY` with `entries[0].id` (recall the list is `pasted_at DESC`-ordered).
    2. **Save-toast auto-dismiss:** when `state.saveToast !== null`, schedule `setTimeout(() => dispatch(DISMISS_SAVE_TOAST), 4000)`; clean up on `state.saveToast` change or unmount.
    3. **Inline-error-toast auto-dismiss:** when `state.inlineError !== null`, schedule `setTimeout(() => dispatch(DISMISS_INLINE_ERROR), 3000)`; clean up similarly.
    4. **Optimistic snapshot ref:** a `useRef<string[]>([])` that captures `state.bank` inside `useUpdateReadBank.onMutate` — on `onError`, dispatch `SET_BANK_FROM_ENTRY` with the snapshot AND `SHOW_INLINE_ERROR { kind: 'bank' }`.
  - Compose `<ReadTopBar />` + view body (`EmptyView` / `PasteView` / `AnnotatedView` / `HistoryView`) per `state.view`; render `<SaveToast />` and `<InlineErrorToast />` outside the main column
  - On `useSaveReadEntry.onSuccess`, dispatch `ENTRY_PERSISTED { entryId }` AND `queryClient.setQueryData(['readEntry', newId], ephemeralEntry)` so the post-save state has a cached entry
  - Purpose: the page entry point
  - _Leverage: `apps/web/app/(dashboard)/page.tsx` (parallel-queries + active-language pattern), `apps/web/app/(dashboard)/drill/page.tsx` (mutation/reducer wiring + auto-effects pattern), all hooks/components from prior tasks_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 3.1, 3.2, 3.4, 4.5, 4.6, 4.7, 6.1, 6.7, 6.8, 7.1, 7.4, 7.5, 7.6, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 9.1, 9.6, 10.4, 10.5, 10.6, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 14.4_

- [x] 34. Add page integration tests in `apps/web/app/(dashboard)/read/page.test.tsx`
  - File: `apps/web/app/(dashboard)/read/page.test.tsx` (new)
  - Mock all hooks at the api-client boundary (matches `drill/page.test.tsx`); use Vitest fake timers for the toast auto-dismiss
  - Cases: mount with 0 entries → `EmptyView`; mount with 3 entries → `AnnotatedView` for the most recent; click "+ paste new" → `PasteView`; type 1,500 / 2,001 chars → counter behavior; click "annotate →" → mutation call; resolved → annotated view; click flagged word → popover; click "save to bank" inside popover → bank update; click "save N to bank →" → toast renders + auto-dismisses after 4 s; click "history" → `HistoryView`; click history card → `useReadEntry` fetches + skeleton then full view; annotation 429 → "try again" disabled; bank-update failure → optimistic rollback + inline error toast
  - Purpose: end-to-end behavioral coverage of the page
  - _Leverage: `apps/web/app/(dashboard)/drill/page.test.tsx` (mock-at-the-hook pattern + fake-timer usage)_
  - _Requirements: 1.3, 1.4, 1.6, 2.1, 2.2, 2.3, 2.4, 4.2, 4.3, 4.6, 6.4, 6.7, 7.1, 7.4, 7.5, 8.1, 8.2, 8.3, 8.4, 9.1, 9.6, 10.4, 10.5, 11.1, 11.4, 11.6_

### Phase 9 — Pre-push verification

- [x] 35. Run full repo checks (`pnpm lint && pnpm typecheck && pnpm test`)
  - From the repo root, run the three commands sequentially and confirm zero failures (per `CLAUDE.md` "Pre-Push Checks")
  - Fix any warnings/errors that surface; re-run until all three pass
  - For any test failures, update the offending source/test file and re-run — do NOT skip tests
  - Purpose: lock the merge gate before opening the PR
  - _Leverage: `CLAUDE.md` §Pre-Push Checks_
  - _Requirements: All_
