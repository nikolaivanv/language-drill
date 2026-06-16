# Admin Content Browser & Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/admin/content` Moderation-mirror that browses/searches the **approved** exercise/theory pool (filters + text search + pagination) and lets an admin **Demote** (→ flagged) or **Reject** (→ rejected) a bad approved item.

**Architecture:** New `/admin/content/*` Lambda endpoints (list with filters/`q`/pagination + plain guarded status transitions) on the existing admin router; new `api-client` query+mutation hooks reusing the flagged `ResolveOutcome` schema; a client-component `/admin/content` page with Exercises | Theory tabs. Reuses `ContentFieldView` (moved to a shared admin location) and the theory renderer.

**Tech Stack:** Hono + Drizzle (Lambda), Vitest, Zod, TanStack Query, Next.js App Router (client components), Tailwind.

---

## Context the implementer needs

Work from the worktree `/Users/seal/dev/language-drill/.claude/worktrees/feat-admin-content-browser` (branch `feat-admin-content-browser`). `cd` into it in every Bash call. Paths contain a `(admin)` route-group segment — quote them.

**Workspace dist:** if a test errors resolving `@language-drill/*`, run `pnpm build` at repo root once, then re-run.

**Single-file test commands:**
- Lambda: `pnpm --filter @language-drill/lambda test <path-relative-to-infra/lambda>`
- api-client: `pnpm --filter @language-drill/api-client test <path>`
- web: `pnpm --filter @language-drill/web test <path>`

**This feature mirrors the just-merged flagged review queue** (`/admin/flagged/*`, `/admin/moderation`). Study those for the exact idioms; the content browser is structurally identical except: pagination via `offset`, a text-search `q` (ILIKE over `content_json::text`), an approved-status guard, and **no `23505` demote-on-conflict** (a status change of the existing unique row never collides).

**Key existing code:**
- `infra/lambda/src/routes/admin.ts`: Hono admin router. Imports from `drizzle-orm` currently include `and, asc, count, desc, eq, gte, isNotNull, sql`. Imports from `@language-drill/db` include `exercises, theoryTopics, …`. It already has `stripDedupKey(content)` and `normalizeFlaggedReasons` (from shared) and the flagged routes (`GET /admin/flagged/{exercises,theory}`, `POST /admin/flagged/{exercises,theory}/:id/{approve,reject}` via split `resolveExerciseFlagged`/`resolveTheoryFlagged`). Query validation: `Schema.safeParse(c.req.query())` → `400 { error, code:'VALIDATION_ERROR', details }`. `:id` validation: `z.string().uuid()`.
- `infra/lambda/src/routes/admin.test.ts`: chain-mock for `db` with a shared `queryQueue` (awaiting a chain shifts the next staged value; a staged `Error` rejects). `makeChain()` currently mocks `from/where/innerJoin/groupBy/orderBy/limit/values/returning/set` — **it does NOT mock `offset`** (add it in Task 1). Schema tables are `{ __mock: 'name' }` sentinels including `exercises`, `theoryTopics`. Tests use a request helper (inspect the file for its exact form — e.g. `app.request(path, init)` through the mounted Hono app).
- `exercises` columns: `reviewStatus`, `contentJson` (jsonb, has `_dedupKey`), `coverageTags` (jsonb|null), `qualityScore` (real|null), `generationSource` (text, notNull default 'manual'), `modelId` (text|null), `difficulty`, `type`, `grammarPointKey`, `language`, `generatedAt` (timestamptz|null). `theory_topics`: same review columns + `cefrLevel`, `topicId` (no `type`, no `coverageTags`).
- api-client: `packages/api-client/src/schemas/flagged.ts` exports `ResolveOutcomeSchema` (`['approved','rejected','demoted','not_found','already_resolved']`) and `ResolveResponseSchema` (`{ outcome }`) — **reuse these**. `hooks/useFlaggedQueue.ts` shows the query/mutation idiom (a private `queryString` builder, `invalidateQueries`). Barrel exports in `index.ts`. `createAuthenticatedFetch`/`AuthenticatedFetch` exported there.
- web: `app/(admin)/admin/moderation/page.tsx` (client page idiom: `useAuth()`→`createAuthenticatedFetch`, tabs, filter selects, try/catch resolve handlers, `Section` helper with loading/error/empty); `_components/content-field-view.tsx` (generic field view — **moves in Task 4**), `flagged-exercise-card.tsx` (uses `formatReason` from `@language-drill/shared`, imports `ContentFieldView` from `./content-field-view`), `flagged-theory-card.tsx` (theory via `renderTheoryTopicJson` from `components/theory/render-json` + `TheorySections` from `components/theory/theory-sections`, raw-JSON fallback). `Button` from `apps/web/components/ui` has variants `'default'|'primary'|'ghost'|'accent'` and `size="sm"`. `ADMIN_NAV` in `components/admin/admin-nav-items.tsx` is `[Moderation, Pool, Theory, Invites]`; its test `components/admin/__tests__/admin-nav.test.tsx` asserts that order.

---

## File structure

**Lambda (modify):** `infra/lambda/src/routes/admin.ts` (+`/admin/content/*` routes, `transitionContentExercise`/`transitionContentTheory`), `infra/lambda/src/routes/admin.test.ts` (+`offset` mock, +content tests).

**api-client (create/modify):** `packages/api-client/src/schemas/content.ts` (new), `packages/api-client/src/hooks/useContentBrowser.ts` (new), `useContentBrowser.test.ts` (new), `index.ts` (barrel).

**web:**
- Move `apps/web/app/(admin)/admin/moderation/_components/content-field-view.tsx` → `apps/web/components/admin/content-field-view.tsx` (+ its test); update the moderation flagged-exercise-card import.
- Create `apps/web/app/(admin)/admin/content/page.tsx`, `_components/content-exercise-card.tsx`, `_components/content-theory-card.tsx`, + tests.
- Modify `apps/web/components/admin/admin-nav-items.tsx` (+ its test).

---

## Task 1: Lambda — content list endpoints

**Files:** Modify `infra/lambda/src/routes/admin.ts`, `infra/lambda/src/routes/admin.test.ts`

- [ ] **Step 1: Add `offset` to the chain mock**

In `infra/lambda/src/routes/admin.test.ts`, in `makeChain()`, add an `offset` method alongside `limit`:
```ts
    offset: vi.fn(() => chain),
```

- [ ] **Step 2: Write failing tests**

Append to `admin.test.ts` (use the file's existing request helper + `queryQueue`):
```ts
describe('GET /admin/content/exercises', () => {
  it('returns approved items (metadata + _dedupKey stripped) + total', async () => {
    queryQueue.push([
      {
        id: 'ex-1', language: 'ES', difficulty: 'A2', type: 'cloze', grammarPointKey: 'obj-pronoun',
        contentJson: { type: 'cloze', sentence: 'Maria ___ lo dio.', correctAnswer: 'se', _dedupKey: 'k1' },
        coverageTags: { person: '3sg' }, qualityScore: 0.91, generationSource: 'claude-batch',
        modelId: 'claude-sonnet-4-6', reviewStatus: 'auto-approved', generatedAt: new Date('2026-06-01T00:00:00Z'),
      },
    ]); // items
    queryQueue.push([{ count: 42 }]); // total
    const res = await request('/admin/content/exercises?language=ES&q=lo&limit=10&offset=0');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(42);
    expect(body.items[0].level).toBe('A2');
    expect(body.items[0].contentJson._dedupKey).toBeUndefined();
    expect(body.items[0].generationSource).toBe('claude-batch');
    expect(body.items[0].reviewStatus).toBe('auto-approved');
    expect(body.items[0].coverageTags).toEqual({ person: '3sg' });
    expect(body.items[0].generatedAt).toBe('2026-06-01T00:00:00.000Z');
  });

  it('rejects an invalid language with 400', async () => {
    const res = await request('/admin/content/exercises?language=FR');
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /admin/content/theory', () => {
  it('returns approved theory items + total (no type/coverageTags)', async () => {
    queryQueue.push([
      {
        id: 'th-1', language: 'DE', cefrLevel: 'B1', grammarPointKey: 'dative', topicId: 'de-b1-dative',
        contentJson: { id: 't', title: 'Dative', subtitle: 's', cefr: 'B1', sections: [] },
        qualityScore: 0.8, generationSource: 'claude-batch', modelId: 'claude-sonnet-4-6',
        reviewStatus: 'manual-approved', generatedAt: new Date('2026-06-02T00:00:00Z'),
      },
    ]);
    queryQueue.push([{ count: 3 }]);
    const res = await request('/admin/content/theory');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(3);
    expect(body.items[0].level).toBe('B1');
    expect(body.items[0].topicId).toBe('de-b1-dative');
    expect(body.items[0].reviewStatus).toBe('manual-approved');
  });
});
```

- [ ] **Step 3: Run tests, expect FAIL (404)**

Run: `pnpm --filter @language-drill/lambda test src/routes/admin.test.ts`

- [ ] **Step 4: Implement**

In `infra/lambda/src/routes/admin.ts`: add `inArray` to the `drizzle-orm` import (alongside `and, asc, count, desc, eq, …`). Add the schemas + routes:
```ts
const APPROVED_STATUSES = ['auto-approved', 'manual-approved'] as const;

const ContentExercisesQuerySchema = z.object({
  language: z.enum(['ES', 'DE', 'TR']).optional(),
  level: z.enum(['A1', 'A2', 'B1', 'B2']).optional(),
  type: z.string().optional(),
  grammarPoint: z.string().optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
const ContentTheoryQuerySchema = z.object({
  language: z.enum(['ES', 'DE', 'TR']).optional(),
  level: z.enum(['A1', 'A2', 'B1', 'B2']).optional(),
  grammarPoint: z.string().optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

admin.get('/admin/content/exercises', async (c) => {
  const parsed = ContentExercisesQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'Invalid query parameters', code: 'VALIDATION_ERROR', details: parsed.error.flatten() }, 400);
  }
  const { language, level, type, grammarPoint, q, limit, offset } = parsed.data;
  const conds = [inArray(exercises.reviewStatus, [...APPROVED_STATUSES])];
  if (language) conds.push(eq(exercises.language, language));
  if (level) conds.push(eq(exercises.difficulty, level));
  if (type) conds.push(eq(exercises.type, type));
  if (grammarPoint) conds.push(eq(exercises.grammarPointKey, grammarPoint));
  if (q) conds.push(sql`${exercises.contentJson}::text ILIKE ${'%' + q + '%'}`);
  const where = and(...conds);
  const [rows, totalRows] = await Promise.all([
    db.select({
      id: exercises.id, language: exercises.language, difficulty: exercises.difficulty,
      type: exercises.type, grammarPointKey: exercises.grammarPointKey,
      contentJson: exercises.contentJson, coverageTags: exercises.coverageTags,
      qualityScore: exercises.qualityScore, generationSource: exercises.generationSource,
      modelId: exercises.modelId, reviewStatus: exercises.reviewStatus, generatedAt: exercises.generatedAt,
    }).from(exercises).where(where)
      .orderBy(sql`${exercises.generatedAt} DESC NULLS LAST`)
      .limit(limit ?? 25).offset(offset ?? 0),
    db.select({ count: count() }).from(exercises).where(where),
  ]);
  const items = rows.map((r) => ({
    id: r.id, language: r.language, level: r.difficulty, type: r.type,
    grammarPointKey: r.grammarPointKey, contentJson: stripDedupKey(r.contentJson),
    coverageTags: r.coverageTags, qualityScore: r.qualityScore,
    generationSource: r.generationSource, modelId: r.modelId, reviewStatus: r.reviewStatus,
    generatedAt: r.generatedAt ? r.generatedAt.toISOString() : null,
  }));
  return c.json({ items, total: Number(totalRows[0]?.count ?? 0) });
});

admin.get('/admin/content/theory', async (c) => {
  const parsed = ContentTheoryQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'Invalid query parameters', code: 'VALIDATION_ERROR', details: parsed.error.flatten() }, 400);
  }
  const { language, level, grammarPoint, q, limit, offset } = parsed.data;
  const conds = [inArray(theoryTopics.reviewStatus, [...APPROVED_STATUSES])];
  if (language) conds.push(eq(theoryTopics.language, language));
  if (level) conds.push(eq(theoryTopics.cefrLevel, level));
  if (grammarPoint) conds.push(eq(theoryTopics.grammarPointKey, grammarPoint));
  if (q) conds.push(sql`${theoryTopics.contentJson}::text ILIKE ${'%' + q + '%'}`);
  const where = and(...conds);
  const [rows, totalRows] = await Promise.all([
    db.select({
      id: theoryTopics.id, language: theoryTopics.language, cefrLevel: theoryTopics.cefrLevel,
      grammarPointKey: theoryTopics.grammarPointKey, topicId: theoryTopics.topicId,
      contentJson: theoryTopics.contentJson, qualityScore: theoryTopics.qualityScore,
      generationSource: theoryTopics.generationSource, modelId: theoryTopics.modelId,
      reviewStatus: theoryTopics.reviewStatus, generatedAt: theoryTopics.generatedAt,
    }).from(theoryTopics).where(where)
      .orderBy(sql`${theoryTopics.generatedAt} DESC NULLS LAST`)
      .limit(limit ?? 25).offset(offset ?? 0),
    db.select({ count: count() }).from(theoryTopics).where(where),
  ]);
  const items = rows.map((r) => ({
    id: r.id, language: r.language, level: r.cefrLevel, grammarPointKey: r.grammarPointKey,
    topicId: r.topicId, contentJson: r.contentJson, qualityScore: r.qualityScore,
    generationSource: r.generationSource, modelId: r.modelId, reviewStatus: r.reviewStatus,
    generatedAt: r.generatedAt ? r.generatedAt.toISOString() : null,
  }));
  return c.json({ items, total: Number(totalRows[0]?.count ?? 0) });
});
```

- [ ] **Step 5: Run tests, expect PASS** — `pnpm --filter @language-drill/lambda test src/routes/admin.test.ts`

- [ ] **Step 6: Commit**
```bash
git add infra/lambda/src/routes/admin.ts infra/lambda/src/routes/admin.test.ts
git commit -m "feat(admin): approved-content list endpoints (filters + search + pagination)"
```

---

## Task 2: Lambda — demote/reject endpoints

**Files:** Modify `infra/lambda/src/routes/admin.ts`, `infra/lambda/src/routes/admin.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `admin.test.ts` (valid uuid for `:id`):
```ts
describe('POST /admin/content/exercises/:id/demote', () => {
  const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  it('demotes an approved row (outcome=demoted)', async () => {
    queryQueue.push([{ id }]); // UPDATE returning -> 1 row
    const res = await request(`/admin/content/exercises/${id}/demote`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outcome: 'demoted' });
  });
  it('already_resolved when 0 rows match but the row exists', async () => {
    queryQueue.push([]); // UPDATE -> 0
    queryQueue.push([{ reviewStatus: 'flagged' }]); // re-read
    const res = await request(`/admin/content/exercises/${id}/demote`, { method: 'POST' });
    expect(await res.json()).toEqual({ outcome: 'already_resolved' });
  });
  it('not_found when the row does not exist', async () => {
    queryQueue.push([]); queryQueue.push([]);
    const res = await request(`/admin/content/exercises/${id}/demote`, { method: 'POST' });
    expect(await res.json()).toEqual({ outcome: 'not_found' });
  });
  it('rejects a non-uuid id with 400', async () => {
    const res = await request('/admin/content/exercises/not-a-uuid/demote', { method: 'POST' });
    expect(res.status).toBe(400);
  });
});

describe('POST /admin/content/exercises/:id/reject', () => {
  const id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  it('rejects an approved row (outcome=rejected)', async () => {
    queryQueue.push([{ id }]);
    const res = await request(`/admin/content/exercises/${id}/reject`, { method: 'POST' });
    expect(await res.json()).toEqual({ outcome: 'rejected' });
  });
});

describe('POST /admin/content/theory/:id/demote', () => {
  const id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  it('demotes an approved theory row', async () => {
    queryQueue.push([{ id }]);
    const res = await request(`/admin/content/theory/${id}/demote`, { method: 'POST' });
    expect(await res.json()).toEqual({ outcome: 'demoted' });
  });
  it('rejects an approved theory row', async () => {
    queryQueue.push([{ id }]);
    const res = await request(`/admin/content/theory/${id}/reject`, { method: 'POST' });
    expect(await res.json()).toEqual({ outcome: 'rejected' });
  });
});
```

- [ ] **Step 2: Run tests, expect FAIL (404)** — `pnpm --filter @language-drill/lambda test src/routes/admin.test.ts`

- [ ] **Step 3: Implement**

In `infra/lambda/src/routes/admin.ts` add (uses `inArray` from Task 1; no `isUniqueViolation` needed — a status change of the existing unique row cannot collide):
```ts
type ContentOutcome = 'demoted' | 'rejected' | 'not_found' | 'already_resolved';

async function transitionContentExercise(id: string, toStatus: 'flagged' | 'rejected'): Promise<ContentOutcome> {
  const updated = await db
    .update(exercises)
    .set({ reviewStatus: toStatus })
    .where(and(eq(exercises.id, id), inArray(exercises.reviewStatus, [...APPROVED_STATUSES])))
    .returning({ id: exercises.id });
  if (updated.length > 0) return toStatus === 'flagged' ? 'demoted' : 'rejected';
  const existing = await db.select({ reviewStatus: exercises.reviewStatus }).from(exercises).where(eq(exercises.id, id)).limit(1);
  return existing.length > 0 ? 'already_resolved' : 'not_found';
}

async function transitionContentTheory(id: string, toStatus: 'flagged' | 'rejected'): Promise<ContentOutcome> {
  const updated = await db
    .update(theoryTopics)
    .set({ reviewStatus: toStatus })
    .where(and(eq(theoryTopics.id, id), inArray(theoryTopics.reviewStatus, [...APPROVED_STATUSES])))
    .returning({ id: theoryTopics.id });
  if (updated.length > 0) return toStatus === 'flagged' ? 'demoted' : 'rejected';
  const existing = await db.select({ reviewStatus: theoryTopics.reviewStatus }).from(theoryTopics).where(eq(theoryTopics.id, id)).limit(1);
  return existing.length > 0 ? 'already_resolved' : 'not_found';
}

const ContentIdSchema = z.string().uuid();

for (const action of ['demote', 'reject'] as const) {
  const toStatus = action === 'demote' ? ('flagged' as const) : ('rejected' as const);
  admin.post(`/admin/content/exercises/:id/${action}`, async (c) => {
    const idParsed = ContentIdSchema.safeParse(c.req.param('id'));
    if (!idParsed.success) return c.json({ error: 'Invalid id', code: 'VALIDATION_ERROR' }, 400);
    return c.json({ outcome: await transitionContentExercise(idParsed.data, toStatus) });
  });
  admin.post(`/admin/content/theory/:id/${action}`, async (c) => {
    const idParsed = ContentIdSchema.safeParse(c.req.param('id'));
    if (!idParsed.success) return c.json({ error: 'Invalid id', code: 'VALIDATION_ERROR' }, 400);
    return c.json({ outcome: await transitionContentTheory(idParsed.data, toStatus) });
  });
}
```
(Two split helpers mirror the flagged-queue resolution to sidestep the Drizzle table-union typing issue.)

- [ ] **Step 4: Run tests, expect PASS** — `pnpm --filter @language-drill/lambda test src/routes/admin.test.ts`
- [ ] **Step 5: Typecheck** — `pnpm --filter @language-drill/lambda typecheck` → clean
- [ ] **Step 6: Commit**
```bash
git add infra/lambda/src/routes/admin.ts infra/lambda/src/routes/admin.test.ts
git commit -m "feat(admin): demote/reject endpoints for approved content"
```

---

## Task 3: api-client — content schemas + hooks

**Files:** Create `packages/api-client/src/schemas/content.ts`, `hooks/useContentBrowser.ts`, `hooks/useContentBrowser.test.ts`; modify `index.ts`.

- [ ] **Step 1: Create `packages/api-client/src/schemas/content.ts`**
```ts
import { z } from 'zod';

export const ContentReviewStatusSchema = z.enum(['auto-approved', 'manual-approved']);

export const ContentExerciseSchema = z.object({
  id: z.string(),
  language: z.string().nullable(),
  level: z.string().nullable(),
  type: z.string().nullable(),
  grammarPointKey: z.string().nullable(),
  contentJson: z.unknown(),
  coverageTags: z.unknown().nullable(),
  qualityScore: z.number().nullable(),
  generationSource: z.string().nullable(),
  modelId: z.string().nullable(),
  reviewStatus: ContentReviewStatusSchema,
  generatedAt: z.string().nullable(),
});
export type ContentExercise = z.infer<typeof ContentExerciseSchema>;
export const ContentExercisesResponseSchema = z.object({ items: z.array(ContentExerciseSchema), total: z.number() });

export const ContentTheorySchema = z.object({
  id: z.string(),
  language: z.string().nullable(),
  level: z.string().nullable(),
  grammarPointKey: z.string().nullable(),
  topicId: z.string().nullable(),
  contentJson: z.unknown(),
  qualityScore: z.number().nullable(),
  generationSource: z.string().nullable(),
  modelId: z.string().nullable(),
  reviewStatus: ContentReviewStatusSchema,
  generatedAt: z.string().nullable(),
});
export type ContentTheory = z.infer<typeof ContentTheorySchema>;
export const ContentTheoryResponseSchema = z.object({ items: z.array(ContentTheorySchema), total: z.number() });

export type ContentExerciseParams = {
  language?: string; level?: string; type?: string; grammarPoint?: string; q?: string;
  limit?: number; offset?: number;
};
export type ContentTheoryParams = {
  language?: string; level?: string; grammarPoint?: string; q?: string;
  limit?: number; offset?: number;
};
```

- [ ] **Step 2: Write failing hook tests**

Create `packages/api-client/src/hooks/useContentBrowser.test.ts` (mirror `useFlaggedQueue.test.ts`'s wrapper/jsonResponse helpers):
```ts
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import {
  useContentExercises, useContentTheory,
  useResolveContentExercise, useResolveContentTheory,
} from './useContentBrowser';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
}
function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

describe('useContentExercises', () => {
  it('builds the URL with filters, q, limit, offset', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ items: [], total: 0 }));
    const { result } = renderHook(
      () => useContentExercises({ fetchFn, params: { language: 'ES', q: 'lo', limit: 25, offset: 50 } }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchFn).toHaveBeenCalledWith('/admin/content/exercises?language=ES&q=lo&limit=25&offset=50');
  });
});

describe('useContentTheory', () => {
  it('builds the theory URL', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ items: [], total: 0 }));
    const { result } = renderHook(() => useContentTheory({ fetchFn, params: { language: 'DE' } }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchFn).toHaveBeenCalledWith('/admin/content/theory?language=DE');
  });
});

describe('useResolveContentExercise', () => {
  it('POSTs demote and returns the outcome', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ outcome: 'demoted' }));
    const { result } = renderHook(() => useResolveContentExercise({ fetchFn }), { wrapper: wrapper() });
    const outcome = await result.current.mutateAsync({ id: 'ex-1', action: 'demote' });
    expect(outcome).toBe('demoted');
    expect(fetchFn).toHaveBeenCalledWith('/admin/content/exercises/ex-1/demote', { method: 'POST' });
  });
});

describe('useResolveContentTheory', () => {
  it('POSTs reject and returns the outcome', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ outcome: 'rejected' }));
    const { result } = renderHook(() => useResolveContentTheory({ fetchFn }), { wrapper: wrapper() });
    const outcome = await result.current.mutateAsync({ id: 'th-1', action: 'reject' });
    expect(outcome).toBe('rejected');
    expect(fetchFn).toHaveBeenCalledWith('/admin/content/theory/th-1/reject', { method: 'POST' });
  });
});
```

- [ ] **Step 3: Run, expect FAIL** — `pnpm --filter @language-drill/api-client test src/hooks/useContentBrowser.test.ts`

- [ ] **Step 4: Create `packages/api-client/src/hooks/useContentBrowser.ts`**
```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../fetchClient';
import { ResolveResponseSchema, type ResolveOutcome } from '../schemas/flagged';
import {
  ContentExercisesResponseSchema, ContentTheoryResponseSchema,
  type ContentExerciseParams, type ContentTheoryParams,
} from '../schemas/content';

function queryString(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function useContentExercises({
  fetchFn, params = {}, enabled = true,
}: { fetchFn: AuthenticatedFetch; params?: ContentExerciseParams; enabled?: boolean }) {
  return useQuery({
    queryKey: ['admin', 'content', 'exercises', params],
    queryFn: async () => {
      const res = await fetchFn(`/admin/content/exercises${queryString(params)}`);
      const json: unknown = await res.json();
      return ContentExercisesResponseSchema.parse(json);
    },
    enabled,
  });
}

export function useContentTheory({
  fetchFn, params = {}, enabled = true,
}: { fetchFn: AuthenticatedFetch; params?: ContentTheoryParams; enabled?: boolean }) {
  return useQuery({
    queryKey: ['admin', 'content', 'theory', params],
    queryFn: async () => {
      const res = await fetchFn(`/admin/content/theory${queryString(params)}`);
      const json: unknown = await res.json();
      return ContentTheoryResponseSchema.parse(json);
    },
    enabled,
  });
}

export function useResolveContentExercise({ fetchFn }: { fetchFn: AuthenticatedFetch }) {
  const queryClient = useQueryClient();
  return useMutation<ResolveOutcome, Error, { id: string; action: 'demote' | 'reject' }>({
    mutationFn: async ({ id, action }) => {
      const res = await fetchFn(`/admin/content/exercises/${id}/${action}`, { method: 'POST' });
      const json: unknown = await res.json();
      return ResolveResponseSchema.parse(json).outcome;
    },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['admin', 'content', 'exercises'] }); },
  });
}

export function useResolveContentTheory({ fetchFn }: { fetchFn: AuthenticatedFetch }) {
  const queryClient = useQueryClient();
  return useMutation<ResolveOutcome, Error, { id: string; action: 'demote' | 'reject' }>({
    mutationFn: async ({ id, action }) => {
      const res = await fetchFn(`/admin/content/theory/${id}/${action}`, { method: 'POST' });
      const json: unknown = await res.json();
      return ResolveResponseSchema.parse(json).outcome;
    },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['admin', 'content', 'theory'] }); },
  });
}
```

- [ ] **Step 5: Barrel exports** — add to `packages/api-client/src/index.ts`:
```ts
export {
  ContentExerciseSchema, ContentExercisesResponseSchema,
  ContentTheorySchema, ContentTheoryResponseSchema, ContentReviewStatusSchema,
  type ContentExercise, type ContentTheory,
  type ContentExerciseParams, type ContentTheoryParams,
} from './schemas/content';
export {
  useContentExercises, useContentTheory,
  useResolveContentExercise, useResolveContentTheory,
} from './hooks/useContentBrowser';
```

- [ ] **Step 6: Test + typecheck + build**
- `pnpm --filter @language-drill/api-client test src/hooks/useContentBrowser.test.ts` → 4 pass
- `pnpm --filter @language-drill/api-client typecheck` → clean
- `pnpm --filter @language-drill/api-client build` → success

- [ ] **Step 7: Commit**
```bash
git add packages/api-client/src/schemas/content.ts packages/api-client/src/hooks/useContentBrowser.ts packages/api-client/src/hooks/useContentBrowser.test.ts packages/api-client/src/index.ts
git commit -m "feat(admin): api-client hooks + schemas for the content browser"
```

---

## Task 4: web — move ContentFieldView to shared + content cards

**Files:** Move `content-field-view.tsx` (+test) to `components/admin/`; update moderation import; create `content/_components/content-exercise-card.tsx`, `content-theory-card.tsx` + exercise-card test.

- [ ] **Step 1: Move `ContentFieldView` to a shared admin location**

```bash
git mv "apps/web/app/(admin)/admin/moderation/_components/content-field-view.tsx" "apps/web/components/admin/content-field-view.tsx"
git mv "apps/web/app/(admin)/admin/moderation/_components/__tests__/content-field-view.test.tsx" "apps/web/components/admin/__tests__/content-field-view.test.tsx"
```
The moved test imports `../content-field-view` — still correct at the new location (test is in `components/admin/__tests__/`, component in `components/admin/`). No test edit needed.

- [ ] **Step 2: Update the moderation flagged-exercise-card import**

In `apps/web/app/(admin)/admin/moderation/_components/flagged-exercise-card.tsx`, change `import { ContentFieldView } from './content-field-view';` to:
```ts
import { ContentFieldView } from '../../../../../components/admin/content-field-view';
```
(From `app/(admin)/admin/moderation/_components/` up five levels to `apps/web/`, then `components/admin/content-field-view`. Verify the depth resolves; match it to how sibling files reach `components/` — e.g. the card already imports `Button` from `../../../../../components/ui`.)

- [ ] **Step 3: Verify the move didn't break anything**

Run: `pnpm --filter @language-drill/web test "components/admin/__tests__/content-field-view.test.tsx" "app/(admin)/admin/moderation"`
Expected: PASS (field-view test + moderation cards/page still green).

- [ ] **Step 4: Write the failing exercise-card test**

Create `apps/web/app/(admin)/admin/content/_components/__tests__/content-exercise-card.test.tsx`:
```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { ContentExercise } from '@language-drill/api-client';
import { ContentExerciseCard } from '../content-exercise-card';

const item: ContentExercise = {
  id: 'ex-1', language: 'ES', level: 'A2', type: 'cloze', grammarPointKey: 'obj-pronoun',
  contentJson: { type: 'cloze', sentence: 'Maria ___ lo dio.', correctAnswer: 'se' },
  coverageTags: { person: '3sg' }, qualityScore: 0.91, generationSource: 'claude-batch',
  modelId: 'claude-sonnet-4-6', reviewStatus: 'auto-approved', generatedAt: '2026-06-01T00:00:00.000Z',
};

describe('ContentExerciseCard', () => {
  it('renders header metadata and content', () => {
    render(<ContentExerciseCard item={item} onResolve={vi.fn()} pending={false} demoted={false} />);
    expect(screen.getAllByText(/cloze/)[0]).toBeInTheDocument();
    expect(screen.getByText(/obj-pronoun/)).toBeInTheDocument();
    expect(screen.getByText(/claude-batch/)).toBeInTheDocument();
    expect(screen.getByText('Maria ___ lo dio.')).toBeInTheDocument();
  });
  it('calls onResolve with demote / reject', () => {
    const onResolve = vi.fn();
    render(<ContentExerciseCard item={item} onResolve={onResolve} pending={false} demoted={false} />);
    fireEvent.click(screen.getByRole('button', { name: /demote/i }));
    expect(onResolve).toHaveBeenCalledWith('demote');
    fireEvent.click(screen.getByRole('button', { name: /reject/i }));
    expect(onResolve).toHaveBeenCalledWith('reject');
  });
  it('shows the demote notice when demoted', () => {
    render(<ContentExerciseCard item={item} onResolve={vi.fn()} pending={false} demoted />);
    expect(screen.getByText(/sent back to the review queue/i)).toBeInTheDocument();
  });
  it('disables both buttons when pending', () => {
    render(<ContentExerciseCard item={item} onResolve={vi.fn()} pending demoted={false} />);
    expect(screen.getByRole('button', { name: /demote/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /reject/i })).toBeDisabled();
  });
});
```

- [ ] **Step 5: Run, expect FAIL** — `pnpm --filter @language-drill/web test "app/(admin)/admin/content/_components/__tests__/content-exercise-card.test.tsx"`

- [ ] **Step 6: Implement the exercise card**

Create `apps/web/app/(admin)/admin/content/_components/content-exercise-card.tsx`:
```tsx
import type { ContentExercise } from '@language-drill/api-client';
import { Button } from '../../../../../components/ui';
import { ContentFieldView } from '../../../../../components/admin/content-field-view';

export function ContentExerciseCard({
  item, onResolve, pending, demoted,
}: {
  item: ContentExercise;
  onResolve: (action: 'demote' | 'reject') => void;
  pending: boolean;
  demoted: boolean;
}) {
  return (
    <div className="border border-rule rounded-r-sm p-4 flex flex-col gap-3 bg-paper">
      <div className="flex items-center gap-2 text-[13px] text-ink-soft flex-wrap">
        <span className="font-medium text-ink">{item.type}</span>
        <span>· {item.language}</span>
        <span>· {item.level}</span>
        <span>· {item.grammarPointKey}</span>
        {item.qualityScore !== null ? <span>· q={item.qualityScore.toFixed(2)}</span> : null}
        <span>· {item.generationSource}</span>
        {item.modelId ? <span>· {item.modelId}</span> : null}
      </div>
      {item.coverageTags ? (
        <p className="text-[12px] text-ink-soft break-words">coverage: {JSON.stringify(item.coverageTags)}</p>
      ) : null}
      <ContentFieldView content={item.contentJson} />
      {demoted ? (
        <p className="text-[12px] text-ink-soft">Demoted — sent back to the review queue.</p>
      ) : null}
      <div className="flex gap-2">
        <Button variant="primary" size="sm" disabled={pending} onClick={() => onResolve('demote')}>Demote</Button>
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => onResolve('reject')}>Reject</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Implement the theory card**

Create `apps/web/app/(admin)/admin/content/_components/content-theory-card.tsx`:
```tsx
import { parseTheoryTopicJson, type LearningLanguage } from '@language-drill/shared';
import type { ContentTheory } from '@language-drill/api-client';
import { Button } from '../../../../../components/ui';
import { renderTheoryTopicJson } from '../../../../../components/theory/render-json';
import { TheorySections } from '../../../../../components/theory/theory-sections';

const LEARNING_LANGUAGES = ['ES', 'DE', 'TR'] as const;

function TheoryBody({ content, language }: { content: unknown; language: string }) {
  const lang: LearningLanguage = (LEARNING_LANGUAGES as readonly string[]).includes(language)
    ? (language as LearningLanguage) : 'ES';
  try {
    const topic = renderTheoryTopicJson(parseTheoryTopicJson(content));
    return <TheorySections topic={topic} language={lang} onSwitchTopic={() => {}} />;
  } catch {
    return <pre className="text-[12px] whitespace-pre-wrap break-words">{JSON.stringify(content, null, 2)}</pre>;
  }
}

export function ContentTheoryCard({
  item, onResolve, pending, demoted,
}: {
  item: ContentTheory;
  onResolve: (action: 'demote' | 'reject') => void;
  pending: boolean;
  demoted: boolean;
}) {
  return (
    <div className="border border-rule rounded-r-sm p-4 flex flex-col gap-3 bg-paper">
      <div className="flex items-center gap-2 text-[13px] text-ink-soft flex-wrap">
        <span className="font-medium text-ink">theory</span>
        <span>· {item.language}</span>
        <span>· {item.level}</span>
        <span>· {item.grammarPointKey}</span>
        {item.qualityScore !== null ? <span>· q={item.qualityScore.toFixed(2)}</span> : null}
        <span>· {item.generationSource}</span>
        {item.modelId ? <span>· {item.modelId}</span> : null}
      </div>
      <TheoryBody content={item.contentJson} language={item.language ?? 'ES'} />
      {demoted ? (
        <p className="text-[12px] text-ink-soft">Demoted — sent back to the review queue.</p>
      ) : null}
      <div className="flex gap-2">
        <Button variant="primary" size="sm" disabled={pending} onClick={() => onResolve('demote')}>Demote</Button>
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => onResolve('reject')}>Reject</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Run the exercise-card test + typecheck**
- `pnpm --filter @language-drill/web test "app/(admin)/admin/content/_components/__tests__/content-exercise-card.test.tsx"` → 4 pass
- `pnpm --filter @language-drill/web typecheck` → clean

- [ ] **Step 9: Commit**
```bash
git add "apps/web/components/admin/content-field-view.tsx" "apps/web/components/admin/__tests__/content-field-view.test.tsx" "apps/web/app/(admin)/admin/moderation/_components/flagged-exercise-card.tsx" "apps/web/app/(admin)/admin/content/_components"
git commit -m "feat(admin): content browser cards; share ContentFieldView under components/admin"
```

---

## Task 5: web — content page + nav entry

**Files:** Create `apps/web/app/(admin)/admin/content/page.tsx`; modify `apps/web/components/admin/admin-nav-items.tsx` + its test.

- [ ] **Step 1: Update the nav test (RED)**

In `apps/web/components/admin/__tests__/admin-nav.test.tsx`, update the order assertions to include Content second:
```tsx
    expect(ADMIN_NAV.map((d) => d.href)).toEqual([
      '/admin/moderation', '/admin/content', '/admin/generation', '/admin/theory', '/admin/invites',
    ]);
    expect(ADMIN_NAV.map((d) => d.label)).toEqual([
      'Moderation', 'Content', 'Pool', 'Theory', 'Invites',
    ]);
```

- [ ] **Step 2: Run nav test, expect FAIL** — `pnpm --filter @language-drill/web test "components/admin/__tests__/admin-nav.test.tsx"`

- [ ] **Step 3: Add the Content nav entry**

In `apps/web/components/admin/admin-nav-items.tsx`, insert after the Moderation entry:
```tsx
  { href: '/admin/moderation', label: 'Moderation' },
  { href: '/admin/content', label: 'Content' },
  { href: '/admin/generation', label: 'Pool' },
  { href: '/admin/theory', label: 'Theory' },
  { href: '/admin/invites', label: 'Invites' },
```

- [ ] **Step 4: Run nav test, expect PASS** — `pnpm --filter @language-drill/web test "components/admin/__tests__/admin-nav.test.tsx"`

- [ ] **Step 5: Implement the content page**

Create `apps/web/app/(admin)/admin/content/page.tsx`:
```tsx
'use client';

import { useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import {
  createAuthenticatedFetch,
  useContentExercises, useContentTheory,
  useResolveContentExercise, useResolveContentTheory,
  type ContentExerciseParams,
} from '@language-drill/api-client';
import { ContentExerciseCard } from './_components/content-exercise-card';
import { ContentTheoryCard } from './_components/content-theory-card';

type Tab = 'exercises' | 'theory';
const PAGE_SIZE = 25;

export default function ContentPage() {
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  const [tab, setTab] = useState<Tab>('exercises');
  const [filters, setFilters] = useState<{ language?: string; level?: string; type?: string; grammarPoint?: string }>({});
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [demotedId, setDemotedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const exerciseParams: ContentExerciseParams = { ...filters, q: q || undefined, limit: PAGE_SIZE, offset };
  const theoryParams = { language: filters.language, level: filters.level, grammarPoint: filters.grammarPoint, q: q || undefined, limit: PAGE_SIZE, offset };

  const exercises = useContentExercises({ fetchFn, params: exerciseParams, enabled: tab === 'exercises' });
  const theory = useContentTheory({ fetchFn, params: theoryParams, enabled: tab === 'theory' });
  const resolveExercise = useResolveContentExercise({ fetchFn });
  const resolveTheory = useResolveContentTheory({ fetchFn });

  const active = tab === 'exercises' ? exercises : theory;
  const total = active.data?.total ?? 0;
  const items = active.data?.items ?? [];

  const switchTab = (next: Tab) => { setTab(next); setOffset(0); setDemotedId(null); setError(null); };
  const setFilter = (key: keyof typeof filters, value: string) => {
    setFilters((f) => ({ ...f, [key]: value || undefined }));
    setOffset(0);
  };
  const onSearch = (value: string) => { setQ(value); setOffset(0); };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-[24px] font-semibold text-ink">Content</h1>
      {error ? <p role="alert" className="text-[13px] text-red-600">{error}</p> : null}

      <div className="flex gap-2" role="tablist">
        <button role="tab" id="tab-exercises" aria-controls="content-panel" aria-selected={tab === 'exercises'}
          onClick={() => switchTab('exercises')}
          className={tab === 'exercises' ? 'font-semibold text-ink' : 'text-ink-soft'}>Exercises</button>
        <button role="tab" id="tab-theory" aria-controls="content-panel" aria-selected={tab === 'theory'}
          onClick={() => switchTab('theory')}
          className={tab === 'theory' ? 'font-semibold text-ink' : 'text-ink-soft'}>Theory</button>
      </div>

      <div className="flex gap-2 flex-wrap text-[13px]">
        <select aria-label="language" value={filters.language ?? ''} onChange={(e) => setFilter('language', e.target.value)}>
          <option value="">All languages</option><option value="ES">ES</option><option value="DE">DE</option><option value="TR">TR</option>
        </select>
        <select aria-label="level" value={filters.level ?? ''} onChange={(e) => setFilter('level', e.target.value)}>
          <option value="">All levels</option><option value="A1">A1</option><option value="A2">A2</option><option value="B1">B1</option><option value="B2">B2</option>
        </select>
        {tab === 'exercises' ? (
          <input aria-label="type" placeholder="type (e.g. cloze)" value={filters.type ?? ''} onChange={(e) => setFilter('type', e.target.value)} />
        ) : null}
        <input aria-label="grammar point" placeholder="grammar point" value={filters.grammarPoint ?? ''} onChange={(e) => setFilter('grammarPoint', e.target.value)} />
        <input aria-label="search" placeholder="search text" value={q} onChange={(e) => onSearch(e.target.value)} />
      </div>

      <div id="content-panel" role="tabpanel" aria-labelledby={tab === 'exercises' ? 'tab-exercises' : 'tab-theory'} className="flex flex-col gap-3">
        {active.isLoading ? <p className="text-ink-soft text-[13px]">Loading…</p>
          : active.isError ? <p className="text-ink-soft text-[13px]">Failed to load content.</p>
          : items.length === 0 ? <p className="text-ink-soft text-[13px]">No matching items.</p>
          : (
            <>
              <p className="text-[12px] text-ink-soft">
                {total} match{total === 1 ? '' : 'es'} · page {Math.floor(offset / PAGE_SIZE) + 1}/{Math.max(1, Math.ceil(total / PAGE_SIZE))}
              </p>
              {tab === 'exercises'
                ? exercises.data?.items.map((item) => (
                    <ContentExerciseCard key={item.id} item={item} pending={resolveExercise.isPending} demoted={demotedId === item.id}
                      onResolve={async (action) => {
                        try {
                          const outcome = await resolveExercise.mutateAsync({ id: item.id, action });
                          setDemotedId(outcome === 'demoted' ? item.id : null); setError(null);
                        } catch { setError('Failed to update item. Please try again.'); }
                      }} />
                  ))
                : theory.data?.items.map((item) => (
                    <ContentTheoryCard key={item.id} item={item} pending={resolveTheory.isPending} demoted={demotedId === item.id}
                      onResolve={async (action) => {
                        try {
                          const outcome = await resolveTheory.mutateAsync({ id: item.id, action });
                          setDemotedId(outcome === 'demoted' ? item.id : null); setError(null);
                        } catch { setError('Failed to update item. Please try again.'); }
                      }} />
                  ))}
              <div className="flex gap-2 items-center text-[13px]">
                <button disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))} className="text-ink-soft disabled:opacity-40">‹ prev</button>
                <button disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset((o) => o + PAGE_SIZE)} className="text-ink-soft disabled:opacity-40">next ›</button>
              </div>
            </>
          )}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Typecheck** — `pnpm --filter @language-drill/web typecheck` → clean

- [ ] **Step 7: Run content + nav web tests** — `pnpm --filter @language-drill/web test "app/(admin)/admin/content" "components/admin/__tests__/admin-nav.test.tsx"` → PASS

- [ ] **Step 8: Commit**
```bash
git add "apps/web/app/(admin)/admin/content/page.tsx" "apps/web/components/admin/admin-nav-items.tsx" "apps/web/components/admin/__tests__/admin-nav.test.tsx"
git commit -m "feat(admin): content browser page with tabs, search, pagination + nav entry"
```

---

## Task 6: Full verification

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

- **Spec coverage:** list+filters+`q`+pagination+`total` (Task 1); demote/reject guarded transitions, no 23505 (Task 2); api-client schemas/hooks reusing `ResolveOutcome` (Task 3); shared `ContentFieldView` move + content cards w/ metadata+coverageTags+Demote/Reject+demote notice (Task 4); page w/ tabs/filters/search/pagination + "Content" nav (Task 5); tests throughout + Task 6. `_dedupKey` stripped server-side + approved-only guard (Task 1); `DESC NULLS LAST` ordering (Task 1).
- **Type consistency:** `ContentExercise`/`ContentTheory` field names (`level`, `grammarPointKey`, `topicId`, `coverageTags`, `generationSource`, `modelId`, `reviewStatus`) match the Lambda list mapping; `ResolveOutcome` reused from `schemas/flagged.ts`; `onResolve(action: 'demote'|'reject')` consistent across cards and page; `ContentExerciseParams`/`ContentTheoryParams` match the query schemas.
- **Known pitfalls flagged inline:** `offset` missing from the chain mock (Task 1 Step 1); Drizzle table-union → split helpers (Task 2); `ContentFieldView` move import-depth (Task 4 Step 2); `variant="ghost"` (real ButtonVariant) for Reject; theory `language` narrowed not cast (Task 4 Step 7); workspace `pnpm build` for cross-package imports.
- **No placeholders:** every code step is complete; every run step has a command + expected result.
```
