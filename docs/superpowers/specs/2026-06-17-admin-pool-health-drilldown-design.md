# Admin Pool Health Drill-Down (Design)

**Status:** approved · **Date:** 2026-06-17 · **Scope:** Tier 2 item #7 (first of two)

Derived from `docs/admin-panel.md` (Tier 2, item 7: "Pool health drill-down + diversity vs.
floors + rejection-reason analytics"). Read-only. The companion item — the on-demand "Refill
this cell" generation trigger (Tier 2 #6) — is a **separate** follow-up spec; its button will
live inside this drill-down once both ship. Builds on the merged admin foundation (PR #317),
flagged queue (PR #321), and content browser (PR #327).

## Goal

Extend the existing `/admin/generation` pool-coverage table so an admin can expand any cell
to see why it's healthy or starved: per-axis **diversity vs. coverage floors**, a
**rejection-reason breakdown** (to spot systematic generation failures), the existing
target/demand/depletion numbers, and a link to the cell's approved exercises. No mutations,
no infrastructure changes.

## Background (verified against current code)

- **`GET /admin/pool-status`** (`infra/lambda/src/routes/admin.ts`) already returns, per cell:
  `language, level, type, grammarPointKey, approved, flagged, rejected, lastRefilledAt,
  depletionRate7d, targetSize, generationTarget, coverageDistribution`
  (`Record<axis, Record<value, count>> | null`). The page consumes this via
  `PoolStatusItemSchema` (`packages/api-client/src/schemas/pool-status.ts`).
- **Coverage model** (`packages/shared/src/coverage.ts`): `CoverageAxis = 'person' |
  'wordClass' | 'polarity' | 'sentenceType'`; `COVERAGE_AXIS_VALUES` per axis;
  `CoverageSpec = { axes: { name, floors: Partial<Record<value, number>> }[] }`. A cell's
  spec lives on its curriculum grammar point.
- **Cell resolution** (`infra/lambda/src/generation/cell-targets.ts`,
  `packages/db/src/generation/cells.ts`): `enumerateCurriculumCells(ALL_CURRICULA)` yields
  `Cell[]` (each with `grammarPoint`, `exerciseType`, etc.); `resolveCellTarget(cell)` already
  reads `coverageSpec` floors. `admin.ts` already imports `ALL_CURRICULA`,
  `enumerateCurriculumCells`, `buildCellKey`, `resolveCellTarget`.
- **Rejection analytics**: `generation_jobs.rejectionReasonCounts` is a
  `Record<GenerationReasonCode, number>` JSONB map per job. `cellKey` =
  `<lang>:<level>:<type>:<grammarPointKey>` (via `buildCellKey`). Reason labels:
  `REASON_LABELS` + `formatReason` in `packages/shared/src/generation-reasons.ts`.
- **Web page**: `apps/web/app/(admin)/admin/generation/page.tsx` (server component: fetches
  `/admin/pool-status` + `/admin/generation-stats`, parses, passes `PoolStatusItem[]` to the
  client `_components/pool-coverage-table.tsx`, which sorts + color-codes rows). The table is
  currently a pure display client component with no data-fetching/auth.
- **Reuse target**: the content browser at `/admin/content` (PR #327) accepts
  `?language=&level=&type=&grammarPoint=` query filters — exactly a cell — so "see its
  exercises" is a link there, not a re-implemented list.
- **Client-fetch idiom**: `useAuth()` → `createAuthenticatedFetch(getToken)` → api-client
  hook, as in `apps/web/app/(admin)/admin/invites/page.tsx` and the moderation/content pages.

## Architecture

Rows in the existing pool-coverage table become **expandable**. Expanding a cell lazily
fetches a small per-cell detail from a new `GET /admin/pool-cell` endpoint and renders an
analytics panel that **combines that fetch with data already on the row**
(`coverageDistribution`, `approved`, `targetSize`, `generationTarget`, `depletionRate7d`,
`lastRefilledAt`). The endpoint therefore returns only the two pieces not already on the row:
curriculum **floors** and the **rejection-reason aggregate**. Computing the rejection
aggregate per-cell-on-demand (rather than for every row in the list) keeps both the list
endpoint and this endpoint cheap.

```
apps/web/app/(admin)/admin/generation/
  page.tsx                              — unchanged data fetch; passes items to the table
  _components/
    pool-coverage-table.tsx            — MODIFIED: expandable rows + builds authed fetchFn
    pool-cell-detail.tsx               — NEW (client): fetches + renders the analytics panel
```

## API — `GET /admin/pool-cell` (new, read-only, in `infra/lambda/src/routes/admin.ts`)

Query (all required): `language` (ES|DE|TR), `level` (A1|A2|B1|B2), `type` (string),
`grammarPoint` (string). Validated with zod `safeParse` → `400 { error, code:
'VALIDATION_ERROR', details }` on failure (matching the existing admin routes).

Returns:
```
{
  floors: Record<string, Record<string, number>>,   // { axisName: { value: floor } }; {} when the cell has no coverageSpec or no matching curriculum cell
  rejectionReasonCounts: Record<string, number>      // { reasonCode: total } summed across this cell's generation_jobs; {} when none
}
```

Implementation:
- **Floors**: build the cell key with `buildCellKey`, find the matching cell from
  `enumerateCurriculumCells(ALL_CURRICULA)` by `(language, level, type, grammarPointKey)`;
  read its grammar point's `coverageSpec.axes` → `{ axis.name: axis.floors }`. If no matching
  cell or no `coverageSpec`, return `{}`.
- **Rejection aggregate**: `db.select({ rejectionReasonCounts }).from(generationJobs)
  .where(eq(generationJobs.cellKey, key))`; reduce the JSONB maps in JS into a single
  `{ code: total }`. (Per-cell job counts are small; no SQL aggregation needed.)

Notably this endpoint does **not** re-query exercises or recompute `coverageDistribution` —
that already arrives on the row.

## Web UI

### `pool-coverage-table.tsx` (modify)
- Add expand/collapse state keyed by cell (e.g. the row's cell key). A row click (or a caret
  button) toggles its expanded panel, rendered as a full-width row beneath the cell's row.
- Build the authenticated fetch once: `const { getToken } = useAuth();` →
  `createAuthenticatedFetch(getToken)` (memoized), passed to each `PoolCellDetail`. This makes
  the table a client data-consumer (currently pure display) — keep the existing sort/color
  logic intact.
- Only the expanded cell mounts its `PoolCellDetail` (lazy fetch).

### `pool-cell-detail.tsx` (new, client)
Props: the `PoolStatusItem` row + the `fetchFn`. Calls `usePoolCell({ fetchFn, cell })`.
- **Loading / error** states while fetching.
- **Diversity vs. floors**: for each `CoverageAxis`, list values present in the row's
  `coverageDistribution[axis]` and/or `floors[axis]`; show `actual` vs `floor` (e.g.
  `3sg 8/5 ✓`, `2pl 1/2 ✗`); mark below-floor values. Axes with no floors show the raw
  distribution counts only. If `coverageDistribution` is null and floors are empty, show a
  "no coverage data" note.
- **Rejection reasons**: chips `formatReason`-labelled `{label}: {count}`, sorted desc by
  count; empty-state "no rejections recorded" when `{}`.
- **Numbers line**: `target {generationTarget} · demand {targetSize} · {depletionRate7d}/day ·
  last refilled {lastRefilledAt|—}` (all from the row).
- **Exercises link**: `View {approved} approved exercises →` →
  `/admin/content?language=…&level=…&type=…&grammarPoint=…` (URL-encoded).

### api-client
- `schemas/pool-cell.ts`: `PoolCellDetailSchema = { floors: record<record<number>>,
  rejectionReasonCounts: record<number> }` (+ inferred type, + a `PoolCellQuery` param type).
- `hooks/usePoolCell.ts`: `usePoolCell({ fetchFn, cell, enabled })` — query keyed
  `['admin','pool-cell', cell]`, builds the query string from the cell fields (reuse the
  shared `buildQueryString` from `lib/build-query-string.ts`), parses with the schema. Barrel-
  exported from `index.ts`.

## Testing

- **Lambda** (`infra/lambda/src/routes/admin.test.ts`, chain-mock + `queryQueue`):
  - floors resolved for a cell whose grammar point has a `coverageSpec` (assert the axis→
    value→floor shape); empty `{}` for a cell without one (or an unknown grammar point).
  - rejection aggregate sums `rejectionReasonCounts` across multiple staged jobs into one map;
    `{}` when no jobs.
  - `400 VALIDATION_ERROR` when a required param is missing/invalid.
  - (Floors come from in-memory curriculum, not the DB — only the rejection query is staged.)
- **api-client**: `usePoolCell` builds `/admin/pool-cell?language=ES&level=A2&type=cloze&grammarPoint=obj-pronoun`
  and parses the response.
- **web**: `pool-cell-detail` renders diversity-vs-floors with a below-floor value flagged,
  rejection chips + empty state, the numbers line, and the content-browser link with the
  correct encoded query; the table toggles a row's panel on expand/collapse and only fetches
  for the expanded cell.
- Gate before push: `pnpm lint`, `pnpm typecheck`, `pnpm turbo run test --concurrency=1`.

## Out of scope (later / separate)

- **On-demand "Refill this cell" trigger** — Tier 2 #6, the next spec (CDK/IAM + SQS +
  `POST /admin/generate`); its button slots into this panel.
- **Job-level log** — the separate unbuilt Tier 1 #5 generation-job-log surface. This
  drill-down aggregates rejection reasons but does not list individual jobs or their
  `errorMessage`/cost.
- **`coverageOutcome` per-axis requested/approved** — deferred; floors-vs-actual + rejection
  reasons already serve "spot systematic generation failures".
- `admin_audit_log` (read-only surface; nothing to audit here anyway).

## Risks / notes

- **Row is the source of truth for distribution/numbers.** The panel trusts the row's
  `coverageDistribution`/`approved`/targets (fetched on page load) rather than re-querying, so
  it stays consistent with the table and avoids duplicate work. Acceptable for an admin tool
  refreshed on navigation.
- **Floor resolution must match the scheduler.** Use the same `enumerateCurriculumCells` /
  grammar-point `coverageSpec` source `resolveCellTarget` uses, so displayed floors equal the
  floors that actually drive `generationTarget`.
- **`coverageDistribution` axis/value keys** are arbitrary strings from stored
  `coverage_tags`; render defensively (don't assume every `COVERAGE_AXIS_VALUES` entry is
  present, and tolerate values not in the canonical list).
- **Table becomes a client data-consumer.** It already is a client component; adding
  `useAuth` + a memoized `fetchFn` follows the established invites/moderation/content idiom.
  The server page's existing fetch is unchanged.
