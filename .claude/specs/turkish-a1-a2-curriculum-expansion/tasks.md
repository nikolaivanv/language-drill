# Implementation Plan

## Task Overview

A data/content change plus its coupled artifacts. The bulk is authoring 36 new/relocated `GrammarPoint` objects in `packages/db/src/curriculum/tr.ts` (each: ≤200-char `description`, ≥2 `examplesPositive`, ≥1 starred `examplesNegative`, ≥1 `commonErrors`, correct vowel-harmony-consistent Turkish), then updating minimums, tests, the seed mapping, the uuid sample list, and adding migration `0015`.

**Consistency constraint:** `assertCurriculumInvariants` rejects dangling/cross-language prerequisites, so `tr.ts` is only *valid* once the whole array is assembled. Prerequisite resolution is by membership over the whole array, not array order, so forward references are fine once all entries exist — e.g. `tr-a1-var-yok` (Task 2) and `tr-a1-genitive-possessive` (Task 3) reference `tr-a1-possessive-suffixes`, which is authored in Task 4; the file is expected to be transiently invariant-invalid between Tasks 1–10. The full invariant gate (`pnpm --filter @language-drill/db test`) is therefore verified at Task 11, and `typecheck` (which does not evaluate prerequisites) is the per-task check for Tasks 1–9. Exact keys + prerequisites per entry are in `design.md` → Data Models.

**Linguistic-accuracy caveat:** the invariant gate checks entry *shape*, not Turkish correctness. The `examplesPositive`/`examplesNegative`/`commonErrors` strings (Tasks 1–8) must be genuinely correct Turkish with truly ill-formed negatives — this is **not** machine-verified by any task and needs human review before merge (Requirements → Non-Functional → Linguistic accuracy).

## Steering Document Compliance

- Follows the per-language curriculum-module convention (`packages/db/src/curriculum/tr.ts`) and the `*_VERSION` bump-in-same-commit rule (tr.ts header / CLAUDE.md).
- Migration is a hand-written, forward-only, numbered SQL file under `packages/db/migrations/` with a `meta/_journal.json` entry, applied by `scripts/migrate.ts` (tech.md §5).
- No application code changes — the curriculum is consumed via stable `ALL_CURRICULA` / `getGrammarPoint` / `enumerateCurriculumCells` interfaces.

## Atomic Task Requirements

Each task touches 1–3 files, is completable in 15–30 min, has one testable outcome, and names exact files. Authoring tasks group 3–5 grammar points by theme.

## Tasks

- [x] 1. tr.ts — header/version + A1 verb system (5 entries)
  - File: packages/db/src/curriculum/tr.ts
  - Bump `CURRICULUM_VERSION_TR = '2026-05-28'`; rewrite the "TEMPORARILY REDUCED" header comment to describe the new A1+A2-complete / B1+B2-disabled state.
  - Add A1 entries: `tr-a1-present-continuous`, `tr-a1-negation`, `tr-a1-imperative`; relocate `tr-a2-dili-past` → `tr-a1-dili-past` and the disabled `tr-b1-future` → `tr-a1-future` (update key + `cefrLevel: A1`, keep/adjust content). Prerequisites per design (e.g. negation → present-continuous).
  - Purpose: establish the A1 verb system and the version bump that unblocks the scheduler.
  - Verify: `pnpm --filter @language-drill/db typecheck`.
  - _Leverage: existing tr.ts entries (tr-a2-dili-past content), disabled tr-b1-future block, GrammarPoint type_
  - _Requirements: 1, 19.1_

- [x] 2. tr.ts — A1 verbless predicates (3 entries)
  - File: packages/db/src/curriculum/tr.ts
  - Add `tr-a1-degil` (prereq tr-a1-personal-suffixes), `tr-a1-var-yok` (prereq tr-a1-possessive-suffixes), and relocate `tr-a2-question-formation` → `tr-a1-questions` (mı + WH-words; prereq tr-a1-personal-suffixes).
  - Purpose: cover değil, var/yok, and yes-no + content questions at A1.
  - Verify: `pnpm --filter @language-drill/db typecheck`.
  - _Leverage: existing tr-a2-question-formation content; GrammarPoint type_
  - _Requirements: 2_

- [x] 3. tr.ts — A1 noun cases (3 relocated entries)
  - File: packages/db/src/curriculum/tr.ts
  - Relocate `tr-a2-accusative-definite-object` → `tr-a1-accusative-definite-object`, `tr-a2-ablative-dative` → `tr-a1-ablative-dative`, `tr-a2-genitive-possessive` → `tr-a1-genitive-possessive` (update keys + `cefrLevel: A1`; update internal `prerequisiteKeys` to `tr-a1-*` forms, e.g. ablative-dative → [tr-a1-vowel-harmony, tr-a1-locative]).
  - Purpose: place the four oblique cases at A1.
  - Verify: `pnpm --filter @language-drill/db typecheck`.
  - _Leverage: existing tr-a2-{accusative,ablative-dative,genitive-possessive} content_
  - _Requirements: 3_

- [x] 4. tr.ts — A1 reference words, numbers, possessives (4 entries)
  - File: packages/db/src/curriculum/tr.ts
  - Add `tr-a1-demonstratives` (bu/şu/o + burası/şurası/orası), `tr-a1-personal-pronouns` (subject + oblique forms), `tr-a1-numbers-ordinals` (cardinals + -(I)ncI), `tr-a1-possessive-suffixes` (-(I)m…-lArI).
  - Purpose: cover demonstratives, pronouns, numbers/ordinals, and the possessive paradigm (the latter is a prerequisite for Tasks 2 and 3 entries).
  - Verify: `pnpm --filter @language-drill/db typecheck`.
  - _Leverage: GrammarPoint type; turkish-harmony.ts for example correctness_
  - _Requirements: 4, 5, 6_

- [x] 5. tr.ts — A1 postpositions/particles + comparison (7 entries)
  - File: packages/db/src/curriculum/tr.ts
  - Add `tr-a1-instrumental-ile`, `tr-a1-postpositions-once-sonra`, `tr-a1-dan-a-kadar`, `tr-a1-ki-relativizer`, `tr-a1-gore-bence`, `tr-a1-beri-dir`, `tr-a1-comparative-superlative` (prereqs per design — most → tr-a1-ablative-dative; ki → tr-a1-locative).
  - Purpose: complete the 26-entry A1 set.
  - Verify: `pnpm --filter @language-drill/db typecheck`.
  - _Leverage: GrammarPoint type; turkish-harmony.ts_
  - _Requirements: 7, 8_

- [x] 6. tr.ts — A2 tenses + modality (3 entries)
  - File: packages/db/src/curriculum/tr.ts
  - Relocate disabled `tr-b1-mis-evidential` → `tr-a2-mis-evidential` (prereq tr-a1-dili-past) and `tr-b1-aorist` → `tr-a2-aorist`; add `tr-a2-ability-necessity` (-(y)Abil/-(y)AmA/-mAlI; prereq tr-a1-present-continuous).
  - Purpose: A2 past aspect, aorist, and modality.
  - Verify: `pnpm --filter @language-drill/db typecheck`.
  - _Leverage: disabled tr-b1-mis-evidential and tr-b1-aorist content_
  - _Requirements: 9, 10_

- [x] 7. tr.ts — A2 converbs, nominalization, relative (4 entries)
  - File: packages/db/src/curriculum/tr.ts
  - Relocate disabled `tr-b2-converbs` → `tr-a2-converbs`; add `tr-a2-converb-temporal` (-mAdAn önce/-DIktАn sonra), `tr-a2-nominalization` (-mA/-mAk/-Iş), `tr-a2-relative-an` (subject -(y)An only). Prereqs per design.
  - Purpose: A2 clause-linking and the subject relative.
  - Verify: `pnpm --filter @language-drill/db typecheck`.
  - _Leverage: disabled tr-b2-converbs content; tr-b2-{relative,noun-clauses} for the split parts_
  - _Requirements: 11, 12_

- [x] 8. tr.ts — A2 connectives, emphasis, purpose, reported speech (7 entries)
  - File: packages/db/src/curriculum/tr.ts
  - Add `tr-a2-gibi-kadar`, `tr-a2-correlative-conjunctions` (hem…hem/ne…ne/ya…ya/ister…ister/belki…belki), `tr-a2-causal-connectors` (çünkü/bu yüzden/bu sebeple), `tr-a2-ca-suffix`, `tr-a2-pekistirme`, `tr-a2-purpose-icin-uzere` (prereq tr-a1-future), `tr-a2-reported-speech` (prereq tr-a1-dili-past).
  - Purpose: complete the 14-entry A2 set; confirm `tr-a2-everyday-vocab` vocab umbrella is unchanged.
  - Verify: `pnpm --filter @language-drill/db typecheck`.
  - _Leverage: GrammarPoint type; turkish-harmony.ts_
  - _Requirements: 13, 14, 15_

- [x] 9. tr.ts — prune/narrow disabled B1/B2 block
  - File: packages/db/src/curriculum/tr.ts
  - In the `/* … */` block: remove `tr-b1-mis-evidential`, `tr-b1-aorist`, `tr-b1-future`, `tr-b2-converbs` (relocated); narrow `tr-b2-relative-clause-participles` to non-subject -DIK/-(y)AcAK and `tr-b2-noun-clauses-ma-dik` to -DIK/-(y)AcAK noun clauses; fix stale prereqs in the surviving entries (`tr-b1-keske-optative`: tr-a2-dili-past → tr-a1-dili-past; `tr-b2-relative-clause-participles`: tr-a2-genitive-possessive → tr-a1-genitive-possessive).
  - Purpose: prevent duplicate concepts / dangling prereqs when B1/B2 are later re-enabled.
  - Verify: `pnpm --filter @language-drill/db typecheck`.
  - _Leverage: existing disabled B1/B2 block in tr.ts_
  - _Requirements: 16_

- [x] 10. index.ts — raise TR minimums
  - File: packages/db/src/curriculum/index.ts
  - Set `PER_LANGUAGE_GRAMMAR_MIN.TR = { A1: 26, A2: 14, B1: 0, B2: 0 }`; update the "TEMPORARILY REDUCED" comment to note TR is now full-A1/A2. Leave ES/DE untouched.
  - Purpose: enforce the new TR floor in `assertCurriculumInvariants`.
  - Verify: `pnpm --filter @language-drill/db typecheck`.
  - _Leverage: existing PER_LANGUAGE_GRAMMAR_MIN_
  - _Requirements: 19.2_

- [x] 11. curriculum.test.ts — update TR counts + run the invariant gate
  - File: packages/db/src/curriculum/curriculum.test.ts
  - Update the "Turkish meets minimums" test: assert `grammar.A1` ≥ 26, `grammar.A2` ≥ 14, `B1` = 0, `B2` = 0, `vocab` = 1; update the test title/comment.
  - Purpose: this is where the full `assertCurriculumInvariants` (key format, uniqueness, level/prefix, examples, ≤200 desc, in-language prereqs) and counts are verified for the assembled tr.ts.
  - Verify: `pnpm --filter @language-drill/db test` — must pass. A failure here (dangling prereq, wrong count, >200-char description) is a `tr.ts`/`index.ts` defect — fix in Tasks 1–10, not by weakening the test.
  - _Leverage: existing per-language counts test_
  - _Requirements: 19.3, 19.4_

- [x] 12. seed-exercises.ts + deterministic-uuid.test.ts — re-key/re-level TR seeds
  - Files: packages/db/scripts/seed-exercises.ts, packages/db/src/lib/deterministic-uuid.test.ts
  - In seed-exercises.ts: rename seed `tr-cloze-a2-1` → `tr-cloze-a1-1` (`difficulty: 'A1'`) and `tr-translation-a2-1` → `tr-translation-a1-1` (`difficulty: 'A1'`); leave `tr-vocab-a2-1` unchanged. Update `SEED_KEY_TO_GRAMMAR_POINT`: `'tr-cloze-a1-1': 'tr-a1-dili-past'`, `'tr-translation-a1-1': 'tr-a1-questions'`, `'tr-vocab-a2-1': 'tr-a2-everyday-vocab'`.
  - In deterministic-uuid.test.ts: rename the two TR keys in the 36-key sample list to match.
  - Purpose: keep `planSeedTags` resolving and seed difficulty coherent with the relocated A1 grammar points.
  - Verify: `pnpm --filter @language-drill/db test` (seed-exercises.test.ts + deterministic-uuid.test.ts pass; update any TR-specific resolution assertion in seed-exercises.test.ts if present).
  - _Leverage: planSeedTags, SEED_KEY_TO_GRAMMAR_POINT, existing TR seed rows_
  - _Requirements: 17_

- [x] 13. migration 0015 — delete orphaned TR A2 rows
  - Files: packages/db/migrations/0015_tr_a1_realign_cleanup.sql, packages/db/migrations/meta/_journal.json
  - Add the SQL exactly as in design.md (4 DELETEs separated by `--> statement-breakpoint`: exercise_tags by the 5 skill_topic UUIDs → exercise_tags by orphaned exercise ids → exercises by the 5 old keys (language='TR') → skill_topics by the 5 UUIDs). Append a journal entry `{ idx: 15, version: "7", when: <epoch-ms>, tag: "0015_tr_a1_realign_cleanup", breakpoints: true }`.
  - Purpose: remove rows orphaned by the key renames so the scheduler repopulates A1 cells; the 5 UUIDs (precomputed in design.md) exclude tr-a2-everyday-vocab's topic. Do NOT add a `generation_jobs` DELETE — those rows are intentionally left as historical records (design.md).
  - Verify: SQL parses; journal JSON is valid (no `db:migrate` here — requires a live DB; runs on the CI Neon branch).
  - _Leverage: design.md Migration SQL + the 5 precomputed UUIDs; existing migrations 0001–0014 for format_
  - _Requirements: 18_

- [x] 14. Repo-root build gate
  - Files: (none — verification task)
  - Run `pnpm lint`, `pnpm typecheck`, `pnpm test` from the repo root; fix any failures (lint/format on edited files, type errors, test assertions).
  - Purpose: satisfy CLAUDE.md Pre-Push Checks with zero failures across all packages.
  - Verify: all three commands exit 0.
  - _Leverage: turbo pipeline_
  - _Requirements: All (esp. 19.4)_
