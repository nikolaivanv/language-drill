# Design Document

## Overview

Phase 5 adds a read-only operational layer on top of the existing exercise generation pipeline. The three deliverables are: (1) two new admin-only Lambda API endpoints backed by aggregating SQL queries, (2) a pure `targetCellSize` helper and Zod client schemas, and (3) a Next.js admin dashboard page that renders the data.

No new tables are introduced. The design stays entirely within the existing monorepo patterns: Hono middleware + router, Drizzle ORM queries, Zod schemas in `packages/api-client`, and Next.js App Router server components with a thin client island for interactivity.

---

## Steering Document Alignment

### Technical Standards (CLAUDE.md)
- Lambda backend stays separate from Next.js API routes — the two admin endpoints ship in `infra/lambda/src/routes/admin.ts`, following every existing route file.
- Drizzle ORM is used for all database access; no raw SQL strings except where `drizzle-orm/pg-core`'s `sql` tagged template is required for `NOW() - INTERVAL '7 days'` and aggregate FILTER clauses.
- Validation at system boundaries: query params are parsed with Zod `safeParse`; schema failures return 400 before any DB call.
- No gamification, no streaks — the dashboard is a pure operational tool.

### Project Structure (CLAUDE.md §Monorepo Layout)
- New files are co-located with existing peers: `routes/admin.ts` next to `routes/progress.ts`, `middleware/admin.ts` next to `middleware/auth.ts`, `schemas/pool-status.ts` next to `schemas/progress.ts`.
- The Next.js page follows the `(dashboard)` segment pattern; the admin layout guard follows the same redirect pattern that the existing dashboard layout uses for unauthenticated users.

---

## Code Reuse Analysis

### Existing Components to Leverage
- **`infra/lambda/src/middleware/auth.ts`**: Admin middleware (`middleware/admin.ts`) is modelled identically — same `Context<{ Bindings; Variables }>` signature, same `c.get('userId')` extraction, returns a JSON error and short-circuits via `return` before `next()`.
- **`infra/lambda/src/lib/exercise-filters.ts` (`approvedStatusFilter`, `APPROVED_STATUSES`)**: Pool status counts for approved exercises use the same status list.
- **`packages/db/src/generation/cells.ts` (`enumerateCurriculumCells`, `ROUND_1_CEFR_LEVELS`)**: Phase 4 introduced this as the canonical cell-universe builder. The pool-status endpoint calls `enumerateCurriculumCells(ALL_CURRICULA)` directly — the barrel doc at `packages/db/src/generation/index.ts` explicitly notes Phase 5 as the consumer. No need to duplicate the kind-compatibility logic.
- **`packages/db/src/lib/cell-key.ts` (`buildCellKey`, `buildCellKeyFromRow`)**: Phase 4 exported these two helpers via `@language-drill/db`. The pool-status handler uses `buildCellKey` when constructing lookup Maps from the curriculum cells, and `buildCellKeyFromRow` when keying exercise count rows from the DB — identical to the scheduler Lambda's approach.
- **`apps/web/lib/api-server.ts` (`apiFetch`)**: The admin page server component uses this existing helper directly; no new server-side fetch utility needed.
- **`packages/api-client/src/schemas/progress.ts`**: Template for Zod schema structure and export shape in the new `pool-status.ts`.

### Files That Must Also Be Modified
- **`infra/lib/constructs/lambda.ts`**: Add `ADMIN_USER_IDS` as a plain environment variable (not a Secrets Manager secret — it contains Clerk user ID strings, not credentials).
- **`infra/lambda/src/index.ts`**: Register the new `admin` router with `app.route('/', admin)`.
- **`packages/api-client/src/index.ts`**: Add re-exports for the two new schemas and their types.
- **`.env.example`**: Add `ADMIN_USER_IDS=dev_user_001` so new developers can call admin routes locally without reading source.
- **`packages/db/src/schema/progress.ts`**: Add the new `(exercise_id, evaluated_at)` covering index to `userExerciseHistory` (see Database Index section).

### Integration Points
- **`packages/db/src/schema/exercises.ts`**: Read-only. Queries `exercises` for per-cell counts filtered by `reviewStatus` and the pool lookup index columns.
- **`packages/db/src/schema/generation.ts` (`generationJobs`)**: Read-only. Queries `generation_jobs` for `lastRefilledAt` and cost/approval aggregates.
- **`packages/db/src/schema/progress.ts` (`userExerciseHistory`)**: Read-only. Queries for 7-day depletion counts, joined to `exercises` on `exerciseId`.
- **`infra/lambda/src/index.ts`**: Registers `admin` router (one new `app.route('/', admin)` line).
- **`packages/api-client/src/index.ts`**: Re-exports two new schemas and their types.
- **`apps/web/app/(dashboard)/layout.tsx`**: The new `admin/layout.tsx` is a sibling-level layout nested within `(dashboard)` — the parent layout continues to handle the shell, language switcher, and auth context.

---

## Architecture

```mermaid
graph TD
    A[Browser: /admin/generation] -->|Next.js RSC| B[admin/generation/page.tsx\nServer Component]
    B -->|apiFetch GET /admin/pool-status| C[Lambda: routes/admin.ts]
    B -->|apiFetch GET /admin/generation-stats| C
    C -->|adminMiddleware| D{ADMIN_USER_IDS check}
    D -->|403| E[Forbidden response]
    D -->|pass| F[SQL queries parallel]
    F -->|exercises counts| G[Neon Postgres]
    F -->|user_exercise_history 7d| G
    F -->|generation_jobs| G
    G -->|raw rows| H[merge with ALL_CURRICULA cells]
    H -->|targetCellSize per cell| I[PoolStatusItem[]]
    I -->|JSON 200| B
    B -->|data as props| J[PoolCoverageTable\nclient component]
    J -->|client sort| K[Rendered table]
```

---

## Components and Interfaces

### 1. `infra/lambda/src/middleware/admin.ts`

- **Purpose:** Hono middleware that enforces admin authorization for `/admin/*` routes. Reads `ADMIN_USER_IDS` from `process.env` at call time (never cached).
- **Interface:**
  ```ts
  export async function adminMiddleware(
    c: Context<{ Bindings: Bindings; Variables: Variables }>,
    next: Next,
  ): Promise<Response | void>
  ```
- **Dependencies:** `hono`, `middleware/auth.ts` (for `Bindings`/`Variables` types — no runtime import).
- **Logic:** `const adminIds = (process.env.ADMIN_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean); if (!adminIds.includes(c.get('userId'))) return c.json(…, 403);`

---

### 2. `infra/lambda/src/routes/admin.ts`

- **Purpose:** Hono router exposing `GET /admin/pool-status` and `GET /admin/generation-stats`. Both routes chain `authMiddleware` then `adminMiddleware`.
- **Dependencies:** `hono`, `drizzle-orm`, `@language-drill/db` (`ALL_CURRICULA`, `enumerateCurriculumCells`, `buildCellKey`, `buildCellKeyFromRow`, schema tables), `@language-drill/shared` (Language, CefrLevel, ExerciseType enums), `lib/exercise-filters`, `lib/target-cell-size`, `middleware/auth`, `middleware/admin`, `db`.

**`GET /admin/pool-status` internal flow:**

1. Parse and validate `?language` / `?level` query params with Zod.
2. Call `enumerateCurriculumCells(ALL_CURRICULA)` to get the full canonical cell list (grammar points → cloze + translation; vocab umbrellas → vocab_recall), then filter in-memory by the requested language/level.
3. Fire three DB queries in parallel (`Promise.all`):
   - **Q1 — exercise counts**: single aggregating query using FILTER clauses:
     ```sql
     SELECT language, difficulty, type, grammar_point_key,
       COUNT(*) FILTER (WHERE review_status IN ('auto-approved','manual-approved')) AS approved,
       COUNT(*) FILTER (WHERE review_status = 'flagged') AS flagged,
       COUNT(*) FILTER (WHERE review_status = 'rejected') AS rejected
     FROM exercises
     WHERE grammar_point_key IS NOT NULL
     GROUP BY language, difficulty, type, grammar_point_key
     ```
     The in-memory cell list handles filtering of the response; the SQL intentionally has no WHERE clause on `review_status` so all statuses are counted in a single pass. Note: the `exercises_pool_lookup_idx` partial index (which covers only `auto-approved`/`manual-approved`) is not engaged by this query — Postgres will use a full index scan on the four grouped columns instead. This is acceptable at current scale.
   - **Q2 — last refilled**: `SELECT cell_key, MAX(finished_at) AS last_refilled_at FROM generation_jobs WHERE status = 'succeeded' GROUP BY cell_key`
   - **Q3 — depletion rate**: `SELECT e.language, e.difficulty, e.type, e.grammar_point_key, COUNT(*) AS consumed_7d FROM user_exercise_history ueh JOIN exercises e ON e.id = ueh.exercise_id WHERE ueh.evaluated_at >= NOW() - INTERVAL '7 days' GROUP BY e.language, e.difficulty, e.type, e.grammar_point_key`
4. Build Maps keyed by `buildCellKey({ language, cefrLevel, exerciseType, grammarPointKey })` for O(1) lookup. For DB rows, use `buildCellKeyFromRow(row)` which handles nullable columns using the same sentinel pattern as the Phase 4 scheduler.
5. For each cell from step 2, merge DB results (defaulting counts to 0). For Q1, use `sql<number>\`COUNT(*)::int\`` in the Drizzle query to cast the bigint at the DB level — mirroring the scheduler Lambda's pattern (avoids a JS `Number()` cast at runtime). Call `targetCellSize(depletionRate7d)` using the depletion count divided by 7.
6. Sort by language → level → type → grammarPointKey. CEFR level sort is lexicographic (`A1 < A2 < B1 < B2`) which is correct for the four supported levels; this must be updated to use a rank lookup if C1/C2 are added in a future phase.
7. Return the response array.

**`GET /admin/generation-stats` internal flow:**

1. Run three DB aggregates in parallel:
   - **Q1 — cost this week / this month**: `SELECT COALESCE(SUM(cost_usd_estimate) FILTER (WHERE started_at >= NOW() - INTERVAL '7 days'), 0) AS week_cost, COALESCE(SUM(cost_usd_estimate) FILTER (WHERE started_at >= DATE_TRUNC('month', NOW())), 0) AS month_cost FROM generation_jobs` — `COALESCE` is required because `SUM` of zero rows returns SQL `NULL`.
   - **Q2 — job counts by status (7d)**: `SELECT status, COUNT(*) AS cnt FROM generation_jobs WHERE started_at >= NOW() - INTERVAL '7 days' GROUP BY status` — the handler must default all four status keys to 0 for statuses not returned by the query.
   - **Q3 — approval rates (30d)**: `SELECT cell_key, SUM(approved_count) AS approved, SUM(flagged_count) AS flagged, SUM(rejected_count) AS rejected FROM generation_jobs WHERE started_at >= NOW() - INTERVAL '30 days' GROUP BY cell_key`
2. Parse `language/level/type` from each row's `cellKey` by splitting on `:` and uppercasing the first two segments.
3. Aggregate Q3 rows by `(language, level, type)` (summing across grammar points). All `SUM()` results are Postgres `bigint`, returned by Drizzle as strings — cast with `Number()` before arithmetic. Compute `approvalRate = Number(approved) / (Number(approved) + Number(flagged) + Number(rejected))` rounded to 3 decimal places; filter rows where the denominator is zero.
4. All `cost_usd_estimate` values are Postgres `numeric`, returned by Drizzle as strings — parse with `parseFloat()` before returning as JSON numbers.
5. Return the combined response object.

---

### 3. `packages/db/src/lib/target-cell-size.ts`

- **Purpose:** Pure function mapping a 7-day depletion rate to a target pool size.
- **Interface:**
  ```ts
  export function targetCellSize(depletionRate7d: number): number
  ```
- **Dependencies:** None.
- **Reuses:** Nothing (pure data → data transform).

---

### 4. `packages/api-client/src/schemas/pool-status.ts`

- **Purpose:** Zod schemas and inferred types for `/admin/pool-status` and `/admin/generation-stats` response shapes.
- **Interface:**
  ```ts
  export const PoolStatusItemSchema = z.object({ ... });
  export type PoolStatusItem = z.infer<typeof PoolStatusItemSchema>;

  export const GenerationStatsSchema = z.object({ ... });
  export type GenerationStats = z.infer<typeof GenerationStatsSchema>;
  ```
- **Reuses:** Zod (already a dependency of `packages/api-client`).

---

### 5. `apps/web/app/(dashboard)/admin/layout.tsx`

- **Purpose:** Server-side admin guard. Redirects non-admins before rendering children.
- **Interface:** Standard Next.js layout (`children: React.ReactNode`).
- **Dependencies:** `@clerk/nextjs/server` (`auth()`), `next/navigation` (`redirect()`).
- **Logic:**
  ```ts
  const { sessionClaims } = await auth();
  if (!sessionClaims?.publicMetadata?.admin) redirect('/');
  return <>{children}</>;
  ```
  Note: `publicMetadata` is the correct Clerk property path (not `metadata`). For `sessionClaims.publicMetadata` to be populated in the JWT, the Clerk JWT template named `api` (configured in the Clerk dashboard per CLAUDE.md) must include `"publicMetadata": "{{ user.public_metadata }}"` in its claims. This template update is a prerequisite for the admin check to work in production; without it, `publicMetadata` is always `undefined` and all users are redirected.
- **Reuses:** Same `auth()` import pattern as the existing `apps/web/app/(dashboard)/settings/` protected logic.

---

### 6. `apps/web/app/(dashboard)/admin/generation/page.tsx`

- **Purpose:** Server Component that fetches both admin API endpoints and renders the four dashboard panels.
- **Dependencies:** `apps/web/lib/api-server.ts` (`apiFetch`), `@language-drill/api-client` (schemas for type-safe parse), child components.
- **Data flow:**
  1. `const [poolRes, statsRes] = await Promise.all([apiFetch('/admin/pool-status'), apiFetch('/admin/generation-stats')]);`
  2. If `poolRes.status === 403` or `statsRes.status === 403`, call `redirect('/')` (Req 6, criterion 10). If any other non-2xx, render an inline error message for that panel (no throw).
  3. Parse with `PoolStatusItemSchema.array().parse(...)` and `GenerationStatsSchema.parse(...)`.
  4. Pass `poolItems` as props to `<PoolCoverageTable>` (client component).
  5. Render Cost panel, Job summary, Approval rate table as static JSX (no interactivity needed for those three).

---

### 7. `apps/web/app/(dashboard)/admin/generation/_components/pool-coverage-table.tsx`

- **Purpose:** `"use client"` component that renders the sortable pool coverage table.
- **Interface:**
  ```ts
  type Props = { items: PoolStatusItem[] };
  export function PoolCoverageTable({ items }: Props)
  ```
- **Dependencies:** React `useState` (sort state), `@language-drill/api-client` (`PoolStatusItem` type).
- **Logic:** `useMemo` to sort `items` by `approved / targetSize` (asc/desc) on click. Color coding via inline `className` ternary or `style={{ background }}`.
- **Reuses:** Existing Tailwind classes from the design system.

---

## Data Models

### PoolStatusItem (API response shape)
```
{
  language: string          // 'ES' | 'DE' | 'TR'
  level: string             // 'A1' | 'A2' | 'B1' | 'B2'
  type: string              // 'cloze' | 'translation' | 'vocab_recall'
  grammarPointKey: string   // e.g. 'es-b1-present-subjunctive'
  approved: number          // integer ≥ 0
  flagged: number           // integer ≥ 0
  rejected: number          // integer ≥ 0
  lastRefilledAt: string | null  // ISO 8601 or null
  depletionRate7d: number   // ≥ 0, one decimal place
  targetSize: number        // 50 | 75 | 100 | 200
}
```

### GenerationStats (API response shape)
```
{
  costThisWeekUsd: number         // ≥ 0, 4 decimal places
  costThisMonthUsd: number        // ≥ 0, 4 decimal places
  jobsThisWeek: {
    succeeded: number
    failed: number
    running: number
    queued: number
  }
  approvalRates: Array<{
    language: string
    level: string
    type: string
    approvedCount: number
    flaggedCount: number
    rejectedCount: number
    approvalRate: number          // 0..1, 3 decimal places
  }>
}
```

---

## Database Index

The depletion rate query (Q3 in `GET /admin/pool-status`) joins `user_exercise_history` to `exercises` on `exercise_id` and filters by `evaluated_at >= NOW() - INTERVAL '7 days'`. The existing indexes on `user_exercise_history` are `(userId, evaluatedAt DESC)` and `(sessionId)` — neither covers the `exerciseId` join column or a bare `evaluatedAt` filter.

A new Drizzle migration adds a covering index. The composite `(exercise_id, evaluated_at)` form is preferred over a bare `(exercise_id)` index because it allows Postgres to satisfy the `evaluated_at >= NOW() - INTERVAL '7 days'` filter from the index without a heap fetch for the time predicate:

```ts
// packages/db/src/schema/progress.ts — added to userExerciseHistory table options
exerciseIdEvaluatedAtIdx: index('user_exercise_history_exercise_id_idx')
  .on(table.exerciseId, table.evaluatedAt),
```

This index is added via a Drizzle migration generated by `pnpm drizzle-kit generate`.

Additional note: `evaluated_at` is currently defined as `timestamp('evaluated_at')` (without timezone). The Q3 depletion query compares it to `NOW()` which returns `timestamptz`. Postgres handles this via implicit cast using the session timezone — this is correct in practice (dev and production both use UTC), but the column should be migrated to `timestamp(..., { withTimezone: true })` in a follow-up to eliminate the implicit cast risk.

---

## Error Handling

### Error Scenarios

1. **Non-admin user calls `/admin/*`**
   - **Handling:** `adminMiddleware` returns 403 before any DB query.
   - **User Impact:** API: `{ "error": "Forbidden", "code": "FORBIDDEN" }`. Dashboard: `layout.tsx` redirects to `/` before the page renders; the client never reaches the API.

2. **Invalid query params on `GET /admin/pool-status`**
   - **Handling:** Zod `safeParse` fails; route handler returns 400 with `{ "error": "Invalid query parameters", "code": "VALIDATION_ERROR" }`.
   - **User Impact:** API callers receive structured error. Dashboard page always calls without invalid params (it constructs the URL programmatically).

3. **Empty database tables (early dev)**
   - **Handling:** All SQL aggregates return null or zero rows; the handler defaults counts to 0 and `lastRefilledAt` to null.
   - **User Impact:** Dashboard shows all-zero table, which is correct for a fresh install.

4. **API fetch error in the dashboard page**
   - **Handling:** `apiFetch` rejects or returns non-2xx; `page.tsx` catches and renders `<p className="text-red-600">Failed to load: {error.message}</p>` in place of the failed panel.
   - **User Impact:** Other panels that succeeded still render; only the failed panel shows an error message.

5. **Admin middleware environment variable not set**
   - **Handling:** `ADMIN_USER_IDS` defaults to empty string → all users get 403.
   - **User Impact:** Dashboard is inaccessible until the env var is configured — intentional fail-closed behavior.

---

## Testing Strategy

### Unit Testing
- `packages/db/src/lib/target-cell-size.test.ts` — covers all four tier boundaries (0, 0.9, 1, 4.9, 5, 9.9, 10, 100) as well as the exact boundary values.
- `packages/api-client/src/schemas/pool-status.test.ts` — parses valid fixture objects for both schemas; rejects objects missing required fields; verifies `null` is accepted for `lastRefilledAt`.
- `infra/lambda/src/middleware/admin.test.ts` — unit tests with a mock Hono context; covers: admin in list → next called, admin not in list → 403, env var empty → 403, multiple IDs in env var → correct user passes, dev user `dev_user_001` passes when present.

### Integration Testing
- `infra/lambda/src/routes/admin.test.ts` — tests against a mocked `db` object; covers: unauthenticated → 401 (from `authMiddleware` mock), non-admin → 403, valid admin + filters `?language=ES&level=B1` → 200 with filtered items only, invalid level → 400, empty DB tables → 200 with all-zero counts, generation-stats → correct shape including empty `approvalRates` array when no jobs.

### Manual Smoke (post-implementation)
1. `ADMIN_USER_IDS=dev_user_001 pnpm dev:api` → `curl http://localhost:3001/admin/pool-status` returns 200 with all curriculum cells.
2. Same curl without `ADMIN_USER_IDS` set → 403.
3. `http://localhost:3000/admin/generation` as dev user → dashboard renders; as a non-admin Clerk user → redirects to `/`.
4. Clicking the `Coverage %` column header in the pool table toggles sort order client-side without a network request.
