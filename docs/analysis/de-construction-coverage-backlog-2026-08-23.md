# DE construction-coverage backlog — 2026-08-23

The DE counterpart of `es-construction-coverage-backlog-2026-08-19.md` and
`tr-construction-coverage-backlog-2026-08-20.md`, and the last of the three
languages to be swept. Generated from `pnpm audit:constructions --language DE`,
run against **production** in per-CEFR chunks (`de-a1-` / `de-a2-` / `de-b1-` /
`de-b2-2026-08-23`, archived in `docs/analysis/run-artifacts/`), prompt
`construction-coverage@2026-08-19`, seed `default`, sample cap 24.

Scope on prod: **104 grammar points**, 196 cloze / translation /
sentence_construction cells, **7,497 approved rows**.

| level | points enumerated | cells | rows sampled | findings | suspect | errors | cost |
|---|---|---|---|---|---|---|---|
| A1 | 19 / 19 | 41 | 787 | 21 over 15 pts | 2 | 0 | $1.02 |
| A2 | 31 / 31 | 55 | 1,276 | 30 over 20 pts | 1 | 0 | $1.66 |
| B1 | 26 / 27 | 54 | 1,228 | 34 over 20 pts | 1 | 1 enum | $1.70 |
| B2 | 27 / 27 | 46 | 1,062 | 36 over 26 pts | 0 | 0 | $1.70 |
| **total** | **103 / 104** | **196** | **4,353** | **121 over 81 pts** | **4** | **1** | **$6.08** |

This is substantially larger than TR (76 findings over 53 points) — DE has more
points (104 vs 89) and a larger pool (7,497 vs 5,424 rows).

**SC was covered in the same pass.** `IN_SCOPE_TYPES` gained
`SENTENCE_CONSTRUCTION` in #691, so unlike ES and TR — which each needed a
separate SC follow-up run — the DE sweep covered all three types in one go.

## Three things that differ from the ES and TR sweeps

### 1. The `decideCoverageTargets` zip bug is already FIXED — but DE's pool is full of its residue

Both prior backlogs list the zip bug as open. It was **fixed in PR #690**
(`c47a5ff0`, 2026-08-21), which replaced the index-wise zip of per-axis
water-filled sequences with an enumeration of the cartesian product, tie-broken
on least-used combination. Per-axis deficit stays primary, so single-axis specs
are unchanged.

DE's pool was generated under the old code and **still shows the diagonal**,
because generation has been paused since #672 and nothing has refilled it. The
sharpest case is `de-b1-relative-pronouns`, whose spec is a literal 2×2 — case
`{dative, genitive}` × number `{singular, plural}` — so `lcm(2,2) = 2` predicts
exactly 2 of the 4 combinations:

| cell | dative+sg | genitive+pl | everything else |
|---|---|---|---|
| translation | 25 | 25 | **0** |
| cloze | 23 | 23 | 3 |

99 of 100 rows sit on two combinations. The two never-requested cells are
`dative+plural` (**denen**) and `genitive+singular` (**dessen/deren**) — the two
forms this B1 point exists to teach, given that its A2 sibling
`de-a2-relative-clauses-nom-acc` owns nominative and accusative.

Verified **not** a tagging gap: `coverage_tags` are 99–100% complete on every
one of the six multi-axis DE points, so the counts above are the pool, not a
measurement artifact. (That check is why the `de-b1-adjectives-as-nouns` and
`de-b1-comparison-attributive` pools — which are healthy, 6 of 6 combinations —
could be cleared rather than flagged.)

**Consequence for this backlog:** the remedy is demote + regenerate, not a code
fix. Post-#690 the controller will spread across all four combinations by
itself. `de-b1-relative-pronouns` therefore belongs in the demotion pass even
though it declares no variants.

### 2. DE is declension-heavy, so the spec/variant collision surface is much wider

41 of 104 points carry a `coverageSpec`. Split by the working rule inherited
from TR:

| axis class | count | rule |
|---|---|---|
| `person` / `polarity` | 18 | orthogonal to a sub-construction — author alongside, keep the spec |
| `case` / `number` / `comparison` | 23 | often *is* the dimension the variants encode — check per point |

Of the 23 RISK-axis points, **4 are `conjugationSuitable`**
(`de-a2-adjective-declension-{indefinite,definite,zero}`, `de-b1-n-declension`),
so the spec cannot be deleted — `assertCurriculumInvariants` requires a
person/case/number axis on such a point. Those need `coverageSpec.appliesTo`
scoping (added in #690), not deletion. The remaining 19 are spec-deletable if a
variant list supersedes the axis.

All 11 pre-existing DE variant points carry **no** `coverageSpec` — the same
avoidance the #631 authors practised on ES and TR.

### 3. The audit's `coverage-spec` proposals are structurally invalid for this codebase

Every finding routed to `mechanism: coverage-spec` emits a snippet shaped like

```ts
coverageSpec: { axes: [{ id: "construction", values: [...] }], floors: [...] }
```

That is not the `CoverageSpec` type. The real shape is
`{ axes: [{ name: CoverageAxis, floors: Record<value, number> }] }`, and
`CoverageAxis` is a closed set of seven: `person`, `number`, `case`,
`wordClass`, `polarity`, `sentenceType`, `comparison`. "Construction",
"plural-formation class" and "stem class" are **not expressible as axes at all**.

So a `coverage-spec` routing must be re-read, never pasted. Where the flagged
dimension is not one of the seven, the mechanism is `constructionVariants` or
the finding is rejected. This affects `de-a1-present-regular`,
`de-a1-plural-formation`, `de-b1-modal-particles-basic` and both
`de-a2-adjective-declension-*` findings.

## The enumeration bug is now confirmed cross-language

`de-b1-reason-consequence-connectors` was never examined — both attempts failed
with `id 'nämlich-medial-reason' must be kebab-case`. This is the **third**
occurrence of the same fault and the second language: TR lost
`tr-a1-numbers-ordinals` (`ordinal-suffix-incI`) and
`tr-b2-compound-past-hikaye` (`past-necessitative-maliydı`) to it.

The enumerator names constructions after target-language material, and the
kebab-case validator rejects any non-ASCII letter — `ä`, `ı`, `İ`. Three points
across two languages are now unexamined for this reason. The fix belongs in the
tool (transliterate before validating, or widen the pattern to Unicode letters),
not in the curriculum.

## Findings by disposition

121 findings triaged into four buckets. Counts are cells, not points; a point
can appear in more than one bucket.

### Bucket A — author new `constructionVariants` (the bulk)

Points with no variant list whose pool has collapsed onto a subset of the
constructions their own description claims. Highlights, worst first:

| point | what the pool shows |
|---|---|
| `de-a1-v2-word-order` | **SVO baseline 0%** in both cells — cloze 19/20 and translation 20/20 are a fronted adverb. German's most basic word order is never drilled |
| `de-b1-plusquamperfekt-nachdem` | cloze **24/24**, SC **24/24**, translation 22/24 all `nachdem`+Plusquamperfekt; the perfekt/present variant and the `hatte` vs `war` auxiliary choice both 0 |
| `de-b1-n-declension` | cloze **23/23** and translation **23/23** the plain oblique `-en`; `Herr → Herrn` 0 and the `-ns` genitive name subtype 0 |
| `de-b1-statt-ohne-zu` | cloze **24/24** the zu-infinitive; the `statt/ohne dass` finite clause 0 |
| `de-b2-consecutive-connectors` | translation **24/24** `so … dass`; `sodass`, main-clause inversion and `zu … als dass` all 0 |
| `de-b2-temporal-connectors` | translation **24/24** a prepositional phrase; every temporal *clause* 0 |
| `de-a2-seit-present` | cloze **12/12** the ongoing present; the negated perfekt 0 |
| `de-a1-modal-verbs-present` | each cell collapsed onto a *different* construction — cloze 60% irregular-singular with verb-bracket 0, SC 95% verb-bracket with irregular-singular 0, translation 95% irregular-singular with verb-bracket 0 |
| `de-a1-present-irregular` | `werden` 0 and `wissen` 0 in cloze; `sein` 0 and `werden` 0 in translation |
| `de-a1-temporal-prepositions` | `für`+acc 0, bare accusative 0, `von … bis` 0, `im`+month 1 |
| `de-b1-zu-infinitive` | `zu` after a noun 0, `brauchen … nicht zu` 0, bare infinitive 0 — in both cells |
| `de-b2-passive-alternatives` | `man` 0, `-bar` 0, `bekommen`-passive 0, subjectless dative 0/1 |
| `de-b2-subjective-modals` | 22/24 one epistemic frame; `dürfte` 0, `will` self-claim 0, `soll` hearsay 1 |

Plus `de-a1-articles-nominative`, `de-a1-questions`, `de-a1-zero-article`,
`de-a1-numbers-ordinals`, `de-a1-plural-formation`, `de-a2-comparison`,
`de-a2-demonstratives-welch`, `de-a2-destination-prepositions`,
`de-a2-indefinite-pronouns-basic`, `de-a2-measure-expressions`,
`de-a2-past-participle-formation`, `de-a2-quantifiers-other`,
`de-a2-verb-preposition-complements`, `de-a2-weil-deshalb`,
`de-a2-wissen-kennen`, `de-a2-dative-accusative-objects`,
`de-b1-adjectives-as-nouns`, `de-b1-futur-i`, `de-b1-genitive`,
`de-b1-hin-her`, `de-b1-konjunktiv-ii-past`, `de-b1-passive-werden`,
`de-b1-two-part-conjunctions`, `de-b1-articles-use`,
`de-b1-subordinate-conjunctions`, `de-b1-dass-clause-perfekt`,
`de-b1-progressive-equivalents`, `de-b2-concessive-connectors`,
`de-b2-dass-equivalents`, `de-b2-fixed-prepositions`,
`de-b2-indefinite-pronouns`, `de-b2-konjunktiv-i`, `de-b2-konjunktiv-ii`,
`de-b2-modal-perfect-word-order`, `de-b2-nominalization`,
`de-b2-verb-prefixes`, `de-b2-word-formation`, `de-b2-zustandspassiv`,
`de-b2-mittelfeld-word-order`, `de-b2-modal-particles-advanced`,
`de-b2-extended-attributes`.

### Bucket C — repass-only: already declares the flagged construction

These points **already declare** the construction the audit flagged. Their pools
predate the declaration, so they need only the label + demote repass — no
authoring. This bucket is large for DE because the #631 batch declared 11 points
and only 3 of them were ever demoted (2026-08-10).

| point | flagged construction(s), all already declared | pool |
|---|---|---|
| `de-b2-causal-connectors` | `weil-da`, `denn`, adverbial `deshalb` — all 0 | translation **24/24** `wegen/aufgrund`; seedWord confirms **49/49** |
| `de-b2-modal-connectors` | `dadurch-dass`, `durch`, `ohne-dass` | translation 22/24 `indem`; seedWord **46/49** |
| `de-b2-conditional-connectors` | `es-sei-denn`, `sonst`, `wenn/falls` | cloze 16/24 `bei`+dative, translation 15/24 verb-first |
| `de-b2-relatives-advanced` | `wor`+preposition, `wo`-relative | cloze 17/24 `was`-relative |
| `de-a2-nicht-sondern` | `aber`-contrast, `nicht nur … sondern auch` | translation **24/24**; seedWord **28/28** |
| `de-a2-lassen` | `lass uns` suggestion | translation 12/20 permissive; seedWord 25/29 |
| `de-a2-wenn-als` | `wenn` present/future condition | translation 15/24 `als`; seedWord 26/29 |
| `de-b1-um-zu-damit` | `um … zu` same-subject (declared at share 2) | translation 22/24 `damit` — its **cloze** cell was demoted in 2026-08-10 and is now healthy (15/16/18); translation never was |
| `de-b1-es-expressions` | `es-placeholder-clause` (declared) | cloze 20/23 fixed expressions |

`de-b2-adversative-connectors` raised no finding this run — every declared
construction cleared 5% — but its seedWord distribution is still 37/48 and 38/49
on `waehrend-adversative-clause`, so it belongs in the demotion sizing anyway.

### Bucket B — top up an existing variant list

- `de-b1-es-expressions` — `es-disappears-on-fronting` is flagged at 0 and is
  **not** among the five declared variants. Add as a sixth.

### Bucket D — rejected or deferred, with reasons

| point | why |
|---|---|
| `de-a1-es-gibt` | `gibt-invariable` is a **property of every one of the 12 rows**, not a disjoint alternative — the same non-disjoint-property class TR rejected for the `-n-`/`-y-` buffers. A variant directive cannot ask for it |
| `de-a1-imperative` | `imperative-du-stem-change` is a *lexical* constraint inside person=2sg, and the point's `person` spec (floors 2sg/2pl/3pl/1pl) is **working** — the pool is 4/5/4/5 balanced across persons. A du-imperative variant would contradict a `person: 3pl` target in the same prompt. Needs curated seed verbs, not variants |
| `de-a1-present-regular` | `s-sz-z-stem-du-contraction` is likewise a stem class inside 2sg. Borderline — the three stem classes *are* disjoint, so a variant is expressible; deferred pending the same seed-verb question as `de-a1-imperative` |
| `de-a1-noun-gender` | both cells `enumeration-suspect` (9/20 and 10/20 unresolved) — no finding raised. Correct behaviour; the construction list was wrong |
| `de-a2-weil-deshalb:sentence_construction` | `enumeration-suspect`; the cloze and translation findings on the same point stand |
| `de-b1-um-zu-damit:sentence_construction` | `enumeration-suspect` — but see the note below, this cell has an independent problem |
| `de-b1-reason-consequence-connectors` | never examined — kebab-case enumeration fault (`nämlich-medial-reason`) |

### Flagged for review, not actioned: `de-a2-adjective-declension-definite`

Its `number` axis declares a floor for **`plural` only**, and
`orderedFloorValues` filters to values present in `floors` — so a singular row
can never be requested, before or after the #690 fix. The pool is
correspondingly **100% plural across all 89 rows** in all three cells.

The audit found the same defect from the construction side, independently:
translation is **24/24 `weak-adj-en-elsewhere`**, with the weak `-e` ending in
nominative singular at 0 and in feminine/neuter accusative singular at 0.

The plural-only floor was deliberate — the 2026-07-17 authoring note explains
that number floors were chosen "where gender — not a coverage axis — is the
unpinnable residual", and plural is where the definite adjective ending is
uniform. But the consequence is that the pool never drills the `-e` ending at
all, which is half of the paradigm this A2 point exists to teach. The `-e`
ending in nominative singular is in fact uniform across all three genders, so it
*is* pinnable.

Recommendation: add a `singular` floor. This is a spec change on a
`conjugationSuitable` point, so the spec stays and is widened — it is not a
variant-authoring decision, and it is called out separately here rather than
folded into bucket A.

## Authoring outcome (batches 1–5, same branch)

**56 of the 74 points with findings now declare `constructionVariants`**, up
from the 11 that #631 left. DE goes from 11 to 52 variant-declaring points
overall (the difference is points that already declared and raised no finding
this run).

| batch | level | points | commit |
|---|---|---|---|
| 1 | A1 | 7 | `Declare the constructions seven collapsed DE A1 points never generated` |
| 2 | A2 | 10 | `… ten collapsed DE A2 points …` |
| 3 | B1 | 11 | `… eleven collapsed DE B1 points …` |
| 4 | B2 | 13 | `… thirteen collapsed DE B2 points …` |
| 5 | mixed | 6 | `Declare six more DE points, and keep every cell target in the allow-list` |

One `coverageSpec` was removed (`de-b1-schon-noch-erst`, polarity) and three
`targetOverride`s raised to cover `MIN_PER_VARIANT`.

### The 18 points deliberately left unauthored

**Seven rejected on the record**, each for a reason that generalizes:

| point | why |
|---|---|
| `de-a1-es-gibt` | `gibt-invariable` is a property of all 12 rows, not a disjoint alternative |
| `de-a1-modal-verbs-present` | classifier artifact — `verb-bracket` and `irregular-singular` co-occur in nearly every modal sentence, so the forced single label flipped per cell (12/0, 0/19, 19/0) |
| `de-b1-subordinate-conjunctions` | same artifact — a fronted subordinate clause is both verb-final and inverted (17/17) |
| `de-a2-reflexive-verbs` | `reciprocal-plural-sich` needs a plural subject, contradicting a `person: 1sg` target from its existing spec |
| `de-a1-imperative` | `du`-stem-change is lexical inside person=2sg, and the person spec is demonstrably working (4/5/4/5 balanced) |
| `de-a1-present-regular` | `s/ß/z`-stem contraction is a stem class inside 2sg; deferred with the above |
| `de-a1-numbers-ordinals` | carries `selfRevealingElicitation`, mutually exclusive with variants — the curriculum invariant caught it |

**Eleven blocked on the RISK-axis check.** Every one carries a `case`, `number`
or `comparison` spec, the axis class that often *is* the dimension its variants
would encode:

`de-a2-adjective-declension-definite`, `de-a2-adjective-declension-indefinite`,
`de-a2-comparison`, `de-a2-demonstratives-welch`,
`de-a2-indefinite-pronouns-basic`, `de-a2-quantifiers-other`,
`de-b1-adjectives-as-nouns`, `de-b1-n-declension`, `de-b1-passive-werden`,
`de-b2-extended-attributes`, `de-b2-indefinite-pronouns`.

Four of these are `conjugationSuitable` (`adjective-declension-*`,
`n-declension`), so their spec cannot be deleted — the invariant requires a
person/case/number axis for the conjugation cell to seed from. They need
`coverageSpec.appliesTo` scoping (the #690 mechanism, added for
`tr-a1-ablative-dative`), which is a per-point judgement rather than a batch
edit. `de-b1-n-declension` is the clearest candidate: its pool is 23/23 and
**23/23** on the plain oblique `-en`, with `Herr → Herrn` at 0.

### One trap worth recording

`admin.test.ts` asserts that every cell target resolves to a value in a literal
allow-list (`[5, 6, 8, 10, 12, 15, 16, 20, 24, 25, 30, 44, 48, 50, 75]`). Seven
variants on an A1 cell resolve to 28, which is not in it. Batch 1 shipped that
regression and the lambda suite **passed anyway**, because a stale
`@language-drill/db` dist meant the lambda tests never saw the curriculum
change. It surfaced only after a rebuild. The inverse of the usual stale-dist
trap: stale dist can fake a PASS, not just a failure. Batch 5 trims those two
lists to six variants and verifies every DE cell target against the allow-list
programmatically.

## What is NOT done

1. **The eleven RISK-axis points** described above, plus the `appliesTo` work
   the four `conjugationSuitable` ones need.
2. **The prod repass — the whole point of the exercise, and it is gated on
   merge + deploy.** Per the ES and TR records the order is: merge, confirm the
   Production Deploy is green (the generation Lambda must have the variant lists
   live BEFORE headroom is opened), snapshot a Neon branch, run
   `backfill:variant-seeds --apply --name <run>`, archive the artifact outside
   the gitignored `packages/db/backfill-runs/`, capture row ids into
   `docs/analysis/`, then `demote:pool --reason pool-hygiene` — **never
   `quality`**, which revokes learners' credit.

   Sizing, measured read-only against prod 2026-08-23: the 11 pre-existing
   variant points hold 916 approved cloze/translation rows and are already
   **96% variant-labelled** (65 rows outstanding, 47 of them the single
   `de-b1-um-zu-damit:sentence_construction` cell). So labelling cost for those
   is near zero; the cost comes from the 45 newly-declared points. At the ES
   measured rate (~$0.00145/row) relabelling the affected DE pool is roughly
   **$8–10**.

   A `push-prompts` step is **not** needed: these batches touch only `de.ts`,
   no prompt file and no `*_PROMPT_VERSION`. Variant lists are curriculum data
   injected into the per-draft user prompt from deployed code, not a
   Langfuse-hosted body — the same reasoning recorded for the TR repass.

3. **Bucket C demotion is large and partly independent of the new authoring.**
   Nine pre-existing variant points are still collapsed and need only the
   demote half of the repass — `de-b2-causal-connectors:translation` is
   **49/49** on one variant, `de-b2-modal-connectors:translation` 46/49,
   `de-a2-nicht-sondern:translation` 28/28. `de-b1-relative-pronouns` belongs in
   the same demotion pass for the zip-residue reason above, though it declares
   no variants.
4. **Three points remain unexamined across the three languages** for the
   kebab-case enumeration fault; DE contributes `de-b1-reason-consequence-connectors`.
5. **Nothing is verified as an outcome.** As with ES and TR, "pools become
   diverse" is unmeasurable until regeneration resumes, and nightly
   pre-generation is still PAUSED (#672).

## Operational note

Unlike TR — whose single full-language sweep hung at 79 minutes with no output —
the four DE per-CEFR chunks were run **concurrently** and all completed, the
longest in about 25 minutes. The CLI still logs nothing between startup and its
final summary, so progress was confirmed out-of-band by watching CPU time and
established sockets per PID. A progress line in the CLI remains worth adding.
