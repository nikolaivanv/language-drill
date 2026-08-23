# DE construction-variant repass — run record, 2026-08-23

Executed against **production** after PR #695 merged (`10457699`) and its
Production Deploy went green. **COMPLETE for cloze + translation + SC** — unlike
ES and TR, sentence_construction was in scope from the start (#691), so there is
no separate SC tail.

Backlog: `de-construction-coverage-backlog-2026-08-23.md`.

## What ran, in order

| step | outcome |
|---|---|
| 1. Production Deploy green for `10457699` | **confirmed from the workflow run**, not assumed — the 58 variant lists are live in the generation Lambda |
| 2. `push-prompts` verification | **no-op, proven from the diff.** The merge touched only `de.ts` and docs — no prompt file, no `*_PROMPT_VERSION`. Variant lists are curriculum data injected into the per-draft user prompt from deployed code, not a Langfuse-hosted body |
| 3. Neon snapshot | `br-ancient-shadow-an57vwlo`, forked from `br-green-waterfall-ancrvpr5` |
| 4. smoke test | `de-a2-seit-present` only — 23 rows, $0.03. All classified `seit-present-ongoing`, matching the audit's 12/12 finding, which confirmed the plumbing before spending the full budget |
| 5. `backfill:variant-seeds --apply` | **3,072 rows, $4.56**, one clean pass. Artifact `applied: true`, `appliedCount: 3072`, `entries: 3072` — every recorded entry written, no partial-write gap |
| 6. capture row ids | 1,710 rows / 109 cells **committed and pushed before any demotion write** — `de-variant-repass-demote-ids-2026-08-23.json` |
| 7. `demote:pool --reason pool-hygiene` | **1,710 rows across 109 cells.** 139 invocations, 0 failures, 0 count mismatches |

Total cost: **$4.59** labelling (plus the $6.08 audit that preceded it). The
demotion is free — no API calls.

## Labelling

| type | approved | labelled after | unlabelled |
|---|---|---|---|
| cloze | 1,904 | 1,777 | 127 |
| translation | 2,156 | 2,048 | 108 |
| sentence_construction | 276 | 176 | 100 |
| **total** | **4,336** | **4,001 (92%)** | **335** |

Labelled rows went 906 → 4,001. The 335 residue is the safe failure — a
classifier decline writes nothing under the `--min-confidence high` default —
plus five batches where the model returned a literal `variantId 'null'`:

```
DE:A2:translation:de-a2-konjunktiv-ii-polite
DE:B1:cloze:de-b1-hin-her
DE:B2:cloze:de-b2-dass-equivalents
DE:B2:cloze:de-b2-konjunktiv-ii
DE:B2:translation:de-b2-dass-equivalents
```

SC is proportionally worst (64% labelled), the same legacy-pool shape ES and TR
hit.

## The demotion

Sized per cell as `need = approved − target + deficit`, where `deficit` sums each
variant's shortfall against its share-weighted quota. Allocated across variants
holding **more** than their quota, oldest row first — which is exactly
`demote:pool`'s own `ORDER BY created_at ASC LIMIT n` (read from the source, not
assumed), so the capture names precisely the rows the CLI would pick.

**1,710 rows across 109 cells / 139 (cell, variant) groups. 0 failures, 0
mismatches** — every invocation demoted exactly what the plan asked for.

Four properties were asserted over the **whole plan** rather than spot-checked:

- every group draws only from a variant strictly above its quota — **0**
  violations;
- no group is pushed below `floor(quota)` — **0**;
- no cell is left under `MIN_PER_VARIANT` — **0** across all 109 cells;
- no duplicate ids, and `sum(limit)` equals the captured row count.

Then verified against the real CLI before applying: a dry-run of the largest
group (`de-b2-temporal-connectors:translation`, limit 39) returned exactly 39.

### Largest reductions — all cells the audit had found totally collapsed

| cell | before → after |
|---|---|
| `de-b2-temporal-connectors:translation` | 50 → **11** |
| `de-b2-subjective-modals:translation` | 50 → **12** |
| `de-b2-causal-connectors:translation` | 49 → **13** |
| `de-b2-consecutive-connectors:translation` | 49 → **13** |
| `de-b2-concessive-connectors:translation` | 49 → **14** |
| `de-b2-passive-alternatives:translation` | 50 → **16** |
| `de-b2-modal-connectors:translation` | 49 → **16** |
| `de-b1-plusquamperfekt-nachdem:translation` | 50 → **20** |

`de-a1-v2-word-order` drops hardest proportionally (20 → 6 cloze, 20 → 5
translation) and correctly so: its pool was 19/20 and 20/20 on `v2-fronted-adverb`,
so nearly everything in it was surplus on one variant.

77 cells report `planned < need`, because the surplus is bounded by what the
classifier had labelled. ES and TR hit the same ceiling and recorded it the same
way.

### Verification after the fact

Reconciled three ways against the pre-write snapshot, not just against the
per-invocation logs — TR's run looked clean in its logs while two extra rows had
in fact been demoted, and only the arithmetic cross-check caught it.

```
captured_total              1710
captured_demoted_hygiene    1710   (exactly the plan)
captured_still_approved        0
captured_wrong_reason          0

pool-hygiene now            1918
pool-hygiene on snapshot     208   -> 1918 - 208 = 1710, the capture exactly
approved on snapshot        7497
approved now                5787   -> difference 1710, the capture exactly
demotion_reason 'quality'     17 before, 17 after — unchanged
```

`--reason pool-hygiene` throughout, never `quality`: pool-hygiene is not in
`NON_EVIDENCE_DEMOTION_REASONS`, so learners keep credit for every past attempt
and **no `backfill:mastery` rebuild is needed**.

## Resulting state

- **114 of 116 cells now sit below target, with 1,838 rows of headroom** for the
  scheduler to fill with the starved constructions. Headroom exceeds the 1,710
  demoted because several cells had their target raised by the new variant counts
  (`de-a1-plural-formation` 20 → 24, `de-b1-modal-particles-basic` and
  `de-b1-schon-noch-erst` 15 → 20).
- The only two cells still at target are `de-a2-indirect-questions:translation`
  (30/30) and `de-b1-konjunktiv-ii-past:sentence_construction` (50/50). The first
  is genuinely balanced (15/15 across its two variants); the second is
  surplus-bounded by labelling.
- 1,710 of 4,336 rows (39%) — between ES's 28% and TR's 44%.
- **Nothing refills it yet.** Nightly pre-generation is still PAUSED (#672), the
  same position ES and TR were deliberately left in. Until it resumes the DE pool
  is simply smaller.

## The artifacts

`prod-de-2026-08-23.json` (3,072 entries) and the smoke run
`de-smoke-2026-08-23.json` (23) are the **only** record of those rows' original
`seedWord` values — legacy frequency-band seeds, not nulls — because
`isEligible` permanently skips already-labelled rows. `packages/db/backfill-runs/`
is gitignored, so both are archived to `.claude/backfill-artifacts-prod-2026-08/`
as well. Revert with `--revert <artifact> --apply`.

The demotion has no rollback artifact of its own; the committed
`de-variant-repass-demote-ids-2026-08-23.json` is that record, and the snapshot
`br-ancient-shadow-an57vwlo` holds every row's original `review_status`.

## Operational notes

**A dry-run costs the same as an apply**, so the run went straight to `--apply`
after a one-point smoke test scoped with `--grammar-point` (~$0.03). That is the
cheap way to prove the invocation before committing the full budget, and it is
safe to follow with a full run because `isEligible` skips already-labelled rows.

**The runner used fully-braced `${var}` throughout.** TR's equivalent script
double-applied one group because zsh parses `$point:s` as a history modifier and
aborted on an `echo` that ran *after* the demote had already written.

**Watch what a wait condition actually tests.** The backfill writes its artifact
*before* applying, so an "artifact exists" wait fired ~4 minutes early; the
correct condition is process exit.

## What is NOT done

1. **The generation resume** — one flag in `infra/bin/app.ts` plus a CDK deploy.
   Everything above is preparation for it, and all three languages are now
   waiting on it together.
2. **The eleven RISK-axis DE points** are still unauthored (case/number/
   comparison specs; four need `coverageSpec.appliesTo`). See the backlog.
3. **`de-b1-relative-pronouns` is untouched.** Its 2-of-4 zip residue (99 of 100
   rows on `dative+singular` and `genitive+plural`) is a coverage-spec problem,
   not a variant one — it declares no variants, so this repass did not reach it.
   It needs its own demotion once the refill is running.
4. **No outcome is verified.** "Pools become diverse" is unmeasurable until
   regeneration; the confirming runs are `audit:constructions` and
   `audit:collapse --dry-run` **after** the refill, not now.
5. **`de-b1-reason-consequence-connectors` was never examined** — kebab-case
   enumeration fault on `nämlich-medial-reason`, the third such loss across two
   languages.
