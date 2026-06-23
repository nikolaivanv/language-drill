# Pool cell status — design

**Date:** 2026-06-23
**Surface:** `/admin/pool` (Exercises tab)

## Problem

The pool dashboard shows each cell's approved count, gen target, demand
(consumption tier), and coverage %, but gives no visibility into the
**scheduler's decision** for that cell. An operator can't tell at a glance
whether a cell is still actively generating, has reached its target, or has
been *suppressed* — and if suppressed, why (low-yield vs saturated-dedup).
That signal currently exists only in CloudWatch scheduler logs.

## Goal

Surface, per cell, the exact decision the scheduler will make on its next
tick, plus the evidence behind it. Reuse the existing pure `decideEnqueue`
function so the dashboard is a faithful mirror of scheduler policy, not a
re-derived heuristic.

## Non-goals

- Changing any scheduler policy or thresholds.
- Showing a history/trend of past runs (only the most recent succeeded job).
- A manual "re-trigger generation" button.

## Background

`decideEnqueue(cell, approvedInPool, target, recentJob, curriculumVersionOnDisk)`
(`infra/lambda/src/generation/scheduler-decision.ts`) is a pure function
returning a discriminated union:

| `EnqueueDecision.kind`  | meaning                                            |
| ----------------------- | -------------------------------------------------- |
| `enqueue`               | will generate (`need = target - approved`)         |
| `skip-target-reached`   | approved ≥ target                                  |
| `skip-low-yield`        | last job produced < 3 net-new approvals            |
| `skip-saturated-dedup`  | last job dedup-heavy (reactive or predictive)      |
| `skip-c2`               | level outside `ROUND_1_CEFR_LEVELS`                |

Suppression (`low-yield` / `saturated-dedup`) clears automatically when the
on-disk `CURRICULUM_VERSION_<LANG>` differs from the recorded one.

`ROUND_1_CEFR_LEVELS = ['A1','A2','B1','B2']` — every level the pool UI can
filter is in Round 1, so `skip-c2` is unreachable in practice and is handled
only as a defensive fallback.

The scheduler already loads the inputs via the private helper
`loadMostRecentSucceededJobPerCell(db)` in `scheduler.ts`, which returns a
`Map<cellKey, RecentJob>` (approved/requested/dedup/curriculumVersion/
coverageOutcome/finishedAt) using a `SELECT DISTINCT ON (cell_key) ... ORDER
BY cell_key, started_at DESC`.

## Backend

### 1. Extract the recent-job loader to a shared module

Move `loadMostRecentSucceededJobPerCell` (and its row-mapping) from
`scheduler.ts` into a new `infra/lambda/src/generation/recent-jobs.ts`,
exporting it. `scheduler.ts` imports it from there (no behavior change). This
makes the `RecentJob` query a single source of truth shared by the scheduler
and the admin endpoint.

### 2. Status-mapping helper

Add a pure helper (co-located with the mapping, e.g. in
`scheduler-decision.ts` or a small `cell-status.ts`):

```ts
export type CellStatus =
  | 'active'
  | 'target-reached'
  | 'low-yield'
  | 'saturated-dedup'
  | 'never-run'
  | 'out-of-scope';

export function cellStatusFromDecision(
  decision: EnqueueDecision,
  recentJob: RecentJob | null,
): CellStatus;
```

Mapping:

| `decision.kind`        | `recentJob === null` | `recentJob !== null` |
| ---------------------- | -------------------- | -------------------- |
| `enqueue`              | `never-run`          | `active`             |
| `skip-target-reached`  | `target-reached`     | `target-reached`     |
| `skip-low-yield`       | (n/a)¹               | `low-yield`          |
| `skip-saturated-dedup` | (n/a)¹               | `saturated-dedup`    |
| `skip-c2`              | `out-of-scope`       | `out-of-scope`       |

¹ `decideEnqueue` can only return `skip-low-yield` / `skip-saturated-dedup`
when `recentJob !== null`, so those `null` cells never arise; the helper still
defaults them to `never-run` defensively.

### 3. Wire into `GET /admin/pool-status`

- Replace the standalone `MAX(finishedAt)` (`lastRefilledRows`) query with
  the shared recent-job loader. `lastRefilledAt` is derived from
  `recentJob.finishedAt` (one fewer query).
- Per cell: resolve `curriculumVersionOnDisk =
  CURRICULUM_VERSION_BY_LANGUAGE[cell.language]`, look up the recent job, call
  `decideEnqueue(cell, approved, generationTarget, recentJob, version)`, then
  `cellStatusFromDecision(...)`.
- New fields on each `PoolStatusItem`:
  - `status: CellStatus`
  - `lastJob: { approvedCount, requestedCount, dedupGivenUpCount,
    curriculumVersion } | null`
- `generationTarget` is already `resolveCellTarget(cell)` and is the `target`
  passed to `decideEnqueue` (consistent with the scheduler).

## Frontend (`pool-coverage-table.tsx`)

### Status column

Add a **Status** column (after Grammar Point, before Approved). Render a
colored badge via a small `StatusBadge` component:

| status            | label          | color (token)        |
| ----------------- | -------------- | -------------------- |
| `active`          | Active         | green                |
| `target-reached`  | Target reached | neutral / blue       |
| `low-yield`       | Low-yield      | amber                |
| `saturated-dedup` | Saturated      | red                  |
| `never-run`       | Never run      | grey                 |
| `out-of-scope`    | Out of scope   | grey                 |

Reuse the existing badge/chip styling already present in the admin surface
where possible (match the theory status badges' visual weight).

### Expanded detail

In `PoolCellDetail`, add a "Last generation run" block when `lastJob` is
non-null:

- `approved / requested` (e.g. "12 / 30 approved")
- `dedup given up: N`
- `curriculum version: <recorded>` and, when it differs from the on-disk
  version, a note that suppression will clear on the next tick
- last run date (`lastRefilledAt`)

When `lastJob` is null, show "No generation run yet."

A one-line caption explains that suppression (low-yield / saturated) clears on
a curriculum-version bump.

## API client (`packages/api-client`)

Extend the `PoolStatusItem` Zod schema / type with `status` (enum) and
`lastJob` (nullable object). The colColumn rendering depends on these.

## Tests

- **Unit** — `cellStatusFromDecision` against every `decision.kind` × recentJob
  presence (new test file alongside the helper). `decideEnqueue` branches are
  already covered by existing tests.
- **Backend** — extend the existing `pool-status` route test (if present) to
  assert `status` / `lastJob` appear and reflect a seeded recent job; otherwise
  assert the mapping wiring via the helper.
- **Frontend** — extend `pool-coverage-table` tests: badge renders the right
  label per status; expanded detail shows last-run metrics. Grep the app for
  any test asserting the old column set / `colSpan` and update.
- **Regression guard** — the expanded-row `<td colSpan>` must be bumped to
  match the new column count.

## Rollout

Pure additive change — new response fields, new column. No migration. The
recent-job loader extraction is a no-op refactor verified by the existing
scheduler tests.
