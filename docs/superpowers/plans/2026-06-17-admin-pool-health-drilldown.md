# Admin Pool Health Drill-Down Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `/admin/generation` pool-coverage table's rows expandable, showing per-cell diversity-vs-floors, a rejection-reason breakdown, the existing target/demand/depletion numbers, and a link to the cell's approved exercises — backed by a new read-only `GET /admin/pool-cell` endpoint.

**Architecture:** A new lean Lambda endpoint returns only the two pieces not already on the pool-status row (curriculum **floors** + the **rejection-reason aggregate** for the cell). The client table gains expandable rows; an expanded row lazily fetches that detail via a new api-client hook and renders an analytics panel combining it with data already on the row. Read-only; no infra changes.

**Tech Stack:** Hono + Drizzle (Lambda), Vitest, Zod, TanStack Query, Next.js App Router (client components), Tailwind.

---

## Context the implementer needs

Work from the worktree `/Users/seal/dev/language-drill/.claude/worktrees/feat-admin-pool-drilldown` (branch `feat-admin-pool-drilldown`). `cd` into it in every Bash call. Paths contain a `(admin)` route-group segment — quote them.

**Workspace dist:** if a test errors resolving `@language-drill/*`, run `pnpm build` at repo root once, then re-run.

**Single-file test commands:**
- Lambda: `pnpm --filter @language-drill/lambda test <path-relative-to-infra/lambda>`
- api-client: `pnpm --filter @language-drill/api-client test <path>`
- web: `pnpm --filter @language-drill/web test <path>`

**Key existing code:**
- `infra/lambda/src/routes/admin.ts`: Hono admin router; `/admin/*` gated by `authMiddleware + adminMiddleware`. Already imports from `drizzle-orm`: `and, asc, count, desc, eq, gte, inArray, isNotNull, sql`. Already imports from `@language-drill/db`: `ALL_CURRICULA, buildCellKey, buildCellKeyFromRow, enumerateCurriculumCells, exercises, generationJobs, invitations, targetCellSize, theoryTopics, userExerciseHistory`. Query validation pattern: `Schema.safeParse(c.req.query())` → `400 { error, code:'VALIDATION_ERROR', details: parsed.error.flatten() }`.
- `infra/lambda/src/routes/admin.test.ts`: chain-mock for `db` with a shared `queryQueue` (awaiting a Drizzle chain shifts the next staged value; a staged `Error` rejects). Uses a request helper (inspect the file). The `@language-drill/db` mock spreads `...actual` then overrides table objects with `{ __mock }` sentinels — so `enumerateCurriculumCells`, `ALL_CURRICULA`, `buildCellKey` are the REAL in-memory curriculum in tests (floors resolution works against real data).
- `buildCellKey({ language, cefrLevel, exerciseType, grammarPointKey })` (`packages/db/src/lib/cell-key.ts`) lowercases language/level/type, keeps grammarPointKey verbatim → e.g. `es:b1:cloze:es-b1-present-subjunctive`.
- `enumerateCurriculumCells(ALL_CURRICULA)` → `Cell[]`, each `{ language, cefrLevel, exerciseType, grammarPoint, cellKey }`. `cell.grammarPoint.coverageSpec?: { axes: { name: string; floors: Partial<Record<string, number>> }[] }`.
- `generation_jobs.rejectionReasonCounts` is a `Record<string, number>` JSONB column (`generationJobs.rejectionReasonCounts`).
- `generation_jobs.cellKey` (`generationJobs.cellKey`) equals `buildCellKey(...)`.
- Real curriculum fixture for tests: grammar point `es-b1-present-subjunctive` (language `ES`, level `B1`) has `coverageSpec.axes = [{ name: 'person', floors: { '1sg':15,'2sg':15,'3sg':15,'1pl':15,'3pl':15 } }]`.
- `PoolStatusItem` (`packages/api-client/src/schemas/pool-status.ts`): `{ language, level, type, grammarPointKey, approved, flagged, rejected, lastRefilledAt, depletionRate7d, targetSize, generationTarget, coverageDistribution: Record<string,Record<string,number>> | null }`.
- `packages/api-client/src/lib/build-query-string.ts` exports `buildQueryString(params: Record<string, string | number | undefined>): string` (skips undefined/empty, keeps 0, returns `''` or `?a=1&b=2`).
- `@language-drill/shared` exports `REASON_LABELS: Record<GenerationReasonCode, string>` and `type GenerationReasonCode`.
- api-client barrel exports `createAuthenticatedFetch`, `type AuthenticatedFetch`.
- Web page `apps/web/app/(admin)/admin/generation/page.tsx` (server) fetches `/admin/pool-status` + passes `PoolStatusItem[]` to the client `_components/pool-coverage-table.tsx` (current full source below in Task 4). Client-fetch idiom: `useAuth()` → `createAuthenticatedFetch(getToken)` (as in `app/(admin)/admin/invites/page.tsx`).
- Content browser at `/admin/content` accepts `?language=&level=&type=&grammarPoint=`.

---

## File structure

**Lambda (modify):** `infra/lambda/src/routes/admin.ts` (+`GET /admin/pool-cell`), `infra/lambda/src/routes/admin.test.ts` (+tests).
**api-client (create/modify):** `schemas/pool-cell.ts` (new), `hooks/usePoolCell.ts` (new), `hooks/usePoolCell.test.ts` (new), `index.ts` (barrel).
**web:** `app/(admin)/admin/generation/_components/pool-cell-detail.tsx` (new) + its test; `app/(admin)/admin/generation/_components/pool-coverage-table.tsx` (modify) + its test.

---

## Task 1: Lambda — `GET /admin/pool-cell`

**Files:** Modify `infra/lambda/src/routes/admin.ts`, `infra/lambda/src/routes/admin.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `infra/lambda/src/routes/admin.test.ts` (adapt `request(...)` to the file's real request helper). Each request runs exactly one DB query (the rejection select); floors come from real in-memory curriculum, so stage one queue entry per request:
```ts
describe('GET /admin/pool-cell', () => {
  it('returns curriculum floors for a cell that has a coverageSpec', async () => {
    queryQueue.push([]); // rejection-aggregate query: no jobs
    const res = await request('/admin/pool-cell?language=ES&level=B1&type=cloze&grammarPoint=es-b1-present-subjunctive');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.floors).toEqual({ person: { '1sg': 15, '2sg': 15, '3sg': 15, '1pl': 15, '3pl': 15 } });
    expect(body.rejectionReasonCounts).toEqual({});
  });

  it('returns empty floors for an unknown grammar point', async () => {
    queryQueue.push([]);
    const res = await request('/admin/pool-cell?language=ES&level=B1&type=cloze&grammarPoint=does-not-exist');
    expect(res.status).toBe(200);
    expect((await res.json()).floors).toEqual({});
  });

  it('sums rejectionReasonCounts across the cell’s jobs', async () => {
    queryQueue.push([
      { rejectionReasonCounts: { 'low-quality-reject': 3 } },
      { rejectionReasonCounts: { 'low-quality-reject': 2, ambiguous: 1 } },
      { rejectionReasonCounts: null },
    ]);
    const res = await request('/admin/pool-cell?language=ES&level=B1&type=cloze&grammarPoint=es-b1-present-subjunctive');
    expect((await res.json()).rejectionReasonCounts).toEqual({ 'low-quality-reject': 5, ambiguous: 1 });
  });

  it('rejects a request missing grammarPoint with 400', async () => {
    const res = await request('/admin/pool-cell?language=ES&level=B1&type=cloze');
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('VALIDATION_ERROR');
  });
});
```

> If the first test's `body.floors` comes back `{}`, then `cloze` is not an enumerated type for `es-b1-present-subjunctive` — pick a compatible type by checking `enumerateCurriculumCells` output for that grammar point (grep for cells whose key starts `es:b1:` and ends `:es-b1-present-subjunctive`) and use that `type` in all three subjunctive tests. The floors are on the grammar point, so any compatible type yields the same `person` floors.

- [ ] **Step 2: Run tests, expect FAIL (404)** — `pnpm --filter @language-drill/lambda test src/routes/admin.test.ts`

- [ ] **Step 3: Implement**

In `infra/lambda/src/routes/admin.ts` add (all referenced imports already present):
```ts
const PoolCellQuerySchema = z.object({
  language: z.enum(['ES', 'DE', 'TR']),
  level: z.enum(['A1', 'A2', 'B1', 'B2']),
  type: z.string().min(1),
  grammarPoint: z.string().min(1),
});

admin.get('/admin/pool-cell', async (c) => {
  const parsed = PoolCellQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'Invalid query parameters', code: 'VALIDATION_ERROR', details: parsed.error.flatten() }, 400);
  }
  const { language, level, type, grammarPoint } = parsed.data;
  const cellKey = buildCellKey({ language, cefrLevel: level, exerciseType: type, grammarPointKey: grammarPoint });

  // Floors: in-memory curriculum (same source resolveCellTarget uses); no DB.
  const cell = enumerateCurriculumCells(ALL_CURRICULA).find((cc) => cc.cellKey === cellKey);
  const floors: Record<string, Record<string, number>> = {};
  for (const axis of cell?.grammarPoint.coverageSpec?.axes ?? []) {
    floors[axis.name] = { ...axis.floors };
  }

  // Rejection-reason aggregate across this cell's generation jobs.
  const jobRows = await db
    .select({ rejectionReasonCounts: generationJobs.rejectionReasonCounts })
    .from(generationJobs)
    .where(eq(generationJobs.cellKey, cellKey));
  const rejectionReasonCounts: Record<string, number> = {};
  for (const row of jobRows) {
    const counts = row.rejectionReasonCounts as Record<string, number> | null;
    if (!counts) continue;
    for (const [code, n] of Object.entries(counts)) {
      if (typeof n === 'number') rejectionReasonCounts[code] = (rejectionReasonCounts[code] ?? 0) + n;
    }
  }

  return c.json({ floors, rejectionReasonCounts });
});
```

- [ ] **Step 4: Run tests, expect PASS** — `pnpm --filter @language-drill/lambda test src/routes/admin.test.ts`
- [ ] **Step 5: Typecheck** — `pnpm --filter @language-drill/lambda typecheck` → clean
- [ ] **Step 6: Commit**
```bash
git add infra/lambda/src/routes/admin.ts infra/lambda/src/routes/admin.test.ts
git commit -m "feat(admin): GET /admin/pool-cell — floors + rejection-reason aggregate"
```

---

## Task 2: api-client — pool-cell schema + hook

**Files:** Create `packages/api-client/src/schemas/pool-cell.ts`, `hooks/usePoolCell.ts`, `hooks/usePoolCell.test.ts`; modify `index.ts`.

- [ ] **Step 1: Create the schema**

`packages/api-client/src/schemas/pool-cell.ts`:
```ts
import { z } from 'zod';

export const PoolCellDetailSchema = z.object({
  floors: z.record(z.string(), z.record(z.string(), z.number())),
  rejectionReasonCounts: z.record(z.string(), z.number()),
});
export type PoolCellDetail = z.infer<typeof PoolCellDetailSchema>;

export type PoolCellQuery = {
  language: string;
  level: string;
  type: string;
  grammarPoint: string;
};
```

- [ ] **Step 2: Write failing hook test**

`packages/api-client/src/hooks/usePoolCell.test.ts` (mirror `usePoolCell`'s sibling hook tests' wrapper idiom — copy from `useContentBrowser.test.ts`):
```ts
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { usePoolCell } from './usePoolCell';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
}
function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

describe('usePoolCell', () => {
  it('builds the cell query string and parses the detail', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ floors: {}, rejectionReasonCounts: {} }));
    const { result } = renderHook(
      () => usePoolCell({ fetchFn, cell: { language: 'ES', level: 'A2', type: 'cloze', grammarPoint: 'obj-pronoun' } }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ floors: {}, rejectionReasonCounts: {} });
    expect(fetchFn).toHaveBeenCalledWith('/admin/pool-cell?language=ES&level=A2&type=cloze&grammarPoint=obj-pronoun');
  });
});
```

- [ ] **Step 3: Run, expect FAIL** — `pnpm --filter @language-drill/api-client test src/hooks/usePoolCell.test.ts`

- [ ] **Step 4: Create the hook**

`packages/api-client/src/hooks/usePoolCell.ts`:
```ts
import { useQuery } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../fetchClient';
import { buildQueryString } from '../lib/build-query-string';
import { PoolCellDetailSchema, type PoolCellQuery } from '../schemas/pool-cell';

export function usePoolCell({
  fetchFn, cell, enabled = true,
}: { fetchFn: AuthenticatedFetch; cell: PoolCellQuery; enabled?: boolean }) {
  return useQuery({
    queryKey: ['admin', 'pool-cell', cell],
    queryFn: async () => {
      const res = await fetchFn(`/admin/pool-cell${buildQueryString({ ...cell })}`);
      const json: unknown = await res.json();
      return PoolCellDetailSchema.parse(json);
    },
    enabled,
  });
}
```

- [ ] **Step 5: Barrel exports** — add to `packages/api-client/src/index.ts`:
```ts
export { PoolCellDetailSchema, type PoolCellDetail, type PoolCellQuery } from './schemas/pool-cell';
export { usePoolCell } from './hooks/usePoolCell';
```

- [ ] **Step 6: Test + typecheck + build**
- `pnpm --filter @language-drill/api-client test src/hooks/usePoolCell.test.ts` → 1 pass
- `pnpm --filter @language-drill/api-client typecheck` → clean
- `pnpm --filter @language-drill/api-client build` → success

- [ ] **Step 7: Commit**
```bash
git add packages/api-client/src/schemas/pool-cell.ts packages/api-client/src/hooks/usePoolCell.ts packages/api-client/src/hooks/usePoolCell.test.ts packages/api-client/src/index.ts
git commit -m "feat(admin): api-client usePoolCell hook + schema"
```

---

## Task 3: web — pool cell detail panel

**Files:** Create `apps/web/app/(admin)/admin/generation/_components/pool-cell-detail.tsx` + `__tests__/pool-cell-detail.test.tsx`.

- [ ] **Step 1: Write the failing test**

`apps/web/app/(admin)/admin/generation/_components/__tests__/pool-cell-detail.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { PoolStatusItem } from '@language-drill/api-client';

const mockUsePoolCell = vi.fn();
vi.mock('@language-drill/api-client', async () => {
  const actual = await vi.importActual<typeof import('@language-drill/api-client')>('@language-drill/api-client');
  return { ...actual, usePoolCell: (args: unknown) => mockUsePoolCell(args) };
});

import { PoolCellDetail } from '../pool-cell-detail';

const item: PoolStatusItem = {
  language: 'ES', level: 'B1', type: 'cloze', grammarPointKey: 'es-b1-present-subjunctive',
  approved: 12, flagged: 1, rejected: 4, lastRefilledAt: '2026-06-01T00:00:00.000Z',
  depletionRate7d: 4.1, targetSize: 75, generationTarget: 30,
  coverageDistribution: { person: { '3sg': 8, '2pl': 1 } },
};
const fetchFn = vi.fn();

describe('PoolCellDetail', () => {
  it('renders diversity vs floors, flagging below-floor values', () => {
    mockUsePoolCell.mockReturnValue({
      isLoading: false, isError: false,
      data: { floors: { person: { '3sg': 5, '2pl': 2 } }, rejectionReasonCounts: {} },
    });
    render(<PoolCellDetail item={item} fetchFn={fetchFn} />);
    expect(screen.getByTestId('axis-person-3sg').textContent).toMatch(/3sg 8\/5/);
    const belowFloor = screen.getByTestId('axis-person-2pl');
    expect(belowFloor.textContent).toMatch(/2pl 1\/2/);
    expect(belowFloor.textContent).toMatch(/✗/);
  });

  it('renders rejection-reason chips and the numbers line', () => {
    mockUsePoolCell.mockReturnValue({
      isLoading: false, isError: false,
      data: { floors: {}, rejectionReasonCounts: { 'low-quality-reject': 6, ambiguous: 2 } },
    });
    render(<PoolCellDetail item={item} fetchFn={fetchFn} />);
    expect(screen.getByText(/: 6/)).toBeInTheDocument();
    expect(screen.getByText(/target 30/)).toBeInTheDocument();
  });

  it('renders the content-browser link with the cell query', () => {
    mockUsePoolCell.mockReturnValue({ isLoading: false, isError: false, data: { floors: {}, rejectionReasonCounts: {} } });
    render(<PoolCellDetail item={item} fetchFn={fetchFn} />);
    const link = screen.getByRole('link', { name: /approved exercises/i });
    expect(link).toHaveAttribute('href', '/admin/content?language=ES&level=B1&type=cloze&grammarPoint=es-b1-present-subjunctive');
  });

  it('shows a loading state', () => {
    mockUsePoolCell.mockReturnValue({ isLoading: true, isError: false, data: undefined });
    render(<PoolCellDetail item={item} fetchFn={fetchFn} />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `pnpm --filter @language-drill/web test "app/(admin)/admin/generation/_components/__tests__/pool-cell-detail.test.tsx"`

- [ ] **Step 3: Implement**

`apps/web/app/(admin)/admin/generation/_components/pool-cell-detail.tsx`:
```tsx
'use client';

import type { AuthenticatedFetch, PoolStatusItem } from '@language-drill/api-client';
import { usePoolCell } from '@language-drill/api-client';
import { REASON_LABELS, type GenerationReasonCode } from '@language-drill/shared';

export function PoolCellDetail({ item, fetchFn }: { item: PoolStatusItem; fetchFn: AuthenticatedFetch }) {
  const detail = usePoolCell({
    fetchFn,
    cell: { language: item.language, level: item.level, type: item.type, grammarPoint: item.grammarPointKey },
  });

  if (detail.isLoading) return <p className="text-[12px] text-ink-soft p-3">Loading…</p>;
  if (detail.isError || !detail.data) return <p className="text-[12px] text-ink-soft p-3">Failed to load cell detail.</p>;

  const { floors, rejectionReasonCounts } = detail.data;
  const dist = item.coverageDistribution ?? {};
  const axes = Array.from(new Set([...Object.keys(floors), ...Object.keys(dist)])).sort();
  const rejections = Object.entries(rejectionReasonCounts).sort((a, b) => b[1] - a[1]);
  const contentHref =
    `/admin/content?language=${encodeURIComponent(item.language)}&level=${encodeURIComponent(item.level)}` +
    `&type=${encodeURIComponent(item.type)}&grammarPoint=${encodeURIComponent(item.grammarPointKey)}`;

  return (
    <div className="flex flex-col gap-3 p-3 text-[13px]">
      <section>
        <h4 className="text-ink-soft text-[12px] mb-1">Diversity vs. floors</h4>
        {axes.length === 0 ? (
          <p className="text-ink-soft">No coverage data.</p>
        ) : (
          <ul className="flex flex-col gap-1 list-none p-0 m-0">
            {axes.map((axis) => {
              const axisDist = dist[axis] ?? {};
              const axisFloors = floors[axis] ?? {};
              const values = Array.from(new Set([...Object.keys(axisFloors), ...Object.keys(axisDist)])).sort();
              return (
                <li key={axis}>
                  <span className="text-ink">{axis}</span>{' '}
                  {values.map((v) => {
                    const actual = axisDist[v] ?? 0;
                    const floor = axisFloors[v];
                    const below = floor !== undefined && actual < floor;
                    const suffix = below ? ' ✗' : floor !== undefined ? ' ✓' : '';
                    return (
                      <span
                        key={v}
                        data-testid={`axis-${axis}-${v}`}
                        className={below ? 'text-red-700' : 'text-ink-soft'}
                      >
                        {v} {actual}{floor !== undefined ? `/${floor}` : ''}{suffix}{'  '}
                      </span>
                    );
                  })}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h4 className="text-ink-soft text-[12px] mb-1">Rejection reasons</h4>
        {rejections.length === 0 ? (
          <p className="text-ink-soft">No rejections recorded.</p>
        ) : (
          <div className="flex gap-2 flex-wrap">
            {rejections.map(([code, n]) => (
              <span key={code} className="bg-paper-2 text-ink px-2 py-px rounded-full text-[12px]">
                {REASON_LABELS[code as GenerationReasonCode] ?? code}: {n}
              </span>
            ))}
          </div>
        )}
      </section>

      <p className="text-[12px] text-ink-soft">
        target {item.generationTarget} · demand {item.targetSize} · {item.depletionRate7d}/day · last refilled{' '}
        {item.lastRefilledAt ?? '—'}
      </p>

      <a href={contentHref} className="text-[13px] text-ink underline">
        View {item.approved} approved exercises →
      </a>
    </div>
  );
}
```

- [ ] **Step 4: Run, expect PASS (4)** — `pnpm --filter @language-drill/web test "app/(admin)/admin/generation/_components/__tests__/pool-cell-detail.test.tsx"`
- [ ] **Step 5: Commit**
```bash
git add "apps/web/app/(admin)/admin/generation/_components/pool-cell-detail.tsx" "apps/web/app/(admin)/admin/generation/_components/__tests__/pool-cell-detail.test.tsx"
git commit -m "feat(admin): pool cell detail analytics panel"
```

---

## Task 4: web — expandable rows in the pool-coverage table

**Files:** Modify `apps/web/app/(admin)/admin/generation/_components/pool-coverage-table.tsx`; create `__tests__/pool-coverage-table.test.tsx`.

- [ ] **Step 1: Write the failing test**

`apps/web/app/(admin)/admin/generation/_components/__tests__/pool-coverage-table.test.tsx` (mock Clerk auth, the authed-fetch factory, and the detail child so the test focuses on expand/collapse):
```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { PoolStatusItem } from '@language-drill/api-client';

vi.mock('@clerk/nextjs', () => ({ useAuth: () => ({ getToken: vi.fn() }) }));
vi.mock('@language-drill/api-client', async () => {
  const actual = await vi.importActual<typeof import('@language-drill/api-client')>('@language-drill/api-client');
  return { ...actual, createAuthenticatedFetch: () => vi.fn() };
});
vi.mock('../pool-cell-detail', () => ({
  PoolCellDetail: ({ item }: { item: PoolStatusItem }) => <div data-testid="cell-detail">{item.grammarPointKey}</div>,
}));

import { PoolCoverageTable } from '../pool-coverage-table';

const items: PoolStatusItem[] = [
  {
    language: 'ES', level: 'B1', type: 'cloze', grammarPointKey: 'es-b1-present-subjunctive',
    approved: 12, flagged: 1, rejected: 4, lastRefilledAt: null, depletionRate7d: 4.1,
    targetSize: 75, generationTarget: 30, coverageDistribution: null,
  },
];

describe('PoolCoverageTable', () => {
  it('expands a row to show the cell detail, and collapses it again', () => {
    render(<PoolCoverageTable items={items} />);
    expect(screen.queryByTestId('cell-detail')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /es-b1-present-subjunctive/i }));
    expect(screen.getByTestId('cell-detail')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /es-b1-present-subjunctive/i }));
    expect(screen.queryByTestId('cell-detail')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `pnpm --filter @language-drill/web test "app/(admin)/admin/generation/_components/__tests__/pool-coverage-table.test.tsx"`

- [ ] **Step 3: Implement — replace the full contents of `pool-coverage-table.tsx`**

```tsx
'use client';

import { useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import {
  createAuthenticatedFetch,
  type PoolStatusItem,
} from '@language-drill/api-client';
import { PoolCellDetail } from './pool-cell-detail';

type Props = { items: PoolStatusItem[] };

type SortDir = 'asc' | 'desc';

function coverageBgClass(ratio: number): string {
  if (ratio < 0.5) return 'bg-red-100';
  if (ratio < 0.8) return 'bg-amber-100';
  return 'bg-green-100';
}

function cellKeyOf(item: PoolStatusItem): string {
  return `${item.language}:${item.level}:${item.type}:${item.grammarPointKey}`;
}

export function PoolCoverageTable({ items }: Props) {
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [expanded, setExpanded] = useState<string | null>(null);

  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);

  // Coverage is measured against the generation target — the number the
  // scheduler actually tops the cell up to — not the demand-derived
  // `targetSize`, so an idle cell isn't shown as perpetually under-filled.
  const sortedItems = useMemo(
    () =>
      [...items].sort((a, b) => {
        const ra = a.approved / a.generationTarget;
        const rb = b.approved / b.generationTarget;
        return sortDir === 'asc' ? ra - rb : rb - ra;
      }),
    [items, sortDir],
  );

  return (
    <table>
      <thead>
        <tr>
          <th>Language</th>
          <th>Level</th>
          <th>Type</th>
          <th>Grammar Point</th>
          <th>Approved</th>
          <th>Gen Target</th>
          <th>Demand</th>
          <th>
            <button
              type="button"
              onClick={() => setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'))}
            >
              Coverage % {sortDir === 'asc' ? '▲' : '▼'}
            </button>
          </th>
        </tr>
      </thead>
      <tbody>
        {sortedItems.map((item) => {
          const ratio = item.approved / item.generationTarget;
          const key = cellKeyOf(item);
          const isOpen = expanded === key;
          return (
            <>
              <tr key={key} className={coverageBgClass(ratio)}>
                <td>{item.language}</td>
                <td>{item.level}</td>
                <td>{item.type}</td>
                <td>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setExpanded((cur) => (cur === key ? null : key))}
                  >
                    {item.grammarPointKey} {isOpen ? '▼' : '▶'}
                  </button>
                </td>
                <td>{item.approved}</td>
                <td>{item.generationTarget}</td>
                <td>{item.targetSize}</td>
                <td>{(ratio * 100).toFixed(1)}%</td>
              </tr>
              {isOpen ? (
                <tr key={`${key}:detail`}>
                  <td colSpan={8}>
                    <PoolCellDetail item={item} fetchFn={fetchFn} />
                  </td>
                </tr>
              ) : null}
            </>
          );
        })}
      </tbody>
    </table>
  );
}
```

> Note: the `<>…</>` fragment inside `.map` needs a `key`; React requires the key on the outermost element of each iteration. If lint/React warns about a keyed fragment, use `<Fragment key={key}>` (import `Fragment` from `react`) wrapping the two `<tr>`s instead of `<>`. Prefer `Fragment` with the key if the bare fragment can't take one in this React version.

- [ ] **Step 4: Run, expect PASS** — `pnpm --filter @language-drill/web test "app/(admin)/admin/generation/_components/__tests__/pool-coverage-table.test.tsx"`
- [ ] **Step 5: Typecheck web** — `pnpm --filter @language-drill/web typecheck` → clean
- [ ] **Step 6: Commit**
```bash
git add "apps/web/app/(admin)/admin/generation/_components/pool-coverage-table.tsx" "apps/web/app/(admin)/admin/generation/_components/__tests__/pool-coverage-table.test.tsx"
git commit -m "feat(admin): expandable pool-coverage rows with per-cell drill-down"
```

---

## Task 5: Full verification

**Files:** none.

- [ ] **Step 1: Lint** — `pnpm lint` → no errors
- [ ] **Step 2: Repo typecheck** — `pnpm typecheck` → no errors (11/11)
- [ ] **Step 3: Full serial test suite** — `pnpm turbo run test --concurrency=1` → all packages pass
- [ ] **Step 4: Commit (only if a lint/format autofix changed files; else skip)**
```bash
git add -A && git commit -m "chore(admin): verification fixes" || echo "nothing to commit"
```

---

## Self-review notes

- **Spec coverage:** `GET /admin/pool-cell` floors + rejection aggregate (Task 1); api-client hook/schema (Task 2); diversity-vs-floors + rejection chips + numbers line + content-browser link (Task 3); expandable rows + lazy fetch via authed `fetchFn` (Task 4); tests throughout + Task 5. Row remains source of truth for distribution/numbers (Task 3 uses `item.*`). `coverageOutcome` correctly omitted (deferred per spec).
- **Type consistency:** `PoolCellQuery` (language/level/type/grammarPoint) used by the hook (Task 2) and constructed in `PoolCellDetail` (Task 3) from `item.grammarPointKey`; `PoolCellDetailSchema` shape (`floors`, `rejectionReasonCounts`) matches the Lambda response (Task 1) and the panel's destructure (Task 3); `cellKeyOf` in the table matches the existing row-key format.
- **Known pitfalls flagged inline:** real-curriculum fixture + the `cloze`-may-not-enumerate fallback (Task 1); keyed fragment in `.map` (Task 4); workspace `pnpm build` for cross-package imports.
- **No placeholders:** every code step is complete; every run step has a command + expected result.
```
