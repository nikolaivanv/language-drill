# es-b1-collective-agreement — construction-variant repass (2026-09-13)

Phases 4–8 of [`docs/runbooks/pool-diversity-sweep.md`](../runbooks/pool-diversity-sweep.md)
for the variants added in #724. Defect class **#1, construction collapse**.

## What was wrong

The point's description and `examplesPositive` name two constructions — singular
agreement after a collective noun (`la gente dice`) and **plural** agreement after
collective + `de` + plural noun (`la mayoría de los vecinos creen`). It declared no
`constructionVariants`, so nothing made the generator produce the second one.

Measured on prod over 100 approved rows: the partitive half was at **0/100**, and
every one of the 50 cloze `correctAnswer` values was a 3rd-person singular verb.
The pool therefore trained "collective ⇒ singular" as an *unconditional* rule.

The subject frame had also collapsed lexically — `todo el mundo` held 31/50 cloze
and 47/50 translation rows. `audit:collapse` had reported the translation cell on
the answer-surface signal in both the 2026-08-11 baseline and the 2026-08-14
post-repass run (`todo el` at 96%) and it was never adjudicated into
`collapse-dismissals.ts`.

## Gates

| Gate | Evidence |
|---|---|
| **A — deploy before demote** | Production Deploy `success` on `2c2ffa7e` (#724) |
| **B — capture before write** | `d27d1c8d` pushed to `origin` before either `--apply` |

Snapshot: Neon branch `br-shiny-field-ane9f7n5`, forked from `production` at
`0/1A4A5D90`. **Still live — delete once the cells have refilled.**

## Label (phase 5)

`backfill:variant-seeds --grammar-point es-b1-collective-agreement --language es`,
run `collective-agreement-label-2026-09-13`, $0.13, **99 of 100 rows labelled**.

This step is not optional and had to precede the demotion. Every row carried a
`seedWord`, but they were frequency lemmas (`academia`, `sindicato`, `borde`), and
`pickVariantSeeds` counts only declared variant ids — so it read **coverage 0 for
all four variants** and would have answered by spreading drafts evenly by share,
refilling the two buckets that were already over-represented.

One translation row kept its `ignorar` lemma (classifier declined it); it reads as
uncovered, which is harmless at n=1.

## Demotion (phase 7)

`--reason pool-hygiene`, **never `quality`**: these rows are individually correct
and answerable, so learners keep credit for past attempts on them. Selection was
oldest-first *within the `todo-el-mundo-singular` bucket*, via `--ids-file` — the
cell filters alone cannot express "the excess of one variant".

| Cell | variant | before | demoted | after | quota |
|---|---|---|---|---|---|
| cloze | `todo-el-mundo-singular` | 31 | **14** | 17 | 17 |
| translation | `todo-el-mundo-singular` | 47 | **35** | 12 | 13 |

Untouched: `lexical-collective-singular` (16 cloze / 2 translation),
`collective-predicate-adjective-singular` (3 cloze), and the two `flagged` cloze
rows.

## Verification (phase 8)

Three-way reconciliation against the snapshot:

```
snapshot approved            100  (50 cloze + 50 translation)
now approved                  51  (36 cloze + 15 translation)
demoted this run              49  (pool-hygiene, this point)
                        51 + 49 = 100 ✓
```

`demoted_other = 0` in every variant bucket — no pre-existing demotion was
disturbed.

Headroom now matches the deficits almost exactly, which is the point of the
sizing: cloze frees 14 against deficits of 14 (lexical +9, predicate-adj +5),
translation frees 35 against 35.5 (lexical +16.75, predicate-adj +6.25,
partitive +12.5).

## Phase 9 — still owed

Nightly generation is **paused** (#718, 2026-09-06), so the 49 freed slots will
not refill until it is switched back on. Until then the point serves 51 rows
instead of 100 — a real dip, though the surviving half is the more diverse half.

After the refill:

- `pnpm audit:collapse --language es --cefr B1 --grammar-point es-b1-collective-agreement`
  — confirm the answer-surface concentration is gone.
- Confirm `partitive-de-plural-agreement` is actually producing in translation. It
  is scoped out of cloze on purpose (free alternation with the singular; see #724),
  so a `0 realized` reading for it in the **cloze** cell is correct, not a finding.
- Watch `variant_outcome` for it. If it lands 0 approved over ≥5 requested,
  give-up retires it and the directive needs rework rather than another repass.
