# SC flagged-pool recovery — re-validate & promote (2026-07-22)

Companion to PRs [#606](https://github.com/nikolaivanv/language-drill/pull/606)
(validator: scope `ambiguous` + low-quality to `sentence_construction`) and
[#607](https://github.com/nikolaivanv/language-drill/pull/607) (generator: SC
person target is the subject, not the addressee). Those fixes stop **future**
over-flagging; this pass recovers the **existing** backlog they left behind.

## Problem

The generation validator applied the cloze single-answer `ambiguous` rubric to
`sentence_construction` (SC), which is **open production** — many correct
sentences by design. Pool-wide (prod, 2026-07-22, pre-fix), 517 SC drafts sat
in `flagged`; ~81% carried a false `ambiguous`. Serving filters on
`auto-approved` / `manual-approved` only (`infra/lambda/src/lib/exercise-filters.ts`),
so every flagged draft was invisible to learners. **TR B2 SC had 0 approved
rows** — that drill type was empty there.

Nightly regen would not fully self-heal it: `LOW_YIELD_THRESHOLD = 3`
(`infra/lambda/src/generation/scheduler-decision.ts`) suppresses any cell whose
most-recent run approved < 3 drafts (`skip-low-yield`), and that suppression
clears only on a `CURRICULUM_VERSION` bump — a prompt fix does not touch it. The
worst-hit cells (TR A2 ×4, TR B1 ×8, ES ×2 by last-run yield) were exactly the
ones frozen.

## Fix — `pnpm revalidate:sc-promote`

A promote-only mirror of the demote-only `revalidate:cloze`
(`decidePromotion` in `packages/db/src/generation/revalidation.ts`,
CLI `packages/db/scripts/revalidate-sc-promote-pool.ts`). It re-scores every
`flagged` SC draft through the **corrected** validator and, where the draft now
routes to `auto-approved`, promotes `flagged → manual-approved` (clearing
`flagged_reasons`). Any other verdict is a no-change — the pass never lowers
status, so genuine residual defects (real ambiguity, low quality, off-level, and
the #607 `du`-miscompiles the fixed validator now flags/rejects) stay `flagged`
for human review.

`manual-approved` (not `auto-approved`) records the operator remediation and
shields the row from the demote-only `revalidate:cloze` pass. Deterministic
checks run on the same footing as the live path.

## Result (applied 2026-07-22)

| | rows |
|---|---|
| scanned (flagged SC) | 517 |
| **promoted → manual-approved** | **431 (83%)** |
| no change (stays flagged) | 86 |
| update-failed | 0 |
| validator cost | $4.69 |

Promotions by cell: DE/A1 25 · DE/A2 18 · DE/B1 40 · DE/B2 11 · ES/B1 20 ·
ES/B2 21 · TR/A2 100 · TR/B1 182 · TR/B2 14.

Post-apply verification (`exercises`, type = `sentence_construction`): 431
`manual-approved` (all with `flagged_reasons` cleared), 86 `flagged` (all
retaining reasons), 1273 `auto-approved` + 84 `rejected` untouched; total 1874
conserved. The 83% promote rate matches the pre-fix false-positive estimate.

### Coverage impact

Every (language, level) SC cell now holds approved content — no empty cells
remain (min 14, TR B2, was 0). Approved-per-cell (target = 50):

- **At/above target** (→ `skip-target-reached`, un-stuck): ES B1 (3/3), ES B2
  (1/1), TR B1 (11/11), DE B1 (2/4), TR A2 (1/4).
- **Below target but self-healing** (not low-yield → keeps regenerating nightly
  under the fixed validator): DE A1/A2/B2, TR B2 (14 → climbs).
- **Below target and possibly low-yield-frozen**: up to 3 TR A2 cells (min 39
  approved). Well-stocked; would only need a `CURRICULUM_VERSION_TR` bump (or a
  forced re-enqueue) to top up to 50 — optional, no user-facing gap.

## Revert

Before the pass there were **zero** `manual-approved` SC rows, so the promoted
set is exactly `type = 'sentence_construction' AND review_status =
'manual-approved'`. To roll back:
`UPDATE exercises SET review_status = 'flagged' WHERE type =
'sentence_construction' AND review_status = 'manual-approved';` (re-run
`revalidate:sc-promote` afterward to restore reasons, or accept null reasons on
revert).
