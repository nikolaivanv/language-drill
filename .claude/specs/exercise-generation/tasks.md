# Implementation Plan

## Task Overview

Phase 1 ships in five thin layers, each independently mergeable:

1. **Helpers and curriculum types** (Tasks 1–2) — extract the deterministic UUID helper and define the `GrammarPoint` shape so the curriculum modules and the rest of the package can compile against a stable contract.
2. **Curriculum content** (Tasks 3–6) — three per-language modules + a barrel that runs invariant assertions in tests. Tasks 3–5 are independent and parallelizable.
3. **Schema diff and migration** (Tasks 7–10) — extend `exercises`, add `generation_jobs`, regenerate the barrel, and produce the Drizzle migration SQL.
4. **Seed-script extension** (Tasks 11–14) — pure planning helpers, then DB write functions, then test coverage.
5. **Read-path filtering** (Tasks 15–18b) — shared constant, two route files, two test files (one per route). The deliberate non-filter on Path A and `/debrief` is enforced by regression assertions in Task 18b.

A final manual verification step (Task 19) records the `EXPLAIN` output in the PR description before merge.

## Steering Document Compliance

- **Drizzle-first migrations** (`tech.md` §"Database", §5): Tasks 7–9 edit Drizzle schema files; Task 10 runs `pnpm db:generate` and commits the auto-generated `0004_*.sql` — no hand-written migration SQL.
- **Co-located tests** (existing convention in this monorepo, `CLAUDE.md` §Testing): every test file lives next to the module it tests; no orphan tests. Tasks 6, 14, 17, 18 follow this rule.
- **Tests-before-merge**: per the project's pre-push convention, every task that touches code closes by running `pnpm test --filter <package>` for the affected package. The phase-level pre-push (`pnpm lint && pnpm typecheck && pnpm test`) runs in Task 19.
- **No CHECK constraints for enum-like columns** (`tech.md` §"Database" inferred from existing schema): Task 7's Drizzle definitions emit plain `text` for `generation_source`, `review_status`, `status`, `trigger`, etc. — values are enforced in TS at insert time.

## Atomic Task Requirements

Each task below touches ≤ 3 files, is bounded to 15–30 minutes for an experienced developer, and has a single testable outcome. Curriculum-content tasks (3–5) are at the upper end of the time box because each authors ≥ 23 entries; they are still single-file, single-purpose, and trivially reviewable.

## Tasks

### Layer 1 — Helpers and curriculum types

- [x] 1. Extract `deterministicUuid` to a shared helper module
  - File: `packages/db/src/lib/deterministic-uuid.ts` (new)
  - File: `packages/db/scripts/seed-exercises.ts` (modify — replace inline implementation with import)
  - File: `packages/db/scripts/seed-exercises.test.ts` (modify — drop the duplicated inline helper at lines 22–45, replace with import from the new module; existing tests for the helper move to a new test in the next bullet)
  - Move the `deterministicUuid()` function (currently `seed-exercises.ts:25–50`) verbatim into the new file with a short JSDoc.
  - Add `packages/db/src/lib/deterministic-uuid.test.ts` (new) covering: stable UUID format (regex from existing test), determinism (same key → same UUID), uniqueness across 36 seed keys.
  - Do NOT add the helper to `packages/db/src/index.ts` (internal-only export per design Component 4).
  - Purpose: single source of truth for the FNV hash used by both the seed script and Task 11's `seedSkillTopics`.
  - _Leverage: existing implementation at `packages/db/scripts/seed-exercises.ts:25-50`, existing tests at `packages/db/scripts/seed-exercises.test.ts:47-102`_
  - _Requirements: 5.2 (deterministic UUID derivation), Reliability NFR §3 (different prefix to avoid collisions — establishes the helper that supports it)_

- [x] 2. Define the `GrammarPoint` type and discriminator
  - File: `packages/db/src/curriculum/types.ts` (new)
  - Define the `CurriculumCefrLevel` type (`Extract<CefrLevel, 'A1'|'A2'|'B1'|'B2'>`) and the `GrammarPoint` `Readonly<{...}>` shape per design Component 1.
  - Include the `kind: 'grammar' | 'vocab'` discriminator with the JSDoc explaining the Phase 2 branch behavior.
  - Re-use `LearningLanguage` and `CefrLevel` from `@language-drill/shared`.
  - Purpose: the contract every curriculum module compiles against.
  - _Leverage: `packages/shared/src/index.ts` (`Language`, `CefrLevel`, `LearningLanguage` enums)_
  - _Requirements: 1.1, 1.2_

### Layer 2 — Curriculum content

- [x] 3. Author the Spanish curriculum module
  - File: `packages/db/src/curriculum/es.ts` (new)
  - Default-export an array of `GrammarPoint` entries; also re-export it as named `esCurriculum`.
  - Cover at minimum 4 A1 + 5 A2 + 6 B1 + 5 B2 = 20 grammar entries (`kind: 'grammar'`) drawn from the per-language CEFR table in `docs/progress-tracking.md` §"Layer 3 — Granular grammar & vocabulary points" (named ES points listed in Requirement 2.3).
  - Add the 3 vocab-umbrella entries (`kind: 'vocab'`) the seed-tag mapping in design Component 4 references: `es-a2-everyday-vocab`, `es-b1-environment-vocab`, `es-b2-abstract-noun-vocab`.
  - Each entry: ≥ 2 `examplesPositive`, ≥ 1 `examplesNegative` (each starting with `*`), ≥ 1 `commonErrors`, `description` ≤ 200 chars in English.
  - Set `prerequisiteKeys` only where genuinely meaningful (e.g. `es-b1-present-subjunctive` lists `es-a2-present-indicative`).
  - Purpose: the ES half of the curriculum the generator and seed both consume.
  - _Leverage: `packages/db/src/curriculum/types.ts` (Task 2), `docs/progress-tracking.md` §Layer 3 ES table_
  - _Requirements: 2.1, 2.2, 2.3_

- [x] 4. Author the German curriculum module
  - File: `packages/db/src/curriculum/de.ts` (new)
  - Same shape and minimums as Task 3, for German.
  - Cover at minimum 4+5+6+5 = 20 grammar entries plus 3 vocab umbrellas: `de-a2-housing-vocab`, `de-b1-environment-vocab`, `de-b2-academic-noun-vocab`.
  - Per-language note: include case-system points (`Akkusativ` prepositions, `Dativ` prepositions, `Konjunktiv II`, `Genitiv`, V2/verb-final word order, separable-prefix verbs).
  - Purpose: the DE half of the curriculum.
  - _Leverage: `packages/db/src/curriculum/types.ts` (Task 2), `docs/progress-tracking.md` §Layer 3 DE table (minimal — extend with the named points listed in design Component 4's mapping)_
  - _Requirements: 2.1, 2.2_

- [x] 5. Author the Turkish curriculum module
  - File: `packages/db/src/curriculum/tr.ts` (new)
  - Same shape and minimums as Tasks 3–4, for Turkish.
  - Cover at minimum 4+5+6+5 = 20 grammar entries plus 3 vocab umbrellas: `tr-a2-everyday-vocab`, `tr-b1-abstract-noun-vocab`, `tr-b2-academic-noun-vocab`.
  - Per-language note: include vowel-harmony, agglutinative suffix ordering, case suffixes, definite/indefinite object marking, the `dili` past, the `keşke` optative, causal conjunctions.
  - Purpose: the TR half of the curriculum.
  - _Leverage: `packages/db/src/curriculum/types.ts` (Task 2), `docs/progress-tracking.md` §Layer 3 TR mention, design Component 4 mapping_
  - _Requirements: 2.1, 2.2_

- [x] 6. Create the curriculum barrel and invariant validator
  - File: `packages/db/src/curriculum/index.ts` (new)
  - File: `packages/db/src/curriculum/curriculum.test.ts` (new)
  - Barrel: import `esCurriculum`, `deCurriculum`, `trCurriculum`; export `ALL_CURRICULA = Object.freeze([...es, ...de, ...tr])`; export `getGrammarPoint(key)` backed by a `Map` built once at module load; export `assertCurriculumInvariants()`.
  - Implement `assertCurriculumInvariants()` per design Component 6 — covers all ten invariants enumerated there. Each violation throws an `Error` whose message identifies the offending entry.
  - Tests: assert `assertCurriculumInvariants()` is a no-op for the shipped curriculum; mutation-test each invariant by cloning `ALL_CURRICULA`, mutating one entry, asserting the helper throws with the expected message; assert `getGrammarPoint(<known-key>)` returns the entry and `getGrammarPoint('unknown')` returns `undefined`; assert the per-language counts meet Req 2.2 minimums (`≥ 20 grammar` per language, plus the 3 vocab umbrellas).
  - Purpose: every cross-cutting curriculum constraint is test-enforced before any DB write happens.
  - _Leverage: Tasks 2, 3, 4, 5_
  - _Requirements: 1.3, 1.4, 1.5, 2.4, 2.5, 6.1_

### Layer 3 — Schema diff and migration

- [x] 7. Extend the `exercises` Drizzle schema with the eight new columns and the partial index
  - File: `packages/db/src/schema/exercises.ts` (modify)
  - Add the eight columns in this order (matching design Component 2): `grammarPointKey: text`, `topicDomain: text`, `generationSource: text.notNull().default('manual')`, `modelId: text`, `qualityScore: real`, `reviewStatus: text.notNull().default('auto-approved')`, `flaggedReasons: jsonb`, `generatedAt: timestamp({ withTimezone: true })`.
  - Add the third-arg index callback returning `{ poolLookupIdx: index('exercises_pool_lookup_idx').on(table.language, table.difficulty, table.type, table.grammarPointKey).where(sql\`${table.reviewStatus} IN ('auto-approved', 'manual-approved')\`) }`.
  - Import `index`, `real`, `sql` from `drizzle-orm/pg-core` / `drizzle-orm` as needed.
  - Add `export type Exercise = InferSelectModel<typeof exercises>;` so consumers can import a typed row.
  - Do not modify the existing `exerciseTags` definition.
  - Purpose: schema source-of-truth for the migration Task 10 generates. The two NOT-NULL defaults declared here are what produce the existing-row backfill described in Req 3.3 (Postgres applies the default in a single `ADD COLUMN ... DEFAULT ... NOT NULL` statement).
  - _Leverage: existing definition at `packages/db/src/schema/exercises.ts`, existing partial-index pattern in the codebase, Drizzle 0.45 `index().where()` API_
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 8. Create the `generation_jobs` Drizzle schema and the `cell_key` validator stub
  - File: `packages/db/src/schema/generation.ts` (new)
  - File: `packages/db/src/lib/cell-key.ts` (new)
  - Define `generationJobs = pgTable('generation_jobs', { ... }, (table) => ({ cellIdx: index('generation_jobs_cell_idx').on(table.cellKey, table.startedAt.desc()) }))` per design Component 2.
  - `id: uuid('id').primaryKey()` — caller-supplied (no `defaultRandom()`); writer is the future SQS handler whose dedup id matches.
  - Export `GenerationJob` and `NewGenerationJob` via `InferSelectModel` / `InferInsertModel`.
  - In `lib/cell-key.ts`: export `assertValidCellKey(cellKey: string): void` that validates against the round-1 alternation `^(es|de|tr):(a1|a2|b1|b2):(cloze|translation|vocab_recall):[a-z0-9-]+$` and throws with the offending key in the message. This is the stub Req 4.4 mandates "in code" — no writers exist yet, so the function is unused in Phase 1 but discoverable when Phase 2's CLI ships. Add a JSDoc note: when a new exercise type is added in Phase 6, the type alternation here must be updated in the same PR — reference `ExerciseType` enum membership.
  - Add `packages/db/src/lib/cell-key.test.ts` with 4 cases: valid round-1 cell keys pass; missing-grammar-point segment throws; unknown language throws; unknown type throws.
  - Do NOT export `assertValidCellKey` from the package barrel — internal-only, like `deterministicUuid`.
  - Purpose: the audit-trail table plus the format validator the future writer (Phase 2 CLI) will call before insert.
  - _Leverage: existing patterns in `packages/db/src/schema/sessions.ts` (timestamptz with default now, table-level index callback); `packages/shared/src/index.ts` `ExerciseType` enum (referenced in JSDoc, not imported — keeps Phase 6 sync-required note honest)_
  - _Requirements: 4.1, 4.2, 4.3, 4.4_

- [x] 9. Update the schema barrel
  - File: `packages/db/src/schema/index.ts` (modify)
  - Add `export { generationJobs } from './generation';` and `export type { GenerationJob, NewGenerationJob } from './generation';`.
  - Add `export type { Exercise } from './exercises';`.
  - Update the index list comment block at the top of the file to add `generation_jobs(cellKey, startedAt DESC)` and `exercises(language, difficulty, type, grammarPointKey) WHERE review_status IN (...)` to the documented index list.
  - Purpose: single import surface for downstream consumers (`@language-drill/db`).
  - _Leverage: existing barrel structure_
  - _Requirements: 3.5, 4.3_

- [x] 10. Generate the Drizzle migration `0004_*.sql`
  - Command: `pnpm --filter @language-drill/db db:generate` (run from repo root)
  - File: `packages/db/migrations/0004_*.sql` (auto-generated; commit verbatim — Drizzle picks the random adjective+noun suffix)
  - File: `packages/db/migrations/meta/_journal.json` (auto-updated)
  - File: `packages/db/migrations/meta/0004_snapshot.json` (auto-generated)
  - Open the generated SQL and visually verify it matches the "Expected SQL shape" in design Component 3: the `ALTER TABLE` adds eight columns with the right defaults; the partial index `WHERE` clause is preserved; the `generation_jobs` `CREATE TABLE` matches column-for-column; the `(cell_key, started_at DESC)` index is present.
  - Do NOT edit the generated SQL by hand — if it differs from the expected shape, fix the Drizzle schema and regenerate.
  - Purpose: the forward-only migration applied to dev/prod by CI.
  - _Leverage: Tasks 7, 8, 9; existing `packages/db/drizzle.config.ts`_
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, NFR Performance, NFR Reliability_

### Layer 4 — Seed-script extension

- [x] 11. Add the seed-key → grammar-point mapping and the pure planning helpers
  - File: `packages/db/scripts/seed-exercises.ts` (modify)
  - Import `ALL_CURRICULA`, `getGrammarPoint`, `GrammarPoint` from `../src/curriculum`.
  - Add the `SEED_KEY_TO_GRAMMAR_POINT: Readonly<Record<string, string>>` constant — exactly the 27 entries listed in design Component 4 (no entry for any of the 9 EN seed keys).
  - Define and export the `SkillTopicPlan` type:
    ```ts
    export type SkillTopicPlan = {
      id: string;                                          // deterministicUuid('skill-topic:' + grammarPoint.key)
      skillKey: { language: LearningLanguage; name: 'grammar' };
      name: string;                                        // grammarPoint.name
      cefrLevel: CurriculumCefrLevel;                       // grammarPoint.cefrLevel
      language: LearningLanguage;                           // grammarPoint.language
    };
    ```
  - Add and export two pure functions:
    - `planSkillTopics(curriculum: readonly GrammarPoint[]): SkillTopicPlan[]` — produces the row plan; `id = deterministicUuid('skill-topic:' + key)`; one row per curriculum entry. (The parent `skills` rows — one per learning language, `name='grammar'` — are produced by `upsertGrammarSkills` in Task 12, not by this planner.)
    - `planSeedTags(seeds, mapping, curriculum): { tags: Array<{ seedKey: string; grammarPointKey: string }>; untaggedEnSeeds: number }` — returns 27 tag tuples + counts; throws with the unmapped seed key per Req 5.6 if any non-EN seed lacks a mapping or if any mapping points to an unknown curriculum key.
  - Do not yet wire anything into `main()`.
  - Purpose: testable planning layer; no DB calls.
  - _Leverage: Tasks 1, 6; existing `SEED_EXERCISES` array; existing `deterministicUuid` (now imported from `lib/deterministic-uuid.ts`)_
  - _Requirements: 5.2, 5.3, 5.6_

- [x] 12. Add the DB-write functions for skills, skill_topics, and exercise_tags
  - File: `packages/db/scripts/seed-exercises.ts` (modify — continue from Task 11)
  - Add three module-scope `async` functions that take a Drizzle client argument:
    - `upsertGrammarSkills(db)` — for each `LearningLanguage`, insert one `skills` row with deterministic id, `name='grammar'`, the language; `onConflictDoNothing()`. Return `{ inserted, skipped }`.
    - `seedSkillTopics(db)` — call `planSkillTopics(ALL_CURRICULA)`, batch-insert into `skill_topics` with `onConflictDoNothing()` (single multi-row insert per language for performance — Req NFR Performance). Return `{ inserted, skipped }`.
    - `tagExistingSeeds(db)` — call `planSeedTags(SEED_EXERCISES, SEED_KEY_TO_GRAMMAR_POINT, ALL_CURRICULA)`. For each tag tuple: `UPDATE exercises SET grammar_point_key = $key WHERE id = $exerciseId AND (grammar_point_key IS NULL OR grammar_point_key = $key)`; then `INSERT INTO exercise_tags … ON CONFLICT DO NOTHING`. Return `{ tagged, alreadyTagged, untaggedEnSeeds }`.
  - All three functions must be idempotent under repeated runs (verify by re-reading after the inserts).
  - Purpose: the actual DB-mutating layer; thin wrappers around the planners from Task 11.
  - _Leverage: Task 11; existing `onConflictDoNothing()` pattern at `seed-exercises.ts:640`_
  - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [x] 13. Wire the new seeders into `main()` and update the summary output
  - File: `packages/db/scripts/seed-exercises.ts` (modify — continue from Task 12)
  - In `main()`, after the existing exercise insert loop and before `console.log('Done. ...')`: call `upsertGrammarSkills`, `seedSkillTopics`, `tagExistingSeeds` in that order.
  - Extend the summary block (currently `seed-exercises.ts:649–658`) to print:
    ```
    Skill topics:
      inserted: <skillTopicsResult.inserted>
      skipped (already present): <skillTopicsResult.skipped>
    Exercise tags:
      inserted: <tagResult.tagged>
      skipped (already present): <tagResult.alreadyTagged>
      untagged EN seeds: <tagResult.untaggedEnSeeds> (EN is source-only)

    Done. <totalInserted> exercise(s) created, <tagResult.tagged> tagged.
    ```
  - All `<...>` placeholders are runtime values returned from the Task 12 functions (`upsertGrammarSkills` / `seedSkillTopics` / `tagExistingSeeds`) plus the existing `totalInserted` counter — no literal numbers committed to the script. The "untagged EN seeds: 9 (EN is source-only)" line in particular is the Req 5.5 receipt.
  - The `Done.` final line includes the tagged count.
  - Purpose: a single seed command that produces the complete Phase 1 dataset.
  - _Leverage: Task 12; existing `main()` at `seed-exercises.ts:614-660`_
  - _Requirements: 5.4, 5.5, NFR Usability (developer-facing)_

- [x] 14. Add tests for the seed-script planning helpers and seed-key mapping
  - File: `packages/db/scripts/seed-exercises.test.ts` (modify — extend in place)
  - Tests for `planSkillTopics(ALL_CURRICULA)`: output length equals `ALL_CURRICULA.length`; each row's `id` equals `deterministicUuid('skill-topic:' + key)`; deterministic across two calls.
  - Tests for `planSeedTags`: returns 27 tags + 9 `untaggedEnSeeds` for the canonical inputs; throws (matching the message contract from Req 5.6) when a non-EN seed key is missing from `SEED_KEY_TO_GRAMMAR_POINT` (mutation: clone the map, delete one entry); throws when a mapping value resolves to no curriculum entry (mutation: replace one value with `'es-zz-fake'`).
  - Tests for `SEED_KEY_TO_GRAMMAR_POINT` itself: exactly 27 entries; no key starts with `'en-'`; every value resolves via `getGrammarPoint`.
  - Do NOT exercise the DB-write functions (`upsertGrammarSkills`, `seedSkillTopics`, `tagExistingSeeds`) — those are covered by the manual smoke test in Task 19.
  - Purpose: lock the planning logic without standing up a test DB.
  - _Leverage: Tasks 1, 6, 11_
  - _Requirements: 6.2 (parts a–e — pure-function variant honors the "in-memory or test database" wording)_

### Layer 5 — Read-path filtering

- [x] 15. Create the shared approved-statuses constant
  - File: `infra/lambda/src/lib/exercise-filters.ts` (new)
  - Export `APPROVED_STATUSES = ['auto-approved', 'manual-approved'] as const;` and a Drizzle helper `approvedStatusFilter(table)` returning `inArray(table.reviewStatus, APPROVED_STATUSES)` so all five call sites add the predicate consistently with one import.
  - Add a 2–3 line comment naming the four call sites that use this and the three sites that intentionally don't (Path A hydrate, debrief hydrate, seed writes).
  - Purpose: one-line flip if the allowable statuses ever change.
  - _Leverage: `drizzle-orm` `inArray`_
  - _Requirements: 3.6_

- [x] 16. Add the review-status filter to the `exercises` route's three pool reads
  - File: `infra/lambda/src/routes/exercises.ts` (modify — three call sites)
  - At line 71 (`GET /exercises` random pool draw): add `approvedStatusFilter(exercisesTable)` to the `and(...)` chain.
  - At line 98 (`GET /exercises/:id` direct fetch): add `approvedStatusFilter(exercisesTable)` to the `WHERE` (the `eq(id)` predicate). A flagged or rejected ID returns 404 like a missing one.
  - At line 135 (`POST /exercises/:id/submit` exercise lookup): same — flagged/rejected returns the existing 404 path.
  - Import `approvedStatusFilter` from the new `lib/exercise-filters.ts`.
  - Purpose: pool-discovery and direct-ID fetches cannot reach flagged content.
  - _Leverage: Task 15; existing `and(...)` predicate composition_
  - _Requirements: 3.6_

- [x] 17. Add the review-status filter to `sessions.ts` pool reads (and document the deliberate non-filter)
  - File: `infra/lambda/src/routes/sessions.ts` (modify — two call sites)
  - At line 80 (`POST /sessions` pool sample): add `approvedStatusFilter(exercisesTable)` to the `and(...)` chain. Insufficient post-filter draws fall through to the existing `INSUFFICIENT_EXERCISES` 422.
  - In the UNION-ALL helper at lines 374–383 (`GET /sessions/today` Path B): add `AND review_status IN ('auto-approved', 'manual-approved')` to each subquery's `WHERE`. (Raw-SQL site, no helper call.)
  - Add a code comment block above the Path A hydrate query at line 262 explaining why this read does NOT filter — verbatim from design Component 5: *"Reads exercises by stored manifest IDs. A flagged exercise that was already in a session manifest stays in that session; filtering would create a phantom missing slot."*
  - Add the same comment block above the debrief hydrate query (`sessions.ts:517` — the raw `db.execute(sql\`SELECT e.id ... FROM exercises e ... WHERE e.id = ANY(${exerciseIds})\`)`). Same rationale: stored manifest, not pool sample.
  - Purpose: pool-discovery filters; manifest-hydration unchanged.
  - _Leverage: Task 15_
  - _Requirements: 3.6_

- [x] 18a. Add filter tests for the `exercises` route
  - File: `infra/lambda/src/routes/exercises.test.ts` (modify)
  - Add a fixture-creation helper (or extend the existing one) that inserts two exercises into the test cell with `reviewStatus='flagged'` and `reviewStatus='rejected'`.
  - Assertion 1: `GET /exercises?language=…&difficulty=…` called 100 times never returns the flagged or rejected fixtures (use a per-test seed if `random()` is non-deterministic).
  - Assertion 2: `GET /exercises/:id` returns 404 for the flagged fixture's UUID.
  - Assertion 3: `GET /exercises/:id` returns 404 for the rejected fixture's UUID.
  - Assertion 4: existing assertions on auto-approved fixtures still pass — confirms the column defaults from Task 7 keep prior behavior intact.
  - Purpose: regression coverage for the three filtered call sites in `routes/exercises.ts`.
  - _Leverage: Task 16; existing fixture/test harness in the same file_
  - _Requirements: 3.6, 6.3_

- [x] 18b. Add filter tests for the `sessions` route (and the Path A non-filter regression)
  - File: `infra/lambda/src/routes/sessions.test.ts` (modify)
  - Add a fixture inserting a flagged exercise into the test cell.
  - Assertion 1: `POST /sessions` called 100 times never includes the flagged fixture's id in the returned manifest. If the call hits `INSUFFICIENT_EXERCISES` because of the filter, that's an acceptable outcome for the assertion (the flagged row was correctly excluded).
  - Assertion 2: `GET /sessions/today` Path B (no existing session today) called 100 times never includes the flagged fixture. Same `INSUFFICIENT_POOL` fallback note as Assertion 1.
  - Assertion 3 (regression for the deliberate non-filter): seed a `practice_sessions` row whose `exerciseIds` array contains a flagged exercise's UUID; call `GET /sessions/today` and assert Path A still returns that exercise in the response (the manifest is preserved even though the row would be filtered from a pool sample).
  - Assertion 4 (regression for the debrief non-filter): seed a completed `practice_sessions` row whose manifest contains a flagged exercise; call `GET /sessions/:id/debrief` and assert the flagged exercise still appears in `items` (manifest hydration is unfiltered).
  - Purpose: regression coverage for the two filtered + two non-filtered call sites in `routes/sessions.ts`.
  - _Leverage: Task 17; existing fixture/test harness in the same file_
  - _Requirements: 3.6, 6.3_

### Layer 6 — Verification

- [x] 19. Apply the migration on a Neon dev branch and capture the EXPLAIN output
  - **Manual step** — not automated in this phase per design Testing Strategy.
  - Apply `0004_*.sql` to a fresh Neon dev branch via `pnpm db:migrate` (env: `DATABASE_URL` set to the dev branch URL).
  - Run the seed: `pnpm db:seed:exercises`. Confirm the summary block prints the new sections and `27 tagged` matches.
  - Open `psql` (or `pnpm db:studio`'s SQL editor) and run: `EXPLAIN SELECT id FROM exercises WHERE language='ES' AND difficulty='B1' AND type='cloze' AND grammar_point_key='es-b1-present-subjunctive' AND review_status IN ('auto-approved', 'manual-approved');`
  - Verify the plan contains `Index Scan using exercises_pool_lookup_idx`. If it instead chooses a Seq Scan on the 36-row table (likely with so few rows), force the planner with `SET enable_seqscan = off;` then re-EXPLAIN and confirm the partial index is used.
  - Run `pnpm lint && pnpm typecheck && pnpm test` from the repo root; all three must pass.
  - **Paste the EXPLAIN output and the seed summary into the PR description before requesting review.** Reviewers reject the PR if either is missing.
  - Purpose: closes the design's mandatory-manual-step gap and proves the partial index is operational before code merges to main.
  - _Leverage: Tasks 6–18b (all prior tasks must be merged or staged in the same PR); existing `pnpm db:migrate` and `pnpm db:seed:exercises` scripts_
  - _Requirements: 3.4, 5.4, NFR Performance, NFR Reliability, design Testing Strategy §Integration testing_
