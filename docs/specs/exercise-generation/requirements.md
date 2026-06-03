# Requirements Document

## Introduction

This spec implements **Phase 1 — Curriculum & schema** from `docs/exercise-generation-plan.md`. Phase 1 is the foundational data layer for the at-scale exercise generator: it defines the curriculum (the structured input the generator will consume), extends the `exercises` table with the metadata columns generated drafts need, adds an audit table for batch runs (`generation_jobs`), seeds the curriculum into `skill_topics`, and backfills the 36 existing hand-authored seed exercises with grammar-point tags so they participate in pool-depth queries.

After this phase, no exercise has been generated yet by AI. The generator core (Phase 2) and the validator/dedup loop (Phase 3) consume what this phase produces. The deliverable is a curriculum module, one Drizzle migration, an updated seed script, and tests — no Lambda, no Claude calls, no API routes.

### Out of scope (this phase)

The following are explicitly deferred to later phases of the exercise-generation plan and SHALL NOT be implemented here:

- The generator itself (`packages/ai/src/generate.ts`) — Phase 2.
- Per-type generation prompt builders — Phase 2.
- The CLI driver `pnpm generate:exercises` — Phase 2.
- The validator (`packages/ai/src/validate.ts`) and the across-batch dedup unique index on `_dedupKey` — Phase 3.
- Lambda + SQS + EventBridge wiring — Phase 4.
- Pool depth API and admin dashboard — Phase 5.
- Curriculum content for English (resolved decision #4 in the plan: EN is dropped from the generator's input) — there is no `en.ts` curriculum module.
- Curriculum coverage above CEFR B2 — round 1 ships A1–B2 only (~80 grammar points per language across those four levels).
- A `_dedupKey` field on `contentJson` — Phase 3 owns this.
- Schema columns for audio (`audio_s3_key` already exists), speaking, listening — those types ship in Phase 6.

## Alignment with Product Vision

The product is positioned (`product.md` §2) as **"what you do between italki sessions"** — a practice app for intermediate learners stuck at the plateau. That positioning depends on a *constantly available pool* of exercises calibrated to specific grammar points at specific CEFR levels. Today the pool is 36 hand-authored exercises (`packages/db/scripts/seed-exercises.ts`) — enough to demo, nowhere near enough for daily use.

This phase enables the cost-controlled content strategy from `tech.md` §7 and `docs/exercise-strategy.md` ("Pre-generated pool — default for all exercise types"):

- **Honest skill-based progress** (`product.md` §2.2) — the curriculum is the spine that links each generated exercise to a single CEFR-tagged grammar point, which is what the progress system maps mastery to (`docs/progress-tracking.md` §"Layer 3 — Granular grammar & vocabulary points").
- **Pre-generated content reuse** (`tech.md` §7) — the `generation_jobs` audit table is the operational surface that tells us how much we've spent generating reusable content, and the new index on `exercises` is what makes "give me a B1 cloze on the past subjunctive in Spanish" a sub-millisecond lookup.
- **Polyglot-aware** (`product.md` §2.3) — the curriculum is per-language (ES/DE/TR), with no shared structure that would require collapsing language-specific grammar into a generic taxonomy.

## Requirements

### Requirement 1 — Curriculum module shape

**User Story:** As a developer authoring exercise specs, I want each grammar point in the curriculum to carry the metadata the generator needs (CEFR level, name, description, positive/negative examples, common learner errors, prerequisite keys), so that downstream phases can build prompts directly from a typed module without a second lookup.

#### Acceptance Criteria

1. WHEN the codebase is built THEN it SHALL expose a TypeScript type `GrammarPoint` from `packages/db/src/curriculum/types.ts` whose required fields are: `key: string`, `name: string`, `description: string`, `cefrLevel: CefrLevel` (re-using the enum from `@language-drill/shared`), `language: Exclude<Language, 'EN'>` (re-using the enum and excluding EN per resolved decision #4), `examplesPositive: string[]` (≥ 2 items), `examplesNegative: string[]` (≥ 1 item, marking incorrect production with a leading `*`), `commonErrors: string[]` (≥ 1 item).
2. WHEN the codebase is built THEN `GrammarPoint` SHALL also expose an optional `prerequisiteKeys: string[]` field, populated where a grammar point is meaningfully built on another (e.g. `es-b1-present-subjunctive` lists `es-a2-present-indicative`). Empty array is permitted.
3. WHEN any consumer imports the curriculum modules THEN every `key` SHALL match the regex `^(es|de|tr)-(a1|a2|b1|b2)-[a-z0-9-]+$` and SHALL be globally unique across all curriculum modules. The build SHALL fail with a typecheck error or a runtime assertion in tests if duplicates exist.
4. WHEN any consumer imports the curriculum modules THEN every entry's `cefrLevel` SHALL be one of `'A1' | 'A2' | 'B1' | 'B2'` (round 1 scope; C1/C2 are intentionally absent).
5. WHEN any consumer imports the curriculum modules THEN every entry's `language` field SHALL match the language prefix encoded in its `key` (e.g. an entry whose `key` starts with `es-` SHALL have `language: Language.ES`). The build SHALL fail with a runtime assertion in tests if any entry violates this invariant.

### Requirement 2 — Curriculum content for ES, DE, TR

**User Story:** As the developer running the generator, I want a complete A1–B2 grammar curriculum already written in code for Spanish, German, and Turkish, so that on day one of Phase 2 the generator has every grammar point it will batch on and I am not blocked authoring content while wiring up the generator.

#### Acceptance Criteria

1. WHEN the codebase is built THEN `packages/db/src/curriculum/es.ts`, `de.ts`, and `tr.ts` SHALL each export a default const array of `GrammarPoint` entries; the file SHALL also re-export it as a named `<lang>Curriculum` (e.g. `esCurriculum`).
2. WHEN the curriculum is loaded THEN each language module SHALL contain at minimum: 4 A1 points, 5 A2 points, 6 B1 points, 5 B2 points (≥ 20 per language; round 1 target is ~80 across the three languages).
3. WHEN the curriculum is loaded THEN each entry SHALL be authored from the per-language CEFR grammar tables in `docs/progress-tracking.md` (§"Layer 3 — Granular grammar & vocabulary points") as the seed list — at minimum, the ES table's named points (present, ser/estar, articles, agreement, preterite, imperfect, reflexive, comparatives, gustar-type, present subjunctive, conditional, relative clauses, passive `se`, past subjunctive, compound tenses, complex conditionals, nuanced ser/estar) SHALL each appear as a curriculum entry where they fall in A1–B2.
4. WHEN the curriculum is loaded THEN there SHALL be a single barrel export at `packages/db/src/curriculum/index.ts` exposing `ALL_CURRICULA: GrammarPoint[]` (concatenation of the three language arrays, frozen) and a typed lookup `getGrammarPoint(key: string): GrammarPoint | undefined`.
5. WHEN any `prerequisiteKeys` value is set on an entry THEN every key in that array SHALL resolve to another entry in `ALL_CURRICULA` (cross-language prerequisites are forbidden — a Spanish entry cannot prerequisite a German one). The build SHALL fail with a runtime assertion in tests if any prerequisite is dangling or cross-language.

### Requirement 3 — Schema extension to `exercises`

**User Story:** As the generator (Phase 2), I want the `exercises` table to carry the metadata columns I need to write per draft (grammar point key, topic domain, generation source, model id, quality score, review status, flagged reasons, generated_at), so that I can insert generated drafts without subsequent ALTER TABLEs and so the API can filter approved exercises in a single query.

**Note:** All eight new columns are provisioned in this phase, but `topic_domain`, `model_id`, `quality_score`, `flagged_reasons`, and `generated_at` are written by future phases — the Phase 2 generator (`model_id`, `generated_at`), the Phase 3 validator (`quality_score`, `flagged_reasons`), and a later phase that lights up domain-aware generation (`topic_domain`, per resolved decision #3 in the plan). Adding the columns now avoids a second migration when those writers ship.

#### Acceptance Criteria

1. WHEN the migration is applied THEN the `exercises` table SHALL have these new nullable columns added in this order: `grammar_point_key TEXT`, `topic_domain TEXT`, `model_id TEXT`, `quality_score REAL`, `flagged_reasons JSONB`, `generated_at TIMESTAMPTZ`.
2. WHEN the migration is applied THEN the `exercises` table SHALL have these new NOT NULL columns with defaults: `generation_source TEXT NOT NULL DEFAULT 'manual'` (intended values: `'manual' | 'claude-batch' | 'claude-realtime'` — enforced in code, not via a CHECK constraint), `review_status TEXT NOT NULL DEFAULT 'auto-approved'` (intended values: `'auto-approved' | 'flagged' | 'rejected' | 'manual-approved'` — enforced in code).
3. WHEN the migration is applied THEN every existing row in `exercises` (the 36 hand-authored seeds) SHALL automatically receive `generation_source='manual'` and `review_status='auto-approved'` via the default — no `UPDATE` statement is required in the migration to backfill these two columns.
4. WHEN the migration is applied THEN a partial composite index `exercises_pool_lookup_idx` SHALL exist on `(language, difficulty, type, grammar_point_key)` with the predicate `WHERE review_status IN ('auto-approved', 'manual-approved')`. This index is what the future pool-depth queries (Phase 5) and the session creation route's pool sample read against.
5. WHEN the Drizzle schema is regenerated THEN `packages/db/src/schema/exercises.ts` SHALL declare each new column with the matching TypeScript type, in the same order they appear in Requirements 3.1 and 3.2: `text (grammar_point_key) | text (topic_domain) | text (generation_source, NOT NULL DEFAULT 'manual') | text (model_id) | real (quality_score) | text (review_status, NOT NULL DEFAULT 'auto-approved') | jsonb (flagged_reasons) | timestamp (generated_at)`. Drizzle-generated types SHALL be re-exported through the barrel.
6. WHEN any read path queries `exercises` for the pool (live API or future pool-depth Lambda) THEN it SHALL filter by `review_status IN ('auto-approved', 'manual-approved')` so that flagged/rejected drafts cannot be served to users. Existing read paths in `infra/lambda/src/routes/exercises.ts` and `infra/lambda/src/lib/today-plan.ts` SHALL be updated to include this predicate; their tests SHALL assert that flagged rows are excluded.

### Requirement 4 — `generation_jobs` audit table

**User Story:** As an operator monitoring generator cost and freshness, I want every generation batch (CLI run or Lambda invocation) to leave one row in a structured audit table with token counts, cell key, status, and trigger, so that I can answer "how much have we spent this week" and "when was this cell last refilled" without rummaging through CloudWatch logs.

#### Acceptance Criteria

1. WHEN the migration is applied THEN a new table `generation_jobs` SHALL exist with these columns: `id UUID PRIMARY KEY`, `cell_key TEXT NOT NULL` (format: `<lang>:<level>:<type>:<grammar_point_key>`), `requested_count INT NOT NULL`, `produced_count INT NOT NULL DEFAULT 0`, `approved_count INT NOT NULL DEFAULT 0`, `flagged_count INT NOT NULL DEFAULT 0`, `rejected_count INT NOT NULL DEFAULT 0`, `status TEXT NOT NULL` (intended values: `'queued' | 'running' | 'succeeded' | 'failed'` — enforced in code), `started_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `finished_at TIMESTAMPTZ`, `input_tokens_used INT`, `output_tokens_used INT`, `cost_usd_estimate NUMERIC(10,4)`, `trigger TEXT NOT NULL` (intended values: `'cli' | 'scheduled' | 'admin'` — enforced in code), `error_message TEXT`.
2. WHEN the migration is applied THEN an index `generation_jobs_cell_idx` SHALL exist on `(cell_key, started_at DESC)`. This is the index the daily refill scheduler (Phase 4.3) reads against.
3. WHEN the Drizzle schema is regenerated THEN `packages/db/src/schema/exercises.ts` (or a new sibling `generation.ts`) SHALL declare `generationJobs` with matching TypeScript types and the table SHALL be re-exported through `packages/db/src/schema/index.ts`.
4. WHEN any future caller (Phase 2 CLI, Phase 4 Lambda) inserts a row THEN the row's `cell_key` SHALL match the format `<lang>:<level>:<type>:<grammar_point_key>` where `<type>` is a current member of the `ExerciseType` enum (`packages/shared/src/index.ts`) — enforced in code at insert time, not via a CHECK constraint. Whoever adds a new exercise type in Phase 6 SHALL update the cell-key validator (and any reference test) in the same PR. Round 1 alternation: `(es|de|tr):(a1|a2|b1|b2):(cloze|translation|vocab_recall):[a-z0-9-]+`.
5. WHEN this phase ships THEN no rows are inserted into `generation_jobs` (the writers don't exist yet). The table SHALL be created empty; the migration SHALL succeed against an existing dev database with no data backfill required.

### Requirement 5 — Curriculum-driven seed of `skill_topics` and backfill of `exercise_tags`

**User Story:** As the developer running the seed script, I want one command to populate `skill_topics` from the curriculum modules and to tag the 36 hand-authored seed exercises with their grammar point, so that pool-depth queries report a non-zero count for the seeded cells from day one and the existing seeds participate in the new index.

#### Acceptance Criteria

1. WHEN `pnpm db:seed:exercises` is run THEN it SHALL, before inserting exercise rows, ensure a row exists in `skills` for each `(language, name)` pair in `{(ES, 'grammar'), (DE, 'grammar'), (TR, 'grammar')}` (idempotent insert via `ON CONFLICT DO NOTHING`).
2. WHEN `pnpm db:seed:exercises` is run THEN it SHALL upsert one row in `skill_topics` per curriculum entry in `ALL_CURRICULA`. The deterministic `id` for each row SHALL be the same FNV-style hash already used in `seed-exercises.ts`, keyed off the curriculum `key` (e.g. `deterministicUuid('skill-topic:' + grammarPoint.key)`). The `name`, `cefrLevel`, and `language` columns SHALL be populated from the curriculum entry; `skillId` SHALL reference the matching `skills` row.
3. WHEN `pnpm db:seed:exercises` is run THEN every existing seed exercise (36 rows, identified by their existing deterministic `id`) SHALL also receive: an `UPDATE` setting `grammar_point_key` to the curriculum key matching the seed's content (mapping table embedded in the seed script — explicit, hand-curated, ≤ 36 entries), and an `INSERT … ON CONFLICT DO NOTHING` into `exercise_tags` linking the exercise to the matching `skill_topics.id`.
4. WHEN `pnpm db:seed:exercises` is run a second time on an already-seeded database THEN it SHALL be a no-op — the `skill_topics` upsert, the `grammar_point_key` update (`UPDATE … WHERE grammar_point_key IS NULL OR grammar_point_key = <new value>`), and the `exercise_tags` insert SHALL all be idempotent. The script's existing summary output SHALL include the new counts: `skill_topics inserted/skipped`, `exercise_tags inserted/skipped`, `exercises tagged`.
5. WHEN the seed script runs against a fresh database THEN the existing 9 EN seed exercises SHALL be inserted but SHALL NOT be tagged with a grammar point (their `grammar_point_key` SHALL remain NULL) — they exist only as fixtures, are not part of the generator's input, and are not part of the curriculum. The script SHALL log a single line confirming this (`9 EN seeds left untagged (EN is source-only)`).
6. IF a hand-authored seed exercise's content cannot be matched to any curriculum entry (e.g. the seed tests a grammar point we haven't added to the curriculum yet) THEN the seed script SHALL fail loudly with an error naming the unmatched seed key, rather than silently leaving it untagged. This forces curriculum coverage to keep up with the existing seed catalogue.

### Requirement 6 — Tests covering the phase

**User Story:** As a maintainer, I want every invariant in this phase covered by tests at the appropriate level (unit for curriculum integrity, integration for the migration + seed), so that subsequent phases can refactor without silently breaking the data foundation.

#### Acceptance Criteria

1. WHEN `pnpm test --filter @language-drill/db` is run THEN there SHALL be a unit test file `packages/db/src/curriculum/curriculum.test.ts` that asserts: (a) every `GrammarPoint.key` is unique across `ALL_CURRICULA`, (b) every `key` matches the regex from Requirement 1.3, (c) every entry's `language` matches its `key` prefix, (d) every `prerequisiteKeys` entry resolves to a known curriculum entry in the same language, (e) per-language counts meet the minimums in Requirement 2.2.
2. WHEN `pnpm test --filter @language-drill/db` is run THEN there SHALL be an integration test (`packages/db/scripts/seed-exercises.test.ts` — extending the existing test file, not a new orphan) that asserts: (a) running the seed against a fresh in-memory or test database creates the expected `skill_topics` count (= `ALL_CURRICULA.length`), (b) running the seed twice is a no-op for `skill_topics` and `exercise_tags`, (c) every non-EN seed exercise has a non-null `grammar_point_key` after the seed completes, (d) every EN seed exercise has a NULL `grammar_point_key` after the seed completes, (e) at least one tagged seed exercise links to a `skill_topics` row whose `id` is the deterministic UUID derived from the matching curriculum `key`.
3. WHEN `pnpm test` is run from the repo root THEN existing tests in `infra/lambda/src/routes/exercises.test.ts` and `infra/lambda/src/lib/today-plan.test.ts` SHALL be updated so that any newly-inserted fixture rows with `review_status='flagged'` or `'rejected'` are excluded from the read-path results (Requirement 3.6 enforcement), and an explicit assertion SHALL be added covering this filter.
4. WHEN `pnpm typecheck` is run from the repo root THEN it SHALL pass: the new Drizzle-typed columns SHALL flow through to all consumers; any read-path consumer that was previously selecting `exercises.*` SHALL be either updated to use the new columns or left unchanged if the new columns are tolerated as `null`.

## Non-Functional Requirements

### Performance

- The new partial index `exercises_pool_lookup_idx` (Requirement 3.4) SHALL be a partial index, not a full index, to avoid bloating with rejected/flagged rows. The intended pool-lookup query (`SELECT … WHERE language = ? AND difficulty = ? AND type = ? AND grammar_point_key = ? AND review_status IN ('auto-approved', 'manual-approved')`) SHALL use this index — verified locally with `EXPLAIN` against a seeded dev DB and noted in design.md.
- The seed script's runtime against an empty database SHALL stay under 5 seconds for the curriculum + tags + 36 exercises (it currently takes ~2s for 36 exercises against a Neon dev branch). This rules out chatty per-row inserts; the script SHALL batch where natural (single multi-row insert per language for `skill_topics`).
- The migration itself SHALL run against a Neon dev branch in under 2 seconds. `ALTER TABLE … ADD COLUMN` on a 36-row table is trivially fast; the partial index creation against the same table is also trivially fast — but the migration SHALL be authored so it remains forward-compatible if the table grows to millions of rows (e.g. no `UPDATE` over all rows on column add).

### Reliability

- The migration SHALL be forward-only. There is no `down` migration for this change — consistent with the project-wide convention (`tech.md` §5: "Migrations are forward-only").
- The seed script SHALL run the same way it does today (`onConflictDoNothing` everywhere) — re-running on a populated DB SHALL not produce duplicate `skill_topics`, duplicate `exercise_tags`, or stale `grammar_point_key` overwrites if a future operator manually edits a seed exercise's tag.
- The deterministic UUID derivation in Requirement 5.2 SHALL use `deterministicUuid('skill-topic:' + key)` — a different prefix from the `'<lang>-<type>-<level>-N'` keys already used for exercises — so that a skill topic and an exercise can never collide on the same UUID.

### Usability (developer-facing)

- The seed script's terminal output (per Requirement 5.4) SHALL preserve the existing format ("Summary by language") and add new lines for the new categories so a developer reading the output can immediately see what was inserted vs. skipped. Color and verbosity match the current style — no flags, no progress bars.
- The curriculum modules SHALL be readable as data: each entry on roughly 8–12 lines, no clever metaprogramming, no shared spread/merge tricks. The format is the contract for whoever lifts the curriculum to a DB-backed surface later (resolved decision #5: deferred).
- Curriculum entries' `description` field SHALL be at most 200 characters and SHALL be written in English, to match the convention already used in `EVALUATION_SYSTEM_PROMPT` (`packages/ai/src/prompts.ts`). Generator prompts (Phase 2) inject these descriptions verbatim, so the cap protects the prompt token budget.
