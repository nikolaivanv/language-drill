# Admin Audit Log Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only `/admin/audit` viewer (filterable, paginated table) over the `admin_audit_log` table, backed by a new `GET /admin/audit` endpoint.

**Architecture:** One new admin list endpoint (filters + `{items,total}` + `createdAt DESC`), a `useAuditLog` query hook, and a client page with a filter bar + table + pagination — mirroring the `/admin/content` read side. New "Audit" nav entry. No migration (table exists), no mutations.

**Tech Stack:** Hono + Drizzle (Lambda), Vitest, Zod, TanStack Query, Next.js client components, Tailwind.

---

## Context the implementer needs

Work from the worktree `/Users/seal/dev/language-drill/.claude/worktrees/feat-admin-audit-viewer` (branch `feat-admin-audit-viewer`). `cd` into it in every Bash call. Paths contain a `(admin)` route-group segment — quote them.

**Workspace dist:** if a test errors resolving `@language-drill/*`, run `pnpm build` at repo root once. If the full lambda test run shows phantom failures from stale `infra/lambda/dist/**/*.test.js`, `rm -rf infra/lambda/dist` and re-run.

**Single-file test commands:** `pnpm --filter @language-drill/lambda test <path>` · `pnpm --filter @language-drill/api-client test <path>` · `pnpm --filter @language-drill/web test <path>`.

**Key existing code:**
- `infra/lambda/src/routes/admin.ts`: Hono admin router; `/admin/*` gated by `authMiddleware + adminMiddleware`. Imports from `drizzle-orm` already include `and, asc, count, desc, eq, gte, inArray, isNotNull, sql`. Imports from `@language-drill/db` include `exercises, theoryTopics, generationJobs, invitations, ALL_CURRICULA, …` — **`adminAuditLog` is NOT yet imported here; add it.** Query validation: `Schema.safeParse(c.req.query())` → `400 { error, code:'VALIDATION_ERROR', details: parsed.error.flatten() }`. The `GET /admin/content/exercises` route is the read-list template (filter `conds` array + `and(...conds)` + `Promise.all([rows, count])` + `.orderBy().limit().offset()` + ISO date mapping).
- `adminAuditLog` (`@language-drill/db`): columns `id`, `adminUserId`, `action`, `targetType`, `targetId` (nullable), `metadata` (jsonb nullable), `createdAt` (timestamptz, indexed). The Drizzle field names are `adminUserId`, `targetType`, `targetId`, `createdAt` (camelCase).
- `infra/lambda/src/routes/admin.test.ts`: chain-mock `db` + shared `queryQueue` (awaiting a chain shifts the next staged value). The `@language-drill/db` mock **already has** `adminAuditLog: { __mock: 'adminAuditLog' }` (added in the audit-log write-side PR). Uses an `app.request(path, init, adminEnv)` helper.
- api-client: `packages/api-client/src/lib/build-query-string.ts` → `buildQueryString(params: Record<string, string|number|undefined>)`. Query-hook idiom: `packages/api-client/src/hooks/useContentBrowser.ts` (`useContentExercises`). Barrel `packages/api-client/src/index.ts`. `createAuthenticatedFetch`/`type AuthenticatedFetch` exported.
- Web: `ADMIN_NAV` (`apps/web/components/admin/admin-nav-items.tsx`) = `[Moderation, Content, Pool, Theory, Invites]`; its test `apps/web/components/admin/__tests__/admin-nav.test.tsx` asserts that exact order. Client-page idiom + filter/pagination: `apps/web/app/(admin)/admin/content/page.tsx`.

---

## File structure

**Lambda (modify):** `infra/lambda/src/routes/admin.ts` (+`GET /admin/audit`), `admin.test.ts` (+tests).
**api-client (create/modify):** `schemas/audit.ts` (new), `hooks/useAuditLog.ts` (new), `hooks/useAuditLog.test.ts` (new), `index.ts` (barrel).
**web (create/modify):** `app/(admin)/admin/audit/page.tsx` (new) + `__tests__/page.test.tsx` (new); `components/admin/admin-nav-items.tsx` (+ its test).

---

## Task 1: Lambda — `GET /admin/audit`

**Files:** Modify `infra/lambda/src/routes/admin.ts`, `infra/lambda/src/routes/admin.test.ts`.

- [ ] **Step 1: Write failing tests**

Append to `admin.test.ts` (use the file's `app.request(path, init, adminEnv)` helper):
```ts
describe('GET /admin/audit', () => {
  it('returns mapped items + total, newest-first', async () => {
    queryQueue.push([
      {
        id: 'a1', adminUserId: 'admin-1', action: 'flagged.approve', targetType: 'exercise',
        targetId: 'ex-1', metadata: { outcome: 'approved' }, createdAt: new Date('2026-06-17T00:00:00Z'),
      },
    ]); // items
    queryQueue.push([{ count: 12 }]); // total
    const res = await app.request('/admin/audit?limit=50&offset=0', undefined, adminEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.total).toBe(12);
    expect(body.items[0]).toMatchObject({
      id: 'a1', adminUserId: 'admin-1', action: 'flagged.approve', targetType: 'exercise',
      targetId: 'ex-1', metadata: { outcome: 'approved' }, createdAt: '2026-06-17T00:00:00.000Z',
    });
  });

  it('accepts action/targetType/adminUserId filters', async () => {
    queryQueue.push([]); // items
    queryQueue.push([{ count: 0 }]); // total
    const res = await app.request('/admin/audit?action=invite.revoke&targetType=invite&adminUserId=admin-1', undefined, adminEnv);
    expect(res.status).toBe(200);
    expect((await res.json()).items).toEqual([]);
  });

  it('rejects limit over 200 with 400', async () => {
    const res = await app.request('/admin/audit?limit=201', undefined, adminEnv);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('VALIDATION_ERROR');
  });

  it('returns empty result on an empty log', async () => {
    queryQueue.push([]); // items
    queryQueue.push([{ count: 0 }]); // total
    const res = await app.request('/admin/audit', undefined, adminEnv);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [], total: 0 });
  });
});
```

- [ ] **Step 2: Run, expect FAIL (404)** — `pnpm --filter @language-drill/lambda test src/routes/admin.test.ts`

- [ ] **Step 3: Implement**

In `infra/lambda/src/routes/admin.ts`: add `adminAuditLog` to the `@language-drill/db` import. Then add:
```ts
const AuditQuerySchema = z.object({
  action: z.string().optional(),
  targetType: z.string().optional(),
  adminUserId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

admin.get('/admin/audit', async (c) => {
  const parsed = AuditQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'Invalid query parameters', code: 'VALIDATION_ERROR', details: parsed.error.flatten() }, 400);
  }
  const { action, targetType, adminUserId, limit, offset } = parsed.data;
  const conds = [];
  if (action) conds.push(eq(adminAuditLog.action, action));
  if (targetType) conds.push(eq(adminAuditLog.targetType, targetType));
  if (adminUserId) conds.push(eq(adminAuditLog.adminUserId, adminUserId));
  const where = conds.length > 0 ? and(...conds) : undefined;

  const [rows, totalRows] = await Promise.all([
    db.select({
      id: adminAuditLog.id,
      adminUserId: adminAuditLog.adminUserId,
      action: adminAuditLog.action,
      targetType: adminAuditLog.targetType,
      targetId: adminAuditLog.targetId,
      metadata: adminAuditLog.metadata,
      createdAt: adminAuditLog.createdAt,
    }).from(adminAuditLog).where(where)
      .orderBy(desc(adminAuditLog.createdAt))
      .limit(limit ?? 50).offset(offset ?? 0),
    db.select({ count: count() }).from(adminAuditLog).where(where),
  ]);

  const items = rows.map((r) => ({
    id: r.id,
    adminUserId: r.adminUserId,
    action: r.action,
    targetType: r.targetType,
    targetId: r.targetId,
    metadata: r.metadata,
    createdAt: r.createdAt ? r.createdAt.toISOString() : null,
  }));
  return c.json({ items, total: Number(totalRows[0]?.count ?? 0) });
});
```

- [ ] **Step 4: Run, expect PASS** — `pnpm --filter @language-drill/lambda test src/routes/admin.test.ts` (run `pnpm build` at repo root first if a workspace-dist resolve error occurs)
- [ ] **Step 5: Typecheck** — `pnpm --filter @language-drill/lambda typecheck` → clean
- [ ] **Step 6: Commit**
```bash
git add infra/lambda/src/routes/admin.ts infra/lambda/src/routes/admin.test.ts
git commit -m "feat(admin): GET /admin/audit — paginated, filterable audit log list"
```

---

## Task 2: api-client — `useAuditLog`

**Files:** Create `packages/api-client/src/schemas/audit.ts`, `hooks/useAuditLog.ts`, `hooks/useAuditLog.test.ts`; modify `index.ts`.

- [ ] **Step 1: Create the schema**

`packages/api-client/src/schemas/audit.ts`:
```ts
import { z } from 'zod';

export const AuditEntrySchema = z.object({
  id: z.string(),
  adminUserId: z.string(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string().nullable(),
  metadata: z.unknown(),
  createdAt: z.string().nullable(),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export const AuditLogResponseSchema = z.object({
  items: z.array(AuditEntrySchema),
  total: z.number(),
});

export type AuditQuery = {
  action?: string;
  targetType?: string;
  adminUserId?: string;
  limit?: number;
  offset?: number;
};
```

- [ ] **Step 2: Write the failing hook test**

`packages/api-client/src/hooks/useAuditLog.test.ts` (match the wrapper idiom in `useContentBrowser.test.ts`):
```ts
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { useAuditLog } from './useAuditLog';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
}
function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

describe('useAuditLog', () => {
  it('builds the query string from params and parses the response', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ items: [], total: 0 }));
    const { result } = renderHook(
      () => useAuditLog({ fetchFn, params: { action: 'invite.revoke', limit: 50, offset: 0 } }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ items: [], total: 0 });
    expect(fetchFn).toHaveBeenCalledWith('/admin/audit?action=invite.revoke&limit=50&offset=0');
  });
});
```

- [ ] **Step 3: Run, expect FAIL** — `pnpm --filter @language-drill/api-client test src/hooks/useAuditLog.test.ts`

- [ ] **Step 4: Create the hook**

`packages/api-client/src/hooks/useAuditLog.ts`:
```ts
import { useQuery } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../fetchClient';
import { buildQueryString } from '../lib/build-query-string';
import { AuditLogResponseSchema, type AuditQuery } from '../schemas/audit';

export function useAuditLog({
  fetchFn, params = {}, enabled = true,
}: { fetchFn: AuthenticatedFetch; params?: AuditQuery; enabled?: boolean }) {
  return useQuery({
    queryKey: ['admin', 'audit', params],
    queryFn: async () => {
      const res = await fetchFn(`/admin/audit${buildQueryString({ ...params })}`);
      const json: unknown = await res.json();
      return AuditLogResponseSchema.parse(json);
    },
    enabled,
  });
}
```

- [ ] **Step 5: Barrel exports** — add to `packages/api-client/src/index.ts`:
```ts
export { AuditEntrySchema, AuditLogResponseSchema, type AuditEntry, type AuditQuery } from './schemas/audit';
export { useAuditLog } from './hooks/useAuditLog';
```

- [ ] **Step 6: Test + typecheck + build**
- `pnpm --filter @language-drill/api-client test src/hooks/useAuditLog.test.ts` → 1 pass
- `pnpm --filter @language-drill/api-client typecheck` → clean
- `pnpm --filter @language-drill/api-client build` → success

- [ ] **Step 7: Commit**
```bash
git add packages/api-client/src/schemas/audit.ts packages/api-client/src/hooks/useAuditLog.ts packages/api-client/src/hooks/useAuditLog.test.ts packages/api-client/src/index.ts
git commit -m "feat(admin): api-client useAuditLog hook + schema"
```

---

## Task 3: web — Audit page + nav entry

**Files:** Create `apps/web/app/(admin)/admin/audit/page.tsx` + `__tests__/page.test.tsx`; modify `apps/web/components/admin/admin-nav-items.tsx` + its test.

- [ ] **Step 1: Update the nav test (RED)**

In `apps/web/components/admin/__tests__/admin-nav.test.tsx`, update the order assertions to append Audit:
```tsx
    expect(ADMIN_NAV.map((d) => d.href)).toEqual([
      '/admin/moderation', '/admin/content', '/admin/generation', '/admin/theory', '/admin/invites', '/admin/audit',
    ]);
    expect(ADMIN_NAV.map((d) => d.label)).toEqual([
      'Moderation', 'Content', 'Pool', 'Theory', 'Invites', 'Audit',
    ]);
```

- [ ] **Step 2: Run nav test, expect FAIL** — `pnpm --filter @language-drill/web test "components/admin/__tests__/admin-nav.test.tsx"`

- [ ] **Step 3: Add the Audit nav entry**

In `apps/web/components/admin/admin-nav-items.tsx`, append to `ADMIN_NAV`:
```tsx
  { href: '/admin/audit', label: 'Audit' },
```

- [ ] **Step 4: Run nav test, expect PASS** — `pnpm --filter @language-drill/web test "components/admin/__tests__/admin-nav.test.tsx"`

- [ ] **Step 5: Write the failing page test**

`apps/web/app/(admin)/admin/audit/__tests__/page.test.tsx`:
```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@clerk/nextjs', () => ({ useAuth: () => ({ getToken: vi.fn() }) }));

const mockUseAuditLog = vi.fn();
vi.mock('@language-drill/api-client', async () => {
  const actual = await vi.importActual<typeof import('@language-drill/api-client')>('@language-drill/api-client');
  return { ...actual, createAuthenticatedFetch: () => vi.fn(), useAuditLog: (args: unknown) => mockUseAuditLog(args) };
});

import AuditPage from '../page';

beforeEach(() => {
  mockUseAuditLog.mockReset();
});

describe('AuditPage', () => {
  it('renders an audit row (time/admin/action/target/details)', () => {
    mockUseAuditLog.mockReturnValue({
      isLoading: false, isError: false,
      data: { items: [{ id: 'a1', adminUserId: 'admin-1', action: 'flagged.approve', targetType: 'exercise', targetId: 'ex-1', metadata: { outcome: 'approved' }, createdAt: '2026-06-17T00:00:00.000Z' }], total: 1 },
    });
    render(<AuditPage />);
    expect(screen.getByText('flagged.approve')).toBeInTheDocument();
    expect(screen.getByText('admin-1')).toBeInTheDocument();
    expect(screen.getByText(/ex-1/)).toBeInTheDocument();
    expect(screen.getByText(/"outcome":"approved"/)).toBeInTheDocument();
  });

  it('shows the empty state', () => {
    mockUseAuditLog.mockReturnValue({ isLoading: false, isError: false, data: { items: [], total: 0 } });
    render(<AuditPage />);
    expect(screen.getByText(/no audit events/i)).toBeInTheDocument();
  });

  it('resets offset to 0 when a filter changes', () => {
    mockUseAuditLog.mockReturnValue({ isLoading: false, isError: false, data: { items: [], total: 0 } });
    render(<AuditPage />);
    fireEvent.change(screen.getByLabelText(/action/i), { target: { value: 'invite.revoke' } });
    // The most recent call's params reflect the new filter with offset 0.
    const lastArgs = mockUseAuditLog.mock.calls.at(-1)![0];
    expect(lastArgs.params).toMatchObject({ action: 'invite.revoke', offset: 0 });
  });
});
```

- [ ] **Step 6: Run, expect FAIL** — `pnpm --filter @language-drill/web test "app/(admin)/admin/audit/__tests__/page.test.tsx"`

- [ ] **Step 7: Implement the page**

`apps/web/app/(admin)/admin/audit/page.tsx`:
```tsx
'use client';

import { useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { createAuthenticatedFetch, useAuditLog, type AuditQuery } from '@language-drill/api-client';

const PAGE_SIZE = 50;
const ACTIONS = [
  'flagged.approve', 'flagged.reject', 'content.demote', 'content.reject',
  'generation.trigger', 'invite.create', 'invite.revoke',
];
const TARGET_TYPES = ['exercise', 'theory_topic', 'cell', 'invite'];

export default function AuditPage() {
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  const [filters, setFilters] = useState<{ action?: string; targetType?: string; adminUserId?: string }>({});
  const [offset, setOffset] = useState(0);

  const params: AuditQuery = { ...filters, limit: PAGE_SIZE, offset };
  const audit = useAuditLog({ fetchFn, params });
  const total = audit.data?.total ?? 0;
  const items = audit.data?.items ?? [];

  const setFilter = (key: keyof typeof filters, value: string) => {
    setFilters((f) => ({ ...f, [key]: value || undefined }));
    setOffset(0);
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-[24px] font-semibold text-ink">Audit log</h1>

      <div className="flex gap-2 flex-wrap text-[13px]">
        <select aria-label="action" value={filters.action ?? ''} onChange={(e) => setFilter('action', e.target.value)}>
          <option value="">All actions</option>
          {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select aria-label="target type" value={filters.targetType ?? ''} onChange={(e) => setFilter('targetType', e.target.value)}>
          <option value="">All targets</option>
          {TARGET_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input aria-label="admin user id" placeholder="admin user id" value={filters.adminUserId ?? ''} onChange={(e) => setFilter('adminUserId', e.target.value)} />
      </div>

      {audit.isLoading ? <p className="text-ink-soft text-[13px]">Loading…</p>
        : audit.isError ? <p className="text-ink-soft text-[13px]">Failed to load the audit log.</p>
        : items.length === 0 ? <p className="text-ink-soft text-[13px]">No audit events.</p>
        : (
          <>
            <p className="text-[12px] text-ink-soft">
              {total} event{total === 1 ? '' : 's'} · page {Math.floor(offset / PAGE_SIZE) + 1}/{Math.max(1, Math.ceil(total / PAGE_SIZE))}
            </p>
            <table className="text-[13px]">
              <thead>
                <tr><th>Time</th><th>Admin</th><th>Action</th><th>Target</th><th>Details</th></tr>
              </thead>
              <tbody>
                {items.map((e) => (
                  <tr key={e.id}>
                    <td className="text-ink-soft">{e.createdAt ? new Date(e.createdAt).toLocaleString() : '—'}</td>
                    <td>{e.adminUserId}</td>
                    <td>{e.action}</td>
                    <td className="text-ink-soft">{e.targetType}{e.targetId ? ` · ${e.targetId}` : ''}</td>
                    <td>
                      {e.metadata !== null && e.metadata !== undefined ? (
                        <details>
                          <summary className="cursor-pointer text-ink-soft">{JSON.stringify(e.metadata)}</summary>
                          <pre className="mt-1 whitespace-pre-wrap break-words text-[12px]">{JSON.stringify(e.metadata, null, 2)}</pre>
                        </details>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex gap-2 items-center text-[13px]">
              <button disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))} className="text-ink-soft disabled:opacity-40">‹ prev</button>
              <button disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset((o) => o + PAGE_SIZE)} className="text-ink-soft disabled:opacity-40">next ›</button>
            </div>
          </>
        )}
    </div>
  );
}
```

- [ ] **Step 8: Run, expect PASS** — `pnpm --filter @language-drill/web test "app/(admin)/admin/audit/__tests__/page.test.tsx" "components/admin/__tests__/admin-nav.test.tsx"`
- [ ] **Step 9: Typecheck web** — `pnpm --filter @language-drill/web typecheck` → clean (the known pre-existing `e2e/helpers/auth.ts` worktree-dist error is acceptable if it's the only one; resolved by the full turbo typecheck in Task 4).
- [ ] **Step 10: Commit**
```bash
git add "apps/web/app/(admin)/admin/audit/page.tsx" "apps/web/app/(admin)/admin/audit/__tests__/page.test.tsx" "apps/web/components/admin/admin-nav-items.tsx" "apps/web/components/admin/__tests__/admin-nav.test.tsx"
git commit -m "feat(admin): audit log viewer page + nav entry"
```

---

## Task 4: Full verification

**Files:** none.

- [ ] **Step 1: Lint** — `pnpm lint` → no errors
- [ ] **Step 2: Repo typecheck** — `pnpm typecheck` → no errors (all packages)
- [ ] **Step 3: Full serial test suite** — `pnpm turbo run test --concurrency=1` → all packages pass. (If `@language-drill/lambda` reports phantom failures from stale compiled `infra/lambda/dist/**/*.test.js`, `rm -rf infra/lambda/dist` and re-run.)
- [ ] **Step 4: Commit (only if a lint/format autofix changed files; else skip)**
```bash
git add -A && git commit -m "chore(admin): verification fixes" || echo "nothing to commit"
```

---

## Self-review notes

- **Spec coverage:** `GET /admin/audit` with optional action/targetType/adminUserId filters (free strings), `limit`/`offset` pagination, `createdAt DESC`, `{items,total}` (Task 1); `useAuditLog` hook + schema with `metadata: z.unknown()` (Task 2); page with filter dropdowns seeded from the known action/target literals + adminUserId input, table (Time/Admin/Action/Target/Details), metadata `<details>` disclosure, pagination + offset-reset + states, "Audit" nav entry (Task 3); tests throughout + Task 4. Read-only (no mutations); no migration.
- **Type consistency:** `AuditEntry` field names (`adminUserId`, `targetType`, `targetId`, `metadata`, `createdAt`) match the Lambda response mapping (Task 1) and the page's row rendering (Task 3); `AuditQuery` params (`action/targetType/adminUserId/limit/offset`) match the endpoint's query schema and the hook's `buildQueryString`; response `{items,total}` consistent across schema, endpoint, and page.
- **Known pitfalls flagged inline:** `adminAuditLog` import to add in admin.ts; the `adminAuditLog` mock sentinel already exists; workspace `pnpm build` + stale `infra/lambda/dist` for the full run; web-only typecheck e2e/db artifact.
- **No placeholders:** every code step is complete; every run step has a command + expected result.
```
