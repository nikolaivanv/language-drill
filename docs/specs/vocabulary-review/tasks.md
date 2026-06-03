# Implementation Plan

## Task Overview

Phase 1 backbone of Vocabulary Review, built bottom-up: shared types → DB schema/migration →
pure server logic (scheduler, grading, item-select, evidence, queue) each with unit tests →
progress-aggregation extension → Hono router → api-client schemas+hooks → web surface (reducer,
hub, session panes, summary, bank, detail, nav, reading highlight) → E2E. Every task touches 1–3
files, references its requirements, and leverages existing code. No LLM calls in this phase.

## Steering Document Compliance

Tasks follow the monorepo layout in `CLAUDE.md`/`tech.md`: `packages/db` (schema+migration),
`packages/shared` (domain Zod types), `packages/api-client` (`schemas/` + `hooks/`),
`infra/lambda/src/routes` + `infra/lambda/src/lib/review` (router + pure logic),
`apps/web/app/(dashboard)/review` (UI). FSRS not SM-2; Zod-validated; Clerk-scoped; forward-only
migration `0015`. Tests added to each module's own test file (Vitest), per the repo testing rule.

## Atomic Task Requirements
- File Scope: 1–3 related files each
- Time Boxing: 15–30 min each
- Single Purpose: one testable outcome
- Specific Files: exact paths given
- Agent-Friendly: clear input/output

## Tasks

### 1. Dependencies & shared domain types

- [x] 1. Add `ts-fsrs` dependency to the Lambda package
  - File: `infra/lambda/package.json`
  - Add latest stable `ts-fsrs` to `dependencies`; run install so the lockfile updates
  - Purpose: make the FSRS engine available to server logic
  - _Leverage: existing `infra/lambda/package.json` dependency block_
  - _Requirements: 1.2_

- [x] 2. Define review domain Zod schemas/types in shared
  - File: `packages/shared/src/review.ts` (new)
  - Define `ReviewItemTypeSchema` (`cloze|meaning|recognition`), `ReviewOutcomeSchema`
    (`correct|partial|incorrect`), `VocabReviewStatusSchema`
    (`new|learning|mature|leech|suspended|known`), `OccurrenceSchema`, `ReviewCardSchema`,
    `FsrsStateViewSchema`, `SchedulerDeltaSchema`, `MasteryDeltaSchema`, `QueueBreakdownSchema`,
    inferred TS types
  - Purpose: canonical, single-source review types for server + client
  - _Leverage: packages/shared/src/read.ts (DeepCard, Morphology), packages/shared/src/index.ts (CefrLevel, LearningLanguage)_
  - _Requirements: 2.2, 14.3_

- [x] 3. Export review types from the shared barrel
  - File: `packages/shared/src/index.ts`
  - Re-export everything from `./review`
  - Purpose: make review types importable as `@language-drill/shared`
  - _Leverage: existing re-export lines in packages/shared/src/index.ts_
  - _Requirements: 14.3_

### 2. Database schema & migration

- [x] 4. Add `vocabulary_review_state` table to the Drizzle schema
  - File: `packages/db/src/schema/read.ts`
  - Define `vocabularyReviewState` pgTable with columns id, userId(FK users, cascade), language,
    lemma, fsrsCardJson(jsonb), stability(real), difficulty(real), reps, lapses,
    state(text $type), lastReviewedAt, dueAt, createdAt; UNIQUE (userId, language, lemma); indexes
    (userId, language, dueAt) and (userId, language, state)
  - Purpose: per-lemma FSRS card store
  - _Leverage: packages/db/src/schema/read.ts (userVocabulary table style), schema/progress.ts (spacedRepetitionCards columns)_
  - _Requirements: 1.1, 2.1, 14.4_

- [x] 5. Add `vocabulary_review_sessions` table to the Drizzle schema
  - File: `packages/db/src/schema/read.ts`
  - Define `vocabularyReviewSessions` pgTable: id, userId(FK), language, filter(jsonb),
    itemCount(smallint), startedAt, completedAt; index (userId, startedAt)
  - Purpose: lightweight session grouping for the summary
  - _Leverage: packages/db/src/schema/sessions.ts (practiceSessions)_
  - _Requirements: 11.1, 14.4_

- [x] 6. Add `vocabulary_review_log` table to the Drizzle schema
  - File: `packages/db/src/schema/read.ts`
  - Define `vocabularyReviewLog` pgTable: id, userId(FK), language, reviewStateId(FK
    vocabularyReviewState, cascade), sessionId(FK vocabularyReviewSessions, set null), lemma,
    itemType, surface, outcome, rating(smallint), cefrBand, grammarPoints(jsonb default []),
    reviewedAt; indexes (userId, language, reviewedAt) and (reviewStateId, reviewedAt)
  - Purpose: evidence rows for radar + word-detail history
  - _Leverage: packages/db/src/schema/read.ts, schema/progress.ts (userExerciseHistory)_
  - _Requirements: 9.1, 9.6, 14.4_

- [x] 7. Export the three new tables from the db schema barrel
  - File: `packages/db/src/schema/index.ts`
  - Re-export the new tables alongside existing read-schema exports
  - Purpose: make tables importable as `@language-drill/db`
  - _Leverage: existing export lines in packages/db/src/schema/index.ts_
  - _Requirements: 14.4_

- [x] 8. Generate and verify migration 0015
  - File: `packages/db/migrations/0015_*.sql` (generated)
  - Run `pnpm db:generate`; verify the SQL creates the three tables + indexes/constraints and adds
    nothing destructive to existing tables
  - Purpose: forward-only migration for the new tables
  - _Leverage: packages/db/drizzle.config.ts, packages/db/migrations/0014_add_deep_annotation_columns.sql_
  - _Requirements: 14.4_

### 3. Scheduler module (pure FSRS)

- [x] 9. Implement the FSRS scheduler wrapper
  - File: `infra/lambda/src/lib/review/scheduler.ts` (new)
  - Define `FSRS_PARAMS` constant; `initCard(now)`; `applyReview(state, rating, now)` returning
    `{ next, delta: SchedulerDelta }`; `deriveLifecycleState(card, lapses)` (leech ≥ 3 lapses,
    mature stability ≥ 7d); use `ts-fsrs`
  - Purpose: the single scheduler seam all ratings flow through
  - _Leverage: ts-fsrs; packages/shared/src/review.ts (SchedulerDelta)_
  - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6, 1.7_

- [x] 10. Implement outcome→rating mapping in the scheduler
  - File: `infra/lambda/src/lib/review/scheduler.ts` (continue from task 9)
  - Add `ratingFromOutcome(outcome, { hintsUsed })`: correct→Good/Easy, partial→Hard,
    incorrect→Again, capped by hint usage; document the Phase 2 `ratingFromEvalScore` sibling slot
  - Purpose: sole outcome→FSRS-rating site (forward-compat seam)
  - _Leverage: infra/lambda/src/lib/review/scheduler.ts (task 9)_
  - _Requirements: 1.4, 6.3, 8.4_

- [x] 11. Unit-test the scheduler
  - File: `infra/lambda/src/lib/review/scheduler.test.ts` (new)
  - Test lifecycle transitions (new→learning→mature; repeated Again→leech at 3 lapses), interval
    growth, deterministic with injected `now`, `ratingFromOutcome` incl. hint caps
  - Purpose: lock down the highest-value logic
  - _Leverage: infra/lambda/src/lib/review/scheduler.ts; existing Vitest setup_
  - _Requirements: 1.3, 1.4, 1.5, 8.4_

### 4. Local grading module (pure)

- [x] 12. Implement local grading functions
  - File: `infra/lambda/src/lib/review/grading.ts` (new)
  - Define `normalize(input, language)`; `gradeCloze(answer, expectedSurface, language)`
    (accent-only mismatch → partial); `gradeMeaning(answer, acceptedForms, language, hintsUsed)`;
    `gradeRecognition(selectedKey, correctKey)` → `ReviewOutcome`
  - Purpose: free, instant grading for the three local item types
  - _Leverage: packages/shared/src/review.ts (ReviewOutcome); answer-normalization intent from packages/ai/src/evaluate.ts_
  - _Requirements: 5.2, 6.2, 7.3, 8.1, 8.2_

- [x] 13. Unit-test local grading
  - File: `infra/lambda/src/lib/review/grading.test.ts` (new)
  - Cover cloze exact/accent-partial/wrong; meaning vs lemma+forms; hint-assisted→partial; ES/DE/TR
    normalization
  - Purpose: verify grading outcomes per language
  - _Leverage: infra/lambda/src/lib/review/grading.ts_
  - _Requirements: 5.2, 6.2, 8.2_

### 5. Item-type & occurrence selection (pure)

- [x] 14. Implement item-type and occurrence selection
  - File: `infra/lambda/src/lib/review/item-select.ts` (new)
  - `pickOccurrence(card)` (least-recently-tested / seeded, null when no usable sentence);
    `pickItemType(card, seed)` (maturity→type; phrase cards exclude morphology cloze; fallback to
    context-independent type when occurrence null)
  - Purpose: pure policy for which item a card gets
  - _Leverage: packages/shared/src/review.ts (ReviewCard, ReviewItemType)_
  - _Requirements: 2.3, 2.4, 2.6, 7.1, 7.2, 7.4_

- [x] 15. Unit-test item selection
  - File: `infra/lambda/src/lib/review/item-select.test.ts` (new)
  - Maturity→type mapping; phrase exclusion; occurrence fallback path; production preferred at
    stability ≥ 7d
  - Purpose: verify selection policy
  - _Leverage: infra/lambda/src/lib/review/item-select.ts_
  - _Requirements: 2.4, 2.6, 7.2_

### 6. Evidence & mastery movement (pure + DB)

- [x] 16. Implement review-log write + contributing-row mapping
  - File: `infra/lambda/src/lib/review/evidence.ts` (new)
  - `writeReviewLog(db, row)`; `reviewContributingRows(db, userId, language, sinceDays=90)` mapping
    log rows to `ContributingRow` (outcome→score, cefr fallback B1, reviewedAt), emitting a
    `vocab_review_vocab` row always and a `vocab_review_grammar` row when grammarPoints non-empty
  - Purpose: persist evidence + feed the radar
  - _Leverage: infra/lambda/src/lib/progress-aggregation.ts (ContributingRow); packages/db (vocabularyReviewLog)_
  - _Requirements: 9.1, 9.2, 9.3, 9.6_

- [x] 17. Implement `computeMasteryDeltas`
  - File: `infra/lambda/src/lib/review/evidence.ts` (continue from task 16)
  - For each grammar label in given rows, compute `aggregateAxisMastery`-based currentMastery
    `from`=excluding given logIds, `to`=including; parameterized for per-item (one id) vs session
    (all ids); returns `MasteryDelta[]`
  - Purpose: honest, evidence-sourced "what moved"
  - _Leverage: infra/lambda/src/lib/progress-aggregation.ts (aggregateAxisMastery, difficultyWeight, recencyWeight)_
  - _Requirements: 9.4, 11.2_

- [x] 18. Unit-test evidence mapping & mastery deltas
  - File: `infra/lambda/src/lib/review/evidence.test.ts` (new)
  - `reviewContributingRows` axis routing + score mapping; `computeMasteryDeltas` bounded [0,1] and
    moves in the right direction; two-row emission only when grammarPoints present
  - Purpose: verify radar integration math
  - _Leverage: infra/lambda/src/lib/review/evidence.ts_
  - _Requirements: 9.2, 9.4_

### 7. Queue builder & card assembly (DB)

- [x] 19. Implement `ensureReviewState` and card assembly
  - File: `infra/lambda/src/lib/review/queue.ts` (new)
  - `ensureReviewState(db, userId, language)` (idempotent create of `new` rows for lemmas lacking
    state); `assembleCards(db, userId, language, lemmas?)` grouping userVocabulary rows by
    (userId, language, lemma) into ReviewCards with pooled occurrences + joined state
  - Purpose: lemma-keyed cards from existing surface rows, non-destructively
  - _Leverage: packages/db (userVocabulary, vocabularyReviewState); packages/shared (ReviewCard, Occurrence)_
  - _Requirements: 2.1, 2.2, 2.5_

- [x] 20. Implement `buildQueue` with filters and caps
  - File: `infra/lambda/src/lib/review/queue.ts` (continue from task 19)
  - Select due + capped-new (5/day from log) + leech (exclude suspended/known); apply filter
    (`all|new|leech|{readEntryId}|{grammarPoint}`); cap to 20 most-overdue; call item-select per
    card; return `{ items, breakdown }`
  - Purpose: per-language ordered session queue
  - _Leverage: infra/lambda/src/lib/review/item-select.ts; packages/db (readEntries for readEntryId filter)_
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.6, 13.1_

- [x] 21. Implement `overview` for the hub
  - File: `infra/lambda/src/lib/review/queue.ts` (continue from task 20)
  - `overview(db, userId, language)` returning counts (due/new/leech/total), item-type mix, est.
    length, next-due preview — without creating a session
  - Purpose: hub data
  - _Leverage: infra/lambda/src/lib/review/queue.ts (buildQueue internals)_
  - _Requirements: 3.5, 4.1, 4.3_

- [x] 22. Unit-test the queue builder
  - File: `infra/lambda/src/lib/review/queue.test.ts` (new)
  - Per-language isolation; new-intake cap from log; ceiling+ordering; readEntryId/new/leech
    filters; `ensureReviewState` idempotency; empty-queue next-due
  - Purpose: verify queue construction
  - _Leverage: infra/lambda/src/lib/review/queue.ts_
  - _Requirements: 3.1, 3.2, 3.4, 3.5, 3.6_

### 8. Progress aggregation extension

- [x] 23. Extend `axisForExerciseType` for review sentinels
  - File: `infra/lambda/src/lib/progress-aggregation.ts`
  - Map `vocab_review_vocab`→`vocabulary` and `vocab_review_grammar`→`grammar`; keep all other
    behavior unchanged
  - Purpose: let review contributing-rows reach radar buckets (avoid default→null drop)
  - _Leverage: infra/lambda/src/lib/progress-aggregation.ts (axisForExerciseType switch)_
  - _Requirements: 9.1, 9.3_

- [x] 24. UNION review evidence into the radar handler
  - File: `infra/lambda/src/routes/progress.ts`
  - In the radar handler, fetch `reviewContributingRows(db, userId, language, 90)` and concatenate
    with the exercise-history rows before bucketing; leave heatmap unchanged
  - Purpose: make the radar reflect reviews
  - _Leverage: infra/lambda/src/lib/review/evidence.ts; routes/progress.ts (radar query, 90-day window)_
  - _Requirements: 9.1, 9.5_

- [x] 25. Integration-test radar movement from reviews
  - File: `infra/lambda/src/routes/progress.test.ts` (add to existing if present, else new)
  - Seed review-log rows and assert `/progress/radar` vocabulary (and grammar) axes move; window
    respected
  - Purpose: verify end-to-end radar integration
  - _Leverage: existing progress route tests / test harness_
  - _Requirements: 9.5_

### 9. Review router

- [x] 26. Create the review router skeleton + register it
  - Files: `infra/lambda/src/routes/review.ts` (new), `infra/lambda/src/index.ts`
  - New Hono router; `app.route('/', review)` in index.ts; read `userId` via `c.get('userId')`
  - Purpose: mount the review API
  - _Leverage: infra/lambda/src/routes/read.ts (router shape), index.ts (registration), middleware/auth.ts_
  - _Requirements: 14.1_

- [x] 27. Implement `GET /review/overview`
  - File: `infra/lambda/src/routes/review.ts`
  - Validate `language` query; return `overview(...)`; per-language only
  - Purpose: hub counts endpoint
  - _Leverage: infra/lambda/src/lib/review/queue.ts (overview); routes/exercises.ts (query validation)_
  - _Requirements: 4.1, 4.2, 13.4_

- [x] 28. Implement `POST /review/sessions`
  - File: `infra/lambda/src/routes/review.ts`
  - Zod-validate `{ language, filter? }`; run `ensureReviewState`; insert a
    `vocabulary_review_sessions` row; `buildQueue`; return `{ sessionId, items }`
  - Purpose: start a session, queue up-front
  - _Leverage: infra/lambda/src/lib/review/queue.ts; packages/db (vocabularyReviewSessions)_
  - _Requirements: 3.1, 3.6, 10.1, 13.1_

- [x] 29. Implement `POST /review/items/:stateId/submit`
  - File: `infra/lambda/src/routes/review.ts`
  - Verify card ownership; grade locally; `applyReview`; persist state; `writeReviewLog` +
    `computeMasteryDeltas`; return `ReviewItemResult`; assert NO usage_events row written
  - Purpose: the graded-item hot path (free, local)
  - _Leverage: infra/lambda/src/lib/review/{grading,scheduler,evidence}.ts_
  - _Requirements: 5.2, 5.4, 5.5, 6.2, 6.5, 8.1, 8.2, 8.3, 8.5, 9.4_

- [x] 30. Implement `GET /review/sessions/:id/summary`
  - File: `infra/lambda/src/routes/review.ts`
  - Aggregate the session's log rows: clean/partial/missed, promoted/lapsed, new-card count,
    per-item recap, session-level mastery deltas, next-due
  - Purpose: end-of-session debrief data
  - _Leverage: infra/lambda/src/lib/review/evidence.ts (computeMasteryDeltas); packages/db (vocabularyReviewLog, vocabularyReviewState)_
  - _Requirements: 11.1, 11.2, 11.3_

- [x] 31. Implement `GET /review/bank` and `GET /review/words/:stateId`
  - File: `infra/lambda/src/routes/review.ts`
  - Bank: list by active language, one row per lemma, with status/stability/next-due, free-text +
    status filters. Word detail: deep-card snapshot + occurrences + FSRS stats + history + grammar
    points
  - Purpose: browse + detail read endpoints
  - _Leverage: infra/lambda/src/lib/review/queue.ts (assembleCards); packages/db (vocabularyReviewState, vocabularyReviewLog, userVocabulary)_
  - _Requirements: 12.1, 12.2, 12.3_

- [x] 32. Implement word actions: `PATCH`/`DELETE /review/words/:stateId` and `GET /review/active-lemmas`
  - File: `infra/lambda/src/routes/review.ts`
  - PATCH `{ action: suspend|unsuspend|mark_known|reset }` updates state; DELETE removes
    userVocabulary rows + state; active-lemmas returns `{ lemmas, surfaces }` for the reading
    highlight
  - Purpose: bank management + reading-highlight source
  - _Leverage: packages/db (vocabularyReviewState, userVocabulary); infra/lambda/src/lib/review/scheduler.ts (initCard for reset)_
  - _Requirements: 12.4, 12.5, 13.2_

- [x] 33. Integration-test the review router happy path
  - File: `infra/lambda/src/routes/review.test.ts` (new)
  - `POST /sessions` → `submit` (each item type) → `summary`: state persisted, log rows written,
    deltas returned, zero usage_events; cross-user `stateId` is 403/404
  - Purpose: verify the API end-to-end on an ephemeral DB
  - _Leverage: existing route test harness; infra/lambda/src/routes/review.ts_
  - _Requirements: 8.3, 10.4, 11.1_

### 10. api-client (schemas + hooks)

- [x] 34. Define review wire schemas in api-client
  - File: `packages/api-client/src/schemas/review.ts` (new)
  - Zod request/response: `HubOverview`, `StartReviewSession` req/res, `SubmitReviewItem`
    req/`ReviewItemResult`, `ReviewSummary`, `BankRow`/list, `WordDetail`, `ActiveLemmas`,
    `UpdateWord` req
  - Purpose: typed client contracts
  - _Leverage: packages/api-client/src/schemas/read.ts; packages/shared/src/review.ts_
  - _Requirements: 14.2, 14.3_

- [x] 35. Add review query hooks
  - File: `packages/api-client/src/hooks/useReviewQueries.ts` (new)
  - `useReviewOverview`, `useReviewSummary`, `useVocabularyBank`, `useVocabularyWord`,
    `useActiveReviewLemmas` (useQuery + Zod parse, per-language query keys)
  - Purpose: read hooks
  - _Leverage: packages/api-client/src/hooks/useReadEntries.ts (query pattern), fetchClient.ts_
  - _Requirements: 14.2_

- [x] 36. Add review mutation hooks
  - File: `packages/api-client/src/hooks/useReviewMutations.ts` (new)
  - `useStartReviewSession`, `useSubmitReviewItem`, `useUpdateVocabularyWord`,
    `useDeleteVocabularyWord` (useMutation + Zod parse + cache invalidation of overview/bank/word/
    active-lemmas)
  - Purpose: write hooks
  - _Leverage: packages/api-client/src/hooks/useExercise.ts (mutation pattern)_
  - _Requirements: 14.2, 14.5_

- [x] 37. Export review schemas + hooks from the api-client barrel
  - File: `packages/api-client/src/index.ts`
  - Re-export the new schemas and hooks
  - Purpose: make hooks importable as `@language-drill/api-client`
  - _Leverage: existing barrel exports in packages/api-client/src/index.ts_
  - _Requirements: 14.2_

### 11. Web surface

- [x] 38. Add the review nav destination + due-count badge
  - Files: `apps/web/components/shell/nav-items.tsx`, `apps/web/components/shell/nav.tsx` (and/or `mobile-tab-bar.tsx`)
  - Add `{ href: '/review', label: 'review', icon }`; render a due-count badge from
    `useReviewOverview`
  - Purpose: make Review reachable with a due badge
  - _Leverage: apps/web/components/shell/nav-items.tsx (NAV_DESTINATIONS); useReviewOverview_
  - _Requirements: 13.4_

- [x] 39. Build the Review hub page
  - File: `apps/web/app/(dashboard)/review/page.tsx` (new)
  - Render breakdown, item-type mix, est. length, primary start, focused-subset starts, and the
    "all caught up" empty state with next-due preview; per active language; no streak/XP
  - Purpose: hub UI
  - _Leverage: docs/design/vocabulary-review-prototype/desktop/hub.jsx + mobile/mw-hub.jsx; components/ui/*; useActiveLanguage; useReviewOverview_
  - _Requirements: 4.1, 4.3, 4.4, 4.5, 4.6_

- [x] 40. Adapt the session reducer for review
  - File: `apps/web/app/(dashboard)/review/_state/review-session-reducer.ts` (new)
  - Mirror the drill reducer (idle→creating→inSession→completing, per-item submission states,
    burndown selectors) over `ReviewItem`/`ReviewItemResult`
  - Purpose: session state machine
  - _Leverage: apps/web/app/(dashboard)/drill/_components/session-reducer.ts_
  - _Requirements: 10.1, 10.4_

- [x] 41. Build the cloze item pane
  - File: `apps/web/app/(dashboard)/review/_components/cloze-item.tsx` (new)
  - Render blanked saved sentence + translation/source; input for inflected form; optional
    morphology hint; "reveal/I don't know"
  - Purpose: cloze-in-context UI
  - _Leverage: docs/design/vocabulary-review-prototype/desktop/session-cloze.jsx; drill/_components/cloze-exercise.tsx; components/ui/*_
  - _Requirements: 5.1, 5.3, 5.4_

- [x] 42. Build the meaning→production item pane
  - File: `apps/web/app/(dashboard)/review/_components/meaning-item.tsx` (new)
  - Show contextualSense/definition + POS/CEFR/freq; word input; progressive hints; accent picker
  - Purpose: meaning→production UI
  - _Leverage: docs/design/vocabulary-review-prototype/desktop/session-meaning.jsx; components/ui/AccentPicker_
  - _Requirements: 6.1, 6.3, 6.4_

- [x] 43. Build the recognition item pane
  - File: `apps/web/app/(dashboard)/review/_components/recognition-item.tsx` (new)
  - Word→meaning recognition choice (warm-up); cheap/local
  - Purpose: recognition UI
  - _Leverage: components/ui/Choice; docs/design/vocabulary-review-prototype (recognition usage)_
  - _Requirements: 7.1_

- [x] 44. Build the in-session feedback panel
  - File: `apps/web/app/(dashboard)/review/_components/review-feedback.tsx` (new)
  - Render correct/partial/incorrect state, corrected form, scheduler delta, and "what moved"
    mastery deltas; keyboard advance
  - Purpose: per-item feedback with what-moved
  - _Leverage: docs/design/vocabulary-review-prototype/desktop/grading.jsx; drill/_components/feedback-shell.tsx_
  - _Requirements: 9.4, 10.2, 10.3_

- [x] 45. Assemble the session page
  - File: `apps/web/app/(dashboard)/review/session/page.tsx` (new)
  - Wire the reducer + `useStartReviewSession`/`useSubmitReviewItem`, route item→pane, burndown,
    pause/exit, route to summary on completion; desktop split + mobile sticky bar
  - Purpose: full session flow
  - _Leverage: apps/web/app/(dashboard)/review/_state/review-session-reducer.ts; the item panes; useReviewMutations_
  - _Requirements: 10.1, 10.2, 10.3, 10.5, 10.6_

- [x] 46. Build the end-of-session summary page
  - File: `apps/web/app/(dashboard)/review/summary/[sessionId]/page.tsx` (new)
  - Render clean/partial/missed, promoted/lapsed, new cards, per-item recap, grammar deltas,
    next-due, next-action CTAs (incl. progress deep-link); no streak/XP
  - Purpose: summary UI
  - _Leverage: docs/design/vocabulary-review-prototype/desktop/summary.jsx; useReviewSummary_
  - _Requirements: 11.1, 11.3, 11.4, 11.5, 13.3_

- [x] 47. Build the vocabulary bank page
  - File: `apps/web/app/(dashboard)/review/bank/page.tsx` (new)
  - List one row per lemma (status/stability/next-due), free-text + status filters incl. leech
    surfacing; per active language
  - Purpose: browse UI
  - _Leverage: docs/design/vocabulary-review-prototype/desktop/bank.jsx; useVocabularyBank_
  - _Requirements: 12.1, 12.2, 12.6_

- [x] 48. Build the word detail page + actions
  - File: `apps/web/app/(dashboard)/review/bank/[stateId]/page.tsx` (new)
  - Render deep-card snapshot, pooled occurrences, FSRS stats, review history, grammar points;
    wire suspend/mark-known/delete/reset via `useUpdateVocabularyWord`/`useDeleteVocabularyWord`
  - Purpose: detail + management UI
  - _Leverage: docs/design/vocabulary-review-prototype/desktop/detail.jsx; useVocabularyWord; useReviewMutations_
  - _Requirements: 12.3, 12.4, 12.5_

- [x] 49. Add the under-review highlight to the Reading annotated view
  - File: `apps/web/app/(dashboard)/read/_components/annotated-view.tsx`
  - Fetch `useActiveReviewLemmas`; mark a word under-review when annotation.lemma ∈ lemmas (surface
    fallback); apply a distinct highlight class
  - Purpose: cross-feature reading highlight
  - _Leverage: apps/web/app/(dashboard)/read/_components/annotated-view.tsx; useActiveReviewLemmas_
  - _Requirements: 13.2_

### 12. End-to-end

- [x] 50. Add Playwright E2E for the review flow
  - File: `apps/web/e2e/review.spec.ts` (new)
  - Hub due counts + language isolation; full session (cloze+meaning+recognition) with feedback,
    keyboard advance, burndown, summary, no streak/XP; review-from-passage; bank filter + suspend
    leaves queue; reading under-review highlight
  - Purpose: verify the user journeys
  - _Leverage: apps/web/e2e/ (authenticated project, auth.setup.ts); docs/testing.md_
  - _Requirements: 4.2, 10.1, 11.4, 12.5, 13.1, 13.2_
