# Admin Audit Log Viewer (Design)

**Status:** approved · **Date:** 2026-06-17 · **Scope:** Tier 2 follow-up (read side of `admin_audit_log`)

The read-only companion to `admin_audit_log` (PR #334, which wired the write side into every
mutating admin action). Adds `GET /admin/audit` + an Audit nav page so the recorded trail is
actually viewable. Builds on the merged admin foundation, content browser, and pool drill-down.

## Goal

Let an admin browse the audit trail: a paginated, filterable table of who did what to which
entity, newest-first. Purely read-only — the table is append-only and nothing here mutates it.

## Background (verified against current code)

- **Table** (`packages/db/src/schema/audit.ts`): `adminAuditLog` — `id` (uuid), `adminUserId`
  (`admin_user_id` text notNull), `action` (text notNull), `targetType` (`target_type` text
  notNull), `targetId` (`target_id` text|null), `metadata` (jsonb|null), `createdAt`
  (`created_at` timestamptz notNull, indexed `admin_audit_log_created_at_idx`). Exported from
  `@language-drill/db`.
- **Action/target taxonomy** (`infra/lambda/src/lib/admin-audit.ts`): `AdminAuditAction` =
  `'flagged.approve'|'flagged.reject'|'content.demote'|'content.reject'|'generation.trigger'|
  'invite.create'|'invite.revoke'`; `AdminAuditTargetType` = `'exercise'|'theory_topic'|'cell'|
  'invite'`. These seed the UI dropdowns.
- **Admin router** (`infra/lambda/src/routes/admin.ts`): `/admin/*` gated by `authMiddleware +
  adminMiddleware`; query validated with zod `safeParse` → `400 { error, code:
  'VALIDATION_ERROR', details }`; dates serialized to ISO. Read-list pattern (filters + `{items,
  total}`) established by `GET /admin/content/*` (the `count()` total + `.limit().offset()` +
  `.orderBy()` shape).
- **api-client**: `packages/api-client/src/lib/build-query-string.ts` exports
  `buildQueryString(params)`. Query-hook idiom: `useContentExercises` (query key + parse with a
  Zod schema). Barrel `index.ts`.
- **Web**: `ADMIN_NAV` (`apps/web/components/admin/admin-nav-items.tsx`) is currently
  `[Moderation, Content, Pool, Theory, Invites]`. The client-page idiom (`useAuth` →
  `createAuthenticatedFetch` → hook, filters + pagination + states) is the content page
  (`app/(admin)/admin/content/page.tsx`); the raw-JSON `<details>` disclosure is
  `components/admin/content-field-view.tsx`.

## Architecture

A new **Audit** section at `/admin/audit` — a read-only **client** page with a filter bar +
paginated table, backed by a single new list endpoint. New `ADMIN_NAV` entry "Audit" appended
last. No migration (table exists); no mutations.

```
app/(admin)/admin/audit/
  page.tsx                 — client: filter bar + table + pagination + states
```

## API — `GET /admin/audit` (new, read-only, in `infra/lambda/src/routes/admin.ts`)

Query (all optional): `action` (string), `targetType` (string), `adminUserId` (string), `limit`
(int 1–200, default 50), `offset` (int ≥ 0, default 0). Validated with zod `safeParse` → `400
VALIDATION_ERROR` on bad input.

`action`/`targetType`/`adminUserId` are **free strings** (NOT enum-constrained) so the endpoint
keeps working when new action/target types are recorded before the UI dropdowns are updated.
Provided filters combine with `AND` (`eq`).

Returns:
```
{ items: Array<{
    id, adminUserId, action, targetType,
    targetId,            // string | null
    metadata,            // unknown (jsonb as-is) | null
    createdAt            // ISO string | null
  }>,
  total }                // count matching filters (items capped by limit/offset)
```
Ordered `createdAt DESC` (uses `admin_audit_log_created_at_idx`). Both `.limit(limit ?? 50)` and
`.offset(offset ?? 0)` applied. `total` via `count()` over the same filters.

## Web — `app/(admin)/admin/audit/page.tsx`

- `'use client'`; `useAuth()` → `createAuthenticatedFetch(getToken)` (memoized) → `useAuditLog`.
- Filter bar: an `action` `<select>` (options = the known `AdminAuditAction` values + "All"),
  a `targetType` `<select>` (known `AdminAuditTargetType` values + "All"), and an
  `adminUserId` text input. (The known-value lists are defined locally in the page or imported
  from a shared source — they're small literal arrays.)
- Table columns: **Time** (`createdAt` as a readable local timestamp, `—` if null), **Admin**
  (`adminUserId`), **Action** (`action`), **Target** (`targetType` + `targetId`), **Details**.
- **Details cell**: `metadata` shown as a compact one-line `JSON.stringify`, with the full
  pretty object in a `<details>`/`<summary>` disclosure (mirrors the content browser's raw-JSON
  pattern). Empty/null metadata → `—`.
- Pagination: `limit`=50, `offset` state; prev/next (prev disabled at offset 0, next disabled
  when `offset + limit >= total`); an "N events · page X/Y" line. Changing any filter resets
  `offset` to 0.
- States: loading, error ("Failed to load the audit log."), empty ("No audit events.").
- api-client: `schemas/audit.ts` (`AuditEntrySchema` with `metadata: z.unknown()`,
  `AuditLogResponseSchema = { items, total }`, `type AuditQuery` params) + `hooks/useAuditLog.ts`
  (`useAuditLog({ fetchFn, params, enabled })`, query key `['admin','audit', params]`, builds the
  URL via `buildQueryString`, parses with the response schema). Barrel-exported.

## Testing

- **Lambda** (`infra/lambda/src/routes/admin.test.ts`, chain-mock + `queryQueue`): list returns
  mapped items (`createdAt` → ISO, `metadata` passthrough) + `total`; the filter params build the
  query without error and a filtered call returns the staged rows; `limit > 200` or negative
  `offset` → `400 VALIDATION_ERROR`; empty result → `{ items: [], total: 0 }`. (The mock ignores
  WHERE/order, so assertions cover shape + validation, consistent with the other admin list
  tests.)
- **api-client** (`hooks/useAuditLog.test.ts`): builds
  `/admin/audit?action=invite.revoke&limit=50&offset=0` (or similar) and parses the response.
- **web** (`audit/page` test, mocking the hook + `useAuth`): renders a row's
  time/admin/action/target/details from a sample entry; the metadata disclosure shows; an empty
  result shows the empty state; a filter change calls the hook with `offset` reset. (Keep to the
  established page-test mocking idiom; the page is wiring over a tested hook.)
- Gate: `pnpm lint`, `pnpm typecheck`, `pnpm turbo run test --concurrency=1`.

## Out of scope

- Any mutation (append-only table; viewer is read-only).
- CSV/JSON export, date-range filtering, free-text search over metadata, live tail/auto-refresh
  (YAGNI for v1 — add when a real need appears).
- Deep-linking from a flagged item / cell to its audit entries (a later cross-link).
- No new migration (the table already exists from PR #334).

## Risks / notes

- **Free-string filters**: accepting any string for `action`/`targetType` means a typo in the
  (future) UI or a manual query returns an empty list rather than a 400 — acceptable for an
  admin tool and avoids coupling the endpoint to the enum's evolution. The dropdowns constrain
  normal use to valid values.
- **`metadata` is `z.unknown()`** at the client boundary (the column is free-form jsonb); the
  page renders it defensively (stringify), never assuming a shape.
- **Pagination + append-only**: new audit rows arrive at the top (`createdAt DESC`); paging back
  through older pages is stable since existing rows never change. A new row appearing between
  page loads can shift the offset window by one — acceptable for an audit browser.
- **`adminUserId` is an opaque Clerk id** — shown verbatim. A future enhancement could resolve it
  to an email, but that's out of scope.
