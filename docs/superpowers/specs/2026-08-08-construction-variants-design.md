# Construction variants — stop multi-construction grammar points collapsing onto one exemplar

**Date:** 2026-08-08
**Status:** Approved (design); pending implementation plan
**Scope:** New `constructionVariants` field on `GrammarPoint`; a new seed branch in the
generation path; a strict per-draft prompt directive mirrored into the validation prompt;
curriculum authoring for ~26 points across ES/DE/TR. No schema change, no migration, no UI
change. Ships inert — see **Rollout**.

## Goal

A grammar point whose description enumerates several constructions should produce a pool
that drills all of them. Today the pool collapses onto the single most prototypical member
and the rest are never generated at all.

## The problem

`es-b1-impersonal-plural` ("Impersonal third-person plural") describes five things: hearsay
`dicen que…`, the agentless event `llaman a la puerta`, the adversity/experiencer
`me robaron la cartera`, the `uno/una + 3sg` generic, and informal impersonal `tú`.

The production pool (2026-08-08, 100 approved rows):

| type | approved | collapse |
|---|---|---|
| cloze | 50 | 43 answer `Dicen`; the remaining 7 are `robaron` ×2, `identificaron`, `guían`, `metieron`, `entraron` |
| translation | 50 | **49** use `dicen que` (48 of them sentence-initially); exactly one (`Me robaron el martillo del coche`) exercises another use |

`uno/una + 3sg` and impersonal `tú` appear **zero** times. The stems are also topically
degenerate — roughly fifteen translations are a variant of "the new restaurant downtown has
the best pizza/paella in the city".

### It is a class of defect, not one point

Sweep over the whole approved pool — top answer-head share for cloze, top leading-bigram
share for translation, points with ≥15 approved rows, reported at ≥65% — returns 53 rows
across 49 distinct points. Triaged against each point's curriculum description:

| point | approved | collapse |
|---|---|---|
| `de-b1-um-zu-damit` | 50 cloze | 49 `damit` + 1 `damit … können` — **`um … zu` is never drilled**, on a point whose entire content is that contrast |
| `tr-a2-adversative-connectors` | 30 cloze | 30 `ama` — `fakat` / `ancak` / `yalnız` absent |
| `tr-a2-causal-connectors` | 30 cloze | 30 `bu yüzden` — `çünkü` / `madem(ki)` absent |
| `de-a2-wenn-als` | 29 cloze | 28 `als`, 1 `Wenn` |
| `es-b2-sino-adversatives` | 50 cloze | 48 `sino` |
| `es-b1-que-vs-cual` | 50 cloze | 45 `cuál` |
| `es-b2-comparatives-advanced` | 49 cloze | 42 `de (lo que)`, on a point listing five constructions |

### Why it happens

Cloze and translation cells *are* seeded per ordinal — but only with a **frequency-band
content word**, under a loose directive that ends "if it does not fit, choose an everyday,
level-appropriate content word of similar frequency instead"
(`packages/ai/src/generation-prompts.ts`, seed block ~L801). The seed is absorbed into the
complement (`restaurante`, `iglesia`, `pizza`) while the *construction frame* stays free —
and a free frame collapses onto the prototype. The point's `name` reinforces it: it is
injected into the generation prompt twice (the task line and the "Stay on target" rule), and
several of these points embed one exemplar in the name itself
(`Impersonal third-person plural (dicen que...)`).

### Why `coverageSpec` cannot express it

`CoverageAxis` is a closed set — `person | number | case | wordClass | polarity |
sentenceType | comparison` (`packages/shared/src/coverage.ts`), with `COVERAGE_AXIS_VALUES`
a single global `Record` of allowed values per axis. `dicen que`, `me robaron la cartera`,
and `llaman a la puerta` are all the same 3pl cell, so no floor on any existing axis
separates them. A person axis would buy only the `uno` (3sg) and impersonal-`tú` (2sg)
generics.

Making `construction` a real axis would mean generalizing `COVERAGE_AXIS_VALUES` to
per-point value sets, which ripples into the validator tool enum, the coverage-tag backfill,
and admin pool-status. Considered and rejected for v1 — the design below buys the same
enforcement locally.

## Design

### Data model

New optional field on `GrammarPoint` (`packages/shared/src/curriculum-types.ts`), valid only
on `kind: 'grammar'`:

```ts
constructionVariants?: readonly {
  /** kebab-case, stable — persisted as the seed, e.g. 'hearsay-dicen-que'. */
  id: string;
  /** strict prompt text naming the sub-construction, with an exemplar. */
  directive: string;
  /** relative weight, default 1 — lets the prototype keep a plurality share. */
  share?: number;
}[];
```

`share` exists because uniform rotation is wrong here: `dicen que` genuinely is the most
frequent use and should hold a plurality of the pool — just not 86% of it.

### Generation path

`seedKindFor` (`packages/db/src/generation/run-one-cell.ts`) gains a
`'construction-variants'` branch, tested for CLOZE and TRANSLATION *ahead of* the
`'frequency'` branch. When a point declares variants, the variant **replaces** the
frequency-word seed for those cells — exactly as `'elicitation-values'` does today.

`buildSeedWords` picks the variant per ordinal; the `id` is persisted as
`content_json.seedWord`; the `directive` is rendered into the strict per-draft block in
`buildGenerationUserPrompt`:

> This exercise MUST use the following sub-construction of *Impersonal third-person plural*:
> **agentless 3pl for a mishap the speaker suffered — `me robaron la cartera`**. Use exactly
> this construction; do not substitute another.

The TRANSLATION branch adds a source-side clause (mirroring the existing `base-word-cue`
translation branch): the English source must elicit the construction naturally and must not
contain the prototype's trigger phrase — otherwise "They say that…" sources keep forcing
`dicen que` regardless of the directive.

### Picking: deficit-ranked, not one-shot exclusion

This is the one semantic departure from the existing curated pools, and it is load-bearing.

`elicitationSeedValues` and `paraphrase.seeds` are **one-shot identities** — `fetchPriorSeeds`
excludes each value once it has been used, and the cell stops when the pool is exhausted.
Construction variants are **buckets** that each need many exercises. Plain exclusion would
consume every variant in the first batch and then stall the cell.

Instead the picker ranks variants by **deficit against the variant's `share` of the resolved
cell target**, computed from live approved counts grouped on `content_json->>'seedWord'` —
the same shape as `computeUncoveredTargetBand` / `pickTargetSeeds` on the vocab-target path
(`packages/db/src/generation/seed-picker.ts`). That gives floor semantics inside the seed
picker without touching the coverage-axis vocabulary.

### Two consequences to fold in, not discover later

**Validator contract.** A `Uno nunca sabe` or `me robaron` draft submitted under a point the
validator knows as "Impersonal third-person plural **(dicen que...)**" is a
`grammarPointMatch=false` candidate. A generation-side structural fix is nullified when the
validate prompt still rejects the new shape, so `packages/ai/src/validation-prompts.ts` takes
the mirror edit and both `GENERATION_PROMPT_VERSION` and `VALIDATION_PROMPT_VERSION` bump.

**Name anchoring.** Point `name` reaches the prompt twice. Names that embed a single member
(`Impersonal third-person plural (dicen que...)`) get audited in the same pass and rewritten
to name the category, not one exemplar.

### Known trade-off

Cells with variants lose their frequency-word lexical seed; scene variety then rests on
topic-domain rotation plus the `recentStems` avoid-list. That is the same deal
`elicitationSeedValues` and `paraphrase.seeds` already make. If lexical monotony reappears,
carrying both seeds is a v2 — not v1.

## Scope — which points

### In scope (26 points)

Points whose description enumerates a construction set the pool ignores.

- **DE** — `de-b1-um-zu-damit`, `de-a2-wenn-als`, `de-a2-nicht-sondern`,
  `de-a2-indirect-questions`, `de-b2-adversative-connectors`, `de-b2-causal-connectors`,
  `de-b2-conditional-connectors`, `de-b2-modal-connectors`, `de-b2-relatives-advanced`.
  The four B2 connector families are explicitly *"across styles"* points (subordinate /
  coordinating / nominal) and each collapsed onto one style.
- **ES** — `es-b1-impersonal-plural`, `es-b1-que-vs-cual`, `es-b2-sino-adversatives`,
  `es-b2-comparatives-advanced`, `es-b2-consecutives-intensity`, `es-a2-por-para`,
  `es-b2-verbs-of-change`, `es-b1-imperative-negative-pronouns`, and the A1 contrast pairs
  `es-a1-porque-para`, `es-a1-hay-estar`, `es-a1-ser-estar-basic`,
  `es-a1-quantifiers-muy-mucho`, `es-a1-coordination-basic`.
- **TR** — `tr-a2-adversative-connectors`, `tr-a2-causal-connectors`,
  `tr-a2-reported-speech`, `tr-a2-gibi-kadar`.

### Needs sub-inspection before authoring (~5 points)

Single-marker points where every answer *is* the marker, so the sweep metric cannot see
whether the sub-uses vary. Each gets a manual read of its approved rows during authoring;
some will land in scope, some will not: `es-b1-passive-se` (100% `se`, four sub-uses),
`es-b2-se-middle-accidental`, `de-b1-es-expressions`, `de-a2-lassen`, `tr-b1-olarak`.

### Out of scope

- **Metric false positives** — points where one answer legitimately *is* the point:
  `es-a2-personal-a`, `es-a2-hace-ago`, `tr-a2-enumerator-tane`,
  `es-b1-adjective-de-infinitive`, and `es-b1-ser-location-events` (94% `ser` is correct;
  `estar` is the distractor, not an answer).
- **Translation source-frame monotony** — `de-b2-mittelfeld-word-order` (91% "Sie hat…"),
  `de-b2-modal-perfect-word-order` (80% "Es ärgert…"), `de-b2-fixed-prepositions` (74%
  "Sie ist…"). Real, but it is subject-person monotony in the English source, better served
  by a person coverage axis than by construction variants.

Variants are hand-authored against the grammar-book mirrors (Butt & Benjamin for ES,
Durrell's Hammer for DE, Göksel & Kerslake for TR), 3–6 per point.

## Verification

**Pre-merge A/B — the real gate.** `pnpm eval:gen` with `--baseline repo --candidate
file:<path>` over a cell dataset covering the worst offenders (`es-b1-impersonal-plural`,
`de-b1-um-zu-damit`, `tr-a2-adversative-connectors`). Two things must hold: approval rate
must not regress, and the **variant spread must actually move** — the run summary needs a
per-`seedWord` breakdown added so "did the pool diversify" is measured, not assumed. A
Langfuse prompt push only affects future runs, so this A/B is how the prompt change is
validated before merge, not by waiting on nightly output.

**Target sizing.** `resolveCellTarget` (`infra/lambda/src/generation/cell-targets.ts`) today
raises the base target to cover the largest `coverageSpec` axis floor sum. It gains the
same treatment for variants: the target must cover `variants.length × MIN_PER_VARIANT`.
Note `targetOverride` still wins outright, so an invariant must reject a point that sets
`targetOverride` below that product.

**Curriculum invariants** (`assertCurriculumInvariants`): `constructionVariants` only on
`kind: 'grammar'`; ≥2 variants; unique kebab-case ids; non-empty directives under a length
cap; `share` positive when present.

**Unit tests.** `seedKindFor` branch precedence (variants beat frequency for cloze/
translation, no effect on conjugation/vocab_recall/paraphrase); deficit ranking picks the
most-starved variant and does not exhaust; `run-one-cell` persists the variant id as
`seedWord`; generation-prompt snapshot parity for
`GENERATION_SYSTEM_PROMPT_TEMPLATE` (the existing byte-parity test between `applyTemplate`
and the sync builder must still pass).

**Version bumps.** `CURRICULUM_VERSION_ES` / `_DE` / `_TR` all bump (also clears the
scheduler's skip-low-yield suppression, which only clears on a curriculum bump);
`GENERATION_PROMPT_VERSION` and `VALIDATION_PROMPT_VERSION` bump; Langfuse push for both
prompts, prod and dev, after merge.

## Rollout

Nightly exercise generation is **paused in production** (`infra/bin/app.ts:54`,
`enableScheduledExerciseGeneration: false`, paused 2026-07-25 to protect Anthropic budget).
This work therefore merges inert, and the pool repass runs when the nightly is resumed.

**A saturated cell will not self-heal.** This is the sharp edge. Cell targets count approved
rows, so `es-b1-impersonal-plural` at 50/50 cloze is already at target — the scheduler will
not generate for it at all, no matter what the variants say. Legacy rows also carry a
frequency word (or null) in `seedWord`, not a variant id, so every variant reads as
zero-covered. **Demotion is not cosmetic cleanup; it is what makes the mechanism take
effect.**

Repass recipe, per affected cell, once generation resumes:

1. **Backfill variant ids** onto the approved rows that are cheaply classifiable — for the
   collapsed frame this is a regex (`^\s*Dicen que`, `^\s*damit`, `^\s*ama`). Rows that
   resist classification stay null and simply do not count toward any variant.
2. **Demote the over-covered surplus** with `pnpm demote:pool --language ES --cefr B1 --type
   cloze --grammar-point es-b1-impersonal-plural --content-ilike 'Dicen que%'` (dry-run
   first; `--apply` to write). The CLI has no `--limit`, so capping a frame at N rather than
   clearing it needs either an id list or a `--limit` flag added — decide in the plan.
3. **Resume the nightly** and confirm the following morning that the freed slots refilled
   across variants, not back into the prototype.

Alternative considered: demote the whole collapsed frame and let regeneration rebuild from a
clean base. Simpler, but it discards ~43 sound `dicen que` exercises and pays to regenerate
the share of them we want to keep. Backfill-then-demote-surplus is preferred.

## Out of scope

- Generalizing `COVERAGE_AXIS_VALUES` into per-point value sets (a real `construction`
  coverage axis with pool-status reporting and scheduler water-fill participation). The
  deficit-ranked picker buys the enforcement; the reporting can follow if it is missed.
- Carrying both a construction variant and a lexical seed on the same draft.
- An LLM-assisted `propose:construction-variants` CLI mirroring `propose:coverage-spec`.
  Worth building if the ~22-point authoring pass proves the bottleneck.
- The translation source-frame / subject-person monotony noted above.
