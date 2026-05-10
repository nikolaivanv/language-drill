# Requirements Document

## Introduction

Phase 5 adds operational visibility into the exercise pool: a secured `GET /admin/pool-status` API endpoint that reports per-cell exercise counts and 7-day depletion rates, a pure `targetCellSize` function that scales the refill target by observed traffic, a `GET /admin/generation-stats` endpoint for cost and approval-rate aggregates, and a read-only admin dashboard page in the Next.js app that surfaces pool coverage, cost spend, and batch outcomes in one place.

This is the monitoring layer that turns the generator from a one-shot CLI into an observable, self-correcting pool. Without it, there is no way to know which cells are running dry, how much generation has cost this month, or whether approval rates are drifting.

## Alignment with Product Vision

The pre-generated pool is the cost backbone of the app (CLAUDE.md §Content Strategy). Exercises must be available before users arrive; a depleted cell produces a 404 on `GET /exercises`, which degrades the drill experience. Phase 5 gives the developer the operational signal needed to keep the pool healthy without manual inspection of the database.

---

## Requirements

### Requirement 1 — Admin authorization middleware (Lambda API)

**User Story:** As the app developer, I want all `/admin/*` Lambda routes protected by an admin check, so that only explicitly authorized users can call sensitive operational endpoints.

#### Acceptance Criteria

1. WHEN a request reaches any route under `/admin/*`, the system SHALL verify that the authenticated `userId` appears in the `ADMIN_USER_IDS` environment variable (comma-separated list of Clerk user IDs).
2. IF the user is not in the admin list, the system SHALL return HTTP 403 with `{ "error": "Forbidden", "code": "FORBIDDEN" }`.
3. IF `ADMIN_USER_IDS` is not set or is empty, the system SHALL treat all users as non-admin and return 403.
4. IF the standard `authMiddleware` has already set a `userId` (including the dev-server's `dev_user_001`), the admin middleware SHALL read that value rather than re-extracting from the JWT.
5. WHEN `ADMIN_USER_IDS` includes the dev user ID `dev_user_001`, local dev requests SHALL pass the admin check without additional configuration.
6. The `authMiddleware` SHALL always run before the admin middleware; a request without a valid Clerk JWT SHALL receive 401 (from `authMiddleware`) before the admin check is reached.
7. `ADMIN_USER_IDS` SHALL be read from the environment at request time (not cached at module load), so updates take effect without a Lambda redeploy.

---

### Requirement 2 — Pool status API endpoint

**User Story:** As an admin, I want `GET /admin/pool-status` to return the current exercise count and 7-day depletion rate for every curriculum cell, so that I can see which cells need refilling.

#### Acceptance Criteria

1. WHEN called without query params, the endpoint SHALL return pool stats for all cells defined in `ALL_CURRICULA` across all three learning languages (ES, DE, TR), expanding each grammar point into one row per exercise type (cloze, translation, vocab_recall).
2. WHEN called with `?language=ES`, the endpoint SHALL return only cells for Spanish.
3. WHEN called with `?language=ES&level=B1`, the endpoint SHALL return only Spanish B1 cells.
4. WHEN called with `?level=B1` (without `?language`), the endpoint SHALL return B1 cells for all languages.
5. WHEN called with a value for `language` that is not one of `ES`, `DE`, `TR` (case-sensitive), the system SHALL return HTTP 400 with `{ "error": "Invalid query parameters", "code": "VALIDATION_ERROR" }`.
6. WHEN called with a value for `level` that is not one of `A1`, `A2`, `B1`, `B2` (case-sensitive), the system SHALL return HTTP 400 with the same error shape.
7. Each response item SHALL contain: `language` (string), `level` (string, CEFR), `type` (string, exercise type), `grammarPointKey` (string), `approved` (integer), `flagged` (integer), `rejected` (integer), `lastRefilledAt` (ISO 8601 string or null), `depletionRate7d` (number), `targetSize` (integer).
8. `approved` SHALL count rows in `exercises` WHERE `reviewStatus IN ('auto-approved', 'manual-approved')` filtered to the cell's `(language, difficulty, type, grammarPointKey)`.
9. `flagged` and `rejected` SHALL count rows in `exercises` WHERE `reviewStatus = 'flagged'` and `reviewStatus = 'rejected'` respectively, using the same cell filter.
10. `depletionRate7d` SHALL be computed as: count of `user_exercise_history` rows WHERE `evaluatedAt >= NOW() - INTERVAL '7 days'` and the associated `exercises` row matches `(language, difficulty, type, grammarPointKey)`, divided by 7, rounded to one decimal place. IF the `user_exercise_history` table is empty, this value SHALL be `0` without error.
11. The depletion rate query SHALL use a single aggregating SQL query across all requested cells (not one query per cell), to satisfy the ≤3-second performance requirement.
12. `lastRefilledAt` SHALL be the maximum `finishedAt` from `generation_jobs` WHERE `status = 'succeeded'` and `cellKey` matches (format `<lang>:<level>:<type>:<grammarPointKey>`), or null if no successful job exists.
13. `targetSize` SHALL be populated by calling `targetCellSize(depletionRate7d)` (Requirement 4).
14. The response array SHALL be ordered by `language ASC`, `level ASC` (A1→A2→B1→B2), `type ASC`, `grammarPointKey ASC`.
15. Cells with zero approved exercises SHALL be included in the response (they are the ones most urgently needing refill).

---

### Requirement 3 — Generation stats API endpoint

**User Story:** As an admin, I want `GET /admin/generation-stats` to return aggregated cost and batch outcome data, so that I can monitor spend and quality trends without querying the database directly.

#### Acceptance Criteria

1. WHEN called, the endpoint SHALL return a single JSON object with the following top-level fields:
   - `costThisWeekUsd`: sum of `generation_jobs.cost_usd_estimate` (cast to float) for jobs WHERE `started_at >= NOW() - INTERVAL '7 days'`; SHALL be `0` if no jobs exist.
   - `costThisMonthUsd`: sum of `generation_jobs.cost_usd_estimate` for jobs WHERE `started_at >= DATE_TRUNC('month', NOW())`; SHALL be `0` if no jobs exist.
   - `jobsThisWeek`: object with integer keys `succeeded`, `failed`, `running`, and `queued` — counts of `generation_jobs` WHERE `started_at >= NOW() - INTERVAL '7 days'` grouped by `status`; all four keys SHALL be present even when zero.
   - `approvalRates`: array of objects with fields `language` (string), `level` (string), `type` (string), `approvedCount` (integer), `flaggedCount` (integer), `rejectedCount` (integer), `approvalRate` (number, 3 decimal places); computed from `generation_jobs` WHERE `started_at >= NOW() - INTERVAL '30 days'`, grouping by the three components parsed from `cellKey`. IF no jobs exist in the period, this SHALL be an empty array.
2. `language`, `level`, and `type` in `approvalRates` SHALL be extracted by splitting `generation_jobs.cellKey` on `:` — format is `<lang>:<level>:<type>:<grammarPointKey>` — and uppercasing the lang and level components (e.g., `es` → `ES`, `b1` → `B1`).
3. `approvalRate` in each `approvalRates` row SHALL equal `approvedCount / (approvedCount + flaggedCount + rejectedCount)`, using the pre-aggregated `approved_count`, `flagged_count`, `rejected_count` columns directly from `generation_jobs` (SUM per group). Rows where the denominator is zero SHALL be omitted.
4. IF no jobs exist (empty `generation_jobs`), `costThisWeekUsd` and `costThisMonthUsd` SHALL both be `0`, `jobsThisWeek` SHALL have all four keys set to `0`, and `approvalRates` SHALL be an empty array.

---

### Requirement 4 — Skill-aware target cell size

**User Story:** As the pool scheduler, I want a pure `targetCellSize(depletionRate7d)` function, so that high-traffic cells automatically get a larger refill target than low-traffic ones.

#### Acceptance Criteria

1. IF `depletionRate7d >= 10`, the function SHALL return `200`.
2. IF `depletionRate7d >= 5` (and < 10), the function SHALL return `100`.
3. IF `depletionRate7d >= 1` (and < 5), the function SHALL return `75`.
4. OTHERWISE (depletionRate7d < 1, including 0), the function SHALL return `50`.
5. The function's input SHALL be treated as non-negative; behavior on negative input is undefined and callers MUST not pass negative values.
6. The function SHALL be pure (no I/O, no side effects) and accept a single `number` argument.
7. The function SHALL be exported from `packages/db/src/lib/target-cell-size.ts`.
8. The pool status endpoint (Requirement 2) SHALL use this function to populate the `targetSize` field on each response item.

---

### Requirement 5 — Pool status Zod schema (API client)

**User Story:** As a frontend developer, I want a Zod schema for the pool-status and generation-stats API responses, so that the admin dashboard is type-safe end-to-end.

#### Acceptance Criteria

1. `PoolStatusItemSchema` SHALL be defined in `packages/api-client/src/schemas/pool-status.ts` with fields matching Requirement 2, criterion 7: `language` (string), `level` (string), `type` (string), `grammarPointKey` (string), `approved` (number), `flagged` (number), `rejected` (number), `lastRefilledAt` (string nullable), `depletionRate7d` (number), `targetSize` (number).
2. `GenerationStatsSchema` SHALL be defined in the same file matching Requirement 3, criterion 1, including the `jobsThisWeek` nested object and `approvalRates` array.
3. Both schemas and their inferred TypeScript types (`PoolStatusItem`, `GenerationStats`) SHALL be exported from `packages/api-client/src/index.ts`.
4. Unit tests in `packages/api-client/src/schemas/pool-status.test.ts` SHALL verify that both schemas parse valid response fixtures without errors and reject malformed inputs.

---

### Requirement 6 — Admin generation dashboard (Next.js page)

**User Story:** As an admin, I want a page at `/admin/generation` in the web app that shows pool coverage, cost spend, and batch outcomes, so that I can monitor the generation system without a database client.

#### Acceptance Criteria

1. WHEN a non-admin user navigates to `/admin/generation`, the system SHALL redirect them to `/` (home).
2. Admin status SHALL be determined server-side using `auth()` from `@clerk/nextjs/server` and checking `sessionClaims?.metadata?.admin === true` (matching the Clerk JWT template that exposes public metadata).
3. The page SHALL be a React Server Component that fetches data using `apiFetch` from `apps/web/lib/api-server.ts` (server-only, uses Clerk `getToken({ template: 'api' })`).
4. The page SHALL display a **Cost panel** showing: `$ this week` and `$ this month` from `generation-stats`, formatted to 4 decimal places with a `$` prefix.
5. The page SHALL display a **Job summary panel** showing: succeeded, failed, running, and queued counts for jobs in the past 7 days, from `generation-stats.jobsThisWeek`.
6. The page SHALL display an **Approval rate table** with columns `Language`, `Level`, `Type`, `Approved`, `Flagged`, `Rejected`, `Rate %`, populated from `generation-stats.approvalRates`.
7. The page SHALL display a **Pool coverage table** with one row per curriculum cell, columns `Language`, `Level`, `Type`, `Grammar Point`, `Approved`, `Target`, `Coverage %`, color-coded by coverage ratio:
   - Red: `approved / targetSize < 0.5`
   - Amber: `0.5 ≤ approved / targetSize < 0.8`
   - Green: `approved / targetSize ≥ 0.8`
8. The pool coverage table SHALL be client-sortable by `Coverage %` (ascending/descending toggle), implemented as a `"use client"` child component receiving the server-fetched data as props.
9. IF the `apiFetch` call to `/admin/pool-status` or `/admin/generation-stats` returns a non-2xx status, the page SHALL display an inline error message rather than throwing an unhandled exception.
10. IF the API returns 403 (user is not admin at the API level), the page SHALL redirect to `/`.

---

### Requirement 7 — Admin layout and routing (Next.js)

**User Story:** As the app developer, I want an admin layout segment in the Next.js app, so that admin pages share a consistent access-control guard.

#### Acceptance Criteria

1. An `apps/web/app/(dashboard)/admin/` directory SHALL be created with a `layout.tsx` that:
   - Checks admin status server-side using `auth()` from `@clerk/nextjs/server`.
   - Calls `redirect('/')` (from `next/navigation`) for non-admins before rendering any child page.
2. The admin layout SHALL not add any visible UI chrome beyond what the parent `(dashboard)` layout already provides.
3. The `generation/page.tsx` SHALL be nested under this layout at `apps/web/app/(dashboard)/admin/generation/page.tsx`.

---

## Non-Functional Requirements

### Performance
- `GET /admin/pool-status` SHALL complete in under 3 seconds for the full curriculum (~200 cells) against the production Neon database.
- Approved/flagged/rejected counts and depletion rates SHALL be computed in a single SQL pass (one query for counts, one for depletion) rather than one query per cell; the existing `exercises_pool_lookup_idx` and `generation_jobs_cell_idx` indexes SHALL be used.
- IF the `user_exercise_history(exerciseId)` lookup in the depletion rate query causes a sequential scan, a covering index on `(exercise_id)` SHALL be added as part of this phase.

### Security
- Admin endpoints SHALL never be callable without a valid Clerk JWT (the standard `authMiddleware` runs first, returning 401 before the admin check).
- `ADMIN_USER_IDS` SHALL be read from the environment at request time (not cached at module load), so it can be updated without a Lambda redeploy.

### Reliability
- IF the `user_exercise_history` table is empty, `depletionRate7d` SHALL return `0` without error.
- IF `generation_jobs` is empty, all cost and count fields SHALL return `0` or empty arrays without error.

### Usability
- The dashboard page SHALL be readable without a chart library — plain color coding (red/amber/green inline styles or Tailwind classes) is sufficient.
- The pool coverage table SHALL be sortable client-side by `Coverage %` so the most depleted cells float to the top.
