# Variant-seed backfill — production, all three languages

_First production use of `pnpm backfill:variant-seeds`. Run in two passes against
the production Neon branch (`br-green-waterfall-ancrvpr5`): Turkish as a
deliberate first slice on 2026-08-11, then Spanish and German on 2026-08-12 once
the mechanism and the closed loop had been proven on one language._

**Total: 1,766 rows labelled for $2.33.** Unrecognised-seed rows across the whole
pool fell from **1,721 to 173**.

## Rollback

| pass | snapshot branch | artifact |
|---|---|---|
| TR | `pre-variant-seed-backfill-tr-2026-08-11` (`br-holy-flower-andl41vv`) | `backfill-runs/prod-tr-2026-08-11.json` |
| ES + DE | `pre-variant-seed-backfill-esde-2026-08-12` (`br-tiny-heart-anm3358w`) | `backfill-runs/prod-es-2026-08-12.json`, `prod-de-2026-08-12.json` |

Surgical restore:
`pnpm backfill:variant-seeds -- --revert backfill-runs/<artifact>.json --apply`.
The ES/DE snapshot was taken fresh rather than reusing the TR one, because
restoring the older branch would also have undone the TR pass.

## The undo path was proven before the first write, not after

The dev rehearsal applied 272 rows and reverted them. Six rows were sampled by
primary key and compared against the artifact's `oldSeedWord`: all six carried
their original frequency words again (`belirsiz`, `Hollywood`, `William`,
`motor`, `sıradan`, `müze`), not the applied variant id. An untested rollback is
not a rollback, so this was the gate for touching production at all.

## What ran

| pass | rows labelled | cost |
|---|---|---|
| TR (`--language TR`) | 218 | $0.28 |
| ES (`--language ES`) | 876 | $1.17 |
| DE (`--language DE`) | 672 | $0.88 |
| **total** | **1,766** | **$2.33** |

Every affected cell spans several variants rather than collapsing onto one, which
is what shows the classifier is discriminating rather than defaulting. Examples:

- `TR:A2:cloze:tr-a2-reported-speech` → `diye-reporting-verb` 23,
  `diye-thought-reason` 3, `reported-command-masini` 2,
  `integrated-digini-soyledi` 1
- `TR:B1:cloze:tr-b1-olarak` → `role-of-person` 26, `classify-or-use-as` 21,
  `derived-adjective-adverb` 2
- `ES:B2:*:es-b2-verbs-of-change` → `llegar-a-ser-slow-outcome` 33,
  `convertirse-en-transformation` 7, `volverse-involuntary-change` 5,
  `quedarse-state-left-by-event` 2, `hacerse-voluntary-conversion` 1,
  `ponerse-temporary-state` 1

## Closed-loop check — `audit:collapse` before and after

The acceptance gate was: **does `unrecognizedSeedCount` collapse?** It did, in
both passes.

| language | unrecognised rows | cells affected | cells with `overQuota` |
|---|---|---|---|
| ES | 956 → **80** | 26 → 14 | 4 → **30** |
| DE | 737 → **65** | 18 → 8 | 6 → **22** |
| TR | 246 → **28** | 7 → 3 | 0 → **10** |
| **all** | **1,721 → 173** | | |

The arithmetic reconciles exactly: ES+DE had 1,693 unrecognised rows before,
1,548 were labelled, 145 remain.

### The 173 residue is mostly not a residue

- **73 rows are out of scope by design** — they sit in `sentence_construction`
  cells, and only cloze and translation carry a construction-variant seed. The
  two largest are `DE:B1:sentence_construction:de-b1-um-zu-damit` (47) and
  `TR:A2:sentence_construction:tr-a2-reported-speech` (26).
- **100 rows are in-scope and unlabelled** — about 6% of eligible rows, where the
  classifier declined to guess. That is the designed behaviour: an unrecognised
  seed is ignored downstream, whereas a wrong variant id counts toward the wrong
  quota. The largest are `es-a1-quantifiers-muy-mucho` (18),
  `es-b1-que-vs-cual` (13) and `es-a2-por-para` (10 + 9) — all points whose
  variants are separated by syntax rather than lexeme, which is exactly where
  caution is wanted.

## A real weakness this exposed in `audit:collapse`

Watch the two headline counters across the TR pass: **"cells with a
declared-but-unrealized mechanism" stayed at 54, and "variant-spread-uneven"
stayed at 0**, despite 218 rows being relabelled and every affected cell
improving.

Both are explicable, and both are reporting defects rather than backfill failures:

1. The declared-but-unrealized bucket is a boolean over
   `shortfalls ∨ underMin ∨ unrecognizedSeedCount`. Cells still qualify — via
   `underMin` now rather than `unrecognizedSeedCount` — so the count does not
   move even though the composition improved sharply (`underMin` per cell fell
   4→2 and 5→4; `unrecognized` fell to ~0).
2. `variant-spread-uneven` is defined as `overQuota ∧ ¬unrealized`. `overQuota`
   became non-zero on almost every affected cell (ES 4→30 cells, DE 6→22, TR
   0→10) — real imbalance became visible for the first time, exactly as intended
   — but it stays masked while those cells remain `unrealized` via `underMin`.

**A reader watching only the summary would conclude nothing had happened.** The
underlying measurements are right; the summary is a poor progress indicator.
Worth a follow-up: report cells-improved or row-level movement alongside the
boolean cell counts.

## What is now visible that was not before

Every affected cell has variants below `MIN_PER_VARIANT`. `tr-a2-reported-speech`
has four (`direct-quote-dedi`, `integrated-digini-soyledi`,
`reported-command-masini`, `diye-thought-reason`); `es-b2-verbs-of-change` has
several. That is not a backfill defect — it is the true state of the pool becoming
measurable for the first time. Those variants are genuinely under-drilled, and
they are what regeneration should target once nightly generation resumes.

## Next

- **Do not demote anything yet.** Nightly exercise generation is still paused
  (PR #615), so a demoted cell has nothing refilling it.
- The repass worklist in `docs/analysis/pool-collapse-baseline-2026-08-11.md` was
  computed against the unlabelled pool and is now stale. Re-run
  `pnpm audit:collapse --dry-run` before acting on it.
