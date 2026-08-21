# TR construction-variant repass — run record, 2026-08-21

Executed against **production** after PR #688 merged (`a907cdae`) and its
Production Deploy went green. **COMPLETE for cloze + translation.** The
sentence_construction tail is still outstanding.

The labelling pass was interrupted mid-run when the Anthropic account ran out of
credit; it was resumed after a top-up and finished. That history is kept below
because the interruption shaped what had to be re-verified.

Backlog: `tr-construction-coverage-backlog-2026-08-20.md`.

## What ran, in order

| step | outcome |
|---|---|
| 1. Production Deploy green for `a907cdae` | **confirmed** — the 46 variant lists are live in the generation Lambda |
| 2. `push-prompts` verification | **no-op, proven from the diff.** The merge touched only `tr.ts` and a doc — no prompt file, no `*_PROMPT_VERSION`. Variant lists are curriculum data injected into the per-draft user prompt from deployed code, not a Langfuse-hosted body |
| 3. Neon snapshot | `br-ancient-sun-any6a4eo`, forked from `br-green-waterfall-ancrvpr5` |
| 4. `backfill:variant-seeds --apply` | **2,401 rows over three runs, $3.59.** Run 1: 1,872 rows ($2.64) before the account hit `credit balance is too low` on 31 batches. Run 2 (post-top-up, after one false start that fired before propagation): 529 rows ($0.91). Retry of the one stuck batch: $0.04, 0 rows |
| 5. capture row ids | 1,077 rows / 75 cells committed **before** any write — `tr-variant-repass-demote-ids-2026-08-21.json` |
| 6. `demote:pool --reason pool-hygiene` | **1,077 rows across 75 cells.** 95 invocations, 0 failures, 0 retries, 0 count mismatches |

## Why the demote waited for labelling to finish

Per cell the plan is `need = approved − target + deficit`, where `deficit` sums
over variants of `max(0, share-weighted target − labelled rows)`. On a cell with
**zero** labelled rows the deficit computes as maximal and the demotion strips
far more than intended — and `demote:pool` selects by `--content-ilike
'"seedWord": "<variant-id>"'`, which cannot match a row carrying no variant id at
all. At the interruption B2 was entirely unlabelled, so demoting then would have
gutted those cells. It was held until labelling completed.

## Labelling state, measured on prod after the resumed run

| level | type | approved | labelled | unlabelled |
|---|---|---|---|---|
| A1 | cloze | 279 | **279** | 0 |
| A1 | translation | 332 | **332** | 0 |
| A2 | cloze | 363 | 359 | 4 |
| A2 | translation | 496 | 494 | 2 |
| A2 | sentence_construction | 56 | 33 | 23 |
| B1 | cloze | 196 | **196** | 0 |
| B1 | translation | 446 | 430 | 16 |
| B1 | sentence_construction | 318 | 264 | 54 |
| B2 | cloze | 47 | 45 | 2 |
| B2 | translation | 297 | 243 | 54 |

Cloze + translation: **2,378 of 2,460 labelled (97%)**. The remainder is the safe
failure — a classifier decline writes nothing under the `--min-confidence high`
default — plus one deterministically stuck batch (below).

### One stuck batch, not retried further

`tr-b1-copula-ol:translation` loses ~16 rows to a classifier fault: the model
returns a row id that was not in the batch (`unknown rowId
'71b06581-…' — not in this batch`), which kills that batch's writes. A scoped
retry reproduced it **exactly** — same phantom id, $0.04, 0 rows — so it is
deterministic, not transient, and further retries would only spend. ES hit the
same fault class and left two cells with one stuck batch each.

## The 15 cells that failed in run 1 (all recovered in run 2 except the stuck batch)

```
TR:B1:translation:tr-b1-abstract-postpositions
TR:B1:translation:tr-b1-conditional-irrealis
TR:B1:translation:tr-b1-converb-while-yken
TR:B1:translation:tr-b1-copula-ol
TR:B1:translation:tr-b1-obligation-periphrases
TR:B1:translation:tr-b1-participles-dik-acak
TR:B1:translation:tr-b1-passive-voice
TR:B1:translation:tr-b1-reason-digi-icin
TR:B2:cloze:tr-b2-compound-evidential-rivayet
TR:B2:translation:tr-b2-as-if-gibi
TR:B2:translation:tr-b2-aspectual-verbs
TR:B2:translation:tr-b2-compound-evidential-rivayet
TR:B2:translation:tr-b2-concessive
TR:B2:translation:tr-b2-instead-of
TR:B2:translation:tr-b2-reported-directives
```

## The artifact

`tr-variant-seeds-prod-2026-08-21.json` — `applied: true`, `appliedCount: 1872`,
`entries: 1872`, so every recorded entry was written and there is no
partial-write gap. It is the **only** record of those 1,872 rows' original
`seedWord` values (legacy frequency-band seeds, not nulls), and
`packages/db/backfill-runs/` is gitignored — so it is archived to
`.claude/backfill-artifacts-prod-2026-08/` as well. Revert with
`--revert <artifact> --apply`.

## The demotion

Sized per cell as `need = approved − target + deficit`, then allocated across the
variants holding **more** than their share-weighted quota, oldest row first
within each variant — the same selection order `demote:pool` itself uses, so the
capture names exactly the rows it would pick.

**1,077 rows across 75 cells.** 95 CLI invocations (one per cell × variant), plus
one applied by hand first as a format probe. **0 failures, 0 retries, 0 count
mismatches** — every invocation demoted exactly what the plan asked for.

Before applying, two properties were asserted over the whole plan rather than
spot-checked:

- every one of the 96 (cell, variant) groups draws **only** from a variant above
  its quota — no row is taken from a starved variant;
- no cell is left under 4 rows (`MIN_PER_VARIANT`).

That check earned its keep. The first captured row demotes a
`no-plural-after-numeral` **cloze** row, which the audit reported at 0 — but that
0 was for *translation*; in cloze that variant holds 18 of 20. Sampling one row
would have raised a false alarm; asserting the property over all 96 groups
settled it.

### Verification after the fact

```
captured_total            1077
captured_demoted          1077   (exactly the plan)
captured_still_approved      0
demotion_reason           pool-hygiene x1077   (no 'quality' — learners keep credit)
pool-hygiene outside capture 437  (unchanged pre-existing baseline from 2026-08-10)
```

Approved rows on the 46 variant points: **2,456 → 1,379** (cloze 885 → 499,
translation 1,571 → 880), a difference of exactly 1,077.

`--reason pool-hygiene` throughout, never `quality`: pool-hygiene is not in
`NON_EVIDENCE_DEMOTION_REASONS`, so learners keep credit for past attempts and no
`backfill:mastery` rebuild is needed.

## Resulting state

- **75 of 75 demoted cells now sit below target**, with **1,110 rows of
  headroom** for the scheduler to fill with the starved constructions.
- This is proportionally larger than the ES repass — 1,077 of 2,425 rows (44%)
  against ES's 2,598 of 9,134 (28%) — because TR's cells were more completely
  collapsed, so almost everything read as surplus on the prototype.
- **Nothing refills it yet.** Nightly pre-generation is still PAUSED (#672), the
  same position ES was deliberately left in. Until it resumes the TR pool is
  simply smaller.

## What is NOT done

1. **The sentence_construction tail.** 374 SC rows on variant points, 297 now
   labelled and 77 not. Not demoted. ES handled SC as a separate pass for the
   same reason.
2. **The generation resume** — one flag in `infra/bin/app.ts` plus a CDK deploy.
   Everything above is preparation for it.
3. **No outcome is verified.** "Pools become diverse" is unmeasurable until
   regeneration; the confirming runs are `audit:constructions` and
   `audit:collapse --dry-run` **after** the refill, not now.
4. **Two points still never examined** — `tr-a1-numbers-ordinals` and
   `tr-b2-compound-past-hikaye`, both kebab-case enumeration faults.
5. **`tr-a1-ablative-dative`** remains blocked on the spec/variant collision.
6. **The `decideCoverageTargets` zip bug** is unfixed and unrelated to this run.

## Cost

Labelling $3.59 across three runs plus a $0.04 retry and two $0.00 failed
attempts. The demotion is free (no API). The four audit chunks that preceded this
were $4.43. **Total for the TR sweep + repass: ~$8.**
