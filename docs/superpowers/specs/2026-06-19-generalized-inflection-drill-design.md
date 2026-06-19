# Generalized Inflection Drill — Design

**Date:** 2026-06-19
**Status:** Approved (design); ready for implementation planning
**Author:** brainstormed with Claude

## Summary

Generalize the existing **conjugation** exercise from verb-only morphology to a
single "produce one inflected form" **inflection drill** that also covers
non-verb morphology: Turkish noun cases, the personal copula, possessives, and
possessive+case suffix **stacking**; later German adjective/noun declension and
Spanish adjective/article agreement.

The drill keeps its current single-text-input interaction. The learner sees a
lemma + a named feature bundle and types the one correct inflected form. We do
**not** build a segmented suffix-builder or a composition (intent→suffix-set)
drill — those stay out of scope (see Non-Goals).

## Motivation

The author struggles with Turkish suffix **stacking** across three layers
(self-reported): (1) **ordering** the suffixes, (2) picking the right
**allomorph** (vowel harmony / consonant softening across a long chain), and
(3) **composition** — knowing which suffixes a meaning requires. It is *not* an
automaticity/speed gap. No current exercise targets stacking well except free
writing and translation.

The conjugation type is already structurally generic — it produces one
inflected form from `lemma` + `featureBundle`, with a `breakdown` field that
already renders an ordered suffix gloss for Turkish. "Verb" is baked only into
prompt wording, the (Spanish-only) seed picker, and the tense/mood axis. So
generalizing it is mostly wiring + curriculum, not a new exercise.

Single-input cells whose feature bundle names multiple stacked features
(e.g. `araba` + "1sg-possessive · accusative" → `arabamı`) exercise the
**ordering** and **allomorph** layers. The **composition** layer is
deliberately not targeted here — naming the features hands the learner "which
suffixes," and composition is closest to translation, which already exists.

## Key findings from codebase exploration

1. **Turkish conjugation already generates unseeded.** `verbBand()`
   (`packages/ai/src/frequency/index.ts:274`) is **Spanish-only** — TR/DE return
   `[]`. Verb-seeding (PR #377) is an ES-specific fix for dedup-collapse on
   Spanish's small high-frequency verb inventory. Turkish conjugation relies on
   Claude to pick verbs, with coverage axes driving variation. **Therefore the
   Turkish MVP needs no `nounBand`/`adjectiveBand`** — the single largest content
   cost is avoided. (Load-bearing assumption — confirm during implementation;
   fallback is a small curated noun list, bounded, not a blocker.)

2. **Turkish grammar points already exist; two are nearly ready.**
   `tr-a1-personal-suffixes` (copula) and `tr-a1-possessive-suffixes` already
   carry a `person` `coverageSpec` — they only need the suitability flag. Case
   points (`tr-a1-locative`, `tr-a1-accusative-definite-object`,
   `tr-a1-ablative-dative`, `tr-a1-genitive-possessive`) exist but need a new
   `case` coverage axis.

3. **German curriculum is fully disabled** (`packages/db/src/curriculum/de.ts`,
   commented out since 2026-05-10). German declension is therefore gated behind
   re-enabling the German curriculum — a separate, larger lift. Deferred to
   Phase 2.

4. **Coverage axes are a closed union** (`packages/shared/src/coverage.ts:42`).
   Adding `case`/`number`/`gender`/`definiteness` is mechanical but touches
   several sites (union, `COVERAGE_AXIS_VALUES`, `AXIS_ORDER`, `CoverageTags`,
   `coverageAxesFor`).

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Exercise type | **Reuse `ExerciseType.CONJUGATION`**, broaden meaning | Avoids the enum ripple across ~8 exhaustive `Record`/switch sites in ai/lambda/web/shared and DB rows storing `"conjugation"`. |
| German non-self-contained forms | **Carrier phrase shown in the drill** | German endings (`groß`→`große`) only mean something inside a noun phrase (`das ___ Haus`). Show an optional context frame; learner still types only the form. Keeps it one drill. |
| Phasing | **Turkish-first**; German deferred | Turkish content exists and is unseeded (cheap). German is gated on re-enabling its curriculum. |
| Stacking interaction | **Single text input**, multi-feature cells | Author chose breadth + single input. Composition stays with translation. |
| Structured feature bundle (#386) | **Reuse #386's `features`/`subject`; make `subject` optional** | #386 (merged, `f9b8bbb`) added glossed `features[]` + a `subject{pronoun,gloss}` badge, both *required* in the parser/tool-schema and verb-shaped. Pure nominal cases have no subject pronoun, so Phase 1 relaxes `subject` to **optional** (omitted for case/number forms; the **possessor** fills it for possessives, e.g. `arabam` → `{pronoun: "benim", gloss: "my"}`) and lets `features` carry **case/number** for nominals. |

## Interaction with PR #386 (merged)

#386 ("legible feature bundle") landed on the same `ConjugationContent` /
`renderConjugationSection` / `generate.ts` surfaces this design touches. It is
**additive and verb-shaped**, and Phase 1 must extend it to nominals:

- **What it added:** `features?: Array<{term, gloss}>` (tense/mood + polarity,
  English-glossed) and `subject?: {pronoun, gloss}` (the person/number cue),
  rendered as a pronoun badge + glossed chips by the shared
  `ConjugationFeatureBundle` component (`apps/web/components/drill/`). The flat
  `featureBundle` is retained as the canonical cell name, the **dedup key**, and
  the legacy fallback.
- **The catch:** both fields are *required* — `requireConjugationSubject`
  (`generate.ts:666`) **throws** if `subject` is absent, and `subject` is in the
  tool-schema `required` array (`generate.ts:307`). A pure Turkish case form
  (`ev → evde`) has **no subject pronoun and no tense/mood**, so it cannot
  satisfy the verb-shaped contract.
- **Phase-1 fix (folded in below):** relax `subject` to optional across parser +
  tool-schema + the prompt guidance + the UI gate; keep `features` required (every
  cell has ≥1 display dimension). `subject` carries the person cue **when one
  exists** (verb/copula subject; the possessor for possessives); it is **omitted**
  for pure case/number forms, which render their `features` chips with no badge.
- **Pool migration is disjoint.** #386's own regen demotes + re-generates the
  *existing* (verb) conjugation cells. Phase 1's new *nominal* cells don't exist
  until the `conjugationSuitable` flags + `CURRICULUM_VERSION_TR` bump land, so
  the two regenerations target non-overlapping cell sets and don't conflict.

## Design

### 1. Type model (`packages/shared/src/index.ts:212`)

Keep `ExerciseType.CONJUGATION` (string `"conjugation"`). The type already
carries (post-#386) `features?: Array<{term, gloss}>` and
`subject?: {pronoun, gloss}` alongside `lemma`/`lemmaGloss`/`featureBundle`/
`targetForm`/`acceptableForms`/`breakdown`/`exampleSentences`/`topicHint`. The
`lemma` is any word class, not just verbs; `featureBundle` already names the
cell (e.g. `"yönelme · tekil"`).

Phase-1 changes are **behavioural, not new top-level fields**: make `subject`
optional in practice (parser + tool-schema, §2) and let `features` carry
case/number for nominals. `carrierPhrase` and an explicit `wordClass`
discriminator are **deferred to Phase 2** (Turkish never populates them; they'd
be dead code now and are pure-additive later).

Unchanged: fluency grading (`packages/shared/src/fluency.ts` —
`isConjugationContent` exact-match on `targetForm`/`acceptableForms`) and the
single-input web UI.

### 2. Generation & validation (`packages/ai/src/`)

- `renderConjugationSection` (`generation-prompts.ts:228-252`) generalizes the
  #386-updated text:
  - Drop verb-only wording ("Use the verb you are given" → "Use the lemma you
    are given"; the carrier sentence references the lemma, not "the verb").
  - Replace "Tense/mood is FIXED by the grammar point" with "the **inflectional
    category** is fixed by the grammar point — tense/mood for verbs,
    case/number/possessive for nominals — vary only the features the cell names."
  - Generalize #386's `features`/`subject` bullets: `features` lists the
    inflectional dimensions **other than the subject cue** (tense/mood + polarity
    for verbs; **case and number** for nominals); `subject` is the person cue
    **only when the form agrees with a person** (verb/copula subject, or the
    **possessor** for possessives — `arabam` → `{pronoun: "benim", gloss: "my"}`),
    and is **omitted** for pure case/number forms (`ev → evde`).
- Parser + tool-schema (`generate.ts`): `requireConjugationSubject` →
  optional (`generate.ts:666`); remove `subject` from the tool-schema `required`
  array (`generate.ts:307`). `features` stays required.
- Seed binding (`generation-prompts.ts:567`): keep the strict ES verb-seed
  path; Turkish stays unseeded (Claude picks nouns, axes drive variation).
- Validation (`validation-prompts.ts:288`): generalize check #2 from
  "tense/mood" to "the grammar point's inflectional category (tense/mood for
  verbs; case/number/possessive for nominals)". Bump `VALIDATION_PROMPT_VERSION`.
- **Prompt versioning (per CLAUDE.md):** bump `GENERATION_PROMPT_VERSION` and
  `VALIDATION_PROMPT_VERSION` to `<surface>@2026-06-19`; after merge, push to
  each Langfuse environment via `push-prompts` (the runtime serves the Langfuse
  body, not the in-repo constant).

### 3. Coverage axes (`packages/shared/src/coverage.ts`)

Add to the closed union and its companions:
- `case` → values: `nominative, accusative, dative, locative, ablative, genitive`
- `number` → values: `singular, plural`
- (Phase 2/3) `gender` → `masculine, feminine, neuter`; `definiteness` →
  `definite, indefinite`

Touch: `CoverageAxis` union, `COVERAGE_AXIS_VALUES`, `AXIS_ORDER`,
`CoverageTags`, and `coverageAxesFor(CONJUGATION)` so the drill monitors the
new axes.

### 4. Curriculum (`packages/db/src/curriculum/tr.ts`) — Phase 1

- `tr-a1-personal-suffixes`, `tr-a1-possessive-suffixes`: add the suitability
  flag (person `coverageSpec` already present).
- Case points (`tr-a1-locative`, `tr-a1-accusative-definite-object`,
  `tr-a1-ablative-dative`, `tr-a1-genitive-possessive`): add the suitability
  flag + a `case` coverage axis (+ `number` where useful).
- **Stacking:** a `coverageSpec` combining axes (possessive-`person` × `case`)
  on the genitive-possessive / possessive points, so cells like
  `araba → arabamı` (1sg-poss + accusative) and `ev → evlerimizden`
  (plural + 1pl-poss + ablative) get generated. This is the cell type that
  drills the author's ordering + allomorph layers.
- **Bump `CURRICULUM_VERSION_TR`** — suitability/axis changes need a curriculum
  bump to clear scheduler skip-low-yield suppression (a prompt-version bump is
  insufficient).

### 5. Web UI (`apps/web/components/drill/conjugation-feature-bundle.tsx`)

Single input unchanged. #386's shared `ConjugationFeatureBundle` already renders
the pronoun badge + glossed chips when structured data is present and falls back
to the flat `featureBundle` otherwise. Its gate is
`structured = subject !== undefined && features.length > 0`
(`conjugation-feature-bundle.tsx:17`) — so a **subjectless nominal cell** (no
`subject`) currently drops to the flat-string fallback. Phase-1 change: render
the `features` chips when `features.length > 0` **even if `subject` is
undefined**, making the subject badge conditional, so Turkish case cells get the
legible chips with no badge. (Carrier-phrase rendering for German is Phase 2.)

## Phasing

- **Phase 1 — Turkish nominal morphology.** Cases, copula, possessives, and
  possessive+case stacking. Unseeded, coverage-axis-driven. Also generalizes
  #386's structured `features`/`subject` model to nominals (subject optional;
  features carry case/number).
- **Phase 2 — German declension (carrier-phrase path).** Adds the
  `carrierPhrase` field + UI and a `wordClass` discriminator. Gated on
  re-enabling the German curriculum (`curriculum/de.ts`) first; then add
  `gender`/`definiteness` axes and a carrier-phrase prompt branch.
- **Phase 3 (optional) — Spanish adjective/article agreement.** Gender/number
  axes; reuse the unseeded or curated-seed path.

## Non-goals

- **No segmented suffix-builder UI** and **no composition (intent→suffix-set)
  drill.** Single input only; composition stays with translation/free-writing.
- **No POS-tagged frequency corpus / no `nounBand`/`adjectiveBand`** for the
  Turkish MVP (it generates unseeded).
- **No new `ExerciseType`** and no rename of `"conjugation"`.
- **No German content** in Phase 1 (curriculum is disabled).
- **No `carrierPhrase` / `wordClass` fields** in Phase 1 (deferred to Phase 2 —
  Turkish never populates them).

## Risks & open questions

- **TR-unseeded assumption.** If Turkish conjugation turns out to depend on
  seeds, we need a small curated noun seed list per CEFR band (bounded work).
  Confirm early in implementation.
- **Diversity/dedup for stacking.** *Resolved* — `canonicalSurface`
  (`generation-prompts.ts:602`) keys on `lemma::featureBundle`, which serializes
  the full cell (the bundle names every stacked feature), so the same stack on
  the same lemma dedups correctly. No change needed.
- **`subject` semantics for nominals.** *Decided* — `subject` carries the person
  cue when one exists (verb/copula subject; the **possessor** for possessives,
  e.g. `arabam` → `{pronoun: "benim", gloss: "my"}`) and is **omitted** for pure
  case/number forms (`ev → evde`). Parser/tool-schema relax `subject` to optional.
- **Feature-bundle wording in Turkish.** Decide whether the bundle is shown in
  Turkish metalanguage (`yönelme durumu`), English, or both — affects whether
  the bundle accidentally leaks the answer and how A1 learners parse it. (#386's
  glossed `features` chips mitigate this: term + short English gloss.)
- **Exhaustiveness ripple.** Even reusing the enum, broadening generation/
  validation/UI branches touches the per-`ExerciseType` switches; sweep them.
