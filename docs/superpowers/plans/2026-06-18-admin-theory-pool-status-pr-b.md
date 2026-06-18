# Admin Theory pool-status (PR-B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Pool page's Theory tab detailed and actionable: add a `GET /admin/theory/pool-status` endpoint returning per-grammar-point theory status (approved / flagged / missing), and render it as a per-point list with deeplinks under the existing coverage matrix.

**Architecture:** The endpoint enumerates grammar-kind curriculum points from `ALL_CURRICULA` and left-joins a single aggregated query over `theory_topics` (grouped by language + grammar point) so missing points still appear. A new `useTheoryPoolStatus` hook + `PoolStatusTheoryItemSchema` feed the Theory tab. Deeplinks point at `/admin/content?tab=theory&…`, which requires the content page to honor `?tab`.

**Tech Stack:** Hono (AWS Lambda), Drizzle ORM, Zod, TanStack Query, Next.js App Router, Vitest + Testing Library.

## Global Constraints

- This PR builds ON branch `feat/admin-pool-page` (PR-A). The Pool page (`apps/web/app/(admin)/admin/pool/page.tsx`) already exists with `Exercises | Theory` tabs, the shared filter row (`FilterSelect` + `GrammarPointCombobox`), and the Theory tab currently rendering only the language×CEFR coverage matrix.
- Theory grain: `theory_topics` is keyed by `(language, grammarPointKey)` with a `cefrLevel` column. Approved = `reviewStatus IN ('auto-approved','manual-approved')`; flagged = `reviewStatus = 'flagged'`; `rejected` is hidden (counts as neither). Mirror these semantics exactly.
- Theory exists only for `kind === 'grammar'` curriculum points (matches the existing `/admin/theory/coverage` denominator).
- Languages ES/DE/TR; levels A1/A2/B1/B2.
- Match newer admin styling: tables/list `text-[13px]`, sub-headings `text-[12px] text-ink-soft`, accent links `text-accent-2 underline`, monospace keys `font-mono`.
- No theory refill/revalidate UI (no such endpoint exists — out of scope).
- The lambda admin tests use a pure-Vitest mock DB: push expected query results onto the module-level `queryQueue` (FIFO, one entry consumed per awaited query). Tests do NOT use a real DB.
- Pre-push gate (CLAUDE.md): `pnpm lint`, `pnpm typecheck`, `pnpm turbo run test --concurrency=1` must pass before the final task's commit.

---

### Task B1: `GET /admin/theory/pool-status` endpoint + lambda test

**Files:**
- Modify: `infra/lambda/src/routes/admin.ts` (add the handler immediately after the existing `/admin/theory/coverage` handler, ~line 530)
- Test: `infra/lambda/src/routes/admin.test.ts` (add a `describe` block; mirror the existing `GET /admin/theory/coverage` test's setup)

**Interfaces:**
- Consumes: `ALL_CURRICULA` (from `@language-drill/db` — already imported in admin.ts), `theoryTopics`, `db`, `sql` (already imported).
- Produces: `GET /admin/theory/pool-status?language=&level=` → JSON array of
  `{ language, level, grammarPointKey, name, hasApprovedPage: boolean, flaggedCount: number, lastGeneratedAt: string | null }`,
  one entry per grammar-kind curriculum point (filtered by the optional query params).

- [ ] **Step 1: Write the failing test**

Add to `infra/lambda/src/routes/admin.test.ts`. If `ALL_CURRICULA` is not already imported at the top of the test file, add `import { ALL_CURRICULA } from '@language-drill/db';`.

```ts
describe('GET /admin/theory/pool-status', () => {
  it('returns one row per grammar curriculum point, marking missing/flagged/approved', async () => {
    const grammarPoints = ALL_CURRICULA.filter((gp) => gp.kind === 'grammar');
    const approvedPt = grammarPoints[0];
    const flaggedPt = grammarPoints[1];

    // One aggregated query: per (language, grammarPointKey) → hasApproved + flaggedCount + lastGeneratedAt.
    queryQueue.push([
      { language: approvedPt.language, grammarPointKey: approvedPt.key, hasApproved: true, flaggedCount: 0, lastGeneratedAt: '2026-06-01T00:00:00.000Z' },
      { language: flaggedPt.language, grammarPointKey: flaggedPt.key, hasApproved: false, flaggedCount: 2, lastGeneratedAt: null },
    ]);

    const res = await app.request('/admin/theory/pool-status', undefined, adminEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{
      language: string; level: string; grammarPointKey: string; name: string;
      hasApprovedPage: boolean; flaggedCount: number; lastGeneratedAt: string | null;
    }>;

    // Every grammar-kind curriculum point appears exactly once.
    expect(body).toHaveLength(grammarPoints.length);

    const byKey = new Map(body.map((r) => [`${r.language}:${r.grammarPointKey}`, r]));
    expect(byKey.get(`${approvedPt.language}:${approvedPt.key}`)?.hasApprovedPage).toBe(true);
    expect(byKey.get(`${flaggedPt.language}:${flaggedPt.key}`)?.hasApprovedPage).toBe(false);
    expect(byKey.get(`${flaggedPt.language}:${flaggedPt.key}`)?.flaggedCount).toBe(2);

    // A point with no DB row is "missing": not approved, zero flagged, name from the curriculum.
    const missing = grammarPoints.find((gp) => gp.key !== approvedPt.key && gp.key !== flaggedPt.key)!;
    const missingRow = byKey.get(`${missing.language}:${missing.key}`);
    expect(missingRow?.hasApprovedPage).toBe(false);
    expect(missingRow?.flaggedCount).toBe(0);
    expect(missingRow?.name).toBe(missing.name);
  });

  it('filters by language', async () => {
    queryQueue.push([]);
    const res = await app.request('/admin/theory/pool-status?language=ES', undefined, adminEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ language: string }>;
    expect(body.length).toBeGreaterThan(0);
    expect(body.every((r) => r.language === 'ES')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd infra/lambda && npx vitest run src/routes/admin.test.ts -t "pool-status"`
Expected: FAIL — the route returns 404 (handler not defined), so `res.status` is not 200.

- [ ] **Step 3: Implement the handler**

In `infra/lambda/src/routes/admin.ts`, immediately after the `admin.get('/admin/theory/coverage', …)` handler closes, add:

```ts
// Per-grammar-point theory fill status: one row per grammar-kind curriculum
// point (so points with no page yet show as "missing"), left-joined to an
// aggregate over theory_topics. Approved = auto/manual-approved; flagged is
// surfaced separately; rejected rows are ignored (mirrors theory/coverage).
admin.get('/admin/theory/pool-status', async (c) => {
  const language = c.req.query('language');
  const level = c.req.query('level');

  const aggRows = await db
    .select({
      language: theoryTopics.language,
      grammarPointKey: theoryTopics.grammarPointKey,
      hasApproved: sql<boolean>`bool_or(${theoryTopics.reviewStatus} IN ('auto-approved', 'manual-approved'))`,
      flaggedCount: sql<number>`COUNT(*) FILTER (WHERE ${theoryTopics.reviewStatus} = 'flagged')::int`,
      lastGeneratedAt: sql<string | null>`MAX(${theoryTopics.generatedAt})`,
    })
    .from(theoryTopics)
    .groupBy(theoryTopics.language, theoryTopics.grammarPointKey);

  const byKey = new Map<string, { hasApproved: boolean; flaggedCount: number; lastGeneratedAt: string | null }>();
  for (const r of aggRows) {
    byKey.set(`${r.language}:${r.grammarPointKey}`, {
      hasApproved: Boolean(r.hasApproved),
      flaggedCount: r.flaggedCount,
      lastGeneratedAt: r.lastGeneratedAt ?? null,
    });
  }

  const items = ALL_CURRICULA.filter((gp) => gp.kind === 'grammar')
    .filter((gp) => (!language || gp.language === language) && (!level || gp.cefrLevel === level))
    .map((gp) => {
      const agg = byKey.get(`${gp.language}:${gp.key}`);
      return {
        language: gp.language,
        level: gp.cefrLevel,
        grammarPointKey: gp.key,
        name: gp.name,
        hasApprovedPage: agg?.hasApproved ?? false,
        flaggedCount: agg?.flaggedCount ?? 0,
        lastGeneratedAt: agg?.lastGeneratedAt ?? null,
      };
    });

  return c.json(items);
});
```

If `ALL_CURRICULA` is not yet imported in `admin.ts`, add it to the existing `@language-drill/db` import (the file already imports `enumerateCurriculumCells` and `theoryTopics` from there — confirm and extend that import rather than adding a duplicate line).

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd infra/lambda && npx vitest run src/routes/admin.test.ts -t "pool-status"`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck the lambda package**

Run: `pnpm --filter @language-drill/lambda typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add infra/lambda/src/routes/admin.ts infra/lambda/src/routes/admin.test.ts
git commit -m "feat(admin): GET /admin/theory/pool-status per-grammar-point endpoint"
```

---

### Task B2: api-client schema + hook for theory pool-status

**Files:**
- Modify: `packages/api-client/src/schemas/theory.ts` (add `PoolStatusTheoryItemSchema`)
- Modify: `packages/api-client/src/schemas/theory.test.ts` (add schema tests)
- Create: `packages/api-client/src/hooks/useTheoryPoolStatus.ts`
- Modify: `packages/api-client/src/index.ts` (export schema + hook)

**Interfaces:**
- Consumes: the endpoint shape from Task B1.
- Produces:
  - `PoolStatusTheoryItemSchema` / `PoolStatusTheoryItem` type
  - `useTheoryPoolStatus({ fetchFn, params?: { language?: string; level?: string }, enabled? })` → `UseQueryResult<PoolStatusTheoryItem[]>`

- [ ] **Step 1: Write the failing schema test**

Add to `packages/api-client/src/schemas/theory.test.ts` (import `PoolStatusTheoryItemSchema` from `./theory` — add to the existing import line):

```ts
describe('PoolStatusTheoryItemSchema', () => {
  const valid = {
    language: 'ES', level: 'B1', grammarPointKey: 'es-b1-ser-estar', name: 'ser vs estar',
    hasApprovedPage: true, flaggedCount: 0, lastGeneratedAt: null,
  };
  it('parses a valid item', () => {
    expect(PoolStatusTheoryItemSchema.parse(valid)).toEqual(valid);
  });
  it('accepts a timestamp string for lastGeneratedAt', () => {
    expect(PoolStatusTheoryItemSchema.parse({ ...valid, lastGeneratedAt: '2026-06-01T00:00:00.000Z' }).lastGeneratedAt)
      .toBe('2026-06-01T00:00:00.000Z');
  });
  it('rejects an invalid language', () => {
    expect(() => PoolStatusTheoryItemSchema.parse({ ...valid, language: 'FR' })).toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `cd packages/api-client && npx vitest run src/schemas/theory.test.ts -t "PoolStatusTheoryItemSchema"`
Expected: FAIL — `PoolStatusTheoryItemSchema` is not exported from `./theory`.

- [ ] **Step 3: Add the schema**

In `packages/api-client/src/schemas/theory.ts`, after `TheoryCoverageResponseSchema` and its types, add:

```ts
// Envelope item for GET /admin/theory/pool-status (one per grammar curriculum point).
export const PoolStatusTheoryItemSchema = z.object({
  language: z.enum(['ES', 'DE', 'TR']),
  level: z.enum(['A1', 'A2', 'B1', 'B2']),
  grammarPointKey: z.string(),
  name: z.string(),
  hasApprovedPage: z.boolean(),
  flaggedCount: z.number().int().nonnegative(),
  lastGeneratedAt: z.string().nullable(),
});

export type PoolStatusTheoryItem = z.infer<typeof PoolStatusTheoryItemSchema>;
```

- [ ] **Step 4: Run the schema test to verify it passes**

Run: `cd packages/api-client && npx vitest run src/schemas/theory.test.ts -t "PoolStatusTheoryItemSchema"`
Expected: PASS (3 tests).

- [ ] **Step 5: Create the hook**

```ts
// packages/api-client/src/hooks/useTheoryPoolStatus.ts
import { useQuery } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../fetchClient';
import { buildQueryString } from '../lib/build-query-string';
import { PoolStatusTheoryItemSchema } from '../schemas/theory';

export type TheoryPoolStatusParams = { language?: string; level?: string };

export function useTheoryPoolStatus({
  fetchFn, params = {}, enabled = true,
}: { fetchFn: AuthenticatedFetch; params?: TheoryPoolStatusParams; enabled?: boolean }) {
  return useQuery({
    queryKey: ['admin', 'theory', 'pool-status', params],
    queryFn: async () => {
      const res = await fetchFn(`/admin/theory/pool-status${buildQueryString({ ...params })}`);
      const json: unknown = await res.json();
      return PoolStatusTheoryItemSchema.array().parse(json);
    },
    enabled,
  });
}
```

- [ ] **Step 6: Export schema + hook from the barrel**

In `packages/api-client/src/index.ts`:
- Add `PoolStatusTheoryItemSchema` and `type PoolStatusTheoryItem` to the existing `from './schemas/theory'` export block (the one exporting `TheoryCoverageResponseSchema`).
- Next to the other theory hook exports (`export { useTheoryCoverage } from './hooks/useTheoryCoverage';`), add:

```ts
export { useTheoryPoolStatus, type TheoryPoolStatusParams } from './hooks/useTheoryPoolStatus';
```

- [ ] **Step 7: Typecheck + run the theory schema test file**

Run:
```bash
pnpm --filter @language-drill/api-client typecheck
cd packages/api-client && npx vitest run src/schemas/theory.test.ts
```
Expected: typecheck PASS; theory schema tests PASS.

- [ ] **Step 8: Rebuild api-client dist (web tests in B4 resolve the built package)**

Run: `pnpm --filter @language-drill/api-client build`
Expected: build succeeds. (Adds the new hook/schema to `dist` so the Pool page test in B4 can import them.)

- [ ] **Step 9: Commit**

```bash
git add packages/api-client/src/schemas/theory.ts packages/api-client/src/schemas/theory.test.ts packages/api-client/src/hooks/useTheoryPoolStatus.ts packages/api-client/src/index.ts
git commit -m "feat(api-client): PoolStatusTheoryItemSchema + useTheoryPoolStatus hook"
```

---

### Task B3: Content page honors `?tab` (so theory deeplinks open the Theory tab)

**Files:**
- Modify: `apps/web/app/(admin)/admin/content/page.tsx` (initialize `tab` from the URL)
- Create: `apps/web/app/(admin)/admin/content/__tests__/page.test.tsx` (focused test for the `?tab` behavior)

**Interfaces:**
- Consumes: nothing new.
- Produces: `/admin/content?tab=theory` starts on the Theory tab.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/app/(admin)/admin/content/__tests__/page.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@clerk/nextjs', () => ({ useAuth: () => ({ getToken: vi.fn() }) }));
const mockSearch = vi.fn();
vi.mock('next/navigation', () => ({ useSearchParams: () => mockSearch() }));

const empty = { isLoading: false, isError: false, data: { items: [], total: 0 } };
vi.mock('@language-drill/api-client', async () => {
  const actual = await vi.importActual<typeof import('@language-drill/api-client')>('@language-drill/api-client');
  return {
    ...actual,
    createAuthenticatedFetch: () => vi.fn(),
    useContentExercises: () => empty,
    useContentTheory: () => empty,
    useResolveContentExercise: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useResolveContentTheory: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useCurriculum: () => ({ isLoading: false, isError: false, data: { items: [] } }),
  };
});

import ContentPage from '../page';

beforeEach(() => mockSearch.mockReset());

describe('ContentPage tab from URL', () => {
  it('starts on Exercises by default', () => {
    mockSearch.mockReturnValue(new URLSearchParams(''));
    render(<ContentPage />);
    expect(screen.getByRole('tab', { name: /exercises/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('starts on Theory when ?tab=theory', () => {
    mockSearch.mockReturnValue(new URLSearchParams('tab=theory'));
    render(<ContentPage />);
    expect(screen.getByRole('tab', { name: /theory/i })).toHaveAttribute('aria-selected', 'true');
  });
});
```

- [ ] **Step 2: Run it to verify the second case fails**

Run: `cd apps/web && npx vitest run "app/(admin)/admin/content/__tests__/page"`
Expected: the "starts on Theory" test FAILS (tab is hard-coded to `'exercises'`); the default test passes.

- [ ] **Step 3: Initialize the tab from the URL**

In `apps/web/app/(admin)/admin/content/page.tsx`, the `ContentPageInner` component reads `searchParams` already. Change the tab state initializer from:

```tsx
  const [tab, setTab] = useState<Tab>('exercises');
```
to:
```tsx
  const [tab, setTab] = useState<Tab>(searchParams.get('tab') === 'theory' ? 'theory' : 'exercises');
```

(Ensure this line is placed after `const searchParams = useSearchParams();` — it already is in the current file.)

- [ ] **Step 4: Run the test to verify both cases pass**

Run: `cd apps/web && npx vitest run "app/(admin)/admin/content/__tests__/page"`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck web**

Run: `pnpm --filter @language-drill/web typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/\(admin\)/admin/content/page.tsx apps/web/app/\(admin\)/admin/content/__tests__/page.test.tsx
git commit -m "feat(admin): content page opens the Theory tab from ?tab=theory"
```

---

### Task B4: Theory tab per-grammar-point list with badges + deeplinks

**Files:**
- Modify: `apps/web/app/(admin)/admin/pool/page.tsx`
- Modify: `apps/web/app/(admin)/admin/pool/__tests__/page.test.tsx`

**Interfaces:**
- Consumes: `useTheoryPoolStatus`, `PoolStatusTheoryItem` (Task B2).
- Produces: the Theory tab renders the coverage matrix (roll-up) **plus** a per-grammar-point list (badge + deeplink), filtered by language/level (hook params) and grammar point (client-side).

- [ ] **Step 1: Extend the page test (write the new failing assertions)**

In `apps/web/app/(admin)/admin/pool/__tests__/page.test.tsx`, add a mock for the new hook alongside the existing `@language-drill/api-client` mock (add to the returned object): `useTheoryPoolStatus: (a: unknown) => mockTheoryPool(a),` and declare `const mockTheoryPool = vi.fn();` with the other mock fns. In `beforeEach`, add:

```tsx
  mockTheoryPool.mockReset();
  mockTheoryPool.mockReturnValue({ isLoading: false, isError: false, data: [
    { language: 'TR', level: 'A1', grammarPointKey: 'tr-a1-approved', name: 'approved pt', hasApprovedPage: true, flaggedCount: 0, lastGeneratedAt: null },
    { language: 'TR', level: 'A1', grammarPointKey: 'tr-a1-flagged', name: 'flagged pt', hasApprovedPage: false, flaggedCount: 3, lastGeneratedAt: null },
    { language: 'TR', level: 'A1', grammarPointKey: 'tr-a1-missing', name: 'missing pt', hasApprovedPage: false, flaggedCount: 0, lastGeneratedAt: null },
  ] });
```

Then add a test:

```tsx
  it('Theory tab lists grammar points with status badges and deeplinks', () => {
    render(<PoolPage />);
    fireEvent.click(screen.getByRole('tab', { name: /theory/i }));

    // Missing point shows a missing badge, no view link.
    expect(screen.getByText('tr-a1-missing')).toBeInTheDocument();
    expect(screen.getByText(/missing/i)).toBeInTheDocument();

    // Approved point has a deeplink into the content theory tab.
    const approvedLink = screen.getByRole('link', { name: /view/i });
    expect(approvedLink).toHaveAttribute(
      'href',
      '/admin/content?tab=theory&language=TR&level=A1&grammarPoint=tr-a1-approved',
    );

    // Flagged point shows its flagged count.
    expect(screen.getByText(/3 flagged/i)).toBeInTheDocument();
  });
```

(There will be two "view" links — approved and flagged. Use `getAllByRole` if `getByRole` complains about multiplicity; assert the approved href via `screen.getAllByRole('link', { name: /view/i })[0]`. Adjust to whichever the rendered order yields — the sort puts missing first, then flagged, then approved, so index `[1]` is the approved link if both flagged+approved have links. Write the assertion against the link whose href contains `tr-a1-approved` by filtering: `const links = screen.getAllByRole('link', { name: /view/i }); const approved = links.find((l) => l.getAttribute('href')?.includes('tr-a1-approved'));`.)

Final test form for the deeplink assertion (use this, not the single-link version above):

```tsx
    const links = screen.getAllByRole('link', { name: /view/i });
    const approved = links.find((l) => l.getAttribute('href')?.includes('tr-a1-approved'));
    expect(approved).toHaveAttribute(
      'href',
      '/admin/content?tab=theory&language=TR&level=A1&grammarPoint=tr-a1-approved',
    );
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/web && npx vitest run "app/(admin)/admin/pool/__tests__/page"`
Expected: the new test FAILS (no per-point list rendered yet; `useTheoryPoolStatus` not used by the page). Pre-existing tests still pass.

- [ ] **Step 3: Implement the per-point list in the page**

In `apps/web/app/(admin)/admin/pool/page.tsx`:

(a) Add to the api-client import: `useTheoryPoolStatus,` and add a type-only import `import type { PoolStatusTheoryItem } from '@language-drill/api-client';` (or add `PoolStatusTheoryItem` to the existing type imports).

(b) Inside `PoolPageInner`, after the existing `theory` hook line, add:

```tsx
  const theoryPool = useTheoryPoolStatus({
    fetchFn,
    params: { language: filters.language, level: filters.level },
    enabled: tab === 'theory',
  });
  const theoryItems = useMemo(() => {
    const filtered = (theoryPool.data ?? []).filter(
      (i) => !filters.grammarPoint || i.grammarPointKey === filters.grammarPoint,
    );
    // Surface gaps first: missing → flagged → approved, then by key.
    return [...filtered].sort((a, b) => theoryStatusRank(a) - theoryStatusRank(b) || a.grammarPointKey.localeCompare(b.grammarPointKey));
  }, [theoryPool.data, filters.grammarPoint]);
```

(c) Add these module-scope helpers (near the top, after the constants):

```tsx
function theoryStatusRank(i: PoolStatusTheoryItem): number {
  if (!i.hasApprovedPage && i.flaggedCount === 0) return 0; // missing
  if (i.flaggedCount > 0) return 1; // flagged (incl. approved-with-flags)
  return 2; // approved, clean
}

function theoryContentHref(i: PoolStatusTheoryItem): string {
  return `/admin/content?tab=theory&language=${encodeURIComponent(i.language)}&level=${encodeURIComponent(i.level)}&grammarPoint=${encodeURIComponent(i.grammarPointKey)}`;
}

function TheoryStatusBadge({ item }: { item: PoolStatusTheoryItem }) {
  if (item.hasApprovedPage) {
    return (
      <span className="text-[12px] text-ink-soft">
        ✓ approved{item.flaggedCount > 0 ? ` · ⚠ ${item.flaggedCount} flagged` : ''}
      </span>
    );
  }
  if (item.flaggedCount > 0) {
    return <span className="text-[12px] text-amber-700">⚠ {item.flaggedCount} flagged</span>;
  }
  return <span className="text-[12px] text-red-700">✗ missing</span>;
}
```

(d) Replace the Theory branch body. The current Theory branch renders only the matrix:

```tsx
        ) : (
          theory.isLoading ? <p className="text-ink-soft text-[13px]">Loading…</p>
          : theory.isError ? <p className="text-ink-soft text-[13px]">Failed to load theory coverage.</p>
          : (
            <table className="text-[13px]">
              ...matrix...
            </table>
          )
        )}
```

Change it to render the matrix as a roll-up plus the per-point list (keep the matrix `<table>` inner content EXACTLY as-is):

```tsx
        ) : (
          <div className="flex flex-col gap-4">
            {theory.isLoading ? <p className="text-ink-soft text-[13px]">Loading…</p>
              : theory.isError ? <p className="text-ink-soft text-[13px]">Failed to load theory coverage.</p>
              : (
                <table className="text-[13px]">
                  ...matrix (UNCHANGED inner content)...
                </table>
              )}
            <section className="flex flex-col gap-2">
              <h2 className="text-ink-soft text-[12px]">Grammar points</h2>
              {theoryPool.isLoading ? <p className="text-ink-soft text-[13px]">Loading…</p>
                : theoryPool.isError ? <p className="text-ink-soft text-[13px]">Failed to load theory pool status.</p>
                : theoryItems.length === 0 ? <p className="text-ink-soft text-[13px]">No matching grammar points.</p>
                : (
                  <ul className="flex flex-col gap-1">
                    {theoryItems.map((i) => (
                      <li key={`${i.language}:${i.grammarPointKey}`} className="flex items-center gap-2 flex-wrap border-b border-rule py-1 text-[13px]">
                        <span className="font-mono text-ink">{i.grammarPointKey}</span>
                        <span className="text-ink-soft">{i.name}</span>
                        <TheoryStatusBadge item={i} />
                        {(i.hasApprovedPage || i.flaggedCount > 0) ? (
                          <a className="text-accent-2 underline" href={theoryContentHref(i)}>view →</a>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
            </section>
          </div>
        )}
```

- [ ] **Step 4: Run the page test to verify it passes**

Run: `cd apps/web && npx vitest run "app/(admin)/admin/pool/__tests__/page"`
Expected: PASS (4 tests — the 3 prior + the new Theory list test).

- [ ] **Step 5: Typecheck web**

Run: `pnpm --filter @language-drill/web typecheck`
Expected: PASS.

- [ ] **Step 6: Full pre-push gate**

Run from repo root:
```bash
pnpm --filter @language-drill/web lint
pnpm typecheck
pnpm turbo run test --concurrency=1
```
Expected: all PASS (concurrency=1 avoids the known infra parallel-load flake).

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/\(admin\)/admin/pool/page.tsx apps/web/app/\(admin\)/admin/pool/__tests__/page.test.tsx
git commit -m "feat(admin): Theory tab per-grammar-point list with status badges + deeplinks"
```

---

## Self-Review

**Spec coverage (PR-B slice):**
- New `GET /admin/theory/pool-status` per-grammar-point endpoint, missing points included — Task B1. ✓
- Approved/flagged/rejected semantics mirror `/admin/theory/coverage` — Task B1 (`bool_or` approved, `FILTER` flagged, rejected ignored). ✓
- `PoolStatusTheoryItemSchema` + `useTheoryPoolStatus` hook + exports — Task B2. ✓
- Theory tab keeps the summary matrix as a roll-up AND adds the per-point list — Task B4. ✓
- Per-point badges ✓ approved / ⚠ N flagged / ✗ missing + deeplink to `/admin/content?tab=theory&…` — Task B4. ✓
- Grammar-point filter applies to the Theory list (resolves PR-A's logged no-op) — Task B4 (`theoryItems` filter on `filters.grammarPoint`). ✓
- Deeplink target actually opens the content Theory tab — Task B3. ✓
- No refill/revalidate UI — honored (none added). ✓

**Placeholder scan:** No TBD/TODO; every code step has full content; test code concrete. The B4 test deeplink assertion is given in final form (filter links by href substring) to avoid order fragility. ✓

**Type consistency:** `PoolStatusTheoryItem` fields (`language`, `level`, `grammarPointKey`, `name`, `hasApprovedPage`, `flaggedCount`, `lastGeneratedAt`) are identical across the endpoint (B1), schema (B2), and page consumption (B4). Hook name `useTheoryPoolStatus` and param type `TheoryPoolStatusParams` match between B2 (definition) and B4 (use). ✓

**Out of scope (PR-C):** the Usage & cost page and re-homing the generation cost/jobs blocks.
