# DE sentence-construction scene-collapse demotion — run record, 2026-08-24

The last piece of the DE pool work, and a **different defect class** from the
construction-variant sweep (#695–#697).

## Why this is not part of the variant sweep

DE needed no separate SC *construction-coverage* pass, unlike ES and TR: #691 put
`sentence_construction` in the audit's `IN_SCOPE_TYPES` and #687 gave
`backfill:variant-seeds` SC support, so SC went through the main audit and repass.
Of the 13 DE SC cells, **7 (238 rows) are on variant-declaring points** and were
labelled and demoted there.

The remaining **6 cells (184 rows) declare no `constructionVariants`**. Their
diversity mechanism is frequency seeding, not variants, and what ails them is
**scene monotony** — every exercise happening in the same little world — rather
than a missing construction. `audit:constructions` is structurally blind to it:
it measures which constructions appear, not whether they all appear in the same
scene.

## Evidence

| cell | rows | seeded | top opening word |
|---|---|---|---|
| `de-a2-dass-clauses` | 30 | **0** | `ich` 67% |
| `de-b1-subordinate-conjunctions` | 50 | 9 | `obwohl` 50% |
| `de-a2-praeteritum-modals` | 29 | 9 | `ich` 48% |
| `de-a2-passive-present` | 30 | 7 | `die` 47% |
| `de-a1-modal-verbs-present` | 20 | 3 | `ich` 40% |
| `de-a1-present-regular` | 25 | 6 | `wir` 20% |

`de-a2-dass-clauses` is the purest case at **0 of 30 seeded** — every row predates
#652. Sampling it: roughly 13 of 30 sentences are about the weather, the matrix
verb is almost always *denken/glauben/sagen*, and there are near-duplicates
(`ich denke, dass die Suppe heute sehr lecker ist` /
`ich glaube, dass die Suppe heute sehr lecker ist`). That is the same signature as
`es-b1-relative-clauses` running 41/46 mentioning a café.

**Five of the six sat exactly at target** (20/20, 25/25, 30/30, 30/30, 50/50), so
they could never regenerate and #652's seeding could never reach them — the same
"ships inert" problem the variant work had. Demotion is what frees the slots.

## Precondition, checked before writing

The standing warning is that demoting a collapsed SC cell **before its seeding
fix is deployed** just refills from the old unanchored prompt and re-freezes the
collapse — "the right fix is seeding, not demotion" (#648).

Verified on main: `seedKindFor` routes an SC cell whose point declares no
variants to `'frequency'`, and that branch has been live since #652 (2026-08-14),
well before the `10457699` Production Deploy. So the freed slots will refill
under frequency seeding.

## Selection — no content filter needed, and that is verifiable

In **every one of the six cells** the first seeded row appears only *after* all
unseeded rows — `first_seeded_pos == unseeded + 1` exactly, in all six. Seeded
rows are strictly newer than unseeded ones.

So a plain oldest-first `--limit` at 50% demotes **purely legacy unseeded rows**
and preserves every frequency-seeded (already diverse) row. Confirmed in the
capture: **0 seeded rows included**, and `seeded_now` after the run (3, 6, 0, 7,
9, 9) matches the pre-demotion seeded counts exactly.

This is the opposite situation from `de-b1-relative-pronouns`, where a bare
`--limit` would have destroyed an irreplaceable minority row and a precise
`--content-ilike` was required. Which selection is safe is a per-cell fact worth
checking, not a default.

## Result

**91 rows demoted**, `--reason pool-hygiene` throughout — never `quality`, so
learners keep credit and no `backfill:mastery` rebuild is needed.

```
captured 91 / demoted 91 / still-approved 0
DE pool-hygiene 1962 -> 2053   (+91, exactly the capture)
DE 'quality'      17 before, 17 after — unchanged
```

| cell | before → after | target | free slots | seeded rows kept |
|---|---|---|---|---|
| `de-a1-modal-verbs-present` | 20 → 10 | 20 | 10 | 3 |
| `de-a1-present-regular` | 25 → 13 | 25 | 12 | 6 |
| `de-a2-dass-clauses` | 30 → 15 | 30 | 15 | 0 |
| `de-a2-passive-present` | 30 → 15 | 30 | 15 | 7 |
| `de-a2-praeteritum-modals` | 29 → 15 | 30 | 15 | 9 |
| `de-b1-subordinate-conjunctions` | 50 → 25 | 50 | 25 | 9 |

**92 slots of headroom**, all of which will regenerate under frequency seeding.

## What is NOT done

1. **Nothing refills this yet** — pre-generation is still paused (#672). This was
   the last DE pool action; the resume is now the only thing outstanding for DE.
2. **No outcome is verified.** The confirming check is `audit:collapse` after the
   refill, looking at its stem-monotony signal for these six cells — that is the
   signal that measures this defect, not `audit:constructions`.
3. **`de-a2-dass-clauses` is worth re-checking specifically.** It refills from a
   base of 15 rows that are *all* unseeded and weather-heavy, so its
   `_dedupKey` history may still steer new drafts; if it re-collapses, the
   remaining 15 need demoting too.
4. **The eleven RISK-axis DE points** remain the only other open DE item
   (four needing `coverageSpec.appliesTo`).
