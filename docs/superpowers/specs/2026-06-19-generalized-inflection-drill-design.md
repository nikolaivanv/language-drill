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

## Design

### 1. Type model (`packages/shared/src/index.ts:212`)

Keep `ExerciseType.CONJUGATION` (string `"conjugation"`). Extend
`ConjugationContent`:

```ts
export type ConjugationContent = {
  type: ExerciseType.CONJUGATION;
  instructions: string;
  lemma: string;          // citation form — any word class, not just verbs
  lemmaGloss: string;
  featureBundle: string;  // names the cell, e.g. "yönelme · tekil" (dative · sg)
  targetForm: string;
  acceptableForms?: string[];
  breakdown: string;      // stem + ordered suffix gloss (already TR-aware)
  exampleSentences: string[];
  topicHint?: string;
  // NEW:
  carrierPhrase?: string; // in-context frame with a blank, e.g. "das ___ Haus".
                          // Display-only, shown above the input only when the
                          // form is not self-contained (German declension).
                          // Null for Turkish/Spanish self-contained forms.
  wordClass?: 'verb' | 'noun' | 'adjective'; // routes generation/validation
                          // wording + breakdown; not needed at grade time.
};
```

Unchanged: fluency grading (`packages/shared/src/fluency.ts` —
`isConjugationContent` exact-match path), the single-input web UI, and the
validation structure. The carrier phrase is display-only.

### 2. Generation & validation (`packages/ai/src/`)

- `renderConjugationSection` (`generation-prompts.ts:228`) generalizes:
  - Drop verb-only wording. Branch on `wordClass`: "conjugate the verb" vs
    "decline the noun" vs "inflect the adjective."
  - Replace "tense/mood is FIXED by the grammar point" with "the inflectional
    dimension(s) fixed by the grammar point — vary only the dimensions the
    coverage axes name."
  - The "no sentence / no blank" rule gains a **carrier-phrase exception**:
    when a carrier phrase is required (German), emit it with the blank and
    require the learner to produce only the inflected form.
- Seed binding (`generation-prompts.ts:567`): keep the strict ES verb-seed
  path; Turkish stays unseeded (Claude picks nouns, axes drive variation).
- Validation (`validation-prompts.ts:288`): generalize the five checks to any
  word class — exact morphological correctness incl. diacritics, feature-bundle
  congruence with the grammar point, acceptable-variant validity, no answer
  leak (incl. via carrier phrase), breakdown accuracy.
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

### 5. Web UI (`apps/web/.../drill/_components/conjugation-exercise.tsx`)

Single input unchanged. When `carrierPhrase` is set, render it above the input
(blank styled like the cloze blank) so German declension reads in context. Card
still shows lemma + gloss + feature bundle; post-answer still shows
`targetForm` + `breakdown` + `exampleSentences`.

## Phasing

- **Phase 1 — Turkish nominal morphology.** Cases, copula, possessives, and
  possessive+case stacking. Unseeded, coverage-axis-driven. Build the
  `carrierPhrase` field + UI plumbing here even though Turkish doesn't use it,
  so Phase 2 is curriculum + prompt only.
- **Phase 2 — German declension (carrier-phrase path).** Gated on re-enabling
  the German curriculum (`curriculum/de.ts`) first; then add `gender`/
  `definiteness` axes and a carrier-phrase prompt branch.
- **Phase 3 (optional) — Spanish adjective/article agreement.** Gender/number
  axes; reuse the unseeded or curated-seed path.

## Non-goals

- **No segmented suffix-builder UI** and **no composition (intent→suffix-set)
  drill.** Single input only; composition stays with translation/free-writing.
- **No POS-tagged frequency corpus / no `nounBand`/`adjectiveBand`** for the
  Turkish MVP (it generates unseeded).
- **No new `ExerciseType`** and no rename of `"conjugation"`.
- **No German content** in Phase 1 (curriculum is disabled).

## Risks & open questions

- **TR-unseeded assumption.** If Turkish conjugation turns out to depend on
  seeds, we need a small curated noun seed list per CEFR band (bounded work).
  Confirm early in implementation.
- **Diversity/dedup for stacking.** The conjugation dedup surface is
  `lemma+featureBundle`; multi-feature bundles must serialize deterministically
  so the same stack on the same lemma dedups correctly. Verify the dedup key
  includes the full feature set, not just `person`.
- **Feature-bundle wording in Turkish.** Decide whether the bundle is shown in
  Turkish metalanguage (`yönelme durumu`), English, or both — affects whether
  the bundle accidentally leaks the answer and how A1 learners parse it.
- **Exhaustiveness ripple.** Even reusing the enum, broadening generation/
  validation/UI branches touches the per-`ExerciseType` switches; sweep them.
