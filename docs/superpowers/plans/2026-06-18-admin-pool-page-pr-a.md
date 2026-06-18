# Admin Pool page (PR-A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unstyled server-rendered `/admin/generation` page with a client-rendered `/admin/pool` page that has `Exercises | Theory` tabs, filters, and consistent styling — the shell that PR-B's enriched Theory tab plugs into.

**Architecture:** Convert the page to a client component (mirroring `/admin/content`). Add three thin `useQuery` hooks to `@language-drill/api-client` for the existing `pool-status`, `generation-stats`, and `theory/coverage` endpoints. The Exercises tab keeps the existing rich `PoolCoverageTable`/`PoolCellDetail` (drill-down, refill, revalidate, deeplinks) — restyled and filterable. The Theory tab initially renders the existing language×CEFR coverage matrix (moved out of the deleted `/admin/theory` page); PR-B enriches it. Old routes redirect.

**Tech Stack:** Next.js App Router (client components), TanStack Query, Zod, Tailwind, Vitest + Testing Library.

## Global Constraints

- Reuse the existing `FilterSelect` (`apps/web/components/admin/filter-select.tsx`) and `GrammarPointCombobox` (`apps/web/components/admin/grammar-point-combobox.tsx`) for filters — do NOT introduce new filter primitives.
- Match the newer admin page styling: root `flex flex-col gap-4`, title `font-display text-[24px] font-semibold text-ink`, tables `text-[13px]`, status text `text-[12px] text-ink-soft`, filter row `flex items-center gap-2 flex-wrap`.
- Languages are `ES`, `DE`, `TR`; levels `A1`, `A2`, `B1`, `B2` (no C-levels in this app).
- Admin access is already gated by `apps/web/app/(admin)/layout.tsx` via `GET /me` → `isAdmin`. Client pages do NOT redirect on 403; they render an error state (as `/admin/content` does).
- Pre-push gate (CLAUDE.md): `pnpm lint`, `pnpm typecheck`, `pnpm turbo run test --concurrency=1` must all pass before the final commit.
- This plan touches package `@language-drill/api-client` and `@language-drill/web` only — no `@language-drill/lambda` / backend changes (those are PR-B).

---

### Task A1: Read hooks for pool-status, generation-stats, theory-coverage

**Files:**
- Create: `packages/api-client/src/hooks/usePoolStatus.ts`
- Create: `packages/api-client/src/hooks/useGenerationStats.ts`
- Create: `packages/api-client/src/hooks/useTheoryCoverage.ts`
- Modify: `packages/api-client/src/index.ts`

**Interfaces:**
- Consumes: `PoolStatusItemSchema`, `GenerationStatsSchema` (from `./schemas/pool-status`), `TheoryCoverageResponseSchema` (from `./schemas/theory`), `AuthenticatedFetch` (from `./fetchClient`), `buildQueryString` (from `./lib/build-query-string`).
- Produces:
  - `usePoolStatus({ fetchFn, params?: { language?: string; level?: string }, enabled? })` → `UseQueryResult<PoolStatusItem[]>`
  - `useGenerationStats({ fetchFn, enabled? })` → `UseQueryResult<GenerationStats>`
  - `useTheoryCoverage({ fetchFn, enabled? })` → `UseQueryResult<TheoryCoverageResponse>`

- [ ] **Step 1: Create `usePoolStatus`**

```ts
// packages/api-client/src/hooks/usePoolStatus.ts
import { useQuery } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../fetchClient';
import { buildQueryString } from '../lib/build-query-string';
import { PoolStatusItemSchema } from '../schemas/pool-status';

export type PoolStatusParams = { language?: string; level?: string };

export function usePoolStatus({
  fetchFn, params = {}, enabled = true,
}: { fetchFn: AuthenticatedFetch; params?: PoolStatusParams; enabled?: boolean }) {
  return useQuery({
    queryKey: ['admin', 'pool-status', params],
    queryFn: async () => {
      const res = await fetchFn(`/admin/pool-status${buildQueryString({ ...params })}`);
      const json: unknown = await res.json();
      return PoolStatusItemSchema.array().parse(json);
    },
    enabled,
  });
}
```

- [ ] **Step 2: Create `useGenerationStats`**

```ts
// packages/api-client/src/hooks/useGenerationStats.ts
import { useQuery } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../fetchClient';
import { GenerationStatsSchema } from '../schemas/pool-status';

export function useGenerationStats({
  fetchFn, enabled = true,
}: { fetchFn: AuthenticatedFetch; enabled?: boolean }) {
  return useQuery({
    queryKey: ['admin', 'generation-stats'],
    queryFn: async () => {
      const res = await fetchFn('/admin/generation-stats');
      const json: unknown = await res.json();
      return GenerationStatsSchema.parse(json);
    },
    enabled,
  });
}
```

- [ ] **Step 3: Create `useTheoryCoverage`**

```ts
// packages/api-client/src/hooks/useTheoryCoverage.ts
import { useQuery } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../fetchClient';
import { TheoryCoverageResponseSchema } from '../schemas/theory';

export function useTheoryCoverage({
  fetchFn, enabled = true,
}: { fetchFn: AuthenticatedFetch; enabled?: boolean }) {
  return useQuery({
    queryKey: ['admin', 'theory', 'coverage'],
    queryFn: async () => {
      const res = await fetchFn('/admin/theory/coverage');
      const json: unknown = await res.json();
      return TheoryCoverageResponseSchema.parse(json);
    },
    enabled,
  });
}
```

- [ ] **Step 4: Export the hooks + param type from the package index**

In `packages/api-client/src/index.ts`, find the line `export { usePoolCell } from './hooks/usePoolCell';` (≈ line 377) and add immediately after it:

```ts
export { usePoolStatus, type PoolStatusParams } from './hooks/usePoolStatus';
export { useGenerationStats } from './hooks/useGenerationStats';
export { useTheoryCoverage } from './hooks/useTheoryCoverage';
```

- [ ] **Step 5: Typecheck the package (deliverable: hooks compile + export)**

Run: `pnpm --filter @language-drill/api-client typecheck`
Expected: PASS (no errors). This package has no isolated hook tests by convention; the hooks are exercised by the page test in Task A3.

- [ ] **Step 6: Commit**

```bash
git add packages/api-client/src/hooks/usePoolStatus.ts packages/api-client/src/hooks/useGenerationStats.ts packages/api-client/src/hooks/useTheoryCoverage.ts packages/api-client/src/index.ts
git commit -m "feat(api-client): add usePoolStatus/useGenerationStats/useTheoryCoverage hooks"
```

---

### Task A2: Move pool components into the pool route and restyle the coverage table

**Files:**
- Move: `apps/web/app/(admin)/admin/generation/_components/pool-coverage-table.tsx` → `apps/web/app/(admin)/admin/pool/_components/pool-coverage-table.tsx`
- Move: `apps/web/app/(admin)/admin/generation/_components/pool-cell-detail.tsx` → `apps/web/app/(admin)/admin/pool/_components/pool-cell-detail.tsx`
- Move: `apps/web/app/(admin)/admin/generation/_components/__tests__/pool-coverage-table.test.tsx` → `apps/web/app/(admin)/admin/pool/_components/__tests__/pool-coverage-table.test.tsx`
- Move: `apps/web/app/(admin)/admin/generation/_components/__tests__/pool-cell-detail.test.tsx` → `apps/web/app/(admin)/admin/pool/_components/__tests__/pool-cell-detail.test.tsx`
- Modify: `apps/web/app/(admin)/admin/generation/page.tsx` (update import path so it stays green until Task A4 removes it)
- Modify: the moved `pool-cell-detail.tsx` import of `LangfuseTracesLink` / `cellKeyFor` (relative path depth is unchanged — `generation` and `pool` are siblings, both 5 levels deep — so the existing `../../../../../components/...` and `../../../../../lib/...` paths remain correct; verify after move).

**Interfaces:**
- Consumes: `PoolStatusItem` (Task A1's hook returns these).
- Produces: `PoolCoverageTable` (default-styled, accepts `items: PoolStatusItem[]`) at the new path, imported by Task A3.

- [ ] **Step 1: Move the four files with `git mv`**

```bash
cd apps/web/app/\(admin\)/admin
mkdir -p pool/_components/__tests__
git mv generation/_components/pool-coverage-table.tsx pool/_components/pool-coverage-table.tsx
git mv generation/_components/pool-cell-detail.tsx pool/_components/pool-cell-detail.tsx
git mv generation/_components/__tests__/pool-coverage-table.test.tsx pool/_components/__tests__/pool-coverage-table.test.tsx
git mv generation/_components/__tests__/pool-cell-detail.test.tsx pool/_components/__tests__/pool-cell-detail.test.tsx
```

(`generation` and `pool` are sibling folders at the same depth, so every relative import inside the moved files — `./pool-cell-detail`, `../../../../../components/...`, `../../../../../lib/...` — resolves unchanged. The test files' `../pool-coverage-table` / `../pool-cell-detail` imports also resolve unchanged.)

- [ ] **Step 2: Point the (soon-to-be-removed) generation page at the new location**

In `apps/web/app/(admin)/admin/generation/page.tsx`, change:

```ts
import { PoolCoverageTable } from './_components/pool-coverage-table';
```
to:
```ts
import { PoolCoverageTable } from '../pool/_components/pool-coverage-table';
```

- [ ] **Step 3: Run the moved component tests to verify they still pass after the move**

Run: `cd apps/web && npx vitest run "app/(admin)/admin/pool/_components"`
Expected: PASS (both `pool-coverage-table` and `pool-cell-detail` suites).

- [ ] **Step 4: Restyle the coverage table** (in the moved `pool/_components/pool-coverage-table.tsx`)

Change the table element from `<table>` to:
```tsx
<table className="text-[13px]">
```
and update the header cells to sentence-case (they already are: "Language", "Level", "Type", "Grammar Point", "Approved", "Gen Target", "Demand", "Coverage %"). Leave the per-row `coverageBgClass` tints and the drill-down behavior unchanged.

- [ ] **Step 5: Run the moved tests again (styling must not break behavior)**

Run: `cd apps/web && npx vitest run "app/(admin)/admin/pool/_components"`
Expected: PASS (the existing expand/collapse test still passes — it matches on the grammar-point button, unaffected by the `text-[13px]` class).

- [ ] **Step 6: Typecheck web (the generation page import update compiles)**

Run: `pnpm --filter @language-drill/web typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A apps/web/app/\(admin\)/admin/pool apps/web/app/\(admin\)/admin/generation/page.tsx
git commit -m "refactor(admin): move pool components into /admin/pool route and restyle coverage table"
```

---

### Task A3: Pool client page with Exercises + Theory tabs

**Files:**
- Create: `apps/web/app/(admin)/admin/pool/page.tsx`
- Create: `apps/web/app/(admin)/admin/pool/__tests__/page.test.tsx`

**Interfaces:**
- Consumes: `usePoolStatus`, `useGenerationStats`, `useTheoryCoverage`, `useCurriculum`, `createAuthenticatedFetch` (api-client); `ExerciseType` (`@language-drill/shared`); `PoolCoverageTable` (Task A2); `FilterSelect`, `GrammarPointCombobox` (components/admin).
- Produces: default-exported `PoolPage` rendered at `/admin/pool`. Reads `?tab=theory` to start on the Theory tab.

- [ ] **Step 1: Write the failing page test**

```tsx
// apps/web/app/(admin)/admin/pool/__tests__/page.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PoolStatusItem } from '@language-drill/api-client';

vi.mock('@clerk/nextjs', () => ({ useAuth: () => ({ getToken: vi.fn() }) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('') }));

const mockPoolStatus = vi.fn();
const mockGenStats = vi.fn();
const mockTheoryCoverage = vi.fn();
const mockCurriculum = vi.fn();
vi.mock('@language-drill/api-client', async () => {
  const actual = await vi.importActual<typeof import('@language-drill/api-client')>('@language-drill/api-client');
  return {
    ...actual,
    createAuthenticatedFetch: () => vi.fn(),
    usePoolStatus: (a: unknown) => mockPoolStatus(a),
    useGenerationStats: (a: unknown) => mockGenStats(a),
    useTheoryCoverage: (a: unknown) => mockTheoryCoverage(a),
    useCurriculum: (a: unknown) => mockCurriculum(a),
  };
});
// Render the rich cell detail as a stub so the test focuses on the page shell.
vi.mock('../_components/pool-cell-detail', () => ({
  PoolCellDetail: ({ item }: { item: PoolStatusItem }) => <div data-testid="cell-detail">{item.grammarPointKey}</div>,
}));

import PoolPage from '../page';

const poolItems: PoolStatusItem[] = [
  { language: 'TR', level: 'A1', type: 'cloze', grammarPointKey: 'tr-a1-ki-relativizer',
    approved: 5, flagged: 1, rejected: 2, lastRefilledAt: null, depletionRate7d: 1,
    targetSize: 50, generationTarget: 20, coverageDistribution: null },
  { language: 'ES', level: 'B1', type: 'translation', grammarPointKey: 'es-b1-ser-estar',
    approved: 30, flagged: 0, rejected: 1, lastRefilledAt: null, depletionRate7d: 2,
    targetSize: 75, generationTarget: 30, coverageDistribution: null },
];
const genStats = {
  costThisWeekUsd: 1, costThisMonthUsd: 2,
  jobsThisWeek: { succeeded: 1, failed: 0, running: 0, queued: 0 },
  approvalRates: [
    { language: 'TR', level: 'A1', type: 'cloze', approvedCount: 5, flaggedCount: 1, rejectedCount: 2, dedupGivenUpCount: 0, approvalRate: 0.71 },
    { language: 'ES', level: 'B1', type: 'translation', approvedCount: 30, flaggedCount: 0, rejectedCount: 1, dedupGivenUpCount: 0, approvalRate: 0.97 },
  ],
};

beforeEach(() => {
  mockPoolStatus.mockReset(); mockGenStats.mockReset();
  mockTheoryCoverage.mockReset(); mockCurriculum.mockReset();
  mockPoolStatus.mockReturnValue({ isLoading: false, isError: false, data: poolItems });
  mockGenStats.mockReturnValue({ isLoading: false, isError: false, data: genStats });
  mockTheoryCoverage.mockReturnValue({ isLoading: false, isError: false, data: { rows: [
    { language: 'TR', level: 'A1', approved: 26, flagged: 0, total: 26 },
  ] } });
  mockCurriculum.mockReturnValue({ isLoading: false, isError: false, data: { items: [
    { key: 'tr-a1-ki-relativizer', name: 'ki relativizer' },
    { key: 'es-b1-ser-estar', name: 'ser vs estar' },
  ] } });
});

describe('PoolPage', () => {
  it('renders the Exercises tab with both coverage rows and the quality table', () => {
    render(<PoolPage />);
    expect(screen.getByRole('heading', { name: 'Pool' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /tr-a1-ki-relativizer/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /es-b1-ser-estar/i })).toBeInTheDocument();
    // Generation quality (30d) section header present
    expect(screen.getByText(/generation quality/i)).toBeInTheDocument();
  });

  it('filters coverage rows by type client-side', () => {
    render(<PoolPage />);
    fireEvent.change(screen.getByLabelText('type'), { target: { value: 'cloze' } });
    expect(screen.getByRole('button', { name: /tr-a1-ki-relativizer/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /es-b1-ser-estar/i })).not.toBeInTheDocument();
  });

  it('switches to the Theory tab and shows the coverage matrix', () => {
    render(<PoolPage />);
    fireEvent.click(screen.getByRole('tab', { name: /theory/i }));
    // Matrix renders a TR row with the 26/26 cell
    expect(screen.getByText(/26\/26/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && npx vitest run "app/(admin)/admin/pool/__tests__/page"`
Expected: FAIL — cannot find module `../page` (page not created yet).

- [ ] **Step 3: Create the Pool page**

```tsx
// apps/web/app/(admin)/admin/pool/page.tsx
'use client';

import { Suspense, useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useSearchParams } from 'next/navigation';
import {
  createAuthenticatedFetch,
  useCurriculum,
  useGenerationStats,
  usePoolStatus,
  useTheoryCoverage,
} from '@language-drill/api-client';
import { ExerciseType } from '@language-drill/shared';
import { PoolCoverageTable } from './_components/pool-coverage-table';
import { GrammarPointCombobox } from '../../../../components/admin/grammar-point-combobox';
import { FilterSelect } from '../../../../components/admin/filter-select';

type Tab = 'exercises' | 'theory';
const EXERCISE_TYPES = Object.values(ExerciseType);
const THEORY_LANGUAGES = ['ES', 'DE', 'TR'] as const;
const THEORY_LEVELS = ['A1', 'A2', 'B1', 'B2'] as const;

function PoolPageInner() {
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>(searchParams.get('tab') === 'theory' ? 'theory' : 'exercises');
  const [filters, setFilters] = useState<{ language?: string; level?: string; type?: string; grammarPoint?: string }>({});

  const poolStatus = usePoolStatus({ fetchFn, params: { language: filters.language, level: filters.level }, enabled: tab === 'exercises' });
  const stats = useGenerationStats({ fetchFn, enabled: tab === 'exercises' });
  const theory = useTheoryCoverage({ fetchFn, enabled: tab === 'theory' });
  const curriculum = useCurriculum({ fetchFn, params: { language: filters.language, level: filters.level } });
  const grammarOptions = useMemo(
    () => (curriculum.data?.items ?? []).map((e: { key: string; name: string }) => ({ key: e.key, name: e.name })),
    [curriculum.data],
  );

  const setFilter = (key: keyof typeof filters, value: string) => {
    setFilters((f) => {
      const next = { ...f, [key]: value || undefined };
      if (key === 'language' || key === 'level') next.grammarPoint = undefined;
      return next;
    });
  };
  const clearFilters = () => setFilters({});
  const hasFilters = Boolean(filters.language || filters.level || filters.type || filters.grammarPoint);

  // pool-status filters language/level server-side; type + grammar point are client-side.
  const items = (poolStatus.data ?? []).filter(
    (i) => (!filters.type || i.type === filters.type) && (!filters.grammarPoint || i.grammarPointKey === filters.grammarPoint),
  );
  const approvalRates = (stats.data?.approvalRates ?? []).filter(
    (r) =>
      (!filters.language || r.language === filters.language) &&
      (!filters.level || r.level === filters.level) &&
      (!filters.type || r.type === filters.type),
  );

  const byKey = new Map<string, { approved: number; flagged: number; total: number }>();
  for (const row of theory.data?.rows ?? []) byKey.set(`${row.language}:${row.level}`, row);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-[24px] font-semibold text-ink">Pool</h1>

      <div className="flex gap-2" role="tablist">
        <button role="tab" id="tab-exercises" aria-controls="pool-panel" aria-selected={tab === 'exercises'}
          onClick={() => setTab('exercises')}
          className={tab === 'exercises' ? 'font-semibold text-ink' : 'text-ink-soft'}>Exercises</button>
        <button role="tab" id="tab-theory" aria-controls="pool-panel" aria-selected={tab === 'theory'}
          onClick={() => setTab('theory')}
          className={tab === 'theory' ? 'font-semibold text-ink' : 'text-ink-soft'}>Theory</button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <FilterSelect aria-label="language" value={filters.language ?? ''} onChange={(e) => setFilter('language', e.target.value)}>
          <option value="">All languages</option>
          {THEORY_LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
        </FilterSelect>
        <FilterSelect aria-label="level" value={filters.level ?? ''} onChange={(e) => setFilter('level', e.target.value)}>
          <option value="">All levels</option>
          {THEORY_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
        </FilterSelect>
        {tab === 'exercises' ? (
          <FilterSelect aria-label="type" value={filters.type ?? ''} onChange={(e) => setFilter('type', e.target.value)}>
            <option value="">All types</option>
            {EXERCISE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </FilterSelect>
        ) : null}
        <div className="min-w-[220px]">
          <GrammarPointCombobox options={grammarOptions} value={filters.grammarPoint ?? ''} onChange={(key) => setFilter('grammarPoint', key)} />
        </div>
        {hasFilters ? (
          <button type="button" onClick={clearFilters} className="text-[13px] text-ink-soft hover:text-ink">clear filters</button>
        ) : null}
      </div>

      <div id="pool-panel" role="tabpanel" aria-labelledby={tab === 'exercises' ? 'tab-exercises' : 'tab-theory'} className="flex flex-col gap-4">
        {tab === 'exercises' ? (
          poolStatus.isLoading ? <p className="text-ink-soft text-[13px]">Loading…</p>
          : poolStatus.isError ? <p className="text-ink-soft text-[13px]">Failed to load pool status.</p>
          : items.length === 0 ? <p className="text-ink-soft text-[13px]">No matching cells.</p>
          : (
            <>
              <PoolCoverageTable items={items} />
              <section className="flex flex-col gap-2">
                <h2 className="text-ink-soft text-[12px]">Generation quality (30d)</h2>
                {approvalRates.length === 0 ? (
                  <p className="text-ink-soft text-[13px]">No generation jobs in the past 30 days.</p>
                ) : (
                  <table className="text-[13px]">
                    <thead>
                      <tr><th>Language</th><th>Level</th><th>Type</th><th>Approved</th><th>Flagged</th><th>Rejected</th>
                        <th title="Slots where all dedup retries collided — already included in Rejected.">Dedup</th>
                        <th title="approved / (approved + flagged + (rejected − dedup))">Rate %</th></tr>
                    </thead>
                    <tbody>
                      {approvalRates.map((row) => (
                        <tr key={`${row.language}:${row.level}:${row.type}`}>
                          <td>{row.language}</td><td>{row.level}</td><td>{row.type}</td>
                          <td>{row.approvedCount}</td><td>{row.flaggedCount}</td><td>{row.rejectedCount}</td>
                          <td>{row.dedupGivenUpCount}</td><td>{(row.approvalRate * 100).toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            </>
          )
        ) : (
          theory.isLoading ? <p className="text-ink-soft text-[13px]">Loading…</p>
          : theory.isError ? <p className="text-ink-soft text-[13px]">Failed to load theory coverage.</p>
          : (
            <table className="text-[13px]">
              <thead>
                <tr><th>Language</th>{THEORY_LEVELS.map((l) => <th key={l}>{l}</th>)}</tr>
              </thead>
              <tbody>
                {THEORY_LANGUAGES.map((language) => (
                  <tr key={language}>
                    <td>{language}</td>
                    {THEORY_LEVELS.map((level) => {
                      const row = byKey.get(`${language}:${level}`);
                      if (!row || row.total === 0) return <td key={level}>—</td>;
                      const badge = row.approved === row.total ? '✓' : row.approved > 0 ? '⚠' : '✗';
                      const bg = row.approved === row.total ? 'bg-green-100' : row.approved > 0 ? 'bg-amber-100' : 'bg-red-100';
                      return (
                        <td key={level} className={bg}>
                          {row.approved}/{row.total} {badge}
                          {row.flagged > 0 && <span className="t-micro"> +{row.flagged} flagged</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
      </div>
    </div>
  );
}

export default function PoolPage() {
  return (
    <Suspense fallback={<div className="p-s-6" />}>
      <PoolPageInner />
    </Suspense>
  );
}
```

- [ ] **Step 4: Run the page test to verify it passes**

Run: `cd apps/web && npx vitest run "app/(admin)/admin/pool/__tests__/page"`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck web**

Run: `pnpm --filter @language-drill/web typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/\(admin\)/admin/pool/page.tsx apps/web/app/\(admin\)/admin/pool/__tests__/page.test.tsx
git commit -m "feat(admin): /admin/pool client page with Exercises + Theory tabs"
```

---

### Task A4: Redirect old routes, update nav, remove the old pages

**Files:**
- Replace contents: `apps/web/app/(admin)/admin/generation/page.tsx` (becomes a redirect stub)
- Replace contents: `apps/web/app/(admin)/admin/theory/page.tsx` (becomes a redirect stub)
- Delete: `apps/web/app/(admin)/admin/theory/page.test.tsx` (if present — its assertions target the removed matrix markup; the matrix is now tested in the Pool page test)
- Modify: `apps/web/components/admin/admin-nav-items.tsx`
- Modify: `apps/web/components/admin/__tests__/admin-nav.test.tsx` (if it asserts the "Theory" item or the `/admin/generation` href)

**Interfaces:**
- Consumes: nothing new.
- Produces: nav points "Pool" → `/admin/pool`; "Theory" nav entry removed; old paths redirect.

- [ ] **Step 1: Turn the generation page into a redirect stub**

Replace the entire contents of `apps/web/app/(admin)/admin/generation/page.tsx` with:

```tsx
import { redirect } from 'next/navigation';

export default function AdminGenerationRedirect() {
  redirect('/admin/pool');
}
```

- [ ] **Step 2: Turn the theory page into a redirect stub**

Replace the entire contents of `apps/web/app/(admin)/admin/theory/page.tsx` with:

```tsx
import { redirect } from 'next/navigation';

export default function AdminTheoryRedirect() {
  redirect('/admin/pool?tab=theory');
}
```

- [ ] **Step 3: Remove the stale theory page test if it exists**

```bash
git rm apps/web/app/\(admin\)/admin/theory/page.test.tsx 2>/dev/null || true
```

- [ ] **Step 4: Update the admin nav**

In `apps/web/components/admin/admin-nav-items.tsx`, change the Pool href and remove the Theory entry. The `ADMIN_NAV` array becomes:

```ts
export const ADMIN_NAV: AdminNavDestination[] = [
  { href: '/admin/moderation', label: 'Moderation' },
  { href: '/admin/flags', label: 'User flags' },
  { href: '/admin/content', label: 'Content' },
  { href: '/admin/pool', label: 'Pool' },
  { href: '/admin/invites', label: 'Invites' },
  { href: '/admin/audit', label: 'Audit' },
  { href: '/admin/capacity', label: 'Capacity' },
  { href: '/admin/curriculum', label: 'Curriculum' },
];
```

- [ ] **Step 5: Fix the nav test if it references the old items**

Open `apps/web/components/admin/__tests__/admin-nav.test.tsx`. If it asserts a "Theory" label or an `/admin/generation` href, update those expectations: the nav no longer has a "Theory" entry, and "Pool" now links to `/admin/pool`. (If the test only checks a subset that is unaffected, leave it.)

- [ ] **Step 6: Run the nav + pool tests**

Run: `cd apps/web && npx vitest run "components/admin/__tests__/admin-nav" "app/(admin)/admin/pool"`
Expected: PASS.

- [ ] **Step 7: Full gate — lint, typecheck, tests**

Run from repo root:
```bash
pnpm --filter @language-drill/web lint
pnpm typecheck
pnpm turbo run test --concurrency=1
```
Expected: all PASS. (Concurrency 1 avoids the known infra parallel-load flake.)

- [ ] **Step 8: Commit**

```bash
git add -A apps/web/app/\(admin\)/admin/generation apps/web/app/\(admin\)/admin/theory apps/web/components/admin/admin-nav-items.tsx apps/web/components/admin/__tests__/admin-nav.test.tsx
git commit -m "feat(admin): point nav at /admin/pool; redirect old generation + theory routes"
```

---

## Self-Review

**Spec coverage (PR-A slice):**
- Nav rename `/admin/generation` → `/admin/pool`, label "Pool" — Task A4. ✓
- `/admin/generation` redirect — Task A4 Step 1. ✓
- `/admin/theory` removed + redirect to `?tab=theory` — Task A4 Steps 2–3. ✓
- Client conversion + tabs + `?tab` deeplink — Task A3. ✓
- Filters (FilterSelect + GrammarPointCombobox; lang/level server, type/grammar client) — Task A3. ✓
- Coverage table styled + filterable — Tasks A2 (style) + A3 (filter). ✓
- "Generation quality (30d)" approval-rates section, cost/jobs NOT shown — Task A3. ✓
- Theory tab renders the coverage matrix (per-point enrichment is PR-B) — Task A3. ✓
- New `usePoolStatus`/`useGenerationStats`/`useTheoryCoverage` hooks — Task A1. ✓
- "clear filters" affordance — Task A3. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full content; test code is concrete. ✓

**Type consistency:** Hook names (`usePoolStatus`, `useGenerationStats`, `useTheoryCoverage`), `PoolStatusParams`, and `PoolCoverageTable` props (`items: PoolStatusItem[]`) match between Task A1 (definition), Task A2 (move), and Task A3 (consumption). Theory matrix uses the `{ language, level, approved, flagged, total }` row shape from `TheoryCoverageResponseSchema` consistently. ✓

**Out of scope (later PRs):** per-grammar-point theory endpoint + enriched Theory tab (PR-B); Usage & cost page incl. moving cost/jobs blocks + capacity restyle (PR-C). The cost/jobs data is intentionally dropped from the Pool page here and re-homed in PR-C; between PR-A and PR-C it is visible nowhere — acceptable for an internal tool, and PR-C is the immediate follow-up.
