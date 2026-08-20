# ES construction-variant repass — run record, 2026-08-20

The retrofit PR #631 never ran, executed against **production** on 2026-08-20 after
the eleven authoring PRs (#674–#683) gave all 90 flagged ES points a
`constructionVariants` list. Backlog: `es-construction-coverage-backlog-2026-08-19.md`.

Nightly pre-generation was **paused throughout** (#672) and stays paused by
explicit decision, so the headroom this opened is not refilled yet. That is the
one step left, and until it runs the ES pool is smaller than it was.

## What ran, in order

| step | outcome |
|---|---|
| 1. `push-prompts` per env | **no-op, verified.** prod and dev both 19/19 matched, 0 mismatched. Variant lists are curriculum data injected into the per-draft user prompt from deployed code, not a Langfuse-hosted body — there was nothing to push. #683's Production Deploy confirmed green first, so all 92 lists were live in the generation Lambda before any data moved. |
| 2. `backfill:variant-seeds` | **5,432 rows written, $7.86.** Labelled rows went 1,106 → 6,532 of 9,134 approved cloze/translation rows. |
| 3. `demote:pool --reason pool-hygiene` | **2,598 rows demoted** across 178 cells. ES approved cloze/translation: 9,134 → 6,536. |
| 4. `audit:constructions` on the 4 never-examined points | **$0.30, all four collapsed** — they reopen as authoring work. |

## Step 2 detail

Snapshot taken first: Neon branch `br-raspy-night-anjwk99z` (forked from
`br-green-waterfall-ancrvpr5`). Run named `es-variant-seeds-prod-2026-08-20`; the
artifact is the only fine-grained record of each row's original `seedWord` and is
archived at `.claude/backfill-artifacts-prod-2026-08/` as well as the gitignored
`packages/db/backfill-runs/`.

Four batches failed on classifier faults — three returned the literal string
`'null'` as a variant id, one returned a row id that was not in its batch. Each
kills its whole batch's writes, which is why `es-a1-interrogatives:cloze` came out
of the main run with **zero** labelled rows despite being a variant point. All four
points were re-run individually (`retry-<key>-2026-08-20`), recovering 45 rows;
two cells still have one stuck batch each.

2,602 approved rows remain unlabelled. All but 472 belong to the 27 ES points that
declare no variants and were correctly skipped; the rest are rows the classifier
declined, which is the safe failure — a declined row writes nothing.

## Step 3 detail — how the demotion was sized

Per cell: `need = approved − target + deficit`, where `deficit` is the sum over
variants of `max(0, share-weighted target − labelled rows)`. Rows were then chosen
in two tiers:

1. **Unlabelled first** (coverage-dead: they occupy pool slots while contributing
   nothing `pickVariantSeeds` can measure) — 472 rows planned.
2. **Surplus second**, allocated across variants holding more than their share —
   2,598 rows.

**Only tier 2 ran.** `demote:pool` selects rows by a content substring
(`--content-ilike`, which matches the `seedWord` inside `content_json`) and cannot
express "unlabelled". A bulk `UPDATE … WHERE id IN (…)` was refused by the sandbox
as a mass production write, correctly. The 472 rows stay approved; their ids are in
the capture file if they are ever to be removed through a sanctioned bulk path.

Every row id was captured **before** any write, into
`es-variant-repass-demote-ids-2026-08-20.json` in this directory — `demote:pool`
produces no rollback artifact, so that file is the only undo path. Restore is
`review_status` back to its prior value (all were `auto-approved` or
`manual-approved`) and `demotion_reason = NULL`.

`--reason pool-hygiene` was used throughout, never `quality`: pool-hygiene is not
in `NON_EVIDENCE_DEMOTION_REASONS`, so learners keep credit for past attempts on
these rows and no `backfill:mastery` rebuild is needed.

### Execution notes

219 CLI invocations, one per (cell, variant). 19 failed on transient DNS
(`getaddrinfo ENOTFOUND` against the Neon pooler host) and were retried to
completion with a 3-attempt loop. Final verification against the capture file:

```
captured_demoted            2598   (exactly the plan)
captured_still_approved      472   (the unlabelled tier, deliberately untouched)
demoted_outside_capture     1754   (unchanged pre-existing baseline from #647/#649)
```

Nothing outside the captured id set was touched.

## Resulting state

- 174 of 179 variant cells now sit **below** target, with **2,745 rows of headroom**.
- 5 cells remain at or above target — their surplus was capped by what the
  classifier had labelled, so their unlabelled rows still fill the space.
- **146 cells still hold a variant at zero.** That is the point: the headroom
  exists so the scheduler can generate those constructions. Until pre-generation
  resumes, they stay at zero.

## What is NOT done

1. **The refill.** Resuming nightly pre-generation is one flag in
   `infra/bin/app.ts` plus a CDK deploy. Everything above is preparation for it.
2. **Sentence-construction cells were never labelled.** `backfill:variant-seeds`
   hard-codes `ELIGIBLE_TYPES = {CLOZE, TRANSLATION}`, so ES has 272 approved SC
   rows with **0** labelled — including `es-b1-present-subjunctive` (75) and
   `es-b2-past-subjunctive` (73), the two points that declare variants *and* own an
   SC cell. Since #652 `seedKindFor` routes SC to variant seeding for exactly those
   points, so on resume those two cells hit the failure this whole sequence exists
   to avoid: coverage reads zero for every variant and the seeder spreads drafts
   evenly instead of chasing real gaps. Either extend the tool's eligible types or
   accept one skewed round there.
3. **Four points reopened as authoring work** (see the backlog's "Never examined"
   section) — they need variants, then their own label + demote pass.
4. **No outcome has been verified.** The claim is "pools become diverse"; that is
   unmeasurable until regeneration. The confirming runs are `audit:constructions`
   and `audit:collapse --dry-run` **after** the refill, not now.
5. **DE and TR have never been swept** for this defect class. The audit was
   ES-only, and there is no reason to assume they are clean.

## Suggested order from here

Finish nothing else first — resume generation, let a few nights run, then
re-audit. Batch 11 (the four points) can proceed in parallel, since its own
repass will need the same pipeline afterwards.
