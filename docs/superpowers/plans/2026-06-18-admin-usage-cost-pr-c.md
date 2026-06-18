# Admin Usage & cost page (PR-C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the `/admin/capacity` page into a "Usage & cost" page with clear visual hierarchy that owns all AI cost + consumption: a Cost & generation block (re-homed from the old generation page), a Brakes block, and a Consumption (24h) block. Rename the nav label accordingly.

**Architecture:** The page reads two hooks — `useGenerationStats` (cost + job counts, added in PR-A) and the existing `useCapacity` (brakes + 24h consumption). Three labeled `<section>` blocks; the two capacity-backed blocks share one loading/error gate so the state text appears once. Route stays `/admin/capacity`; only the title and nav label change.

**Tech Stack:** Next.js App Router (client component), TanStack Query, Tailwind, Vitest + Testing Library.

## Global Constraints

- Branch off `main` (PR-A is merged; `useGenerationStats` is already in `@language-drill/api-client`). Independent of PR-B.
- Route stays `/admin/capacity` (file `apps/web/app/(admin)/admin/capacity/page.tsx`). Do NOT rename the route or move the file.
- Page title is **"Usage & cost"**; nav label changes from **"Capacity"** to **"Usage & cost"** (href unchanged).
- The Cost & generation block shows: cost this week `$`, cost this month `$` (both `toFixed(2)`), and Jobs (7d) as `✓ succeeded · ✗ failed · N running · N queued`. It must NOT show approval rates (those stay on the Pool page).
- Match newer admin styling: root `flex flex-col gap-6`, title `font-display text-[24px] font-semibold text-ink`, section sub-headings `text-[12px] text-ink-soft`, tables `text-[13px]`, body text `text-[13px]`.
- Preserve existing behavior: kill-switch On/Off, global cap (`no cap` when null), the `usage24h` line (`total / cap (pct%)` or `total events · no cap`), the by-event-type table, the top-consumers table, and their empty states ("No usage in the last 24h." / "No consumers in the last 24h.").
- Pre-push gate (CLAUDE.md): `pnpm lint`, `pnpm typecheck`, `pnpm turbo run test --concurrency=1` must pass before the final task's commit.

---

### Task C1: Rebuild the capacity page into Usage & cost (3 blocks)

**Files:**
- Modify: `apps/web/app/(admin)/admin/capacity/page.tsx` (full rewrite)
- Modify: `apps/web/app/(admin)/admin/capacity/__tests__/page.test.tsx` (add `useGenerationStats` mock + cost-block tests; keep existing assertions)

**Interfaces:**
- Consumes: `useCapacity` (existing), `useGenerationStats` (PR-A), `createAuthenticatedFetch`.
- Produces: the rebuilt default-exported page at `/admin/capacity`.

- [ ] **Step 1: Update the test (write the new + adjusted assertions)**

Replace the entire contents of `apps/web/app/(admin)/admin/capacity/__tests__/page.test.tsx` with:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@clerk/nextjs', () => ({ useAuth: () => ({ getToken: vi.fn() }) }));

const mockUseCapacity = vi.fn();
const mockUseGenerationStats = vi.fn();
vi.mock('@language-drill/api-client', async () => {
  const actual = await vi.importActual<typeof import('@language-drill/api-client')>('@language-drill/api-client');
  return {
    ...actual,
    createAuthenticatedFetch: () => vi.fn(),
    useCapacity: (args: unknown) => mockUseCapacity(args),
    useGenerationStats: (args: unknown) => mockUseGenerationStats(args),
  };
});

import CapacityPage from '../page';

const genStatsData = {
  costThisWeekUsd: 53.2479,
  costThisMonthUsd: 108.7432,
  jobsThisWeek: { succeeded: 297, failed: 12, running: 0, queued: 0 },
  approvalRates: [],
};
const emptyCapacity = {
  isLoading: false, isError: false,
  data: { killSwitch: false, globalDailyCap: null, usage24h: { total: 0, byEventType: [] }, topConsumers: [] },
};

beforeEach(() => {
  mockUseCapacity.mockReset();
  mockUseGenerationStats.mockReset();
  mockUseGenerationStats.mockReturnValue({ isLoading: false, isError: false, data: genStatsData });
});

describe('UsageCostPage', () => {
  it('renders the cost & generation block (spend + job counts)', () => {
    mockUseCapacity.mockReturnValue(emptyCapacity);
    render(<CapacityPage />);
    expect(screen.getByText('$53.25')).toBeInTheDocument();
    expect(screen.getByText('$108.74')).toBeInTheDocument();
    expect(screen.getByText(/✓ 297/)).toBeInTheDocument();
    expect(screen.getByText(/✗ 12/)).toBeInTheDocument();
  });

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
    expect(screen.getByText('On')).toBeInTheDocument();
    expect(screen.getByText(/992 \/ 5000/)).toBeInTheDocument();
    expect(screen.getByText(/20%/)).toBeInTheDocument();
    expect(screen.getByText('ai_evaluation')).toBeInTheDocument();
    expect(screen.getByText('u1')).toBeInTheDocument();
  });

  it('renders "no cap" and an off kill-switch', () => {
    mockUseCapacity.mockReturnValue(emptyCapacity);
    render(<CapacityPage />);
    expect(screen.getAllByText(/no cap/i).length).toBeGreaterThan(0);
    expect(screen.getByText('Off')).toBeInTheDocument();
  });

  it('shows the empty states for breakdown and consumers', () => {
    mockUseCapacity.mockReturnValue(emptyCapacity);
    render(<CapacityPage />);
    expect(screen.getByText(/no usage in the last 24h/i)).toBeInTheDocument();
    expect(screen.getByText(/no consumers in the last 24h/i)).toBeInTheDocument();
  });

  it('shows the capacity loading state', () => {
    mockUseCapacity.mockReturnValue({ isLoading: true, isError: false, data: undefined });
    render(<CapacityPage />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('shows the capacity error state', () => {
    mockUseCapacity.mockReturnValue({ isLoading: false, isError: true, data: undefined });
    render(<CapacityPage />);
    expect(screen.getByText(/failed to load capacity/i)).toBeInTheDocument();
  });

  it('shows a cost-block error without breaking the capacity blocks', () => {
    mockUseGenerationStats.mockReturnValue({ isLoading: false, isError: true, data: undefined });
    mockUseCapacity.mockReturnValue(emptyCapacity);
    render(<CapacityPage />);
    expect(screen.getByText(/failed to load generation stats/i)).toBeInTheDocument();
    expect(screen.getByText('Off')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && npx vitest run "app/(admin)/admin/capacity/__tests__/page"`
Expected: FAIL — the cost-block tests fail (no `$53.25` / `✓ 297` yet), and the current page calls the real `useGenerationStats`? No — the current page doesn't import it; the new cost assertions fail because the cost block doesn't exist.

- [ ] **Step 3: Rewrite the page**

Replace the entire contents of `apps/web/app/(admin)/admin/capacity/page.tsx` with:

```tsx
'use client';

import { useMemo } from 'react';
import { useAuth } from '@clerk/nextjs';
import { createAuthenticatedFetch, useCapacity, useGenerationStats } from '@language-drill/api-client';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[12px] text-ink-soft">{label}</span>
      <span className="text-[15px] text-ink">{value}</span>
    </div>
  );
}

export default function CapacityPage() {
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  const capacity = useCapacity({ fetchFn });
  const stats = useGenerationStats({ fetchFn });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-[24px] font-semibold text-ink">Usage &amp; cost</h1>

      <section className="flex flex-col gap-2">
        <h2 className="text-ink-soft text-[12px]">Cost &amp; generation</h2>
        {stats.isLoading ? (
          <p className="text-ink-soft text-[13px]">Loading…</p>
        ) : stats.isError || !stats.data ? (
          <p className="text-ink-soft text-[13px]">Failed to load generation stats.</p>
        ) : (
          <div className="flex gap-8 flex-wrap">
            <Stat label="Cost this week" value={`$${stats.data.costThisWeekUsd.toFixed(2)}`} />
            <Stat label="Cost this month" value={`$${stats.data.costThisMonthUsd.toFixed(2)}`} />
            <Stat
              label="Jobs (7d)"
              value={`✓ ${stats.data.jobsThisWeek.succeeded} · ✗ ${stats.data.jobsThisWeek.failed} · ${stats.data.jobsThisWeek.running} running · ${stats.data.jobsThisWeek.queued} queued`}
            />
          </div>
        )}
      </section>

      {capacity.isLoading ? (
        <p className="text-ink-soft text-[13px]">Loading…</p>
      ) : capacity.isError || !capacity.data ? (
        <p className="text-ink-soft text-[13px]">Failed to load capacity.</p>
      ) : (
        <>
          <section className="flex flex-col gap-1">
            <h2 className="text-ink-soft text-[12px]">Brakes</h2>
            <div className="flex gap-2 items-center text-[13px]">
              <span className="text-ink-soft">Kill switch</span>
              <span className={capacity.data.killSwitch ? 'text-red-700 font-medium' : 'text-ink'}>
                {capacity.data.killSwitch ? 'On' : 'Off'}
              </span>
              <span className="text-ink-soft">· Global cap</span>
              <span className="text-ink">
                {capacity.data.globalDailyCap !== null ? capacity.data.globalDailyCap : 'no cap'}
              </span>
            </div>
            <p className="text-[12px] text-ink-soft">
              Set via deploy (AI_KILL_SWITCH / AI_GLOBAL_DAILY_CAP) — UI toggle not yet available.
            </p>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-ink-soft text-[12px]">Consumption (24h)</h2>
            <p className="text-[13px] text-ink">
              {capacity.data.globalDailyCap !== null
                ? `${capacity.data.usage24h.total} / ${capacity.data.globalDailyCap} (${Math.round((capacity.data.usage24h.total / capacity.data.globalDailyCap) * 100)}%)`
                : `${capacity.data.usage24h.total} events · no cap`}
            </p>

            <div className="flex flex-col gap-1">
              <h3 className="text-[12px] text-ink-soft">By event type</h3>
              {capacity.data.usage24h.byEventType.length === 0 ? (
                <p className="text-ink-soft text-[13px]">No usage in the last 24h.</p>
              ) : (
                <table className="text-[13px]">
                  <thead>
                    <tr><th>Event type</th><th>24h count</th></tr>
                  </thead>
                  <tbody>
                    {capacity.data.usage24h.byEventType.map((e) => (
                      <tr key={e.eventType}><td>{e.eventType}</td><td>{e.count}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="flex flex-col gap-1">
              <h3 className="text-[12px] text-ink-soft">Top consumers</h3>
              {capacity.data.topConsumers.length === 0 ? (
                <p className="text-ink-soft text-[13px]">No consumers in the last 24h.</p>
              ) : (
                <table className="text-[13px]">
                  <thead>
                    <tr><th>User</th><th>24h count</th></tr>
                  </thead>
                  <tbody>
                    {capacity.data.topConsumers.map((c) => (
                      <tr key={c.userId}><td>{c.userId}</td><td>{c.count}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/web && npx vitest run "app/(admin)/admin/capacity/__tests__/page"`
Expected: PASS (7 tests).

- [ ] **Step 5: Typecheck web**

Run: `pnpm --filter @language-drill/web typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/\(admin\)/admin/capacity/page.tsx apps/web/app/\(admin\)/admin/capacity/__tests__/page.test.tsx
git commit -m "feat(admin): rebuild capacity page as Usage & cost (cost + brakes + consumption blocks)"
```

---

### Task C2: Rename the nav label + full gate

**Files:**
- Modify: `apps/web/components/admin/admin-nav-items.tsx` (label `Capacity` → `Usage & cost`)
- Modify: `apps/web/components/admin/__tests__/admin-nav.test.tsx` (expected label array)

**Interfaces:**
- Consumes: nothing new.
- Produces: nav shows "Usage & cost" → `/admin/capacity`.

- [ ] **Step 1: Update the nav label**

In `apps/web/components/admin/admin-nav-items.tsx`, change the entry:
```ts
  { href: '/admin/capacity', label: 'Capacity' },
```
to:
```ts
  { href: '/admin/capacity', label: 'Usage & cost' },
```

- [ ] **Step 2: Update the nav test expectation**

In `apps/web/components/admin/__tests__/admin-nav.test.tsx`, the label-array assertion currently reads:
```ts
    expect(ADMIN_NAV.map((d) => d.label)).toEqual([
      'Moderation', 'User flags', 'Content', 'Pool', 'Invites', 'Audit', 'Capacity', 'Curriculum',
    ]);
```
Change `'Capacity'` to `'Usage & cost'`:
```ts
    expect(ADMIN_NAV.map((d) => d.label)).toEqual([
      'Moderation', 'User flags', 'Content', 'Pool', 'Invites', 'Audit', 'Usage & cost', 'Curriculum',
    ]);
```
(The href array is unchanged — `/admin/capacity` stays.)

- [ ] **Step 3: Run the nav test**

Run: `cd apps/web && npx vitest run "components/admin/__tests__/admin-nav"`
Expected: PASS (3 tests).

- [ ] **Step 4: Full pre-push gate**

Run from repo root:
```bash
pnpm --filter @language-drill/web lint
pnpm typecheck
pnpm turbo run test --concurrency=1
```
Expected: all PASS (concurrency=1 avoids the known infra parallel-load flake).

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/admin/admin-nav-items.tsx apps/web/components/admin/__tests__/admin-nav.test.tsx
git commit -m "feat(admin): rename Capacity nav label to Usage & cost"
```

---

## Self-Review

**Spec coverage (PR-C slice):**
- Cost & generation block (cost week/month + jobs counts) re-homed from the generation page, via `useGenerationStats` — Task C1. ✓
- Brakes block (kill switch + global cap, deploy-time note) — Task C1. ✓
- Consumption (24h) block (events-by-type + top-consumers tables + empty states) — Task C1. ✓
- Approval rates NOT shown here (stay on Pool) — Task C1 (cost block reads only cost + jobs). ✓
- Clear hierarchy: three labeled sections, `gap-6`, stat cards, sub-headings — Task C1. ✓
- Title "Usage & cost"; nav label "Capacity" → "Usage & cost", route unchanged — Tasks C1 + C2. ✓
- Existing capacity behavior preserved (On/Off, no cap, usage line, tables, empty states) — Task C1 (tests retained). ✓

**Placeholder scan:** No TBD/TODO; full page + test code given; nav edits are exact strings. ✓

**Type consistency:** The page reads `stats.data.costThisWeekUsd`, `costThisMonthUsd`, `jobsThisWeek.{succeeded,failed,running,queued}` — exactly the `GenerationStatsSchema` fields; `capacity.data.{killSwitch,globalDailyCap,usage24h.{total,byEventType},topConsumers}` — exactly the `useCapacity` shape used by the prior page. ✓

**State-text uniqueness:** The two capacity-backed blocks share ONE loading/error gate, so "Loading…"/"Failed to load capacity." render once (keeps `getByText` single-match). The cost block has its own independent state ("Failed to load generation stats."). Tests set complementary mocks so each state-text assertion is unambiguous. ✓

**Out of scope:** No route rename; no kill-switch UI toggle (still deploy-time); approval-rates table stays on the Pool page (PR-A).
