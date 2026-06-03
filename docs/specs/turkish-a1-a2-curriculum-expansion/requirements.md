# Requirements Document

## Introduction

The Turkish (TR) curriculum in `packages/db/src/curriculum/tr.ts` currently ships 9 grammar points + 1 vocab umbrella (A1×4, A2×5; B1/B2 disabled). Benchmarked against the **Yedi İklim Türkçe** A1 and A2 syllabi (Yunus Emre Institute), the active curriculum is missing a large fraction of the topics each level is expected to cover, and it places several core A1 topics (the four noun cases, definite past, future, genitive constructions, comparatives, the question particle) at A2 instead of A1.

This feature brings the Turkish A1 and A2 curriculum to **full Yedi İklim parity**:

1. **Add every missing A1/A2 topic** as a new grammar point.
2. **Re-align levels to Yedi İklim**: relocate the noun cases, definite past, future, genitive-possessive, comparatives, and the question particle from A2 **down to A1** (these are taught in Yedi İklim A1, units 1–7).
3. **Full A2 alignment**: relocate evidential past `-mIş`, converbs, the subject relative participle `-(y)An`, and verbal-noun nominalization from the disabled B1/B2 blocks **up to A2** (Yedi İklim teaches them at A2).

Because a grammar point's CEFR level is encoded in its key (invariant: key infix must equal `cefrLevel`), relocating a topic means **renaming its key**. Five keys that exist today are referenced live by `SEED_KEY_TO_GRAMMAR_POINT` in `packages/db/scripts/seed-exercises.ts` and by already-generated production data (`exercises.grammar_point_key`, `skill_topics.id = deterministicUuid('skill-topic:' + key)`). The renames therefore also require updating the seed mapping, re-leveling the affected seed rows, and a one-off **cleanup migration** to remove the orphaned rows so the scheduler cleanly repopulates the new A1 cells.

The target end state is **26 A1 grammar points + 14 A2 grammar points + 1 vocab umbrella** (full list in the Appendix). The change also updates the per-language version constant, the per-language grammar-count minimums, and the per-language count test assertions to match.

## Alignment with Product Vision

`product.md` positions the app around **honest, skill-based progress** mapped to CEFR and real exams, and targets learners climbing through the intermediate plateau. A CEFR spine is only credible if each level actually covers what that level is expected to cover. Today a Turkish A1 learner cannot form a single verbal sentence (no present tense at A1) and the pool cannot contain exercises for topics absent from the curriculum, because the scheduler enumerates generation cells from curriculum entries. Reaching Yedi İklim parity — the de-facto standard syllabus for CEFR-aligned Turkish instruction — makes the Turkish A1/A2 mapping faithful, unblocks pre-generation of the missing exercise types, and reinforces the polyglot, multiple-languages-at-different-levels positioning.

## Requirements

### Requirement 1 — A1 verb system

**User Story:** As a Turkish A1 learner, I want the basic verb tenses and the imperative at A1, so that I can produce verbal sentences (present, past, future, commands) and negate them.

#### Acceptance Criteria

1. WHEN the curriculum is loaded THEN it SHALL contain A1 grammar points `tr-a1-present-continuous` (`-(I)yor`), `tr-a1-dili-past` (definite past `-DI`), `tr-a1-future` (`-(y)AcAk`), `tr-a1-imperative` (`Emir`), and `tr-a1-negation` (verbal `-mA`).
2. WHEN the present-continuous entry is inspected THEN it SHALL document vowel-raising before `-yor` (`gel- → geliyor`, `oku- → okuyor`, `başla- → başlıyor`) and SHALL declare `tr-a1-vowel-harmony` as a prerequisite.
3. WHEN the negation entry is inspected THEN it SHALL document the `-ma`/`-me` suffix and the present-continuous fusion `-mIyor`, and SHALL declare `tr-a1-present-continuous` as a prerequisite.
4. WHEN `tr-a1-dili-past` and `tr-a1-future` are inspected THEN they SHALL carry the content previously held by `tr-a2-dili-past` and the disabled `tr-b1-future`, with `cefrLevel: A1`.

### Requirement 2 — A1 verbless predicates: negation, existence/possession, and questions

**User Story:** As a Turkish A1 learner, I want to negate nominal predicates with `değil`, assert existence and possession with `var`/`yok`, and ask both yes/no and content questions, so that I can say "I am not a student", "there is no time / I have a car", and ask "what / who / where".

#### Acceptance Criteria

1. WHEN the curriculum is loaded THEN it SHALL contain A1 grammar points `tr-a1-degil` (nominal negation with `değil`), `tr-a1-var-yok` (existence/possession), and `tr-a1-questions` (yes/no particle `mı` + content WH-words).
2. WHEN the `değil` entry is inspected THEN it SHALL cover `değil` + personal endings on nominal/copular predicates ("öğrenci değilim") and SHALL declare `tr-a1-personal-suffixes` as a prerequisite.
3. WHEN the questions entry is inspected THEN it SHALL cover the yes/no particle `mı/mi/mu/mü` (carrying the content previously in `tr-a2-question-formation`) and the common WH-words (`ne, kim, nerede, ne zaman, kaç, nasıl, niçin/neden`).
4. WHEN the `var`/`yok` entry is inspected THEN it SHALL cover both the existential reading ("Evde kitap var") and the possessive reading via the possessive suffix + `var`/`yok` ("Bir arabam var", "Vaktim yok"), and SHALL declare `tr-a1-possessive-suffixes` as a prerequisite for the possessive reading.

### Requirement 3 — A1 noun-case system

**User Story:** As a Turkish A1 learner, I want the four oblique noun cases at A1, so that I can mark definite objects, location, source, and goal.

#### Acceptance Criteria

1. WHEN the curriculum is loaded THEN it SHALL contain A1 grammar points `tr-a1-accusative-definite-object`, `tr-a1-ablative-dative`, and `tr-a1-genitive-possessive`, alongside the existing `tr-a1-locative`.
2. WHEN these entries are inspected THEN they SHALL carry the content previously held by `tr-a2-accusative-definite-object`, `tr-a2-ablative-dative`, and `tr-a2-genitive-possessive`, with `cefrLevel: A1` and key prefixes updated to `tr-a1-`.
3. WHEN any prerequisite of these entries is inspected THEN it SHALL resolve to an existing same-language A1 key (no dangling/cross-language prerequisites after relocation).

### Requirement 4 — A1 reference words (demonstratives and pronouns)

**User Story:** As a Turkish A1 learner, I want demonstratives and personal pronouns, so that I can point to things and refer to people with the correct case forms.

#### Acceptance Criteria

1. WHEN the curriculum is loaded THEN it SHALL contain A1 grammar points `tr-a1-demonstratives` (`bu/şu/o` + place demonstratives `burası/şurası/orası`) and `tr-a1-personal-pronouns` (subject pronouns + oblique forms `bana/seni/onda/bizden/…`).

### Requirement 5 — A1 numbers and ordinals

**User Story:** As a Turkish A1 learner, I want to form cardinal and ordinal numbers, so that I can count, give quantities, and order items.

#### Acceptance Criteria

1. WHEN the curriculum is loaded THEN it SHALL contain an A1 grammar point `tr-a1-numbers-ordinals` covering cardinal-number formation (compound numbers like `yüz yirmi üç`) and the ordinal suffix `-(I)ncI`.

### Requirement 6 — A1 possessive suffixes

**User Story:** As a Turkish A1 learner, I want the personal possessive-suffix paradigm, so that I can say "my house / your book / their car".

#### Acceptance Criteria

1. WHEN the curriculum is loaded THEN it SHALL contain an A1 grammar point `tr-a1-possessive-suffixes` covering `-(I)m, -(I)n, -(s)I, -(I)mIz, -(I)nIz, -lArI` with buffer consonants.

### Requirement 7 — A1 postpositions and particle connectors

**User Story:** As a Turkish A1 learner, I want common postpositions and connective particles, so that I can express "with", "before/after", "from…to", "according to", "since/for", and "the one at/of".

#### Acceptance Criteria

1. WHEN the curriculum is loaded THEN it SHALL contain A1 grammar points `tr-a1-instrumental-ile` (`-ile/-(y)lA`, "with/and"), `tr-a1-postpositions-once-sonra` (`-DAn önce` / `-DAn sonra`), `tr-a1-dan-a-kadar` (`-DAn … -A kadar`), `tr-a1-gore-bence` (`-A göre`, `bence`), `tr-a1-beri-dir` (`-DEn beri` / `-DIr` duration), and `tr-a1-ki-relativizer` (`-ki` / `-DAki`).

### Requirement 8 — A1 comparison

**User Story:** As a Turkish A1 learner, I want comparatives and superlatives, so that I can compare things ("bigger / the best").

#### Acceptance Criteria

1. WHEN the curriculum is loaded THEN it SHALL contain an A1 grammar point `tr-a1-comparative-superlative` covering `daha`, `en`, and the ablative standard of comparison (`Ali Ayşe'den daha uzun`), with `tr-a1-ablative-dative` as a prerequisite (satisfied by the relocation in Requirement 3).

### Requirement 9 — A2 past aspect and aorist

**User Story:** As a Turkish A2 learner, I want the evidential past `-mIş` and the aorist `-(A/I)r`, so that I can report unwitnessed events and express habits/general truths.

#### Acceptance Criteria

1. WHEN the curriculum is loaded THEN it SHALL contain A2 grammar points `tr-a2-mis-evidential` and `tr-a2-aorist`.
2. WHEN `tr-a2-mis-evidential` is inspected THEN it SHALL carry the content previously held by the disabled `tr-b1-mis-evidential`, with `cefrLevel: A2`, and SHALL declare `tr-a1-dili-past` as a prerequisite.

### Requirement 10 — A2 modality (ability and necessity)

**User Story:** As a Turkish A2 learner, I want to express ability and necessity, so that I can say "I can do it" and "I must go".

#### Acceptance Criteria

1. WHEN the curriculum is loaded THEN it SHALL contain an A2 grammar point `tr-a2-ability-necessity` covering ability `-(y)Abil` (`yapabilirim`), negative ability `-(y)AmA` (`yapamam`), and necessity `-mAlI` (`gitmeliyim`).

### Requirement 11 — A2 converbs

**User Story:** As a Turkish A2 learner, I want adverbial converbs, so that I can link clauses by manner, sequence, and time without a finite verb.

#### Acceptance Criteria

1. WHEN the curriculum is loaded THEN it SHALL contain A2 grammar points `tr-a2-converbs` (`-(y)Ip`, `-(y)ArAk`, `-mAdAn`, `-(y)A…-(y)A`) and `tr-a2-converb-temporal` (`-mAdAn önce`, `-DIktAn sonra`).
2. WHEN `tr-a2-converbs` is inspected THEN it SHALL carry the converb content previously held by the disabled `tr-b2-converbs`, with `cefrLevel: A2`.

### Requirement 12 — A2 nominalization and the subject relative participle

**User Story:** As a Turkish A2 learner, I want verbal nouns and the subject relative participle, so that I can nominalize actions and form "the person who…" relatives.

#### Acceptance Criteria

1. WHEN the curriculum is loaded THEN it SHALL contain A2 grammar points `tr-a2-nominalization` (`-mA` / `-mAk` / `-Iş` verbal nouns) and `tr-a2-relative-an` (subject relative `-(y)An`).
2. WHEN `tr-a2-relative-an` is inspected THEN it SHALL cover **only** the subject-relative `-(y)An`; the non-subject `-DIK` / `-(y)AcAK` relatives SHALL remain in the disabled B2 block.

### Requirement 13 — A2 connectives

**User Story:** As a Turkish A2 learner, I want comparison/similarity words, correlative pairs, causal connectors, and the `-CA` suffix, so that I can build more complex sentences and discourse.

#### Acceptance Criteria

1. WHEN the curriculum is loaded THEN it SHALL contain A2 grammar points `tr-a2-gibi-kadar` (`gibi`, `kadar`), `tr-a2-correlative-conjunctions` (`hem…hem`, `ne…ne`, `ya…ya`, `ister…ister`, `belki…belki`), `tr-a2-causal-connectors` (`çünkü`, `bu yüzden`, `bu sebeple`), and `tr-a2-ca-suffix` (`-CA` manner/“-wise” adverbs).
2. WHEN `tr-a2-causal-connectors` is inspected THEN it SHALL cover sentence-level paratactic causal connectors only; the nominalized `-DIğI için` causal SHALL remain in the disabled B1 block.

### Requirement 14 — A2 emphasis (reduplication)

**User Story:** As a Turkish A2 learner, I want adjective intensification, so that I can use emphatic forms like `kıpkırmızı` and `bembeyaz`.

#### Acceptance Criteria

1. WHEN the curriculum is loaded THEN it SHALL contain an A2 grammar point `tr-a2-pekistirme` covering the `m/p/r/s`-reduplication intensifier (`pekiştirme`).

### Requirement 15 — A2 purpose clauses and reported speech

**User Story:** As a Turkish A2 learner, I want purpose clauses and reported speech, so that I can express "in order to" and report what others said/asked.

#### Acceptance Criteria

1. WHEN the curriculum is loaded THEN it SHALL contain A2 grammar points `tr-a2-purpose-icin-uzere` (`-mAk için`, `-mAk üzere`) and `tr-a2-reported-speech` (`… diye sormak`/`söylemek` and reported imperatives — `dolaylı anlatım`).

### Requirement 16 — Disabled B1/B2 blocks cleaned and de-duplicated

**User Story:** As a maintainer, I want the disabled B1/B2 blocks to stop containing topics that moved to A1/A2, so that re-enabling B1/B2 later does not create duplicate concepts.

#### Acceptance Criteria

1. WHEN the disabled B1 block is reviewed THEN the `tr-b1-mis-evidential`, `tr-b1-aorist`, and `tr-b1-future` entries SHALL be removed (relocated to A1/A2).
2. WHEN the disabled B2 block is reviewed THEN `tr-b2-converbs` SHALL be removed, and `tr-b2-relative-clause-participles` and `tr-b2-noun-clauses-ma-dik` SHALL be narrowed so their commented scope is only the non-subject `-DIK`/`-(y)AcAK` constructions not moved to A2.
3. WHEN the `tr.ts` "TEMPORARILY REDUCED" header comment is reviewed THEN it SHALL be rewritten to describe the new A1/A2-complete, B1/B2-disabled state accurately.

### Requirement 17 — Seed mapping and seed levels updated for renamed keys

**User Story:** As a maintainer, I want the seed catalogue to keep resolving after the key renames, so that `planSeedTags` does not throw and the seed exercises stay coherent with their grammar points' levels.

#### Acceptance Criteria

1. WHEN `SEED_KEY_TO_GRAMMAR_POINT` in `packages/db/scripts/seed-exercises.ts` is inspected THEN the active TR mappings SHALL point to the renamed keys (`tr-cloze-a2-1` → `tr-a1-dili-past`, `tr-translation-a2-1` → `tr-a1-questions`, `tr-vocab-a2-1` unchanged → `tr-a2-everyday-vocab`).
2. WHEN a TR seed maps to a relocated A1 grammar point THEN that seed's `key` and `difficulty` SHALL be re-leveled to A1 (e.g. `tr-cloze-a2-1`/`difficulty:'A2'` → `tr-cloze-a1-1`/`difficulty:'A1'`) so the seed's difficulty matches its grammar point's CEFR level.
3. WHEN `planSeedTags(SEED_EXERCISES, SEED_KEY_TO_GRAMMAR_POINT, ALL_CURRICULA)` runs THEN it SHALL not throw, and any TR seed-resolution assertions in `seed-exercises.test.ts` SHALL pass.

### Requirement 18 — Cleanup migration for orphaned production data

**User Story:** As a maintainer, I want a forward-only migration that removes data tied to the renamed A2 keys, so that the scheduler repopulates the new A1 cells and no stale rows are served.

#### Acceptance Criteria

1. WHEN a new migration `packages/db/migrations/0014_*.sql` is added THEN it SHALL delete, for the five renamed keys (`tr-a2-dili-past`, `tr-a2-accusative-definite-object`, `tr-a2-ablative-dative`, `tr-a2-genitive-possessive`, `tr-a2-question-formation`): the dependent `exercise_tags`, the `exercises` rows where `language='TR' AND grammar_point_key IN (…)`, and the `skill_topics` rows whose `id` equals `deterministicUuid('skill-topic:'+oldKey)`.
2. WHEN the migration is added THEN `packages/db/migrations/meta/_journal.json` SHALL gain a matching entry so `pnpm db:migrate` applies it.
3. WHEN the migration SQL is reviewed THEN deletions SHALL be ordered to respect the `exercise_tags → skill_topics` / `exercise_tags → exercises` foreign keys (tags first), and SHALL be scoped to `language='TR'` so ES/DE data is untouched.

### Requirement 19 — Version, minimums, and tests stay consistent

**User Story:** As a maintainer, I want the version constant, count minimums, and count tests updated atomically, so that the build gate passes and the generation scheduler treats the edited cells as a new curriculum version.

#### Acceptance Criteria

1. WHEN `tr.ts` grammar entries change THEN `CURRICULUM_VERSION_TR` SHALL be bumped to `2026-05-28`, per the `tr.ts` header comment (analogous to the `*_PROMPT_VERSION` rule in the root CLAUDE.md).
2. WHEN the new TR grammar counts are A1 = 26 and A2 = 14 THEN `PER_LANGUAGE_GRAMMAR_MIN.TR` in `packages/db/src/curriculum/index.ts` SHALL be updated to `{ A1: 26, A2: 14, B1: 0, B2: 0 }`.
3. WHEN the per-language count test for Turkish runs THEN the assertions in `packages/db/src/curriculum/curriculum.test.ts` SHALL reflect A1 = 26, A2 = 14, B1 = 0, B2 = 0, vocab = 1, and pass.
4. WHEN `assertCurriculumInvariants()` runs over the shipped curriculum THEN it SHALL not throw.

## Non-Functional Requirements

### Correctness (curriculum invariants)

Every new/relocated entry MUST satisfy all invariants in `assertCurriculumInvariants` (`packages/db/src/curriculum/index.ts`):
- Key matches `^(es|de|tr)-(a1|a2|b1|b2)-[a-z0-9-]+$` and is globally unique.
- `language` matches the key prefix; `cefrLevel` matches the key infix.
- `examplesPositive.length >= 2`; `examplesNegative.length >= 1` with each negative starting with `*`; `commonErrors.length >= 1`.
- `description.length <= 200` characters.
- Every `prerequisiteKeys` entry resolves to an existing same-language key.

### Linguistic accuracy

All Turkish example strings MUST be correct Turkish, with negatives that are genuinely ill-formed for the stated reason, consistent with the deterministic vowel-harmony rules in `packages/ai/src/turkish-harmony.ts`.

### Data safety

The cleanup migration MUST be forward-only and scoped to `language='TR'`; it MUST NOT touch ES/DE rows and MUST NOT drop or alter any table or column (data-only `DELETE`s).

### Build gate

`pnpm lint`, `pnpm typecheck`, and `pnpm test` MUST all pass from the repo root with zero failures before the change is considered complete (per CLAUDE.md Pre-Push Checks).

### Scope boundaries

- Out of scope: re-enabling any Turkish B1/B2 grammar points (the disabled blocks are only pruned/narrowed, not activated); changes to Spanish (ES) or German (DE) curricula; vocab umbrellas beyond the existing `tr-a2-everyday-vocab` (vocab count stays 1).
- Out of scope: adding **new** seed exercises beyond re-leveling the existing TR seeds; backfilling the new A1/A2 pool is left to the background generation scheduler.
- Out of scope: "Zaman Zarfları" (time adverbs) as a standalone grammar point — treated as lexical and exercised within the tense entries' examples.

## Appendix — Target curriculum (40 grammar + 1 vocab)

**A1 (26 grammar):**

| Key | Topic | Source |
|---|---|---|
| tr-a1-vowel-harmony | Vowel harmony | existing |
| tr-a1-personal-suffixes | Copular/personal suffixes | existing |
| tr-a1-plural-suffix | Plural `-lAr` | existing |
| tr-a1-locative | Locative `-DA` | existing |
| tr-a1-demonstratives | `bu/şu/o`, `burası/şurası/orası` | new |
| tr-a1-questions | `mı` + WH-words | renamed from tr-a2-question-formation |
| tr-a1-degil | Nominal negation `değil` | new |
| tr-a1-var-yok | Existence/possession `var/yok` | new |
| tr-a1-numbers-ordinals | Cardinals + ordinal `-(I)ncI` | new |
| tr-a1-personal-pronouns | Pronouns + oblique forms | new |
| tr-a1-accusative-definite-object | Accusative `-(y)I` | renamed from tr-a2- |
| tr-a1-ablative-dative | Ablative `-DAn` + dative `-(y)A` | renamed from tr-a2- |
| tr-a1-genitive-possessive | İsim tamlaması | renamed from tr-a2- |
| tr-a1-present-continuous | Present continuous `-(I)yor` | new |
| tr-a1-negation | Verbal negation `-mA` | new |
| tr-a1-dili-past | Definite past `-DI` | renamed from tr-a2- |
| tr-a1-future | Future `-(y)AcAk` | relocated from disabled tr-b1-future |
| tr-a1-imperative | Imperative `Emir` | new |
| tr-a1-possessive-suffixes | İyelik ekleri | new |
| tr-a1-instrumental-ile | `-ile/-(y)lA` | new |
| tr-a1-postpositions-once-sonra | `-DAn önce/sonra` | new |
| tr-a1-dan-a-kadar | `-DAn … -A kadar` | new |
| tr-a1-ki-relativizer | `-ki` / `-DAki` | new |
| tr-a1-gore-bence | `-A göre`, `bence` | new |
| tr-a1-beri-dir | `-DEn beri` / `-DIr` | new |
| tr-a1-comparative-superlative | `daha` / `en` | relocated from draft tr-a2- |

**A2 (14 grammar):**

| Key | Topic | Source |
|---|---|---|
| tr-a2-mis-evidential | Evidential past `-mIş` | relocated from disabled tr-b1- |
| tr-a2-aorist | Aorist `-(A/I)r` | relocated from disabled tr-b1- |
| tr-a2-ability-necessity | `-(y)Abil` / `-mAlI` | new |
| tr-a2-converbs | `-(y)Ip/-ArAk/-mAdAn/-(y)A…-(y)A` | relocated from disabled tr-b2- |
| tr-a2-converb-temporal | `-mAdAn önce` / `-DIktAn sonra` | new |
| tr-a2-nominalization | `-mA/-mAk/-Iş` verbal nouns | split from disabled tr-b2-noun-clauses |
| tr-a2-relative-an | Subject relative `-(y)An` | split from disabled tr-b2-relative |
| tr-a2-gibi-kadar | `gibi`, `kadar` | new |
| tr-a2-correlative-conjunctions | `hem…hem`, `ne…ne`, `ya…ya`, `ister…ister`, `belki…belki` | new |
| tr-a2-causal-connectors | `çünkü`, `bu yüzden`, `bu sebeple` | new |
| tr-a2-ca-suffix | `-CA` adverbs | new |
| tr-a2-pekistirme | Reduplication intensifier | new |
| tr-a2-purpose-icin-uzere | `-mAk için` / `-mAk üzere` | new |
| tr-a2-reported-speech | `diye` + reported imperative | new |

**Vocab (1):** `tr-a2-everyday-vocab` (unchanged).
