# Admin Panel Foundation — Shell + Consolidated Auth (Design)

**Status:** approved · **Date:** 2026-06-16 · **Scope:** Tier 1, foundation only

Derived from `docs/admin-panel.md` (Tier 1, item 1: "Unified `/admin` shell +
consolidated auth"). This is the foundation the later Tier 1 surfaces (flagged
review queue, content browser, user inspector, generation job log) slot into.
Those surfaces, and the `admin_audit_log` (Tier 2), are **out of scope** here.

## Goal

1. Make `ADMIN_USER_IDS` the single source of truth for admin access, retiring
   the separate, manually-maintained Clerk `publicMetadata.admin` frontend gate.
2. Introduce a unified `/admin` shell with a left-nav so future surfaces slot in
   instead of sprawling into disjoint top-level routes.
3. Re-home the three existing admin pages under the shell with **no URL changes**.

## Background (current state, verified)

- **Backend gate:** `infra/lambda/src/middleware/admin.ts` (`adminMiddleware`)
  checks `ADMIN_USER_IDS` (comma-separated Clerk IDs). `isAdmin(userId)` lives in
  `infra/lambda/src/usage/plan.ts`. This is the real security boundary and is
  unchanged by this work.
- **`GET /me` already returns `isAdmin`.** `infra/lambda/src/routes/me.ts`
  computes `isAdmin: isAdmin(userId)`. **No backend change is needed.**
- **Client plumbing already exists.** `packages/api-client/src/schemas/me.ts`
  already declares `isAdmin: z.boolean()`; `MeResponseSchema` / `useMe` exist.
- **Frontend gate (to be replaced):** `apps/web/app/(dashboard)/admin/layout.tsx`
  reads `sessionClaims.publicMetadata.admin` — set manually per-user in the Clerk
  dashboard, drift-prone, and a second source of truth.
- **Existing admin pages** (all under `app/(dashboard)/admin/`, so they currently
  inherit the learner shell + the `(dashboard)` profile fetch):
  - `/admin/generation` — `GET /admin/pool-status`, `GET /admin/generation-stats` (server component)
  - `/admin/theory` — `GET /admin/theory/coverage` (server component)
  - `/admin/invites` — `GET/POST /admin/invites`, `POST /admin/invites/:id/revoke` (client, TanStack Query)
- **Existing shell idiom to mirror:** `apps/web/components/shell/nav.tsx`,
  `apps/web/components/shell/nav-items.tsx` (a `NAV_DESTINATIONS` array as the
  single source of truth, `usePathname` for active state).

## Architecture

**Admin gets its own route group: `app/(admin)/`.**

Route groups do not affect URLs, so the three pages keep byte-identical paths
(`/admin/generation`, `/admin/theory`, `/admin/invites`) — no route renames, no
URL-based test breakage. The move removes them from the learner `(dashboard)`
shell (so they no longer render the Today/Drill/Read/… sidebar) and removes their
dependency on the `(dashboard)` layout's `profiles/languages` fetch.

```
app/(admin)/
  layout.tsx          — auth gate (fetch /me, gate on isAdmin) wrapping <AdminShell>
  admin/
    page.tsx          — redirect('/admin/generation')
    generation/…      — moved verbatim from (dashboard)/admin/generation
    theory/…          — moved verbatim from (dashboard)/admin/theory
    invites/…         — moved verbatim from (dashboard)/admin/invites
```

The old `app/(dashboard)/admin/layout.tsx` and the `(dashboard)/admin/` directory
are removed.

## Components

### 1. Consolidated auth — `app/(admin)/layout.tsx`

Server component. Replaces the `publicMetadata.admin` read:

```tsx
const res = await apiFetch('/me');
if (!res.ok) redirect('/');
const me = MeResponseSchema.parse(await res.json());
if (!me.isAdmin) redirect('/');
return <AdminShell>{children}</AdminShell>;
```

- Uses the existing `apps/web/lib/api-server.ts` `apiFetch` (server-only, attaches
  the `api` JWT). `apiFetch` throws if there is no token — wrap in try/catch and
  `redirect('/')` on throw, so an unauthenticated hit lands on the public route
  rather than erroring.
- Imports `MeResponseSchema` from `@language-drill/api-client`.
- A short comment notes that `publicMetadata.admin` is no longer consulted and the
  Clerk session-token customization for it is now unused (no dashboard change
  required; leaving the Clerk setting in place is harmless).

### 2. `AdminShell` + `AdminNav` — `apps/web/components/admin/`

Mirrors the `components/shell/` pattern.

- `admin-nav-items.tsx`: `ADMIN_NAV` array — single source of truth. Live entries:
  - `{ label: 'Pool', href: '/admin/generation' }`
  - `{ label: 'Theory', href: '/admin/theory' }`
  - `{ label: 'Invites', href: '/admin/invites' }`
  - New sections (Moderation, Ops, Users) are appended here as they are built.
- `admin-nav.tsx`: client component (`'use client'`), `usePathname` for active
  highlighting, renders `ADMIN_NAV` as `next/link`s. Active match: exact or prefix
  on `href`.
- `admin-shell.tsx`: layout — fixed left sidebar (brand/title "Admin" + `AdminNav`)
  + a `<main>` content container. Server component is fine; it renders the client
  `AdminNav` inside. Reuse existing Tailwind tokens/spacing from `shell/nav.tsx`
  for visual consistency.

### 3. `/admin` index — `app/(admin)/admin/page.tsx`

`redirect('/admin/generation')`.

### 4. No premature abstraction

No shared `DataTable` / generic admin-table component yet. Build shared UI when the
first new surface (flagged queue) actually needs it (YAGNI).

## Testing

- **`(admin)/layout.tsx`** — add `layout.test.tsx`: mock `apiFetch` and
  `next/navigation`'s `redirect`.
  - `isAdmin: false` → `redirect('/')` called.
  - non-`ok` response → `redirect('/')`.
  - `apiFetch` throws → `redirect('/')`.
  - `isAdmin: true` → renders children (no redirect).
- **`AdminNav`** — render test: all `ADMIN_NAV` links present; active link gets the
  active class for a given `usePathname` value.
- **Regression grep** — search the web app for `publicMetadata.admin` and any test
  asserting the old gate; update/remove. Confirm no other code path depends on it.
- Run the standard gate before pushing: `pnpm lint && pnpm typecheck`, and
  `pnpm turbo run test --concurrency=1` (full suite, serial — avoids the known
  infra parallel flake).

## Out of scope (later tiers)

- `admin_audit_log` table and wiring (Tier 2).
- New surfaces: flagged review queue, content browser (demote/delete), user
  search/detail/progress drill-down, generation job log (the rest of Tier 1 —
  each its own follow-up spec).
- Any new API endpoints or DB migrations. This foundation touches the web app only.

## Risks / notes

- **Moving files across route groups**: ensure no relative imports inside the three
  page dirs break (they import from `@/…` aliases and `@language-drill/*`, so the
  move should be import-stable; verify `_components/` relative paths after the move).
- **E2E**: any authenticated admin smoke test now depends on `/me` returning
  `isAdmin: true` rather than a Clerk session claim — mock accordingly if such a
  test exists or is added. (No new e2e is required by this spec.)
