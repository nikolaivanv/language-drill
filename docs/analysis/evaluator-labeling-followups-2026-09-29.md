# Evaluator labeling — carried follow-ups

**Date:** 2026-09-29
**Branch:** `feat/evaluator-labeling` (19 commits)
**Spec:** `docs/superpowers/specs/2026-09-29-evaluator-labeling-design.md`
**Plan:** `docs/superpowers/plans/2026-09-29-evaluator-labeling.md`

Everything here was found by review, triaged, and deliberately **not** fixed on the
branch. Recorded so the next person does not re-derive it. Nothing below blocks the
surface from being used.

## The one gate that matters

**Land Task 8 (the `pnpm export:labels` CLI) before the labels are used as ground
truth — not merely before they reach 100.** Until it exists, nothing freezes the
evaluation snapshot a label was recorded against, and `response_json` is appended to
in production (`infra/lambda/src/routes/exercises.ts`, the `explanation` key). A label
whose context has drifted is worse than no label. Exposure is small today: the FK
cascade means a deleted submission takes its label with it rather than orphaning it,
and pool hygiene demotes rather than deletes.

Task 8 was gated-not-run by design — its own text requires ~20 real labels to exist
first, so its fixture contract is proven by real labels rather than guessed at. The
labels are not trapped in the meantime: `GET /admin/labeling/stats` answers "how many
exist", and the rows are reachable by SQL, Drizzle Studio, or the Neon MCP.

## Parked with reasoning

**The `seed` query param is unreachable from the UI.** `safeSeed` defaults to today's
date, so the `random` permutation changes daily. Within-day stability — the property
the spec actually argues for — holds, and a different md5 permutation over the
unlabelled set is still unbiased. Past samples remain replayable: the seed *is* the
date, and `labeled_at` records it. Only ordering is affected, never membership.

**A session spanning midnight reorders.** Same cause. Harmless.

## Recommended follow-up work

**Replace the card-sizing machinery with CSS.** `page.tsx` carries
`ADMIN_MAIN_BOTTOM_PADDING = 36` mirroring `admin-shell.tsx`'s `py-[36px]`, a
`CARD_TO_BAR_GAP = 16` mirroring the column's `gap-4`, a `ResizeObserver`, two
`useLayoutEffect`s and a resize listener — three coupled magic numbers across two
files, guarded by one back-pointing comment. The durable fix is to let CSS do the
arithmetic: `AdminShell`'s padded wrapper becomes `h-full min-h-0 flex flex-col`, the
card becomes `flex-1 min-h-0 overflow-y-auto`, and the sticky bar plus all measurement
disappear. Out of scope here because it touches a shell every admin page depends on.

**The `↓ more` pill occludes 1-2 words** of the card's last visible line at initial
paint when the overflow is small. Self-announcing and cleared by the keypress it
advertises, unlike the silent occlusion it replaced. A bottom margin or gradient
instead of literal overlap is the polish.

**The whole admin section breaks at phone width** — `AdminShell`'s fixed 220px
sidebar, no responsive handling. Confirmed identical on `/admin/invites`, so this is a
section-wide gap, not a labeling regression.

**`docs/admin-panel.md` is stale beyond this branch.** Its "what exists today" table
lists three pages and is already missing `/admin/flags`, `/admin/moderation`,
`/admin/pool`, `/admin/audit`, `/admin/capacity`, `/admin/activity`,
`/admin/curriculum` and `/admin/diversity`; its header still says "Status: proposal".
Worth one pass at some point, not as part of this work.

## Minor items carried

Hardening, none reachable from the UI:
- The base predicate admits rows with no `evaluation` at all (`NULL IS DISTINCT FROM
  'deterministic'` is true). Matches the spec, and 0 such rows exist on dev; if any
  appear they occupy queue slots and inflate `remaining`. `response_json->'evaluation'
  IS NOT NULL` would be belt-and-braces.
- `z.enum(['ES','DE','TR'])` hardcodes languages, so EN rows are servable but not
  filterable.
- The targeted stratum's ORDER BY binds `CORRECT_THRESHOLD` as a parameter inside
  `abs()` — valid Postgres, exercised live, but inconsistent with the comment two
  lines up explaining why the seed is inlined instead.
- No `id` tiebreaker on the targeted order; `evaluated_at desc` is effectively unique,
  so ties are theoretical.
- Two sequential awaits over the same `where` double the endpoint's latency.
  Irrelevant at 695 rows; `Promise.all` would invert the mock FIFO order.
- `LabelBar` uses `z-10` where the app's other sticky bar uses `z-30`. No collision.

UI polish:
- When every row on a page is dropped, "Nothing left to label in this scope." shows
  next to "N unlabelled in scope" — the `· N unrenderable, skipped` chip explains it,
  but the two strings contradict each other.
- The header shows "N labelled today" and the random stratum's count, but no
  `labelled / target` denominator, so "do 100 exist yet" reads off two numbers.
- `u` (unsure) nulls both verdicts but leaves `tags` and `critique` in place.
- `estimatedCefrEvidence` is typed on the card's `Evaluation` but never rendered, and
  `item.score` is never shown independently of `evaluation.score`.
- `stats.isLoading` is never consulted, so counters render 0 then pop in.
- The keydown listener re-subscribes on every keystroke (`commit`'s deps include
  `draft`).

Test-infrastructure notes:
- **Type annotations in `packages/ai` and `packages/db` test files are not checked by
  anything** — both `tsconfig.json`s exclude `**/*.test.ts` and vitest strips types
  without checking. A comment now records this at the one place it mattered
  (`qa-sample.test.ts`), but the general fact is worth knowing before relying on a
  test file's types.
- The mocked `db.insert` chain in the lambda route tests has no
  `onConflictDoNothing()`, so `authMiddleware`'s user-upsert throws a `TypeError` on
  every authenticated request, swallowed by its own try/catch. Pre-existing and
  repo-wide (inherited from `admin-diversity.test.ts`), which means a real regression
  in that middleware would currently be invisible in these suites.
- `review-item-card.test.tsx` flaked once under the full parallel web run and passed
  58/58 in isolation plus a clean full re-run. Cross-file pollution, not a regression.
- Stats fixtures use JS numbers, so the `Number()` coercion guarding Postgres
  bigint-as-string is never exercised — though it is load-bearing: the live query does
  return counts as strings.
