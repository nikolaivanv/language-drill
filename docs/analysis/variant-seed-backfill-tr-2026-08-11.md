# Variant-seed backfill — TR slice, production

_First production run of `pnpm backfill:variant-seeds`. Scoped to **Turkish only**
as a deliberate first slice: prove the mechanism and the closed loop on one
language before committing ES and DE. Run against the production Neon branch
(`br-green-waterfall-ancrvpr5`) on 2026-08-11._

**Rollback:** Neon snapshot `pre-variant-seed-backfill-tr-2026-08-11`
(`br-holy-flower-andl41vv`, taken from production at LSN `0/14936C50`), plus the
per-row artifact `packages/db/backfill-runs/prod-tr-2026-08-11.json`. Restore
surgically with
`pnpm backfill:variant-seeds -- --revert backfill-runs/prod-tr-2026-08-11.json --apply`.

## The undo path was proven before the write, not after

The rehearsal on the dev branch applied 272 rows and then reverted them. Six rows
were sampled by primary key and compared against the artifact's `oldSeedWord`:
all six carried their original frequency words again (`belirsiz`, `Hollywood`,
`William`, `motor`, `sıradan`, `müze`), not the applied variant id. An untested
rollback is not a rollback, so this was the gate for touching production at all.

## What ran

`--language TR --apply --snapshot br-holy-flower-andl41vv --max-cost-usd 2`

- 4632 rows scanned → **6 cells** with eligible rows (~220 in-scope rows)
- **218 rows labelled**, cost **$0.28**
- **2 in-scope rows left unlabelled** (0.9%) — the classifier declining to guess,
  which is the designed behaviour, not a failure

Per-cell distribution — note every cell spans several variants rather than
collapsing onto one, which is what tells us the classifier is discriminating
rather than defaulting:

| cell | assignment |
|---|---|
| `TR:A2:cloze:tr-a2-gibi-kadar` | `kadar-equality` 22, `gibi-similarity` 8 |
| `TR:A2:translation:tr-a2-gibi-kadar` | `kadar-equality` 24, `gibi-similarity` 6 |
| `TR:A2:cloze:tr-a2-reported-speech` | `diye-reporting-verb` 23, `diye-thought-reason` 3, `reported-command-masini` 2, `integrated-digini-soyledi` 1 |
| `TR:A2:translation:tr-a2-reported-speech` | `diye-reporting-verb` 28, `direct-quote-dedi` 1, `reported-command-masini` 1 |
| `TR:B1:cloze:tr-b1-olarak` | `role-of-person` 26, `classify-or-use-as` 21, `derived-adjective-adverb` 2 |
| `TR:B1:translation:tr-b1-olarak` | `role-of-person` 30, `classify-or-use-as` 20 |

## Closed-loop check — `audit:collapse` before and after

The acceptance gate was: **does `unrecognizedSeedCount` collapse?** It did.

| metric (TR) | before | after |
|---|---|---|
| unrecognized-seed rows | **246** across 7 cells | **28** across 3 cells |
| …of which out of scope by design | — | **26** in one `sentence_construction` cell |
| **in-scope residue** | 246 | **2** |
| cells with a declared-but-unrealized mechanism | 54 | 54 |
| variant-spread-uneven | 0 | 0 |

Per cell, the composition moved substantially — `underMin`/`unrecognized`/`overQuota`:

```
TR:A2:cloze:tr-a2-gibi-kadar          4/30/0 -> 2/0/2
TR:A2:cloze:tr-a2-reported-speech     5/30/0 -> 4/1/1
TR:A2:translation:tr-a2-gibi-kadar    4/30/0 -> 2/0/1
TR:A2:translation:tr-a2-reported-speech 5/30/0 -> 4/0/1
TR:B1:cloze:tr-b1-olarak              4/50/0 -> 2/1/2
TR:B1:translation:tr-b1-olarak        4/50/0 -> 2/0/2
```

The 26 residual rows sit in a `sentence_construction` cell. That is correct: only
cloze and translation carry a construction-variant seed, so the backfill does not
touch SC by design.

## A real weakness this exposed in `audit:collapse`

**The two headline counters did not move at all**, despite 218 rows being
relabelled and every affected cell improving. Both are explicable, and both are
reporting defects rather than backfill failures:

1. **"Cells with a declared-but-unrealized mechanism" stayed at 54.** That bucket
   is a boolean over `shortfalls ∨ underMin ∨ unrecognizedSeedCount`. The cells
   still qualify — via `underMin` now rather than `unrecognizedSeedCount` — so the
   count is unchanged even though `unrecognized` fell from 246 to 2 and `underMin`
   fell per cell (4→2, 5→4). **A reader watching that number would conclude
   nothing had happened.**
2. **"Variant-spread-uneven" stayed at 0.** `overQuota` genuinely became non-zero
   on every affected cell (0→1 or 2) — real imbalance became visible for the first
   time, exactly as predicted — but the bucket is defined as
   `overQuota ∧ ¬unrealized`, and these cells remain `unrealized` via `underMin`,
   so the imbalance is masked.

Neither invalidates the backfill; both mean the audit's summary is a poor progress
indicator. Worth a follow-up: report cells-improved or row-level movement
alongside the boolean cell counts, so a run like this is visible in the headline.

## Also worth knowing

Every affected cell now has variants sitting below `MIN_PER_VARIANT` — e.g.
`tr-a2-reported-speech` has four (`direct-quote-dedi`,
`integrated-digini-soyledi`, `reported-command-masini`, `diye-thought-reason`).
That is not a backfill defect; it is the true state of the pool becoming
measurable for the first time. Those variants are genuinely under-drilled and are
what regeneration should target once nightly generation resumes.

## Next

- ES and DE remain unbackfilled (~1,700 rows). This run is the template.
- Do **not** demote anything yet: nightly generation is still paused, so a demoted
  cell has nothing refilling it.
