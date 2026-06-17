# Admin Curriculum / Grammar-Point Reference Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only `/admin/curriculum` reference (every curriculum entry per language/level, its CEFR mapping, suitability flags, coverage spec, and the exercise types it drives) backed by a new `GET /admin/curriculum` endpoint that serves the in-code curriculum — no DB, no mutations.

**Architecture:** One new read-only admin endpoint reading `ALL_CURRICULA` + `enumerateCurriculumCells` (already imported in `admin.ts`); a `useCurriculum` query hook + `schemas/curriculum.ts`; a client page with server-driven filters (language/level/kind), a client-side text filter, and expandable per-entry detail that deep-links to the content browser. New "Curriculum" nav entry.

**Tech Stack:** Hono + Drizzle-free static data (Lambda), Vitest, Zod, TanStack Query, Next.js client components, Tailwind.

---

## Context the implementer needs

Work from the worktree `/Users/seal/dev/language-drill/.claude/worktrees/feat-admin-curriculum` (branch `feat-admin-curriculum`). `cd` into it in every Bash call (the checked-out branch can silently flip; always operate from this path). Paths contain a `(admin)` route-group segment — quote them.

**Workspace dist:** if a test errors resolving `@language-drill/*`, run `pnpm build` at repo root. If the full lambda run shows phantom failures from stale `infra/lambda/dist/**/*.test.js`, `rm -rf infra/lambda/dist` and re-run.

**Single-file test commands:** `pnpm --filter @language-drill/lambda test <path>` · `pnpm --filter @language-drill/api-client test <path>` · `pnpm --filter @language-drill/web test <path>`.

**Key existing code (verified):**
- `infra/lambda/src/routes/admin.ts`: Hono admin router; `/admin/*` gated by `authMiddleware + adminMiddleware`. Already imports `ALL_CURRICULA` and `enumerateCurriculumCells` from `@language-drill/db` (lines 6, 10). **Add `curriculumOrderOf` and `CURRICULUM_VERSION_BY_LANGUAGE` to that same import.** Confirm `z` (zod) is imported at the top — other routes validate input with it; if it is not, add `import { z } from 'zod';`. The read-list idiom (`safeParse` query → `400 { error: 'VALIDATION_ERROR' }`, `c.json`) is `GET /admin/audit` / `GET /admin/content/exercises`.
- `enumerateCurriculumCells(ALL_CURRICULA)` returns `Cell[]`, each `{ language, cefrLevel, exerciseType, grammarPoint, cellKey }`. Group by `cell.grammarPoint.key` → the exercise types a point drives.
- `GrammarPoint` (`packages/shared/src/curriculum-types.ts`): `key, kind ('grammar'|'vocab'|'dictation'|'free-writing'), name, description, cefrLevel ('A1'|'A2'|'B1'|'B2'), language ('ES'|'DE'|'TR'), examplesPositive[], examplesNegative[], commonErrors[], prerequisiteKeys?[], targetOverride?, clozeUnsuitable?, sentenceConstructionSuitable?, conjugationSuitable?, coverageSpec?: { axes: { name, floors }[] }, freeWriting?: { register }`.
- `CURRICULUM_VERSION_BY_LANGUAGE` is keyed by the `Language` enum whose values are the strings `'ES'|'DE'|'TR'` — it serializes to `{ ES, DE, TR }` with no remapping.
- `infra/lambda/src/routes/admin.test.ts`: at the top it already imports the **real** `ALL_CURRICULA` and `enumerateCurriculumCells` from `@language-drill/db`, and `vi.mock('@language-drill/db', …)` spreads `...actual` (only the schema **table** objects are swapped for `{__mock}` sentinels). So curriculum exports are REAL in tests — the new route does NO `db` call, needs NO `queryQueue` staging, and tests can compute expected values directly from the imported `ALL_CURRICULA` / `enumerateCurriculumCells`. Helpers in-file: `app.request(path, init, env)`, `adminEnv`, `nonAdminEnv`, `unauthEnv`, `type AnyJson = Record<string, any>`. Uses vitest globals.
- api-client: `buildQueryString(params)` (`lib/build-query-string.ts`) returns `?a=1&b=2` **or** `''` (includes the leading `?`, skips undefined/empty, keeps `0`). Closest sibling hook with params: `packages/api-client/src/hooks/useContentBrowser.ts` / `useAuditLog.ts`. Barrel: `src/index.ts`. `createAuthenticatedFetch` / `type AuthenticatedFetch` exported.
- Web: `ADMIN_NAV` (`apps/web/components/admin/admin-nav-items.tsx`) = `[Moderation, Content, Pool, Theory, Invites, Audit, Capacity]`; its test (`components/admin/__tests__/admin-nav.test.tsx`) asserts exact href + label order. Read-only page idiom: `app/(admin)/admin/capacity/page.tsx` (filters/states) and `app/(admin)/admin/content/page.tsx` (server filters via `useState` params + a `grammarPoint` text input + expandable rows). The content browser is the deep-link target: it reads `searchParams` for `language`/`level`/`grammarPoint`.

---

## File structure

**Lambda (modify):** `infra/lambda/src/routes/admin.ts` (+`GET /admin/curriculum`), `admin.test.ts` (+tests).
**api-client (create/modify):** `schemas/curriculum.ts` (new), `hooks/useCurriculum.ts` (new), `hooks/useCurriculum.test.ts` (new), `index.ts` (barrel).
**web (create/modify):** `app/(admin)/admin/curriculum/page.tsx` (new) + `__tests__/page.test.tsx` (new); `components/admin/admin-nav-items.tsx` (+ its test).

---

## Task 1: Lambda — `GET /admin/curriculum`

**Files:** Modify `infra/lambda/src/routes/admin.ts`, `infra/lambda/src/routes/admin.test.ts`.

- [ ] **Step 1: Write failing tests**

Append to `admin.test.ts` (computes expectations from the real imported `ALL_CURRICULA` / `enumerateCurriculumCells`, so it survives curriculum churn):
```ts
describe('GET /admin/curriculum', () => {
  it('rejects a bad enum with 400 VALIDATION_ERROR', async () => {
    const res = await app.request('/admin/curriculum?language=FR', undefined, adminEnv);
    expect(res.status).toBe(400);
    expect(((await res.json()) as AnyJson).error).toBe('VALIDATION_ERROR');
  });

  it('returns the full curriculum with versions when unfiltered', async () => {
    const res = await app.request('/admin/curriculum', undefined, adminEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.total).toBe(ALL_CURRICULA.length);
    expect(body.items).toHaveLength(ALL_CURRICULA.length);
    expect(body.curriculumVersionByLanguage).toHaveProperty('ES');
    expect(body.curriculumVersionByLanguage).toHaveProperty('DE');
    expect(body.curriculumVersionByLanguage).toHaveProperty('TR');
  });

  it('filters by language', async () => {
    const res = await app.request('/admin/curriculum?language=TR', undefined, adminEnv);
    const body = (await res.json()) as AnyJson;
    const expected = ALL_CURRICULA.filter((e) => e.language === 'TR').length;
    expect(body.total).toBe(expected);
    expect(body.items.every((i: AnyJson) => i.language === 'TR')).toBe(true);
  });

  it('filters by kind', async () => {
    const res = await app.request('/admin/curriculum?kind=grammar', undefined, adminEnv);
    const body = (await res.json()) as AnyJson;
    expect(body.items.every((i: AnyJson) => i.kind === 'grammar')).toBe(true);
    expect(body.total).toBe(ALL_CURRICULA.filter((e) => e.kind === 'grammar').length);
  });

  it('sorts ES then DE then TR', async () => {
    const res = await app.request('/admin/curriculum', undefined, adminEnv);
    const langs: string[] = ((await res.json()) as AnyJson).items.map((i: AnyJson) => i.language);
    const order = { ES: 0, DE: 1, TR: 2 } as Record<string, number>;
    for (let i = 1; i < langs.length; i++) {
      expect(order[langs[i]]).toBeGreaterThanOrEqual(order[langs[i - 1]]);
    }
  });

  it('serializes the full entry shape with normalized flags and derived exerciseTypes', async () => {
    const res = await app.request('/admin/curriculum?kind=grammar', undefined, adminEnv);
    const item = ((await res.json()) as AnyJson).items[0];
    // normalized booleans (never undefined)
    expect(typeof item.clozeUnsuitable).toBe('boolean');
    expect(typeof item.sentenceConstructionSuitable).toBe('boolean');
    expect(typeof item.conjugationSuitable).toBe('boolean');
    expect(Array.isArray(item.prerequisiteKeys)).toBe(true);
    expect(item.targetOverride === null || typeof item.targetOverride === 'number').toBe(true);
    expect(item.coverageSpec === null || Array.isArray(item.coverageSpec.axes)).toBe(true);
    // derived exercise types match enumerateCurriculumCells for this key
    const expectedTypes = [
      ...new Set(
        enumerateCurriculumCells(ALL_CURRICULA)
          .filter((cc) => cc.grammarPoint.key === item.key)
          .map((cc) => cc.exerciseType),
      ),
    ].sort();
    expect([...item.exerciseTypes].sort()).toEqual(expectedTypes);
  });

  it('requires admin (non-admin is rejected)', async () => {
    const res = await app.request('/admin/curriculum', undefined, nonAdminEnv);
    expect(res.status).toBe(403);
  });
});
```
First confirm the in-file names (`app.request`, `adminEnv`, `nonAdminEnv`, `AnyJson`, and that `ALL_CURRICULA` + `enumerateCurriculumCells` are imported at the top) and adapt if any differ. Confirm the non-admin rejection status other admin-route tests assert (it should be `403`; match whatever the existing `nonAdminEnv` tests expect).

- [ ] **Step 2: Run, expect FAIL (404 / shape mismatch)** — `pnpm --filter @language-drill/lambda test src/routes/admin.test.ts`

- [ ] **Step 3: Implement**

In `admin.ts`: add `curriculumOrderOf` and `CURRICULUM_VERSION_BY_LANGUAGE` to the `@language-drill/db` import; ensure `z` is imported. Add the route (near the other admin GET routes):
```ts
const CurriculumQuerySchema = z.object({
  language: z.enum(['ES', 'DE', 'TR']).optional(),
  level: z.enum(['A1', 'A2', 'B1', 'B2']).optional(),
  kind: z.enum(['grammar', 'vocab', 'dictation', 'free-writing']).optional(),
});

admin.get('/admin/curriculum', async (c) => {
  const parsed = CurriculumQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() }, 400);
  }
  const { language, level, kind } = parsed.data;

  // Exercise types each point drives — built once from the FULL curriculum.
  const exerciseTypesByKey = new Map<string, string[]>();
  for (const cell of enumerateCurriculumCells(ALL_CURRICULA)) {
    const list = exerciseTypesByKey.get(cell.grammarPoint.key) ?? [];
    list.push(cell.exerciseType);
    exerciseTypesByKey.set(cell.grammarPoint.key, list);
  }

  const LANGUAGE_ORDER = ['ES', 'DE', 'TR'];

  const items = ALL_CURRICULA.filter(
    (e) =>
      (!language || e.language === language) &&
      (!level || e.cefrLevel === level) &&
      (!kind || e.kind === kind),
  )
    .map((e) => ({
      key: e.key,
      kind: e.kind,
      name: e.name,
      description: e.description,
      cefrLevel: e.cefrLevel,
      language: e.language,
      examplesPositive: [...e.examplesPositive],
      examplesNegative: [...e.examplesNegative],
      commonErrors: [...e.commonErrors],
      prerequisiteKeys: e.prerequisiteKeys ? [...e.prerequisiteKeys] : [],
      targetOverride: e.targetOverride ?? null,
      clozeUnsuitable: !!e.clozeUnsuitable,
      sentenceConstructionSuitable: !!e.sentenceConstructionSuitable,
      conjugationSuitable: !!e.conjugationSuitable,
      coverageSpec: e.coverageSpec
        ? { axes: e.coverageSpec.axes.map((a) => ({ name: a.name, floors: { ...a.floors } })) }
        : null,
      freeWritingRegister: e.freeWriting?.register ?? null,
      exerciseTypes: [...(exerciseTypesByKey.get(e.key) ?? [])].sort(),
    }))
    .sort((a, b) => {
      const la = LANGUAGE_ORDER.indexOf(a.language);
      const lb = LANGUAGE_ORDER.indexOf(b.language);
      if (la !== lb) return la - lb;
      return (
        (curriculumOrderOf(a.key) ?? Number.MAX_SAFE_INTEGER) -
        (curriculumOrderOf(b.key) ?? Number.MAX_SAFE_INTEGER)
      );
    });

  return c.json({
    items,
    total: items.length,
    curriculumVersionByLanguage: CURRICULUM_VERSION_BY_LANGUAGE,
  });
});
```

- [ ] **Step 4: Run, expect PASS** — `pnpm --filter @language-drill/lambda test src/routes/admin.test.ts` (run `pnpm build` at repo root first if a workspace-dist resolve error occurs)
- [ ] **Step 5: Typecheck** — `pnpm --filter @language-drill/lambda typecheck` → clean
- [ ] **Step 6: Commit**
```bash
git add infra/lambda/src/routes/admin.ts infra/lambda/src/routes/admin.test.ts
git commit -m "feat(admin): GET /admin/curriculum — read-only curriculum reference"
```

---

## Task 2: api-client — `useCurriculum`

**Files:** Create `packages/api-client/src/schemas/curriculum.ts`, `hooks/useCurriculum.ts`, `hooks/useCurriculum.test.ts`; modify `index.ts`.

- [ ] **Step 1: Create the schema**

`packages/api-client/src/schemas/curriculum.ts`:
```ts
import { z } from 'zod';

export const CoverageAxisSchema = z.object({
  name: z.string(),
  floors: z.record(z.number()),
});

export const CurriculumEntrySchema = z.object({
  key: z.string(),
  kind: z.enum(['grammar', 'vocab', 'dictation', 'free-writing']),
  name: z.string(),
  description: z.string(),
  cefrLevel: z.enum(['A1', 'A2', 'B1', 'B2']),
  language: z.enum(['ES', 'DE', 'TR']),
  examplesPositive: z.array(z.string()),
  examplesNegative: z.array(z.string()),
  commonErrors: z.array(z.string()),
  prerequisiteKeys: z.array(z.string()),
  targetOverride: z.number().nullable(),
  clozeUnsuitable: z.boolean(),
  sentenceConstructionSuitable: z.boolean(),
  conjugationSuitable: z.boolean(),
  coverageSpec: z.object({ axes: z.array(CoverageAxisSchema) }).nullable(),
  freeWritingRegister: z.enum(['informal', 'neutral', 'formal']).nullable(),
  exerciseTypes: z.array(z.string()),
});
export type CurriculumEntry = z.infer<typeof CurriculumEntrySchema>;

export const CurriculumResponseSchema = z.object({
  items: z.array(CurriculumEntrySchema),
  total: z.number(),
  curriculumVersionByLanguage: z.object({ ES: z.string(), DE: z.string(), TR: z.string() }),
});
export type CurriculumResponse = z.infer<typeof CurriculumResponseSchema>;
```
(If this repo's zod requires an explicit value type for `z.record`, use `z.record(z.string(), z.number())` — match how other `schemas/*.ts` call `z.record`.)

- [ ] **Step 2: Write the failing hook test**

`packages/api-client/src/hooks/useCurriculum.test.ts` (mirror the sibling hook test idiom in this package):
```ts
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { useCurriculum } from './useCurriculum';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
}
function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}
const payload = {
  items: [
    {
      key: 'tr-a1-present-tense', kind: 'grammar', name: 'Present tense', description: 'desc',
      cefrLevel: 'A1', language: 'TR', examplesPositive: ['a', 'b'], examplesNegative: ['*c'],
      commonErrors: ['e'], prerequisiteKeys: [], targetOverride: null,
      clozeUnsuitable: false, sentenceConstructionSuitable: true, conjugationSuitable: false,
      coverageSpec: { axes: [{ name: 'person', floors: { '1sg': 2 } }] },
      freeWritingRegister: null, exerciseTypes: ['cloze', 'translation'],
    },
  ],
  total: 1,
  curriculumVersionByLanguage: { ES: 'es@1', DE: 'de@1', TR: 'tr@1' },
};

describe('useCurriculum', () => {
  it('fetches /admin/curriculum and parses the response', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(payload));
    const { result } = renderHook(() => useCurriculum({ fetchFn }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(payload);
    expect(fetchFn).toHaveBeenCalledWith('/admin/curriculum');
  });

  it('passes filter params as a query string', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(payload));
    renderHook(() => useCurriculum({ fetchFn, params: { language: 'ES', kind: 'grammar' } }), { wrapper: wrapper() });
    await waitFor(() => expect(fetchFn).toHaveBeenCalled());
    expect(fetchFn).toHaveBeenCalledWith('/admin/curriculum?language=ES&kind=grammar');
  });
});
```

- [ ] **Step 3: Run, expect FAIL** — `pnpm --filter @language-drill/api-client test src/hooks/useCurriculum.test.ts`

- [ ] **Step 4: Create the hook**

`packages/api-client/src/hooks/useCurriculum.ts` (adapt imports to match `useContentBrowser.ts`/`useAuditLog.ts`):
```ts
import { useQuery } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../fetchClient';
import { buildQueryString } from '../lib/build-query-string';
import { CurriculumResponseSchema } from '../schemas/curriculum';

export type CurriculumParams = { language?: string; level?: string; kind?: string };

export function useCurriculum({
  fetchFn,
  params = {},
  enabled = true,
}: {
  fetchFn: AuthenticatedFetch;
  params?: CurriculumParams;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: ['admin', 'curriculum', params],
    queryFn: async () => {
      const res = await fetchFn(`/admin/curriculum${buildQueryString(params)}`);
      const json: unknown = await res.json();
      return CurriculumResponseSchema.parse(json);
    },
    enabled,
  });
}
```
(Confirm the import path for `AuthenticatedFetch` and `buildQueryString` against a sibling hook that uses both — adjust if they differ.)

- [ ] **Step 5: Barrel exports** — add to `packages/api-client/src/index.ts` (matching existing style):
```ts
export {
  CurriculumEntrySchema,
  CurriculumResponseSchema,
  type CurriculumEntry,
  type CurriculumResponse,
} from './schemas/curriculum';
export { useCurriculum, type CurriculumParams } from './hooks/useCurriculum';
```

- [ ] **Step 6: Test + typecheck + build**
- `pnpm --filter @language-drill/api-client test src/hooks/useCurriculum.test.ts` → 2 pass
- `pnpm --filter @language-drill/api-client typecheck` → clean
- `pnpm --filter @language-drill/api-client build` → success

- [ ] **Step 7: Commit**
```bash
git add packages/api-client/src/schemas/curriculum.ts packages/api-client/src/hooks/useCurriculum.ts packages/api-client/src/hooks/useCurriculum.test.ts packages/api-client/src/index.ts
git commit -m "feat(admin): api-client useCurriculum hook + schema"
```

---

## Task 3: web — Curriculum page + nav entry

**Files:** Create `apps/web/app/(admin)/admin/curriculum/page.tsx` + `__tests__/page.test.tsx`; modify `apps/web/components/admin/admin-nav-items.tsx` + its test.

- [ ] **Step 1: Update the nav test (RED)**

In `apps/web/components/admin/__tests__/admin-nav.test.tsx`, append Curriculum to the order assertions:
```tsx
    expect(ADMIN_NAV.map((d) => d.href)).toEqual([
      '/admin/moderation', '/admin/content', '/admin/generation', '/admin/theory', '/admin/invites', '/admin/audit', '/admin/capacity', '/admin/curriculum',
    ]);
    expect(ADMIN_NAV.map((d) => d.label)).toEqual([
      'Moderation', 'Content', 'Pool', 'Theory', 'Invites', 'Audit', 'Capacity', 'Curriculum',
    ]);
```
First READ the test to match its exact assertion style.

- [ ] **Step 2: Run nav test, expect FAIL** — `pnpm --filter @language-drill/web test "components/admin/__tests__/admin-nav.test.tsx"`

- [ ] **Step 3: Add the Curriculum nav entry**

In `apps/web/components/admin/admin-nav-items.tsx`, append to `ADMIN_NAV`:
```tsx
  { href: '/admin/curriculum', label: 'Curriculum' },
```

- [ ] **Step 4: Run nav test, expect PASS** — `pnpm --filter @language-drill/web test "components/admin/__tests__/admin-nav.test.tsx"`

- [ ] **Step 5: Write the failing page test**

`apps/web/app/(admin)/admin/curriculum/__tests__/page.test.tsx`:
```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@clerk/nextjs', () => ({ useAuth: () => ({ getToken: vi.fn() }) }));

const mockUseCurriculum = vi.fn();
vi.mock('@language-drill/api-client', async () => {
  const actual = await vi.importActual<typeof import('@language-drill/api-client')>('@language-drill/api-client');
  return { ...actual, createAuthenticatedFetch: () => vi.fn(), useCurriculum: (args: unknown) => mockUseCurriculum(args) };
});

import CurriculumPage from '../page';

const entry = {
  key: 'tr-a1-present-tense', kind: 'grammar', name: 'Present tense', description: 'The present tense',
  cefrLevel: 'A1', language: 'TR', examplesPositive: ['geliyorum', 'gidiyor'], examplesNegative: ['*gelmek'],
  commonErrors: ['drops the suffix'], prerequisiteKeys: [], targetOverride: null,
  clozeUnsuitable: false, sentenceConstructionSuitable: true, conjugationSuitable: false,
  coverageSpec: { axes: [{ name: 'person', floors: { '1sg': 2, '3sg': 2 } }] },
  freeWritingRegister: null, exerciseTypes: ['cloze', 'translation'],
};
const data = { items: [entry], total: 1, curriculumVersionByLanguage: { ES: 'es@1', DE: 'de@1', TR: 'tr@1' } };

beforeEach(() => { mockUseCurriculum.mockReset(); });

describe('CurriculumPage', () => {
  it('renders a row with key, kind badge, and flag chips; expand reveals detail + deep-link', () => {
    mockUseCurriculum.mockReturnValue({ isLoading: false, isError: false, data });
    render(<CurriculumPage />);
    expect(screen.getByText('tr-a1-present-tense')).toBeInTheDocument();
    expect(screen.getByText('Present tense')).toBeInTheDocument();
    expect(screen.getByText(/SC/)).toBeInTheDocument(); // sentenceConstructionSuitable chip
    expect(screen.getByText(/coverage/i)).toBeInTheDocument(); // has coverageSpec chip
    // expand
    fireEvent.click(screen.getByText('tr-a1-present-tense'));
    expect(screen.getByText('The present tense')).toBeInTheDocument();
    expect(screen.getByText('geliyorum')).toBeInTheDocument();
    expect(screen.getByText(/cloze, translation|cloze.*translation/)).toBeInTheDocument(); // exerciseTypes
    const link = screen.getByRole('link', { name: /pool content/i });
    expect(link).toHaveAttribute('href', '/admin/content?language=TR&level=A1&grammarPoint=tr-a1-present-tense');
  });

  it('client text filter narrows the list', () => {
    const two = { items: [entry, { ...entry, key: 'es-b1-subjunctive', name: 'Subjunctive', language: 'ES', cefrLevel: 'B1' }], total: 2, curriculumVersionByLanguage: data.curriculumVersionByLanguage };
    mockUseCurriculum.mockReturnValue({ isLoading: false, isError: false, data: two });
    render(<CurriculumPage />);
    expect(screen.getByText('es-b1-subjunctive')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/filter/i), { target: { value: 'present' } });
    expect(screen.queryByText('es-b1-subjunctive')).not.toBeInTheDocument();
    expect(screen.getByText('tr-a1-present-tense')).toBeInTheDocument();
  });

  it('shows loading and empty states', () => {
    mockUseCurriculum.mockReturnValue({ isLoading: true, isError: false, data: undefined });
    const { rerender } = render(<CurriculumPage />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    mockUseCurriculum.mockReturnValue({ isLoading: false, isError: false, data: { items: [], total: 0, curriculumVersionByLanguage: data.curriculumVersionByLanguage } });
    rerender(<CurriculumPage />);
    expect(screen.getByText(/no (entries|curriculum|results)/i)).toBeInTheDocument();
  });
});
```
If a matcher is ambiguous (e.g. the exerciseTypes joined string), tighten it to match exactly how you render that line. Keep assertions meaningful.

- [ ] **Step 6: Run, expect FAIL** — `pnpm --filter @language-drill/web test "app/(admin)/admin/curriculum/__tests__/page.test.tsx"`

- [ ] **Step 7: Implement the page**

Create `apps/web/app/(admin)/admin/curriculum/page.tsx`. Mirror the `capacity`/`content` page idiom (tokens `text-ink`/`text-ink-soft`/`text-[13px]`/`font-display`; loading/error wording; the content page's `useState`-driven server filters + expandable rows). Functional template (adapt classes to siblings; do NOT invent tokens):
```tsx
'use client';

import { useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { createAuthenticatedFetch, useCurriculum, type CurriculumEntry } from '@language-drill/api-client';

const LANGUAGES = ['ES', 'DE', 'TR'];
const LEVELS = ['A1', 'A2', 'B1', 'B2'];
const KINDS = ['grammar', 'vocab', 'dictation', 'free-writing'];

export default function CurriculumPage() {
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  const [params, setParams] = useState<{ language?: string; level?: string; kind?: string }>({});
  const [text, setText] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const curriculum = useCurriculum({ fetchFn, params });

  const setParam = (k: 'language' | 'level' | 'kind', v: string) =>
    setParams((p) => ({ ...p, [k]: v || undefined }));

  if (curriculum.isLoading) return <p className="text-ink-soft text-[13px] p-1">Loading…</p>;
  if (curriculum.isError || !curriculum.data) return <p className="text-ink-soft text-[13px] p-1">Failed to load the curriculum.</p>;

  const { items, total, curriculumVersionByLanguage } = curriculum.data;
  const q = text.trim().toLowerCase();
  const visible = q ? items.filter((e) => e.key.toLowerCase().includes(q) || e.name.toLowerCase().includes(q)) : items;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-[24px] font-semibold text-ink">Curriculum</h1>
      <p className="text-[12px] text-ink-soft">
        Versions — ES {curriculumVersionByLanguage.ES} · DE {curriculumVersionByLanguage.DE} · TR {curriculumVersionByLanguage.TR}
      </p>

      <div className="flex gap-2 items-center text-[13px]">
        <select aria-label="language" value={params.language ?? ''} onChange={(e) => setParam('language', e.target.value)}>
          <option value="">All languages</option>
          {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <select aria-label="level" value={params.level ?? ''} onChange={(e) => setParam('level', e.target.value)}>
          <option value="">All levels</option>
          {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <select aria-label="kind" value={params.kind ?? ''} onChange={(e) => setParam('kind', e.target.value)}>
          <option value="">All kinds</option>
          {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <input aria-label="filter" placeholder="filter by key or name" value={text} onChange={(e) => setText(e.target.value)} />
      </div>

      <p className="text-[12px] text-ink-soft">{visible.length} of {total}</p>

      {visible.length === 0 ? (
        <p className="text-ink-soft text-[13px]">No entries match.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {visible.map((e) => (
            <li key={e.key} className="flex flex-col gap-1 border-b border-line py-1">
              <button type="button" className="flex gap-2 items-center text-left text-[13px]" onClick={() => setOpen(open === e.key ? null : e.key)}>
                <span className="font-mono">{e.key}</span>
                <span className="text-ink-soft">[{e.kind}]</span>
                <span className="text-ink">{e.name}</span>
                <span className="text-ink-soft">{e.cefrLevel}</span>
                {e.clozeUnsuitable && <Chip>cloze-unsuitable</Chip>}
                {e.sentenceConstructionSuitable && <Chip>SC</Chip>}
                {e.conjugationSuitable && <Chip>conjugation</Chip>}
                {e.coverageSpec && <Chip>coverage</Chip>}
                {e.targetOverride !== null && <Chip>target {e.targetOverride}</Chip>}
              </button>
              {open === e.key && <CurriculumDetail entry={e} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="text-[11px] text-ink-soft border border-line rounded px-1">{children}</span>;
}

function CurriculumDetail({ entry }: { entry: CurriculumEntry }) {
  const poolHref = `/admin/content?language=${entry.language}&level=${entry.cefrLevel}&grammarPoint=${encodeURIComponent(entry.key)}`;
  return (
    <div className="flex flex-col gap-1 text-[12px] text-ink-soft pl-2">
      <p className="text-ink">{entry.description}</p>
      <p>Positive: {entry.examplesPositive.join(' · ')}</p>
      <p>Negative: {entry.examplesNegative.join(' · ')}</p>
      <p>Common errors: {entry.commonErrors.join(' · ')}</p>
      {entry.prerequisiteKeys.length > 0 && <p>Prerequisites: {entry.prerequisiteKeys.join(', ')}</p>}
      {entry.coverageSpec && (
        <p>Coverage: {entry.coverageSpec.axes.map((a) => `${a.name} {${Object.entries(a.floors).map(([k, v]) => `${k}:${v}`).join(', ')}}`).join(' · ')}</p>
      )}
      {entry.freeWritingRegister && <p>Free-writing register: {entry.freeWritingRegister}</p>}
      <p>Drives: {entry.exerciseTypes.join(', ')}</p>
      <a className="text-accent underline" href={poolHref}>View pool content →</a>
    </div>
  );
}
```
IMPORTANT: verify against the content page which border/accent token classes actually exist (e.g. `border-line`, `text-accent`) and use the real ones; if the sibling uses a shared Chip/badge component, prefer it over the local `Chip`. Ensure the chip text rendered matches the test matchers (`/SC/`, `/coverage/i`) — adjust either to agree.

- [ ] **Step 8: Run page + nav tests, expect PASS** — `pnpm --filter @language-drill/web test "app/(admin)/admin/curriculum/__tests__/page.test.tsx" "components/admin/__tests__/admin-nav.test.tsx"` (run `pnpm build` at repo root first if a workspace-dist resolve error occurs)
- [ ] **Step 9: Typecheck web** — `pnpm --filter @language-drill/web typecheck` → clean (a known pre-existing `e2e/helpers/auth.ts` "@language-drill/db" worktree-dist error is acceptable only if it's the ONLY error and unrelated; the Task-4 turbo typecheck is the real gate)
- [ ] **Step 10: Commit**
```bash
git add "apps/web/app/(admin)/admin/curriculum/page.tsx" "apps/web/app/(admin)/admin/curriculum/__tests__/page.test.tsx" "apps/web/components/admin/admin-nav-items.tsx" "apps/web/components/admin/__tests__/admin-nav.test.tsx"
git commit -m "feat(admin): curriculum reference page + nav entry"
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

- **Spec coverage:** `GET /admin/curriculum` with optional `language`/`level`/`kind` (zod safeParse → 400), full `CurriculumEntry` shape with normalized flags + derived `exerciseTypes` + ES→DE→TR/curriculum-order sort + `curriculumVersionByLanguage`, read-only no-DB (Task 1); `useCurriculum` hook + schema + types (Task 2); page with server filters + client text filter + expandable detail + content-browser deep-link + "Curriculum" nav (Task 3); tests throughout + Task 4 gate. Editing, live pool counts, and `skill_topics` are out of scope per the spec.
- **Type consistency:** `CurriculumEntry` field set (`key`, `kind`, `name`, `description`, `cefrLevel`, `language`, `examplesPositive`, `examplesNegative`, `commonErrors`, `prerequisiteKeys`, `targetOverride`, `clozeUnsuitable`, `sentenceConstructionSuitable`, `conjugationSuitable`, `coverageSpec`, `freeWritingRegister`, `exerciseTypes`) is identical across the Lambda response (Task 1), the Zod schema (Task 2), and the page consumer (Task 3). `coverageSpec.axes[].{name,floors}` and `curriculumVersionByLanguage.{ES,DE,TR}` consistent.
- **Known pitfalls flagged inline:** add `curriculumOrderOf` + `CURRICULUM_VERSION_BY_LANGUAGE` to the db import and confirm `z` is imported (Task 1); curriculum exports are REAL in `admin.test.ts` so no `queryQueue` staging and expectations computed from imports (Task 1); `buildQueryString` already includes the leading `?` (Task 2); verify real token/badge classes + chip-text/matcher agreement (Task 3); workspace `pnpm build` + stale `infra/lambda/dist` (Tasks 1/3/4); web-only typecheck e2e/db artifact (Task 3).
- **No placeholders:** every code step is complete; every run step has a command + expected result.
```
