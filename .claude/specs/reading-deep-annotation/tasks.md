# Implementation Plan

## Task Overview

Implements Reading: Deep Annotation (Part 1) in dependency order across three shippable groups: **(A) shared contract**, **(B) slim skim pass** (PR 1), **(C) deep on-demand path** — DB → AI module → backend routes → api-client → web UI (PR 2), and **(D) Turkish/German morphology + E2E + docs** (PR 3). Each task touches 1–3 files, has one testable outcome, and references the requirement(s) it satisfies and the existing code it extends.

## Steering Document Compliance

Files land in their conventional homes: shared Zod/types in `packages/shared/src`, prompts/tools/parsers in `packages/ai/src`, wire schemas + hooks in `packages/api-client/src`, routes in `infra/lambda/src/routes`, schema/migrations in `packages/db`, UI under `apps/web/app/(dashboard)/read/_components`. New files mirror neighbor naming (`read-span.ts`, `useReadAnnotateSpan.ts`). No CDK changes (the route rides the existing `/{proxy+}` proxy). Prompt edits bump version constants and are Langfuse-synced per CLAUDE.md.

## Atomic Task Requirements

Each task: 1–3 files, 15–30 min, single testable outcome, explicit files, requirement + leverage references. Tests are added to the module's existing test file and run before the task is marked complete.

## Tasks

### A. Shared contract

- [x] 1. Add deep-card Zod schemas + types to `packages/shared/src/read.ts`
  - File: `packages/shared/src/read.ts`
  - Add `MorphologySchema`, `InflectionSchema`, `DeepWordCardSchema`, `DeepPhraseCardSchema`, `DeepSentenceCardSchema`, the `DeepCardSchema` discriminated union (on `type`), and `SpanAnnotationsSchema` (`z.record(string, DeepCardSchema)`); export inferred types
  - Purpose: single authoritative contract shared by AI parser, route, api-client, and DB `$type`
  - _Leverage: packages/shared/src/read.ts (WordFlagSchema/FlaggedMapSchema patterns), CefrLevel enum_
  - _Requirements: 4.2, 5.2, 6.1, 6.4, 7.1, 11.1_

- [x] 2. Make `WordFlagSchema.example` optional in `packages/shared/src/read.ts`
  - File: `packages/shared/src/read.ts`
  - Change `example: z.string().min(1)` → `example: z.string().min(1).optional()`; keep all other fields
  - Purpose: the slimmed skim card omits `example`; stored entries with `example` stay valid
  - _Leverage: packages/shared/src/read.ts_
  - _Requirements: 1.1_

- [x] 3. Add unit tests for the deep-card schemas
  - File: `packages/shared/src/read.test.ts` (create if absent, else extend)
  - Assert each card type parses a valid fixture, the union discriminates on `type`, a missing `type` is rejected, and `WordFlag` parses with and without `example`
  - Purpose: lock the contract before downstream code depends on it
  - _Leverage: packages/shared vitest setup_
  - _Requirements: 1.1, 4.2, 5.2, 6.1_

### B. Slim skim pass (PR 1)

- [x] 4. Slim `ANNOTATE_TOOL` + skim prompt in `packages/ai/src/annotate.ts`
  - File: `packages/ai/src/annotate.ts`
  - Remove `example` from the tool `input_schema` and its `required` array; edit `ANNOTATE_SYSTEM_PROMPT` to stop emitting examples and to **never flag proper nouns**; bump `ANNOTATE_SYSTEM_PROMPT_VERSION` to `annotate@<today>`
  - Purpose: lighter per-word output (Req 1) + proper-noun exclusion at the prompt (Req 2)
  - _Leverage: packages/ai/src/annotate.ts (ANNOTATE_TOOL, ANNOTATE_SYSTEM_PROMPT(_VERSION))_
  - _Requirements: 1.1, 1.5, 2.1_

- [x] 5. Drop proper-noun items + tolerate missing `example` in `streamAnnotation`
  - File: `packages/ai/src/annotate.ts`
  - In the per-item validation loop, skip any flag whose `pos` denotes a proper noun (defense in depth); ensure the item validator accepts the now-optional `example`
  - Purpose: server-side PROPN guard + slim-flag compatibility (Req 2.4, 1.1)
  - _Leverage: packages/ai/src/annotate.ts (extractNewItems, WordFlagSchema+matchedForm validation)_
  - _Requirements: 2.4, 1.1_

- [x] 6. Raise `CANDIDATE_LIMIT` + add proper-noun pre-filter in `pipeline.ts`
  - File: `infra/lambda/src/annotate-stream/pipeline.ts`
  - Raise `CANDIDATE_LIMIT` 20 → 50 (update the comment with the slim-token latency rationale); add an ES/TR pre-filter dropping capitalized non-sentence-initial tokens before candidate selection; exclude German from the capitalization rule
  - Purpose: broader coverage (Req 1.2) + cheap PROPN removal for ES/TR (Req 2.2, 2.3)
  - _Leverage: infra/lambda/src/annotate-stream/pipeline.ts (tokenize, stopword/freq filters, CANDIDATE_LIMIT)_
  - _Requirements: 1.2, 2.2, 2.3_

- [x] 7. Tests for the slimmed pipeline + PROPN pre-filter
  - File: `infra/lambda/src/annotate-stream/pipeline.test.ts`
  - Assert the cap is 50; an ES/TR mid-sentence capitalized token is dropped while a sentence-initial one survives the capitalization rule; a German capitalized noun is **not** dropped by capitalization; an all-stopword/empty-candidate passage still yields zero candidates (empty-candidate shortcut preserved)
  - Purpose: verify Req 1.2 / 1.4 / 2.2 / 2.3
  - _Leverage: infra/lambda/src/annotate-stream/pipeline.test.ts_
  - _Requirements: 1.2, 1.4, 2.2, 2.3_

- [x] 8. Tests for slim parse + server-side PROPN drop
  - File: `infra/lambda/src/annotate-stream/handler.test.ts` (server-side PROPN drop) and the `packages/ai` annotate parser test (optional `example`)
  - Assert a flag without `example` is accepted/streamed; a `pos`=proper-noun flag is dropped before streaming
  - Purpose: verify Req 1.1 / 2.4
  - _Leverage: existing annotate streaming contract tests_
  - _Requirements: 1.1, 2.4_

### C. Deep on-demand path (PR 2)

#### C1. Database

- [x] 9. Add `span_annotations` and `card` columns to the read schema
  - File: `packages/db/src/schema/read.ts`
  - Add `spanAnnotations: jsonb('span_annotations').$type<SpanAnnotations>()` (nullable) to `readEntries`; add `card: jsonb('card').$type<DeepCard>()` (nullable) to `userVocabulary`; import the types from `@language-drill/shared`
  - Purpose: durable per-entry deep-card store (Req 11) + vocab snapshot (Req 8)
  - _Leverage: packages/db/src/schema/read.ts (flaggedWords/bank jsonb `$type` precedent)_
  - _Requirements: 8.1, 11.1_

- [x] 10. Generate the Drizzle migration for the new columns
  - Files: `packages/db/migrations/0014_*.sql`, `packages/db/migrations/meta/*`
  - Run `pnpm --filter @language-drill/db db:generate`; verify the SQL is two `ADD COLUMN ... jsonb` statements (nullable, no constraint/index changes)
  - Purpose: forward-only migration matching the schema change
  - _Leverage: packages/db/drizzle.config.ts, migrations/0012_add_rejection_reason_counts… (ADD COLUMN jsonb precedent)_
  - _Requirements: 8.1, 11.1_

- [x] 11. Extend DB schema tests for the new columns
  - File: `packages/db/src/schema/read.test.ts`
  - Assert `read_entries.span_annotations` and `user_vocabulary.card` exist via `getTableConfig`; assert the `(user, language, word)` unique constraint and existing indexes are unchanged
  - Purpose: verify schema additions don't regress constraints
  - _Leverage: packages/db/src/schema/read.test.ts (getTableConfig assertions)_
  - _Requirements: 8.3, 11.1_

#### C2. AI deep-span module

- [x] 12. Create the deep-span prompt + tool in `packages/ai/src/read-span.ts`
  - File: `packages/ai/src/read-span.ts`
  - Define `READ_SPAN_SYSTEM_PROMPT`, `READ_SPAN_PROMPT_VERSION = "read-span@<today>"`, and `READ_SPAN_TOOL` (input schema = the deep-card union; prompt instructs CEFR-calibrated `definition`, contextual sense, and that the caller supplies `type`)
  - Purpose: the Sonnet contract for deep cards (Req 6, 4, 5)
  - _Leverage: packages/ai/src/evaluate.ts (EVALUATION_TOOL + prompt shape), packages/shared deep-card schemas_
  - _Requirements: 6.1, 6.6, 4.2, 5.2_

- [x] 13. Implement `annotateSpan` + `parseSpanResult` in `read-span.ts`
  - File: `packages/ai/src/read-span.ts`
  - `annotateSpan(client, { language, text, start, end, spanType, proficiencyLevel })`: resolve prompt via `getPromptOrFallback("read-span-system-prompt", …, READ_SPAN_PROMPT_VERSION)`, `messages.create` with `model:"claude-sonnet-4-6"`, forced `tool_choice`, `temperature:0`, system `cache_control: ephemeral`; extract `tool_use`; `parseSpanResult` (Zod) → `DeepCard`; `buildSpanUserPrompt` sends full passage + offsets
  - Purpose: the deep model call (Req 3.4, 6, 7)
  - _Leverage: packages/ai/src/evaluate.ts (call structure), prompts-registry (getPromptOrFallback, sha8), observability (setResolvedPromptVersion/Client)_
  - _Requirements: 3.4, 6.1, 6.6_

- [x] 14. Re-export `read-span` symbols + register the prompt
  - Files: `packages/ai/src/index.ts`, `CLAUDE.md`
  - Re-export `annotateSpan`, `READ_SPAN_SYSTEM_PROMPT(_VERSION)`, `READ_SPAN_TOOL`; add the `read-span-system-prompt` entry to the prompt-version table in CLAUDE.md and ensure `bootstrap-prompts` picks it up
  - Purpose: make the module callable + satisfy prompt-versioning bookkeeping (Req 10.5)
  - _Leverage: packages/ai/src/index.ts (existing re-exports), CLAUDE.md prompt-version table, packages/ai/scripts/bootstrap-prompts.ts_
  - _Requirements: 10.5_

- [x] 15. Tests for `read-span.ts`
  - File: `packages/ai/src/read-span.test.ts`
  - `parseSpanResult` accepts each card type and rejects malformed input; `annotateSpan` builds a forced-tool Sonnet request and maps `tool_use` → `DeepCard` with a mocked SDK; prompt resolves via fallback when Langfuse is unset
  - Purpose: verify the deep model call contract
  - _Leverage: packages/ai/src/evaluate.test.ts (mock-SDK pattern), vitest config_
  - _Requirements: 6.1, 7.1_

#### C3. Backend routes

- [x] 16. Add span-type resolution helper
  - File: `infra/lambda/src/routes/read-span-utils.ts` (new)
  - `resolveSpanType(text, start, end): "word"|"phrase"|"sentence"` — single token → word; multi-token within a sentence → phrase; offsets matching a sentence range (boundaries via `.`/`!`/`?`) → sentence
  - Purpose: server-authoritative span typing (Req 4.3, 5.1)
  - _Leverage: infra/lambda/src/annotate-stream/pipeline.ts tokenizer (or shared tokenize util)_
  - _Requirements: 4.3, 5.1_

- [x] 17. Add `POST /read/annotate-span` route
  - File: `infra/lambda/src/routes/read.ts`
  - Zod-validate `{ language, text, start, end, entryId? }`; derive `spanType`; cache-hit short-circuit on owned `entryId` + existing `span_annotations["start:end"]` (no model, no metering); rate-limit on `read_span_annotation` vs `READ_SPAN_DAILY_LIMIT` (≈150); resolve `proficiencyLevel` from `userLanguageProfiles` (default B1, as `pipeline.ts` does); call `annotateSpan` in `withLlmTrace`; write-back via `COALESCE(span_annotations,'{}'::jsonb) || jsonb_build_object(key, card)` only when owned `entryId` (no `entryId` ⇒ no DB write, Req 11.2); insert one usage row only on a real call; return `DeepCard`
  - Purpose: the on-demand endpoint (Req 3, 4, 5, 10, 11)
  - _Leverage: infra/lambda/src/routes/read.ts (router, authMiddleware, safeParse, db.transaction), annotate-stream/pipeline.ts (userLanguageProfiles CEFR lookup, default B1), annotate-stream/handler.ts:146-164,300 + routes/exercises.ts:183-249 (usage_events pattern), packages/ai annotateSpan/createObservedClaudeClient/withLlmTrace_
  - _Requirements: 3.2, 3.4, 3.5, 4.1, 5.1, 10.1, 10.2, 10.3, 10.4, 11.1, 11.6_

- [x] 18. Add `POST /read/vocabulary` + `DELETE /read/vocabulary/:id`
  - File: `infra/lambda/src/routes/read.ts`
  - POST: Zod-validate `{ language, card: DeepCard, sourceReadEntryId? }`; reject `card.type === "sentence"` (400); derive lexical columns from the card and upsert `user_vocabulary` with the `card` jsonb on the existing `(user, language, word)` key; return `{ id }`. DELETE: remove the owned record by id
  - Purpose: deep-card → save seam + undo (Req 8)
  - _Leverage: infra/lambda/src/routes/read.ts (POST /read/entries upsert + onConflictDoUpdate)_
  - _Requirements: 8.1, 8.2, 8.3, 8.5, 8.6_

- [x] 19. Tests for the new read routes
  - File: `infra/lambda/src/routes/read.test.ts`
  - annotate-span: happy path (mock `annotateSpan`, capture usage insert + write-back SQL), cache hit (no model, no metering), **no `entryId` ⇒ no write-back** (Req 11.2), 429 rate-limit, 400 validation; vocabulary: save persists card + lexical cols, sentence card rejected, delete removes record, and a vocabulary save does **not** touch entry `span_annotations` (independence, Req 11.7)
  - Purpose: verify Req 3/4/5/8/10/11 at the route layer
  - _Leverage: infra/lambda/src/routes/read.test.ts (vi.mock db + tx capture), annotate-stream/handler.test.ts (usage-limit test pattern)_
  - _Requirements: 8.6, 10.2, 10.4, 11.1, 11.2, 11.6, 11.7_

#### C4. API client

- [x] 20. Add deep-span wire schemas to the api-client
  - File: `packages/api-client/src/schemas/read.ts`
  - `AnnotateSpanRequestSchema` (`{ language, text, start, end, entryId? }`) and `AnnotateSpanResponseSchema` (= shared `DeepCardSchema`); plus vocabulary save/delete request/response schemas
  - Purpose: typed client contract matching the routes
  - _Leverage: packages/api-client/src/schemas/read.ts (existing request/response schemas), @language-drill/shared DeepCardSchema_
  - _Requirements: 3.4, 8.1_

- [x] 21. Add `useReadAnnotateSpan` hook
  - File: `packages/api-client/src/hooks/useReadAnnotateSpan.ts` (new)
  - `useMutation<DeepCard, Error, AnnotateSpanRequest>` via `fetchFn('/read/annotate-span', { method:'POST', body })`; on success, write the card into the `['readEntry', entryId]` cache's `spanAnnotations`
  - Purpose: client trigger for the deep endpoint (Req 3, 11.4)
  - _Leverage: packages/api-client/src/hooks/useReadEntryMutations.ts (useSaveReadEntry shape + cache write-through), fetchClient.createAuthenticatedFetch_
  - _Requirements: 3.2, 3.5, 11.4_

- [x] 22. Add `useSaveVocabularyCard` + `useDeleteVocabularyCard` hooks
  - File: `packages/api-client/src/hooks/useReadEntryMutations.ts` (extend) or new file
  - `useMutation` wrappers over `POST` / `DELETE /read/vocabulary`
  - Purpose: save + undo from the card (Req 8.4, 8.5)
  - _Leverage: packages/api-client/src/hooks/useReadEntryMutations.ts (useSaveReadEntry)_
  - _Requirements: 8.4, 8.5_

#### C5. Web UI

- [x] 23. Make every word tappable + add span selection in `annotated-text.tsx`
  - File: `apps/web/app/(dashboard)/read/_components/annotated-text.tsx`
  - Render all word tokens as interactive (not just flagged); add mouse-drag selection (mousedown → mouseenter → mouseup) and sentence-range detection; report `{ start, end, type, rect }` via a new `onSpanSelect` (keep `onWordClick` for taps)
  - Purpose: tap-any-word + idiom/sentence selection (Req 3.2, 4.1, 4.3, 5.1)
  - _Leverage: apps/web/.../read/_components/annotated-text.tsx (tokenize loop), word-flag-styles.module.css (.active)_
  - _Requirements: 3.2, 4.1, 4.3, 5.1_

- [x] 24. Add deep-card + selection state to the page reducer
  - File: `apps/web/app/(dashboard)/read/_state/read-page-reducer.ts`
  - Add `deepCard: { status:'idle'|'loading'|'loaded'|'error', span, card?, error? }` and selection actions; carry `spanAnnotations` from the loaded entry; actions for open/loading/resolved/error/dismiss
  - Purpose: state machine for the deep card (Req 9.3, 9.4, 11.4)
  - _Leverage: apps/web/.../read/_state/read-page-reducer.ts (discriminated-union reducer)_
  - _Requirements: 9.3, 9.4, 11.4_

- [x] 25. Add the word deep-card layout to `word-card-body.tsx`
  - File: `apps/web/app/(dashboard)/read/_components/word-card-body.tsx`
  - Render the `DeepWordCard`: header (headword/pos/CEFR/freq) + inline inflection; contextual sense; target-language definition; morphology chips + "why this form"; collapsible synonyms/collocations/register/extra-example
  - Purpose: Req 6 + Req 7 word layout
  - _Leverage: apps/web/.../read/_components/word-card-body.tsx (existing header/body/footer), word-popover/word-sheet chrome_
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 7.1_

- [x] 26. Add phrase + sentence card layouts
  - Files: `apps/web/app/(dashboard)/read/_components/phrase-card-body.tsx`, `apps/web/app/(dashboard)/read/_components/sentence-card-body.tsx` (new)
  - Phrase: citation/idiomatic/literal/register/example/synonyms. Sentence: translation + chunked breakdown + grammar chips (Theory deep-link when target resolves, else plain text); no save action
  - Purpose: Req 4.2 + Req 5.2/5.3/5.4 layouts
  - _Leverage: apps/web/.../read/_components/word-card-body.tsx (structure), WordCardBody footer pattern_
  - _Requirements: 4.2, 5.2, 5.3, 5.4_

- [x] 27. Add card skeleton + error states
  - Files: `apps/web/app/(dashboard)/read/_components/word-popover.tsx`, `word-sheet.tsx`
  - Show a skeleton/"looking it up" state while loading (chrome stays mounted) and an inline error + retry on failure; render by `deepCard.status`
  - Purpose: Req 9.3, 9.4
  - _Leverage: apps/web/.../read/_components/annotated-skeleton.tsx, annotated-error.tsx (styling), word-popover/word-sheet_
  - _Requirements: 9.3, 9.4_

- [x] 28. Wire the deep endpoint + persisted annotations in `annotated-view.tsx`/`page.tsx`
  - Files: `apps/web/app/(dashboard)/read/_components/annotated-view.tsx`, `apps/web/app/(dashboard)/read/page.tsx`
  - Call `useReadAnnotateSpan` on tap/select (pass `entryId` when viewing a saved entry); show the skim gloss instantly for flagged words then swap to the deep card; render persisted `spanAnnotations` from `useReadEntry` and bypass the endpoint for already-stored spans
  - Purpose: end-to-end deep flow + Req 11.3/11.4
  - _Leverage: apps/web/.../read/page.tsx (hook composition, useReadEntry), annotated-view.tsx (handleWordClick/popover positioning)_
  - _Requirements: 3.1, 3.2, 3.3, 9.1, 9.2, 11.3, 11.4_

- [x] 29. Wire save + undo + toast on word/phrase cards
  - Files: `apps/web/app/(dashboard)/read/_components/annotated-view.tsx`, `save-toast.tsx`
  - Save posts the resolved `DeepCard` via `useSaveVocabularyCard`; flip to "saved" style + show toast; undo via `useDeleteVocabularyCard`; no save on sentence cards
  - Purpose: Req 8.4, 8.5, 5.4
  - _Leverage: apps/web/.../read/_components/save-toast.tsx, word-flag-styles.module.css (.saved)_
  - _Requirements: 8.4, 8.5_

### D. Morphology, E2E, docs (PR 3)

- [x] 30. Add Turkish/German morphology guidance to the deep-span prompt
  - Files: `packages/ai/src/read-span.ts`, `CLAUDE.md`
  - Extend `READ_SPAN_SYSTEM_PROMPT` with a Turkish section (morpheme segmentation + sentence-grounded "why this form") and German case/separable-prefix guidance; bump `READ_SPAN_PROMPT_VERSION`; note the bump in CLAUDE.md
  - Purpose: Req 7 quality (morphology fields already in the schema)
  - _Leverage: packages/ai/src/read-span.ts, packages/ai/src/annotate.ts (per-language prompt sections)_
  - _Requirements: 7.1, 7.2, 7.3, 10.5_

- [x] 31. Add morphology assertions to `read-span.test.ts`
  - File: `packages/ai/src/read-span.test.ts`
  - Assert a Turkish word card parses a populated `morphology` (segments + `whyThisForm`); a card without morphology still validates
  - Purpose: verify Req 7 contract
  - _Leverage: packages/ai/src/read-span.test.ts_
  - _Requirements: 7.1, 7.3_

- [x] 32. Add Playwright E2E for deep annotation
  - File: `apps/web/e2e/tests/authenticated/read.spec.ts` (new)
  - Tap an unflagged word → skeleton → word card; drag-select a phrase → phrase card; select a sentence → sentence card (no save); save a word → "saved" + toast; reopen from History → persisted spans render with no deep-endpoint call; mobile = bottom sheet, desktop = popover; Escape/outside-tap dismisses and a tall card scrolls internally; error → retry
  - Purpose: end-to-end verification of Req 3/4/5/8/9/11
  - _Leverage: apps/web/e2e (authenticated project, auth.setup.ts), apps/web/playwright.config.ts_
  - _Requirements: 3.2, 4.1, 5.1, 8.4, 9.1, 9.2, 9.4, 9.5, 9.6, 11.3, 11.4_

- [x] 33. Update prompt-sync + docs
  - Files: `CLAUDE.md`, `docs/reading-deep-annotation-design.md`
  - Confirm the prompt-version table lists `read-span-system-prompt` and the `annotate.ts` bump; note the `NEXT_PUBLIC_API_URL` (not stream URL) transport for the deep endpoint; mark Part 1 design items as implemented
  - Purpose: keep prompt bookkeeping + docs accurate (CLAUDE.md prompt-edit policy)
  - _Leverage: CLAUDE.md (Prompt Editing section), docs/reading-deep-annotation-design.md_
  - _Requirements: 1.5, 10.5_
