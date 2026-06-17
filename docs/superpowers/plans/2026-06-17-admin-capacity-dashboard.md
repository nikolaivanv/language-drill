# Admin Usage & Capacity Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only `/admin/capacity` dashboard (kill-switch/cap state + trailing-24h total-vs-cap + per-event-type breakdown + top consumers), backed by a new `GET /admin/capacity` endpoint.

**Architecture:** One new read-only admin endpoint reading the same env vars + `usage_events` aggregates the global cap uses; a `useCapacity` query hook; a client page with three read-only sections. New "Capacity" nav entry. No table, no migration, no infra change, no mutations.

**Tech Stack:** Hono + Drizzle (Lambda), Vitest, Zod, TanStack Query, Next.js client components, Tailwind.

---

## Context the implementer needs

Work from the worktree `/Users/seal/dev/language-drill/.claude/worktrees/feat-admin-capacity` (branch `feat-admin-capacity`). `cd` into it in every Bash call. Paths contain a `(admin)` route-group segment — quote them.

**Workspace dist:** if a test errors resolving `@language-drill/*`, run `pnpm build` at repo root. If the full lambda run shows phantom failures from stale `infra/lambda/dist/**/*.test.js`, `rm -rf infra/lambda/dist` and re-run.

**Single-file test commands:** `pnpm --filter @language-drill/lambda test <path>` · `pnpm --filter @language-drill/api-client test <path>` · `pnpm --filter @language-drill/web test <path>`.

**Key existing code:**
- `infra/lambda/src/routes/admin.ts`: Hono admin router; `/admin/*` gated by `authMiddleware + adminMiddleware`. Imports from `drizzle-orm` include `and, asc, count, desc, eq, gte, inArray, isNotNull, sql`. Imports from `@language-drill/db` include `exercises, theoryTopics, generationJobs, invitations, adminAuditLog, userExerciseHistory, …` — **`usageEvents` is NOT yet imported here; add it.** `db` from `../db`. Read-list pattern (`Promise.all`, `c.json`) is `GET /admin/audit` / `GET /admin/content/exercises`.
- Capacity semantics to mirror exactly (`infra/lambda/src/usage/global-capacity.ts`): kill switch = `(process.env.AI_KILL_SWITCH ?? '').toLowerCase() === 'on'`; cap = `Number.parseInt(process.env.AI_GLOBAL_DAILY_CAP ?? '', 10)`, enabled only when `> 0`; the global 24h count is over **all** `usage_events` (no event-type filter).
- `usageEvents` (`@language-drill/db`): `userId`, `eventType`, `metadata`, `createdAt`. Index `(user_id, event_type, created_at)`.
- `infra/lambda/src/routes/admin.test.ts`: chain-mock `db` + shared `queryQueue` (awaiting a chain shifts the next staged value; `Promise.all` shifts in array order). Uses `app.request(path, init, adminEnv)`; `AnyJson` type defined in-file. The generate tests show the `beforeAll`/`afterAll` env capture/restore pattern.
- api-client: `buildQueryString` exists but this endpoint has no params. Query-hook idiom: `packages/api-client/src/hooks/useAuditLog.ts`. Barrel `index.ts`. `createAuthenticatedFetch`/`type AuthenticatedFetch` exported.
- Web: `ADMIN_NAV` (`apps/web/components/admin/admin-nav-items.tsx`) = `[Moderation, Content, Pool, Theory, Invites, Audit]`; its test asserts that order. Read-only client-page idiom: `apps/web/app/(admin)/admin/audit/page.tsx`.

---

## File structure

**Lambda (modify):** `infra/lambda/src/routes/admin.ts` (+`GET /admin/capacity`), `admin.test.ts` (+tests).
**api-client (create/modify):** `schemas/capacity.ts` (new), `hooks/useCapacity.ts` (new), `hooks/useCapacity.test.ts` (new), `index.ts` (barrel).
**web (create/modify):** `app/(admin)/admin/capacity/page.tsx` (new) + `__tests__/page.test.tsx` (new); `components/admin/admin-nav-items.tsx` (+ its test).

---

## Task 1: Lambda — `GET /admin/capacity`

**Files:** Modify `infra/lambda/src/routes/admin.ts`, `infra/lambda/src/routes/admin.test.ts`.

- [ ] **Step 1: Write failing tests**

Append to `admin.test.ts` (use `app.request(path, init, adminEnv)`; the env capture/restore mirrors the generate-test pattern):
```ts
describe('GET /admin/capacity', () => {
  let prevKill: string | undefined;
  let prevCap: string | undefined;
  beforeAll(() => { prevKill = process.env.AI_KILL_SWITCH; prevCap = process.env.AI_GLOBAL_DAILY_CAP; });
  afterAll(() => {
    if (prevKill === undefined) delete process.env.AI_KILL_SWITCH; else process.env.AI_KILL_SWITCH = prevKill;
    if (prevCap === undefined) delete process.env.AI_GLOBAL_DAILY_CAP; else process.env.AI_GLOBAL_DAILY_CAP = prevCap;
  });

  it('reports kill-switch on + cap + 24h usage breakdown + top consumers', async () => {
    process.env.AI_KILL_SWITCH = 'on';
    process.env.AI_GLOBAL_DAILY_CAP = '5000';
    queryQueue.push([
      { eventType: 'read_annotation', count: 380 },
      { eventType: 'ai_evaluation', count: 612 },
    ]); // byEventType (unsorted)
    queryQueue.push([
      { userId: 'u2', count: 95 },
      { userId: 'u1', count: 210 },
    ]); // topConsumers (unsorted)
    const res = await app.request('/admin/capacity', undefined, adminEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.killSwitch).toBe(true);
    expect(body.globalDailyCap).toBe(5000);
    expect(body.usage24h.total).toBe(992);
    expect(body.usage24h.byEventType[0]).toEqual({ eventType: 'ai_evaluation', count: 612 }); // sorted desc
    expect(body.topConsumers[0]).toEqual({ userId: 'u1', count: 210 }); // sorted desc
  });

  it('reports kill-switch off + no cap when env is unset', async () => {
    delete process.env.AI_KILL_SWITCH;
    delete process.env.AI_GLOBAL_DAILY_CAP;
    queryQueue.push([]); // byEventType
    queryQueue.push([]); // topConsumers
    const res = await app.request('/admin/capacity', undefined, adminEnv);
    const body = (await res.json()) as AnyJson;
    expect(body.killSwitch).toBe(false);
    expect(body.globalDailyCap).toBeNull();
    expect(body.usage24h).toEqual({ total: 0, byEventType: [] });
    expect(body.topConsumers).toEqual([]);
  });

  it('treats a non-positive cap as no cap', async () => {
    process.env.AI_GLOBAL_DAILY_CAP = '0';
    queryQueue.push([]); queryQueue.push([]);
    const res = await app.request('/admin/capacity', undefined, adminEnv);
    expect((await res.json()).globalDailyCap).toBeNull();
  });

  it('caps top consumers at 10', async () => {
    delete process.env.AI_GLOBAL_DAILY_CAP;
    queryQueue.push([]); // byEventType
    queryQueue.push(Array.from({ length: 15 }, (_, i) => ({ userId: `u${i}`, count: i }))); // 15 consumers
    const res = await app.request('/admin/capacity', undefined, adminEnv);
    expect((await res.json()).topConsumers).toHaveLength(10);
  });
});
```

- [ ] **Step 2: Run, expect FAIL (404)** — `pnpm --filter @language-drill/lambda test src/routes/admin.test.ts`

- [ ] **Step 3: Implement**

In `admin.ts`: add `usageEvents` to the `@language-drill/db` import. Then add:
```ts
admin.get('/admin/capacity', async (c) => {
  const killSwitch = (process.env.AI_KILL_SWITCH ?? '').toLowerCase() === 'on';
  const capRaw = Number.parseInt(process.env.AI_GLOBAL_DAILY_CAP ?? '', 10);
  const globalDailyCap = capRaw > 0 ? capRaw : null;
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [byTypeRows, consumerRows] = await Promise.all([
    db.select({ eventType: usageEvents.eventType, count: count() })
      .from(usageEvents)
      .where(gte(usageEvents.createdAt, since))
      .groupBy(usageEvents.eventType),
    db.select({ userId: usageEvents.userId, count: count() })
      .from(usageEvents)
      .where(gte(usageEvents.createdAt, since))
      .groupBy(usageEvents.userId),
  ]);

  // Sort + cap in JS (result sets are tiny; avoids orderBy-aggregate portability concerns).
  const byEventType = byTypeRows
    .map((r) => ({ eventType: r.eventType, count: Number(r.count) }))
    .sort((a, b) => b.count - a.count);
  const total = byEventType.reduce((sum, e) => sum + e.count, 0);
  const topConsumers = consumerRows
    .map((r) => ({ userId: r.userId, count: Number(r.count) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return c.json({ killSwitch, globalDailyCap, usage24h: { total, byEventType }, topConsumers });
});
```

- [ ] **Step 4: Run, expect PASS** — `pnpm --filter @language-drill/lambda test src/routes/admin.test.ts` (run `pnpm build` at repo root first if a workspace-dist resolve error occurs)
- [ ] **Step 5: Typecheck** — `pnpm --filter @language-drill/lambda typecheck` → clean
- [ ] **Step 6: Commit**
```bash
git add infra/lambda/src/routes/admin.ts infra/lambda/src/routes/admin.test.ts
git commit -m "feat(admin): GET /admin/capacity — kill-switch/cap state + 24h usage + top consumers"
```

---

## Task 2: api-client — `useCapacity`

**Files:** Create `packages/api-client/src/schemas/capacity.ts`, `hooks/useCapacity.ts`, `hooks/useCapacity.test.ts`; modify `index.ts`.

- [ ] **Step 1: Create the schema**

`packages/api-client/src/schemas/capacity.ts`:
```ts
import { z } from 'zod';

export const CapacityResponseSchema = z.object({
  killSwitch: z.boolean(),
  globalDailyCap: z.number().nullable(),
  usage24h: z.object({
    total: z.number(),
    byEventType: z.array(z.object({ eventType: z.string(), count: z.number() })),
  }),
  topConsumers: z.array(z.object({ userId: z.string(), count: z.number() })),
});
export type CapacityResponse = z.infer<typeof CapacityResponseSchema>;
```

- [ ] **Step 2: Write the failing hook test**

`packages/api-client/src/hooks/useCapacity.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { useCapacity } from './useCapacity';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
}
function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

describe('useCapacity', () => {
  it('fetches /admin/capacity and parses the response', async () => {
    const payload = { killSwitch: false, globalDailyCap: null, usage24h: { total: 0, byEventType: [] }, topConsumers: [] };
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(payload));
    const { result } = renderHook(() => useCapacity({ fetchFn }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(payload);
    expect(fetchFn).toHaveBeenCalledWith('/admin/capacity');
  });
});
```

- [ ] **Step 3: Run, expect FAIL** — `pnpm --filter @language-drill/api-client test src/hooks/useCapacity.test.ts`

- [ ] **Step 4: Create the hook**

`packages/api-client/src/hooks/useCapacity.ts`:
```ts
import { useQuery } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../fetchClient';
import { CapacityResponseSchema } from '../schemas/capacity';

export function useCapacity({ fetchFn, enabled = true }: { fetchFn: AuthenticatedFetch; enabled?: boolean }) {
  return useQuery({
    queryKey: ['admin', 'capacity'],
    queryFn: async () => {
      const res = await fetchFn('/admin/capacity');
      const json: unknown = await res.json();
      return CapacityResponseSchema.parse(json);
    },
    enabled,
  });
}
```

- [ ] **Step 5: Barrel exports** — add to `packages/api-client/src/index.ts`:
```ts
export { CapacityResponseSchema, type CapacityResponse } from './schemas/capacity';
export { useCapacity } from './hooks/useCapacity';
```

- [ ] **Step 6: Test + typecheck + build**
- `pnpm --filter @language-drill/api-client test src/hooks/useCapacity.test.ts` → 1 pass
- `pnpm --filter @language-drill/api-client typecheck` → clean
- `pnpm --filter @language-drill/api-client build` → success

- [ ] **Step 7: Commit**
```bash
git add packages/api-client/src/schemas/capacity.ts packages/api-client/src/hooks/useCapacity.ts packages/api-client/src/hooks/useCapacity.test.ts packages/api-client/src/index.ts
git commit -m "feat(admin): api-client useCapacity hook + schema"
```

---

## Task 3: web — Capacity page + nav entry

**Files:** Create `apps/web/app/(admin)/admin/capacity/page.tsx` + `__tests__/page.test.tsx`; modify `apps/web/components/admin/admin-nav-items.tsx` + its test.

- [ ] **Step 1: Update the nav test (RED)**

In `apps/web/components/admin/__tests__/admin-nav.test.tsx`, update the order assertions to append Capacity:
```tsx
    expect(ADMIN_NAV.map((d) => d.href)).toEqual([
      '/admin/moderation', '/admin/content', '/admin/generation', '/admin/theory', '/admin/invites', '/admin/audit', '/admin/capacity',
    ]);
    expect(ADMIN_NAV.map((d) => d.label)).toEqual([
      'Moderation', 'Content', 'Pool', 'Theory', 'Invites', 'Audit', 'Capacity',
    ]);
```

- [ ] **Step 2: Run nav test, expect FAIL** — `pnpm --filter @language-drill/web test "components/admin/__tests__/admin-nav.test.tsx"`

- [ ] **Step 3: Add the Capacity nav entry**

In `apps/web/components/admin/admin-nav-items.tsx`, append to `ADMIN_NAV`:
```tsx
  { href: '/admin/capacity', label: 'Capacity' },
```

- [ ] **Step 4: Run nav test, expect PASS** — `pnpm --filter @language-drill/web test "components/admin/__tests__/admin-nav.test.tsx"`

- [ ] **Step 5: Write the failing page test**

`apps/web/app/(admin)/admin/capacity/__tests__/page.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@clerk/nextjs', () => ({ useAuth: () => ({ getToken: vi.fn() }) }));

const mockUseCapacity = vi.fn();
vi.mock('@language-drill/api-client', async () => {
  const actual = await vi.importActual<typeof import('@language-drill/api-client')>('@language-drill/api-client');
  return { ...actual, createAuthenticatedFetch: () => vi.fn(), useCapacity: (args: unknown) => mockUseCapacity(args) };
});

import CapacityPage from '../page';

beforeEach(() => { mockUseCapacity.mockReset(); });

describe('CapacityPage', () => {
  it('renders kill-switch on, cap, usage total/percent, and the breakdown + consumers', () => {
    mockUseCapacity.mockReturnValue({
      isLoading: false, isError: false,
      data: {
        killSwitch: true, globalDailyCap: 5000,
        usage24h: { total: 992, byEventType: [{ eventType: 'ai_evaluation', count: 612 }] },
        topConsumers: [{ userId: 'u1', count: 210 }],
      },
    });
    render(<CapacityPage />);
    expect(screen.getByText(/on/i)).toBeInTheDocument();
    expect(screen.getByText(/992 \/ 5000/)).toBeInTheDocument();
    expect(screen.getByText(/20%/)).toBeInTheDocument(); // 992/5000 ≈ 20%
    expect(screen.getByText('ai_evaluation')).toBeInTheDocument();
    expect(screen.getByText('u1')).toBeInTheDocument();
  });

  it('renders "no cap" and an off kill-switch', () => {
    mockUseCapacity.mockReturnValue({
      isLoading: false, isError: false,
      data: { killSwitch: false, globalDailyCap: null, usage24h: { total: 0, byEventType: [] }, topConsumers: [] },
    });
    render(<CapacityPage />);
    expect(screen.getByText(/no cap/i)).toBeInTheDocument();
    expect(screen.getByText(/off/i)).toBeInTheDocument();
  });

  it('shows the loading state', () => {
    mockUseCapacity.mockReturnValue({ isLoading: true, isError: false, data: undefined });
    render(<CapacityPage />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run, expect FAIL** — `pnpm --filter @language-drill/web test "app/(admin)/admin/capacity/__tests__/page.test.tsx"`

- [ ] **Step 7: Implement the page**

`apps/web/app/(admin)/admin/capacity/page.tsx`:
```tsx
'use client';

import { useMemo } from 'react';
import { useAuth } from '@clerk/nextjs';
import { createAuthenticatedFetch, useCapacity } from '@language-drill/api-client';

export default function CapacityPage() {
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  const capacity = useCapacity({ fetchFn });

  if (capacity.isLoading) return <p className="text-ink-soft text-[13px] p-1">Loading…</p>;
  if (capacity.isError || !capacity.data) return <p className="text-ink-soft text-[13px] p-1">Failed to load capacity.</p>;

  const { killSwitch, globalDailyCap, usage24h, topConsumers } = capacity.data;
  const usageLine = globalDailyCap !== null
    ? `${usage24h.total} / ${globalDailyCap} (${Math.round((usage24h.total / globalDailyCap) * 100)}%)`
    : `${usage24h.total} events · no cap`;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-[24px] font-semibold text-ink">Usage &amp; capacity</h1>

      <section className="flex flex-col gap-1 text-[13px]">
        <div className="flex gap-2 items-center">
          <span className="text-ink-soft">Kill switch</span>
          <span className={killSwitch ? 'text-red-700 font-medium' : 'text-ink'}>{killSwitch ? 'On' : 'Off'}</span>
          <span className="text-ink-soft">· Global cap</span>
          <span className="text-ink">{globalDailyCap !== null ? globalDailyCap : 'no cap'}</span>
        </div>
        <p className="text-[12px] text-ink-soft">
          Set via deploy (AI_KILL_SWITCH / AI_GLOBAL_DAILY_CAP) — UI toggle not yet available.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-ink-soft text-[12px]">Last 24h</h2>
        <p className="text-[13px] text-ink">{usageLine}</p>
        {usage24h.byEventType.length === 0 ? (
          <p className="text-ink-soft text-[13px]">No usage in the last 24h.</p>
        ) : (
          <table className="text-[13px]">
            <thead><tr><th>Event type</th><th>24h count</th></tr></thead>
            <tbody>
              {usage24h.byEventType.map((e) => (
                <tr key={e.eventType}><td>{e.eventType}</td><td>{e.count}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-ink-soft text-[12px]">Top consumers (24h)</h2>
        {topConsumers.length === 0 ? (
          <p className="text-ink-soft text-[13px]">No consumers in the last 24h.</p>
        ) : (
          <table className="text-[13px]">
            <thead><tr><th>User</th><th>24h count</th></tr></thead>
            <tbody>
              {topConsumers.map((c) => (
                <tr key={c.userId}><td>{c.userId}</td><td>{c.count}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 8: Run, expect PASS** — `pnpm --filter @language-drill/web test "app/(admin)/admin/capacity/__tests__/page.test.tsx" "components/admin/__tests__/admin-nav.test.tsx"` (run `pnpm build` at repo root first if a workspace-dist resolve error occurs)
- [ ] **Step 9: Typecheck web** — `pnpm --filter @language-drill/web typecheck` → clean (a known pre-existing `e2e/helpers/auth.ts` "@language-drill/db" worktree-dist error is acceptable if it's the ONLY error; resolved by the full turbo typecheck in Task 4)
- [ ] **Step 10: Commit**
```bash
git add "apps/web/app/(admin)/admin/capacity/page.tsx" "apps/web/app/(admin)/admin/capacity/__tests__/page.test.tsx" "apps/web/components/admin/admin-nav-items.tsx" "apps/web/components/admin/__tests__/admin-nav.test.tsx"
git commit -m "feat(admin): usage & capacity dashboard page + nav entry"
```

---

## Task 4: Full verification

**Files:** none.

- [ ] **Step 1: Lint** — `pnpm lint` → no errors
- [ ] **Step 2: Repo typecheck** — `pnpm typecheck` → no errors (all packages)
- [ ] **Step 3: Full serial test suite** — `pnpm turbo run test --concurrency=1` → all packages pass. (If `@language-drill/lambda` shows phantom failures from stale `infra/lambda/dist/**/*.test.js`, `rm -rf infra/lambda/dist` and re-run.)
- [ ] **Step 4: Commit (only if a lint/format autofix changed files; else skip)**
```bash
git add -A && git commit -m "chore(admin): verification fixes" || echo "nothing to commit"
```

---

## Self-review notes

- **Spec coverage:** `GET /admin/capacity` with killSwitch (env), globalDailyCap (parsed, null-when-≤0), `usage24h` {total, byEventType all-types sorted desc}, topConsumers (top 10) (Task 1); `useCapacity` hook + schema (Task 2); page with controls (kill-switch badge + cap + deploy note), 24h total/percent + per-type table, top-consumers table, states, "Capacity" nav (Task 3); tests throughout + Task 4. Read-only, no toggle, no migration.
- **Type consistency:** `CapacityResponse` shape (`killSwitch`/`globalDailyCap`/`usage24h.{total,byEventType}`/`topConsumers`) matches the Lambda response (Task 1), the schema (Task 2), and the page destructure (Task 3); field names `eventType`/`count`/`userId` consistent across all three.
- **Known pitfalls flagged inline:** `usageEvents` import to add in admin.ts; JS sort+slice (no orderBy-aggregate); env capture/restore in the lambda test; the two Promise.all queries shift `queryQueue` in array order (byEventType then topConsumers); workspace `pnpm build` + stale `infra/lambda/dist`; web-only typecheck e2e/db artifact.
- **No placeholders:** every code step is complete; every run step has a command + expected result.
```
