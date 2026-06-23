# Admin Activity — Sessions DataTable Restructure — Design

**Date:** 2026-06-23
**Status:** Approved (design); pending implementation plan
**Branch:** `feat-admin-activity-datatable`

## Purpose

Restructure the `/admin/activity` **Sessions** tab from a problematic-only feed
into a full, paginated, filterable **DataTable** of all practice sessions, with
human-readable user names and inline row expansion.

Requirements (from the user):
1. Show **all** sessions, paginated, sorted by creation date **descending**
   (newest first), with a session-date column — regardless of risk.
2. Filter by **date range**, by **user**, and by **risk kind** (abandoned /
   low score / flagged).
3. Render as a **DataTable**.
4. Show user **first + last name**, not just `user_id`.
5. Clicking a row **expands the session content inline, directly below that
   row** (not below the whole table).

## Decisions locked during brainstorming

- **User names are persisted to the DB** (chosen over live Clerk fetch / email-only):
  add `first_name`/`last_name` to `users`, backfill once from Clerk, keep current
  via the webhook. No per-request Clerk calls.
- Inline expansion is feasible because the existing `DataTable` is a real
  `<table>` — an expansion `<tr>` with a `colSpan` cell renders beneath the
  clicked row. No separate page.
- Reuse existing primitives: `components/admin/data-table.tsx` (`DataTable`/`Th`/`Td`),
  the `content/page.tsx` prev/next pagination pattern, and the existing
  `SessionDetail` component + `useActivitySessionDetail` hook for expansion.

## Out of scope

- Per-column client sorting (fixed `startedAt DESC`).
- Live Clerk name fetching (rejected in favor of persistence).
- Changes to the Failures / Roster tabs.

---

## Section A — Data model & backend

### A1. Names on `users` (migration)

Add two nullable columns to `packages/db/src/schema/users.ts`:

```ts
firstName: text('first_name'),
lastName: text('last_name'),
```

Generate the Drizzle migration with `drizzle-kit generate`. **Migration gotcha**
(known issue): parallel branches collide on the next `NNNN` slot and CI forks
from `dev` — if a renumber conflict appears on merge, take main's
`migrations/meta`, `git rm` the stale `.sql`, and regenerate. Do **not** apply
this migration to the local/dev DB ad hoc (dev branch CI-fork pollution); let CI
apply it on the per-PR Neon branch.

### A2. Webhook keeps names current

`infra/lambda/src/routes/webhooks/clerk.ts`:
- `user.created`: also persist `first_name` / `last_name` from
  `event.data.first_name` / `event.data.last_name` (nullable).
- Add a `user.updated` case: update `first_name` / `last_name` / `email` for the
  existing row.

**Manual step (documented, not code):** subscribe the Clerk dashboard webhook to
`user.updated` (it currently subscribes to `user.created` + `user.deleted`).
Until then names still populate on creation + backfill; `user.updated` only keeps
later renames fresh.

### A3. One-off backfill script

New `pnpm` CLI under the lambda package (mirrors existing one-off scripts), using
`@clerk/backend` `createClerkClient(...).users.getUserList({ limit, offset })` to
page through all Clerk users and `UPDATE users SET first_name, last_name WHERE id`.
Idempotent; dry-run by default, `--apply` to write. **Run manually against prod**
(`CLERK_SECRET_KEY` from Secrets Manager) — never against dev (CI-fork pollution).

### A4. `GET /admin/activity/sessions` — reworked

**Query params (Zod-validated; 400 `VALIDATION_ERROR` on failure):**
- `user?: string` — ILIKE match against `first_name`, `last_name`, `email`, or `id`.
- `from?: string`, `to?: string` — ISO date(-time); filter on `practice_sessions.started_at`
  (`>= from`, `< to + 1 day` when `to` is a date — see A4 note).
- `risk?: ('abandoned'|'low_score'|'flagged')[]` — repeatable query param; multiple
  values OR together; absent → no risk filter (all sessions).
- `limit?: number` (default 25, max 100), `offset?: number` (default 0).
- (Removes `all` and the old `userId`; superseded.)

**Behavior:**
- `LEFT JOIN users ON users.id = practice_sessions.user_id` to read
  `firstName`/`lastName`/`email`.
- Reuse the existing signal SQL (`hasOpenFlag` correlated `EXISTS` with the
  qualified-literal `practice_sessions.id`; `isAbandoned`; `isLowScore`) for both
  the row badges AND the `risk` filter (`risk` builds an `OR` of the matching
  signal expressions, added to the `WHERE`).
- Default order `startedAt DESC` (no problematic-only filter anymore).
- **Two queries** (same `WHERE`): the page rows (`limit`/`offset`) and a
  `COUNT(*)` total.

**Response shape — CHANGED from a bare array to:**

```
{
  items: Array<{
    sessionId, userId, firstName: string|null, lastName: string|null, email: string|null,
    language, difficulty, exerciseCount, correctCount,
    completedAt: string|null, startedAt: string,
    signals: ('flagged'|'abandoned'|'low_score')[]
  }>,
  total: number
}
```

(`primarySignal` is dropped — the table renders the full `signals[]` badge set;
ordering is by date, not by signal rank.)

`from`/`to` date handling: treat a bare `YYYY-MM-DD` `to` as inclusive of that
whole day (`started_at < (to::date + 1)`). `from` is `started_at >= from::date`.

---

## Section B — API client (`packages/api-client`)

- Extend `ActivitySessionListItemSchema`: add `firstName: z.string().nullable()`,
  `lastName: z.string().nullable()`, `email: z.string().nullable()`; remove
  `primarySignal`.
- New `ActivitySessionsPageSchema = z.object({ items: ActivitySessionListItemSchema.array(), total: z.number() })`.
- `useActivitySessions`:
  - params: `{ user?: string; from?: string; to?: string; risk?: ('abandoned'|'low_score'|'flagged')[]; limit?: number; offset?: number }`.
  - `risk` serialized as repeated `risk=` params (extend `buildQueryString` if it
    doesn't already support array values, OR build that part manually).
  - returns the parsed `ActivitySessionsPage` (`{ items, total }`).
- `useActivitySessionDetail` unchanged.

---

## Section C — Web UI (`apps/web/app/(admin)/admin/activity/page.tsx`, `SessionsTab`)

### C1. Table

Render via `DataTable`/`Th`/`Td`. Columns (5):

| Date | User | Lang·Level | Score | Risk |
|---|---|---|---|---|
| `startedAt` `YYYY-MM-DD HH:mm` | name → email → `id.slice(0,12)…` | `TR·A2` | `2 / 5` or `incomplete` | risk badges from `signals[]`, empty if none |

- User display name: `firstName`/`lastName` joined if present; else `email`; else
  truncated id. Helper `displayUser(row)`.
- "Score" shows `correctCount / exerciseCount` when `completedAt` is set, else
  `incomplete`.

### C2. Filter bar (above the table)

- Date range: two `<input type="date">` (`from`, `to`).
- User: debounced `<input type="text">` (placeholder "name, email, or id").
- Risk: three toggle chips — `abandoned`, `low score`, `flagged` (multi-select;
  toggling updates the `risk[]` param).
- All controls `bg-card border-rule` per admin convention. Changing any filter
  resets `offset` to 0.

### C3. Pagination

Reuse the `content/page.tsx` pattern: `‹ prev` / `next ›` buttons (disabled at
bounds) + `page/totalPages` indicator, driven by `total` and `PAGE_SIZE = 25`.

### C4. Inline row expansion

- One expanded session at a time (`expandedId` state).
- Clicking a row toggles `expandedId`. When a row is expanded, render an
  **expansion `<tr>`** immediately after it: `<tr><td colSpan={5}>…</td></tr>`
  containing the existing `SessionDetail` (fed by `useActivitySessionDetail({ sessionId: expandedId })`).
- The clicked row gets an `aria-expanded` + a visual affordance (caret / bg).

---

## Testing

- **Lambda** (`admin.test.ts`, mocked-db queue): valid → 200 with `{items,total}`;
  risk filter builds the OR; date-range + user params validate; bad params → 400;
  401/403 paths; the handler issues the expected number of queries (rows + count)
  so the mock `queryQueue` staging is deterministic.
- **api-client** (`admin-activity.test.ts`): `ActivitySessionsPageSchema` parses
  `{items,total}`; list item parses with null names; risk array round-trips through
  the hook's query string.
- **Web** (`activity/__tests__/page.test.tsx`): rows render with display names;
  toggling a risk chip re-queries with `risk`; prev/next paginates; clicking a row
  renders `SessionDetail` in an expansion row beneath it (and a second click
  collapses).
- **Real-DB check** (established practice): esbuild-bundle the new join+count query
  and run it against the dev branch before shipping.

## Migration / rollout notes

- The endpoint response shape change (`array` → `{items,total}`) is breaking for
  the hook + page; all three change together in one PR.
- Backfill is a manual post-deploy step against prod; until it runs, rows show
  email/id fallback (graceful).
