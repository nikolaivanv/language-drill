# Vocab Expansion — More Topics and Non-Noun Words

**Date:** 2026-10-17
**Status:** Approved (design), pending spec review
**Prior art:** `2026-07-09-vocab-coverage-hub-design.md` (curated targets +
coverage read model), `2026-07-10-vocab-generation-seeding-design.md` (seeded
`vocab_recall` generation), `2026-07-17-vocab-target-expansion-design.md`
(themed umbrellas for every scope), PR #790 (article rule for nouns).

## Goal

Roughly double the curated vocabulary per language and stop it being almost
all nouns. The goal is useful *production* vocabulary per level — the verbs,
adjectives, adverbs, connectors and fixed expressions a learner needs to say
things — not a raw word count.

## Current state (prod, 2026-10-17)

- 60 themed vocab umbrellas: 5 per level × A1–B2 × ES/DE/TR, each with 20–35
  approved `vocab_target` rows (~1,600 words total; DE 521, ES 553, TR 535).
- Part-of-speech mix of approved targets (joined to `vocab_lemma.pos_all`):

  | | NOUN | ADJ | VERB | ADV | other / unmatched |
  |---|---|---|---|---|---|
  | DE | 421 | 36 | 10 | 5 | 49 |
  | ES | 412 | 65 | 41 | 9 | 26 |
  | TR | 411 | 36 | 13 | 12 | 63 |

- Cause: `VOCAB_TARGET_GENERATION_SYSTEM_PROMPT_TEMPLATE`
  (`packages/ai/src/vocab-target-prompts.ts`) asks for "concrete, everyday"
  words, forbids multi-word items, gives only a noun example, and sets no
  word-class mix. `validateProposedWord` rejects any lemma containing
  whitespace. `vocab_target` has no part-of-speech column, so the mix can be
  neither steered nor measured except through the corpus join.
- The per-umbrella avoid-list is umbrella-scoped, so nothing stops one word
  landing in two groups.
- The Words tab (`progress/_components/words-tab.tsx`) and the /vocab hub
  render topics as one flat list; at ~40 groups per language that stops
  scaling. `VocabTopicSummary` already carries `cefrLevel`.

## Decisions (agreed with the user)

1. **Non-nouns appear both ways:** themed topics get an enforced word-class
   mix, *and* each level gets dedicated word-class groups (core verbs,
   describing words, connectors …) so theme-less verbs and connectors have a
   home.
2. **Short fixed expressions count as words:** 2–4 token fixed expressions,
   reflexive and prepositional verbs ("echar de menos", "sich freuen auf",
   "iyi ki", "por la mañana").
3. **Scale: roughly double.** Per language × level: +3 themed topics, +2
   word-class groups, and +10–15 non-nouns topped into each existing topic.
   ~20 → ~40 groups and ~550 → ~1,200 words per language.

## Part 1 — Pipeline PR

### 1a. Word class on `vocab_target`

- Migration: `vocab_target.pos text` (nullable), values
  `noun | verb | adjective | adverb | phrase | other`. Shared type
  `VocabPos` in `@language-drill/shared`.
- The authoring prompt returns `pos` per word; `validateProposedWord` rejects
  a missing/unknown value.
- One-off `pnpm backfill:vocab-target-pos` (dry-run default, `--apply`,
  artifact + `--revert`, same shape as `backfill:vocab-article-form`): tag
  existing rows from `vocab_lemma.pos_all[1]` (UD tags mapped:
  NOUN/PROPN→noun, VERB/AUX→verb, ADJ→adjective, ADV→adverb, else other);
  rows with no lemma match or a multi-token lemma go to one batched Claude
  classification call. Artifact lives outside the repo
  (`.claude/backfill-artifacts-prod-2026-10/`).

### 1b. Word-class mix for themed topics

- Themed umbrellas (no `vocabGroup` marker, see 2b) target, per authoring
  run: nouns ≤ 60%, verbs ≥ 20%, adjectives + adverbs ≥ 15%, phrases ≤ 10%.
- The mix lives in one pure helper (`vocab-target/mix.ts`):
  `mixShortfall(rows, wordCount, quota) → { verb: n, adjective: n, … }`.
- `runOneUmbrella` counts the validated batch by `pos`; for any shortfall it
  makes **one** follow-up call asking only for the missing classes (same
  avoid-list), then truncates surplus nouns so the run lands inside the
  quota. No loop beyond one follow-up — a still-short run is reported, not
  retried.
- Word-class groups (2b) skip the mix: their `vocabGroup.pos` restricts every
  word to the declared class(es).
- Prompt changes: drop "concrete"; add a verb, an adjective and a phrase
  example to the `displayForm` rule (verbs → infinitive; adjectives → ES
  masculine singular, DE uninflected, TR bare; phrases → the full fixed
  form); state the requested mix. Bump
  `VOCAB_TARGET_GENERATION_PROMPT_VERSION`. (In-repo prompt, not Langfuse.)

### 1c. Phrases

- `validateProposedWord`: a lemma may contain whitespace only when
  `pos = 'phrase'` or `pos = 'verb'` (reflexive/prepositional verb), and is
  capped at 4 tokens. The example-sentence check matches the phrase's first
  content token, since inflection changes later tokens.
- Phrases rarely match `vocab_lemma`: `freqRank` stays null as today; tier
  derivation is unchanged (null → `extended`) — tier is not learner-visible.

### 1d. Cross-group dedup

- `loadExistingLemmas` takes the whole language (all umbrellas, all
  statuses) as the avoid-list, so a word lives in one group per language.
  Comparison stays case-insensitive. The prompt list grows to ≤ ~1,200
  lemmas (~5k tokens) — acceptable for a one-off CLI.
- Existing cross-umbrella duplicates are left as they are.

### 1e. `--fill-mix` top-up mode

- `generate:vocab-targets --fill-mix [--language X] [--level Y]
  [--umbrella K]`: for each themed umbrella, compute the shortfall against
  the mix using its *existing approved + flagged* rows plus a requested
  growth (`--word-count`, default 12), and ask only for the missing classes.
  Never proposes nouns.

### 1f. Exercise generation for non-nouns

- `vocab_recall` generation already seeds on the target word
  (`generation-prompts.ts`: "The target word (expectedWord) MUST be exactly
  …"). Add citation-form rules to the vocab_recall section:
  - verb → the infinitive (ES/DE) / `-mek/-mak` infinitive (TR); reflexive
    verbs keep `se`/`sich`.
  - adjective → ES masculine singular with the feminine in
    `acceptableAnswers`; DE uninflected; TR bare.
  - phrase → the full fixed expression as `expectedWord`; legitimate
    word-order or clitic-placement variants go in `acceptableAnswers`; the
    definition must name the situation the phrase is used in.
- Mirror the accepting side in the validation prompt (generate↔validate
  contract), bump `GENERATION_PROMPT_VERSION` and
  `VALIDATION_PROMPT_VERSION`, then `push-prompts` to prod and dev Langfuse
  from fresh main after merge.
- The evaluator's article rule (PR #790) already applies only when
  `articleForm` is set; `resolveArticleForm` keys off the target's
  `displayForm`, so non-noun targets carry no article requirement. A phrase
  whose displayForm starts with an article ("el fin de semana") is a noun
  phrase and correctly gets one.

### 1g. UI: group by level, label word-class groups

- Words tab and /vocab hub: section the topic list under A1/A2/B1/B2
  headings (order from `cefrLevel`, then curriculum order).
- `VocabTopicSummary` gains optional `group: 'verbs' | 'describing' |
  'adverbs' | 'connectors' | 'expressions' | null` (from `vocabGroup.label`);
  the topic card shows it as a small tag. Zod default `null`.

### Tests

Each in the existing module's test file: `validate.test.ts` (pos, phrase
token cap), new `mix.test.ts` for the pure helper, `run-one-umbrella.test.ts`
(shortfall follow-up, surplus truncation, single follow-up),
`generate-vocab-targets` arg parsing (`--fill-mix`), backfill script tests
(mapping, revert), `vocab-target-prompts.test.ts`, `prompts`/generation
prompt version pins, `words-tab.test.tsx` (level sections, group tag).

## Part 2 — Curriculum PR

### 2a. Themed topics (+3 per language × level = 36)

Draft themes — exact wording finalized against PCIC (ES), Goethe / Profile
Deutsch (DE) and Yedi İklim (TR) during implementation:

| Level | New themed topics |
|---|---|
| A1 | free time & hobbies; time & calendar; greetings & everyday phrases |
| A2 | technology & communication; celebrations & traditions; cooking & restaurants (DE A2 replaces one with daily routine, the theme it lacks vs ES/TR) |
| B1 | travel & tourism; money & consumers; health & lifestyle |
| B2 | law & justice; economy & business; psychology & behaviour |

### 2b. Word-class groups (+2 per language × level = 24)

| Level | Groups |
|---|---|
| A1 | everyday verbs; describing words (adjectives) |
| A2 | verbs of movement & change; time & frequency adverbs (*ya, todavía / schon, noch / hâlâ, henüz*) |
| B1 | verbs with prepositions / case government (*acordarse de / sich freuen auf / -e/-den governed verbs*); connectors & discourse markers |
| B2 | collocations & idioms; formal connectors & hedging (*no obstante / dennoch / ancak, dolayısıyla*) |

- Same entry shape as existing vocab umbrellas (`kind: 'vocab'`,
  description ≤ 450 chars, 2 positive / 1 negative example, 2
  `commonErrors`), keys `<lang>-<level>-vocab-<theme>`.
- New optional `GrammarPoint.vocabGroup: { label, pos: VocabPos[] }` marks
  the word-class groups; a curriculum invariant restricts it to
  `kind: 'vocab'`. Its presence switches authoring from the mix (1b) to the
  class restriction.
- coverageSpec: none on new umbrellas (targets drive seeding; a `wordClass`
  floor on the exercise pool would duplicate what the target list already
  fixes). Documented per umbrella per the coverageSpec checklist.

### Ripple

- Bump `CURRICULUM_VERSION_ES/DE/TR`.
- `curriculum.test.ts` per-level floors (and any pinned counts).
- `vocabGroup` exhaustiveness: if any switch over curriculum fields needs it,
  and the api-client Zod schema if `vocabGroup` crosses the API.
- No theory-categories entry (theory is grammar-only); book-coverage ledgers
  untouched.
- `skill_topics` seeds if new umbrellas need them (check the FW-topics
  precedent).
- Existing vocab-kind points without curated targets (`de-b2-verb-prefixes`,
  `es-b2-aspectual-se`, `tr-b1-when-converbs`) are out of scope.

## Part 3 — Data rollout (prod)

All runs use the prod `DATABASE_URL` from Secrets Manager (local `.env` is
the dev branch).

1. **After PR 1 deploys:** `backfill:vocab-target-pos` dry-run → `--apply`.
2. **Pilot — ES A2 + B1:** `--fill-mix` on the existing umbrellas; after PR 2
   deploys, author the new ES A2/B1 groups. Triage → user spot-check →
   approve. Let one nightly run fill them, then compare `vocab_recall`
   approval rate for verb / adjective / phrase targets against nouns
   (generation_jobs + exercises.review_status, joined on `seedWord` →
   `vocab_target.pos`). If phrases or verbs approve at well under the noun
   rate (> 15pp gap), fix the generation/validation prompt before scaling.
3. **Scale:** remaining scopes — `--fill-mix` (~720 non-nouns over the 60
   existing topics) and new groups (~1,500 words over 60 new groups). Claude
   triage per list (off-level, off-theme, wrong class, duplicate), user
   spot-check per language, `review:flagged-vocab --approve-all`.
4. **Fill:** the nightly scheduler converges seeded coverage, ~1–2 weeks
   given the volume. Expected generation cost $60–120.

## Success criteria

- Each language has ~40 vocab groups and ~1,200 approved targets.
- Overall approved targets per language are ≤ 60% nouns (measured on
  `vocab_target.pos`).
- `vocab_recall` approval rate for non-noun targets within 15pp of nouns.
- Words tab shows level sections, group tags, and coverage filling in.
- No duplicate word across groups among the new rows.

## Out of scope

- Changes to the vocab drill interaction (shipped in PR #790).
- Retiring or renaming existing umbrellas; cleaning existing duplicates.
- C1/C2 and EN.
- Per-word part-of-speech display in the word list.
