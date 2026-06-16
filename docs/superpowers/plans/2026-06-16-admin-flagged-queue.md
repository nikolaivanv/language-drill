# Admin Flagged Content Review Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `review:flagged` / `review:flagged:theory` CLI REPLs with a web Moderation page that lists flagged exercises + theory, shows each item's content/reasons/quality, and approves (→ `manual-approved`) or rejects (→ `rejected`) them with the CLI's exact promote/demote semantics.

**Architecture:** New `/admin/flagged/*` Lambda endpoints (list + approve/reject for both content types) on the existing admin router; new `api-client` query+mutation hooks following the `useAdminInvites` idiom; a client-component Moderation page (`/admin/moderation`) under the merged `(admin)` route group with two tabs (Exercises | Theory), reusing the existing theory renderer and a new generic field view for exercises.

**Tech Stack:** Hono + Drizzle (Lambda), Vitest, Zod, TanStack Query, Next.js App Router (client components), Tailwind.

---

## Context the implementer needs

Work from the worktree `/Users/seal/dev/language-drill/.claude/worktrees/feat-admin-flagged-queue` (branch `feat-admin-flagged-queue`). `cd` into it in every Bash call. Paths contain a `(admin)` route-group segment — quote them in shell commands.

**Workspace dist:** This worktree may lack built workspace packages. If a test errors on resolving `@language-drill/api-client` / `@language-drill/shared` / `@language-drill/db`, run `pnpm build` once at the repo root, then re-run.

**Single-file test commands:**
- Lambda: `pnpm --filter @language-drill/lambda test <path-relative-to-infra/lambda>`
- api-client: `pnpm --filter @language-drill/api-client test <path>`
- web: `pnpm --filter @language-drill/web test <path>`

**Key existing code:**
- Admin router: `infra/lambda/src/routes/admin.ts`. Imports already include `and, desc, eq, gte, isNotNull, sql` from `drizzle-orm` and `exercises, theoryTopics, invitations, …` from `@language-drill/db`. All `/admin/*` are gated by `authMiddleware + adminMiddleware`. Query validation uses `zod.safeParse(c.req.query())` → `400 { error, code: 'VALIDATION_ERROR', details }`.
- Admin route tests: `infra/lambda/src/routes/admin.test.ts` — a chain-mock for `db` with a shared `queryQueue` (await on a chain shifts the next staged result). `db.update`/`db.insert`/`db.select`/`db.execute` are mocked; schema tables are opaque `{ __mock: 'exercises' }` sentinels.
- Schemas: `exercises` (`review_status`, `flagged_reasons` `$type<GenerationReason[]>`, `quality_score`, `content_json`, `difficulty`, `type`, `grammar_point_key`, `language`, `generated_at`) in `packages/db/src/schema/exercises.ts`; `theory_topics` (`cefr_level`, `topic_id`, `content_json` `$type<TheoryTopicJson>`, same review columns) in `packages/db/src/schema/theory.ts`.
- Reasons: `@language-drill/shared` exports `normalizeFlaggedReasons(raw): GenerationReason[]`, `REASON_LABELS: Record<GenerationReasonCode,string>`, `type GenerationReason = { code; detail? }`, `type GenerationReasonCode`.
- The CLI's `isUniqueViolation` (in `packages/db/scripts/review-flagged.ts`, NOT importable from Lambda) walks `err.cause` up to 8 levels looking for `code === '23505'`. We re-implement it in the Lambda.
- api-client idiom: `packages/api-client/src/hooks/useAdminInvites.ts` (query parses with a Zod schema; mutation POSTs then `queryClient.invalidateQueries`). Schemas in `packages/api-client/src/schemas/`. Barrel exports in `packages/api-client/src/index.ts`. `createAuthenticatedFetch`/`AuthenticatedFetch` exported there too.
- Foundation nav: `apps/web/components/admin/admin-nav-items.tsx` exports `ADMIN_NAV`. Its test `apps/web/components/admin/__tests__/admin-nav.test.tsx` asserts the exact order `['/admin/generation','/admin/theory','/admin/invites']` / `['Pool','Theory','Invites']` — adding Moderation MUST update that test.
- Theory renderer: `renderTheoryTopicJson(topic: TheoryTopicJson): TheoryTopic` in `apps/web/components/theory/render-json.tsx`; `TheorySections({ topic, language, onSwitchTopic })` in `apps/web/components/theory/theory-sections.tsx`; `parseTheoryTopicJson(input): TheoryTopicJson` from `@language-drill/shared`.
- Existing client admin page for reference: `apps/web/app/(admin)/admin/invites/page.tsx` (`'use client'`, `useAuth()` → `createAuthenticatedFetch(getToken)` → hooks).

---

## File structure

**Lambda (modify):**
- `infra/lambda/src/routes/admin.ts` — add a flagged section: query schemas, `isUniqueViolation`, `resolveFlagged` helper, 2 GET list routes, 4 POST resolve routes.
- `infra/lambda/src/routes/admin.test.ts` — extend the chain mock to reject on staged `Error`; add flagged-queue tests.

**api-client (create/modify):**
- Create `packages/api-client/src/schemas/flagged.ts`
- Create `packages/api-client/src/hooks/useFlaggedQueue.ts`
- Create `packages/api-client/src/hooks/useFlaggedQueue.test.ts`
- Modify `packages/api-client/src/index.ts` (barrel exports)

**web (create/modify):**
- Create `apps/web/app/(admin)/admin/moderation/page.tsx`
- Create `apps/web/app/(admin)/admin/moderation/_components/content-field-view.tsx` (+ test)
- Create `apps/web/app/(admin)/admin/moderation/_components/flagged-exercise-card.tsx`
- Create `apps/web/app/(admin)/admin/moderation/_components/flagged-theory-card.tsx`
- Create tests under `apps/web/app/(admin)/admin/moderation/_components/__tests__/`
- Modify `apps/web/components/admin/admin-nav-items.tsx` (+ its test)

---

## Task 1: Lambda — flagged list endpoints

**Files:**
- Modify: `infra/lambda/src/routes/admin.ts`
- Test: `infra/lambda/src/routes/admin.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `infra/lambda/src/routes/admin.test.ts` (the file already mocks `db` and `@language-drill/db`; reuse its `queryQueue`, `makeApp`/request helpers — match whatever the existing tests use to build the Hono app and issue requests). Add:

```ts
describe('GET /admin/flagged/exercises', () => {
  it('returns flagged items (reasons normalized, _dedupKey stripped) + total', async () => {
    queryQueue.push([
      {
        id: 'ex-1',
        language: 'ES',
        difficulty: 'A2',
        type: 'cloze',
        grammarPointKey: 'obj-pronoun',
        contentJson: { type: 'cloze', sentence: 'Maria ___ lo dio.', correctAnswer: 'se', _dedupKey: 'k1' },
        qualityScore: 0.62,
        flaggedReasons: [{ code: 'ambiguous' }],
        generatedAt: new Date('2026-06-01T00:00:00Z'),
      },
    ]); // items query
    queryQueue.push([{ count: 5 }]); // total query

    const res = await request('/admin/flagged/exercises?language=ES');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(5);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].level).toBe('A2');
    expect(body.items[0].contentJson._dedupKey).toBeUndefined();
    expect(body.items[0].flaggedReasons).toEqual([{ code: 'ambiguous' }]);
    expect(body.items[0].generatedAt).toBe('2026-06-01T00:00:00.000Z');
  });

  it('rejects an invalid language with 400', async () => {
    const res = await request('/admin/flagged/exercises?language=FR');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /admin/flagged/theory', () => {
  it('returns flagged theory items + total (no type field)', async () => {
    queryQueue.push([
      {
        id: 'th-1',
        language: 'DE',
        cefrLevel: 'B1',
        grammarPointKey: 'dative',
        topicId: 'de-b1-dative',
        contentJson: { id: 't', title: 'Dative', subtitle: 's', cefr: 'B1', sections: [] },
        qualityScore: 0.55,
        flaggedReasons: [{ code: 'level-mismatch' }],
        generatedAt: new Date('2026-06-02T00:00:00Z'),
      },
    ]);
    queryQueue.push([{ count: 1 }]);

    const res = await request('/admin/flagged/theory');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.items[0].level).toBe('B1');
    expect(body.items[0].topicId).toBe('de-b1-dative');
  });
});
```

> Note: use the SAME request/app helper the existing tests in this file use (e.g. an `app.request(path)` wrapper). If the file lacks a reusable helper, mirror the construction already present in its other `describe` blocks. Reset `queryQueue` in the file's existing `beforeEach` (it already does for current tests).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @language-drill/lambda test src/routes/admin.test.ts`
Expected: FAIL — routes return 404 (not yet defined).

- [ ] **Step 3: Implement the list endpoints**

In `infra/lambda/src/routes/admin.ts`: add `asc`, `count` to the `drizzle-orm` import (it currently imports `and, desc, eq, gte, isNotNull, sql`), and add `normalizeFlaggedReasons` to the `@language-drill/shared` import (add the import if the file doesn't import from shared yet). Then add, near the other schemas + routes:

```ts
const FlaggedExercisesQuerySchema = z.object({
  language: z.enum(['ES', 'DE', 'TR']).optional(),
  level: z.enum(['A1', 'A2', 'B1', 'B2']).optional(),
  type: z.string().optional(),
  grammarPoint: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const FlaggedTheoryQuerySchema = z.object({
  language: z.enum(['ES', 'DE', 'TR']).optional(),
  level: z.enum(['A1', 'A2', 'B1', 'B2']).optional(),
  grammarPoint: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

// Drop the writer-only `_dedupKey` before returning content to the client.
function stripDedupKey(content: unknown): unknown {
  if (!content || typeof content !== 'object') return content;
  const { _dedupKey, ...rest } = content as Record<string, unknown>;
  void _dedupKey;
  return rest;
}

admin.get('/admin/flagged/exercises', async (c) => {
  const parsed = FlaggedExercisesQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json(
      { error: 'Invalid query parameters', code: 'VALIDATION_ERROR', details: parsed.error.flatten() },
      400,
    );
  }
  const { language, level, type, grammarPoint, limit } = parsed.data;
  const conds = [eq(exercises.reviewStatus, 'flagged')];
  if (language) conds.push(eq(exercises.language, language));
  if (level) conds.push(eq(exercises.difficulty, level));
  if (type) conds.push(eq(exercises.type, type));
  if (grammarPoint) conds.push(eq(exercises.grammarPointKey, grammarPoint));
  const where = and(...conds);

  const [rows, totalRows] = await Promise.all([
    db
      .select({
        id: exercises.id,
        language: exercises.language,
        difficulty: exercises.difficulty,
        type: exercises.type,
        grammarPointKey: exercises.grammarPointKey,
        contentJson: exercises.contentJson,
        qualityScore: exercises.qualityScore,
        flaggedReasons: exercises.flaggedReasons,
        generatedAt: exercises.generatedAt,
      })
      .from(exercises)
      .where(where)
      .orderBy(asc(exercises.generatedAt))
      .limit(limit ?? 100),
    db.select({ count: count() }).from(exercises).where(where),
  ]);

  const items = rows.map((r) => ({
    id: r.id,
    language: r.language,
    level: r.difficulty,
    type: r.type,
    grammarPointKey: r.grammarPointKey,
    contentJson: stripDedupKey(r.contentJson),
    qualityScore: r.qualityScore,
    flaggedReasons: normalizeFlaggedReasons(r.flaggedReasons),
    generatedAt: r.generatedAt ? r.generatedAt.toISOString() : null,
  }));
  return c.json({ items, total: Number(totalRows[0]?.count ?? 0) });
});

admin.get('/admin/flagged/theory', async (c) => {
  const parsed = FlaggedTheoryQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json(
      { error: 'Invalid query parameters', code: 'VALIDATION_ERROR', details: parsed.error.flatten() },
      400,
    );
  }
  const { language, level, grammarPoint, limit } = parsed.data;
  const conds = [eq(theoryTopics.reviewStatus, 'flagged')];
  if (language) conds.push(eq(theoryTopics.language, language));
  if (level) conds.push(eq(theoryTopics.cefrLevel, level));
  if (grammarPoint) conds.push(eq(theoryTopics.grammarPointKey, grammarPoint));
  const where = and(...conds);

  const [rows, totalRows] = await Promise.all([
    db
      .select({
        id: theoryTopics.id,
        language: theoryTopics.language,
        cefrLevel: theoryTopics.cefrLevel,
        grammarPointKey: theoryTopics.grammarPointKey,
        topicId: theoryTopics.topicId,
        contentJson: theoryTopics.contentJson,
        qualityScore: theoryTopics.qualityScore,
        flaggedReasons: theoryTopics.flaggedReasons,
        generatedAt: theoryTopics.generatedAt,
      })
      .from(theoryTopics)
      .where(where)
      .orderBy(asc(theoryTopics.generatedAt))
      .limit(limit ?? 100),
    db.select({ count: count() }).from(theoryTopics).where(where),
  ]);

  const items = rows.map((r) => ({
    id: r.id,
    language: r.language,
    level: r.cefrLevel,
    grammarPointKey: r.grammarPointKey,
    topicId: r.topicId,
    contentJson: r.contentJson,
    qualityScore: r.qualityScore,
    flaggedReasons: normalizeFlaggedReasons(r.flaggedReasons),
    generatedAt: r.generatedAt ? r.generatedAt.toISOString() : null,
  }));
  return c.json({ items, total: Number(totalRows[0]?.count ?? 0) });
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @language-drill/lambda test src/routes/admin.test.ts`
Expected: PASS (new + existing tests).

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/routes/admin.ts infra/lambda/src/routes/admin.test.ts
git commit -m "feat(admin): flagged exercises + theory list endpoints"
```

---

## Task 2: Lambda — approve/reject endpoints (with demote-on-conflict)

**Files:**
- Modify: `infra/lambda/src/routes/admin.ts`
- Test: `infra/lambda/src/routes/admin.test.ts`

- [ ] **Step 1: Extend the chain mock to allow staged rejections**

In `infra/lambda/src/routes/admin.test.ts`, find `makeChain()`'s `then` (it currently does `const next = queryQueue.shift() ?? []`). Replace its body so a staged `Error` rejects the chain (needed to simulate a unique violation):

```ts
    then: (
      resolve: (value: unknown) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => {
      const next = queryQueue.shift() ?? [];
      if (next instanceof Error) return Promise.reject(next).then(resolve, reject);
      return Promise.resolve(next).then(resolve, reject);
    },
```

- [ ] **Step 2: Write failing tests**

Append to `infra/lambda/src/routes/admin.test.ts`:

```ts
describe('POST /admin/flagged/exercises/:id/approve', () => {
  const id = '11111111-1111-1111-1111-111111111111';

  it('approves a flagged row (outcome=approved)', async () => {
    queryQueue.push([{ id }]); // UPDATE ... returning -> 1 row
    const res = await request(`/admin/flagged/exercises/${id}/approve`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outcome: 'approved' });
  });

  it('demotes to rejected on a unique-violation (outcome=demoted)', async () => {
    const err = Object.assign(new Error('dup'), { code: '23505' });
    queryQueue.push(err);        // first UPDATE rejects
    queryQueue.push([{ id }]);   // demote UPDATE returning
    const res = await request(`/admin/flagged/exercises/${id}/approve`, { method: 'POST' });
    expect(await res.json()).toEqual({ outcome: 'demoted' });
  });

  it('returns already_resolved when no flagged row matched but the row exists', async () => {
    queryQueue.push([]);                                  // UPDATE returning -> 0 rows
    queryQueue.push([{ reviewStatus: 'manual-approved' }]); // re-read select
    const res = await request(`/admin/flagged/exercises/${id}/approve`, { method: 'POST' });
    expect(await res.json()).toEqual({ outcome: 'already_resolved' });
  });

  it('returns not_found when the row does not exist', async () => {
    queryQueue.push([]); // UPDATE returning -> 0 rows
    queryQueue.push([]); // re-read select -> none
    const res = await request(`/admin/flagged/exercises/${id}/approve`, { method: 'POST' });
    expect(await res.json()).toEqual({ outcome: 'not_found' });
  });

  it('rejects a non-uuid id with 400', async () => {
    const res = await request('/admin/flagged/exercises/not-a-uuid/approve', { method: 'POST' });
    expect(res.status).toBe(400);
  });
});

describe('POST /admin/flagged/exercises/:id/reject', () => {
  const id = '22222222-2222-2222-2222-222222222222';
  it('rejects a flagged row (outcome=rejected)', async () => {
    queryQueue.push([{ id }]); // UPDATE returning -> 1 row
    const res = await request(`/admin/flagged/exercises/${id}/reject`, { method: 'POST' });
    expect(await res.json()).toEqual({ outcome: 'rejected' });
  });
});

describe('POST /admin/flagged/theory/:id/approve', () => {
  const id = '33333333-3333-3333-3333-333333333333';
  it('approves a flagged theory row', async () => {
    queryQueue.push([{ id }]);
    const res = await request(`/admin/flagged/theory/${id}/approve`, { method: 'POST' });
    expect(await res.json()).toEqual({ outcome: 'approved' });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @language-drill/lambda test src/routes/admin.test.ts`
Expected: FAIL — resolve routes 404.

- [ ] **Step 4: Implement the resolve helper + routes**

In `infra/lambda/src/routes/admin.ts` add:

```ts
// Postgres unique-violation detector — mirrors packages/db/scripts/review-flagged.ts
// `isUniqueViolation` (walks `.cause` since the driver wraps the SQLSTATE). Re-implemented
// here because that helper lives in a CLI script not importable from the Lambda bundle.
function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 8; depth++) {
    if (current instanceof Error && 'code' in current && (current as { code: unknown }).code === '23505') {
      return true;
    }
    if (current instanceof Error && current.cause !== undefined) {
      current = current.cause;
      continue;
    }
    return false;
  }
  return false;
}

type ResolveOutcome = 'approved' | 'rejected' | 'demoted' | 'not_found' | 'already_resolved';

// Shared approve/reject against exercises or theory_topics. Both tables expose
// identically-named `id` / `reviewStatus` / `flaggedReasons` columns. Approve clears
// flaggedReasons and, on a dedup unique-violation, demotes the row to `rejected`
// (matching the CLI). Reject preserves flaggedReasons. Every UPDATE is guarded by
// `review_status='flagged'` so concurrent state changes no-op instead of clobbering.
async function resolveFlagged(
  table: typeof exercises | typeof theoryTopics,
  id: string,
  action: 'approve' | 'reject',
): Promise<ResolveOutcome> {
  const setValues = action === 'approve'
    ? { reviewStatus: 'manual-approved', flaggedReasons: null }
    : { reviewStatus: 'rejected' };
  try {
    const updated = await db
      .update(table)
      .set(setValues)
      .where(and(eq(table.id, id), eq(table.reviewStatus, 'flagged')))
      .returning({ id: table.id });
    if (updated.length > 0) return action === 'approve' ? 'approved' : 'rejected';
  } catch (err) {
    if (action === 'approve' && isUniqueViolation(err)) {
      await db
        .update(table)
        .set({ reviewStatus: 'rejected' })
        .where(and(eq(table.id, id), eq(table.reviewStatus, 'flagged')));
      return 'demoted';
    }
    throw err;
  }
  const existing = await db
    .select({ reviewStatus: table.reviewStatus })
    .from(table)
    .where(eq(table.id, id))
    .limit(1);
  return existing.length > 0 ? 'already_resolved' : 'not_found';
}

const FlaggedIdSchema = z.string().uuid();

for (const [kind, table] of [
  ['exercises', exercises],
  ['theory', theoryTopics],
] as const) {
  for (const action of ['approve', 'reject'] as const) {
    admin.post(`/admin/flagged/${kind}/:id/${action}`, async (c) => {
      const idParsed = FlaggedIdSchema.safeParse(c.req.param('id'));
      if (!idParsed.success) {
        return c.json({ error: 'Invalid id', code: 'VALIDATION_ERROR' }, 400);
      }
      const outcome = await resolveFlagged(table, idParsed.data, action);
      return c.json({ outcome });
    });
  }
}
```

> TypeScript note: if `db.update(table)` rejects the `typeof exercises | typeof theoryTopics` union (Drizzle generics not unifying), split `resolveFlagged` into two concrete copies — `resolveExerciseFlagged` / `resolveTheoryFlagged` — with `exercises` / `theoryTopics` hard-coded and the identical body, and call the matching one in the route loop. Prefer the generic version; only fall back if the compiler forces it.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @language-drill/lambda test src/routes/admin.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck the Lambda package**

Run: `pnpm --filter @language-drill/lambda typecheck`
Expected: no errors. (If the union fails, apply the fallback from the note, then re-run.)

- [ ] **Step 7: Commit**

```bash
git add infra/lambda/src/routes/admin.ts infra/lambda/src/routes/admin.test.ts
git commit -m "feat(admin): approve/reject flagged content endpoints with demote-on-conflict"
```

---

## Task 3: api-client — flagged-queue schemas + hooks

**Files:**
- Create: `packages/api-client/src/schemas/flagged.ts`
- Create: `packages/api-client/src/hooks/useFlaggedQueue.ts`
- Test: `packages/api-client/src/hooks/useFlaggedQueue.test.ts`
- Modify: `packages/api-client/src/index.ts`

- [ ] **Step 1: Create the schemas**

Create `packages/api-client/src/schemas/flagged.ts`:

```ts
import { z } from 'zod';

export const ResolveOutcomeSchema = z.enum([
  'approved',
  'rejected',
  'demoted',
  'not_found',
  'already_resolved',
]);
export type ResolveOutcome = z.infer<typeof ResolveOutcomeSchema>;

export const ResolveResponseSchema = z.object({ outcome: ResolveOutcomeSchema });

const FlaggedReasonSchema = z.object({
  code: z.string(),
  detail: z.string().optional(),
});

export const FlaggedExerciseSchema = z.object({
  id: z.string(),
  language: z.string().nullable(),
  level: z.string().nullable(),
  type: z.string().nullable(),
  grammarPointKey: z.string().nullable(),
  contentJson: z.unknown(),
  qualityScore: z.number().nullable(),
  flaggedReasons: z.array(FlaggedReasonSchema),
  generatedAt: z.string().nullable(),
});
export type FlaggedExercise = z.infer<typeof FlaggedExerciseSchema>;

export const FlaggedExercisesResponseSchema = z.object({
  items: z.array(FlaggedExerciseSchema),
  total: z.number(),
});

export const FlaggedTheorySchema = z.object({
  id: z.string(),
  language: z.string().nullable(),
  level: z.string().nullable(),
  grammarPointKey: z.string().nullable(),
  topicId: z.string().nullable(),
  contentJson: z.unknown(),
  qualityScore: z.number().nullable(),
  flaggedReasons: z.array(FlaggedReasonSchema),
  generatedAt: z.string().nullable(),
});
export type FlaggedTheory = z.infer<typeof FlaggedTheorySchema>;

export const FlaggedTheoryResponseSchema = z.object({
  items: z.array(FlaggedTheorySchema),
  total: z.number(),
});

export type FlaggedExerciseFilters = {
  language?: string;
  level?: string;
  type?: string;
  grammarPoint?: string;
};
export type FlaggedTheoryFilters = {
  language?: string;
  level?: string;
  grammarPoint?: string;
};
```

- [ ] **Step 2: Write failing hook tests**

Create `packages/api-client/src/hooks/useFlaggedQueue.test.ts` (mirror `useAdminInvites.test.ts`'s harness — `QueryClientProvider` wrapper + `renderHook` + `waitFor`; copy whichever wrapper that file uses):

```ts
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { useFlaggedExercises, useResolveFlaggedExercise } from './useFlaggedQueue';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

describe('useFlaggedExercises', () => {
  it('fetches and parses the flagged exercises list with filters in the query string', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({ items: [], total: 0 }),
    );
    const { result } = renderHook(
      () => useFlaggedExercises({ fetchFn, filters: { language: 'ES' } }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ items: [], total: 0 });
    expect(fetchFn).toHaveBeenCalledWith('/admin/flagged/exercises?language=ES');
  });
});

describe('useResolveFlaggedExercise', () => {
  it('POSTs the action and returns the outcome', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ outcome: 'approved' }));
    const { result } = renderHook(() => useResolveFlaggedExercise({ fetchFn }), {
      wrapper: wrapper(),
    });
    const outcome = await result.current.mutateAsync({ id: 'ex-1', action: 'approve' });
    expect(outcome).toBe('approved');
    expect(fetchFn).toHaveBeenCalledWith('/admin/flagged/exercises/ex-1/approve', {
      method: 'POST',
    });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @language-drill/api-client test src/hooks/useFlaggedQueue.test.ts`
Expected: FAIL — `./useFlaggedQueue` missing.

- [ ] **Step 4: Implement the hooks**

Create `packages/api-client/src/hooks/useFlaggedQueue.ts`:

```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../fetchClient';
import {
  FlaggedExercisesResponseSchema,
  FlaggedTheoryResponseSchema,
  ResolveResponseSchema,
  type FlaggedExerciseFilters,
  type FlaggedTheoryFilters,
  type ResolveOutcome,
} from '../schemas/flagged';

function queryString(filters: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v) params.set(k, v);
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

export function useFlaggedExercises({
  fetchFn,
  filters = {},
  enabled = true,
}: {
  fetchFn: AuthenticatedFetch;
  filters?: FlaggedExerciseFilters;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: ['admin', 'flagged', 'exercises', filters],
    queryFn: async () => {
      const res = await fetchFn(`/admin/flagged/exercises${queryString(filters)}`);
      const json: unknown = await res.json();
      return FlaggedExercisesResponseSchema.parse(json);
    },
    enabled,
  });
}

export function useFlaggedTheory({
  fetchFn,
  filters = {},
  enabled = true,
}: {
  fetchFn: AuthenticatedFetch;
  filters?: FlaggedTheoryFilters;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: ['admin', 'flagged', 'theory', filters],
    queryFn: async () => {
      const res = await fetchFn(`/admin/flagged/theory${queryString(filters)}`);
      const json: unknown = await res.json();
      return FlaggedTheoryResponseSchema.parse(json);
    },
    enabled,
  });
}

export function useResolveFlaggedExercise({ fetchFn }: { fetchFn: AuthenticatedFetch }) {
  const queryClient = useQueryClient();
  return useMutation<ResolveOutcome, Error, { id: string; action: 'approve' | 'reject' }>({
    mutationFn: async ({ id, action }) => {
      const res = await fetchFn(`/admin/flagged/exercises/${id}/${action}`, { method: 'POST' });
      const json: unknown = await res.json();
      return ResolveResponseSchema.parse(json).outcome;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'flagged', 'exercises'] });
    },
  });
}

export function useResolveFlaggedTheory({ fetchFn }: { fetchFn: AuthenticatedFetch }) {
  const queryClient = useQueryClient();
  return useMutation<ResolveOutcome, Error, { id: string; action: 'approve' | 'reject' }>({
    mutationFn: async ({ id, action }) => {
      const res = await fetchFn(`/admin/flagged/theory/${id}/${action}`, { method: 'POST' });
      const json: unknown = await res.json();
      return ResolveResponseSchema.parse(json).outcome;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'flagged', 'theory'] });
    },
  });
}
```

- [ ] **Step 5: Add barrel exports**

In `packages/api-client/src/index.ts`, add (near the other schema/hook exports):

```ts
export {
  FlaggedExerciseSchema,
  FlaggedExercisesResponseSchema,
  FlaggedTheorySchema,
  FlaggedTheoryResponseSchema,
  ResolveOutcomeSchema,
  ResolveResponseSchema,
  type FlaggedExercise,
  type FlaggedTheory,
  type FlaggedExerciseFilters,
  type FlaggedTheoryFilters,
  type ResolveOutcome,
} from './schemas/flagged';
export {
  useFlaggedExercises,
  useFlaggedTheory,
  useResolveFlaggedExercise,
  useResolveFlaggedTheory,
} from './hooks/useFlaggedQueue';
```

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm --filter @language-drill/api-client test src/hooks/useFlaggedQueue.test.ts`
Expected: PASS (2 tests).
Run: `pnpm --filter @language-drill/api-client typecheck`
Expected: no errors.

- [ ] **Step 7: Build api-client (so web can import the new exports)**

Run: `pnpm --filter @language-drill/api-client build`
Expected: success.

- [ ] **Step 8: Commit**

```bash
git add packages/api-client/src/schemas/flagged.ts packages/api-client/src/hooks/useFlaggedQueue.ts packages/api-client/src/hooks/useFlaggedQueue.test.ts packages/api-client/src/index.ts
git commit -m "feat(admin): api-client hooks + schemas for the flagged queue"
```

---

## Task 4: web — generic content field view

**Files:**
- Create: `apps/web/app/(admin)/admin/moderation/_components/content-field-view.tsx`
- Test: `apps/web/app/(admin)/admin/moderation/_components/__tests__/content-field-view.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/(admin)/admin/moderation/_components/__tests__/content-field-view.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ContentFieldView } from '../content-field-view';

describe('ContentFieldView', () => {
  const content = {
    type: 'cloze',
    instructions: 'Fill the blank',
    sentence: 'Maria ___ lo dio.',
    correctAnswer: 'se',
    acceptableAnswers: ['se', 'se lo'],
    _dedupKey: 'should-not-show',
  };

  it('renders labeled fields including the answer, hides type and _dedupKey', () => {
    render(<ContentFieldView content={content} />);
    expect(screen.getByText('sentence')).toBeInTheDocument();
    expect(screen.getByText('Maria ___ lo dio.')).toBeInTheDocument();
    expect(screen.getByText('correctAnswer')).toBeInTheDocument();
    expect(screen.getByText('se')).toBeInTheDocument();
    expect(screen.queryByText('_dedupKey')).not.toBeInTheDocument();
    expect(screen.queryByText('type')).not.toBeInTheDocument();
  });

  it('renders a raw JSON disclosure', () => {
    render(<ContentFieldView content={content} />);
    expect(screen.getByText('raw JSON')).toBeInTheDocument();
  });

  it('falls back to JSON for non-object content', () => {
    render(<ContentFieldView content={'just a string'} />);
    expect(screen.getByText(/just a string/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/web test "app/(admin)/admin/moderation/_components/__tests__/content-field-view.test.tsx"`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the component**

Create `apps/web/app/(admin)/admin/moderation/_components/content-field-view.tsx`:

```tsx
function renderValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (Array.isArray(value)) return value.map((v) => renderValue(v)).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

// Type-agnostic read-only view of an exercise's contentJson: every field except
// the discriminator `type` and the writer-only `_dedupKey` is shown as a labeled
// row, with the full JSON available in a disclosure. Works for all exercise types.
export function ContentFieldView({ content }: { content: unknown }) {
  if (!content || typeof content !== 'object') {
    return (
      <pre className="text-[12px] whitespace-pre-wrap break-words text-ink-soft">
        {JSON.stringify(content)}
      </pre>
    );
  }
  const entries = Object.entries(content as Record<string, unknown>).filter(
    ([k]) => k !== '_dedupKey' && k !== 'type',
  );
  return (
    <div className="flex flex-col gap-2">
      <dl className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-1 text-[13px]">
        {entries.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-ink-soft">{k}</dt>
            <dd className="text-ink break-words">{renderValue(v)}</dd>
          </div>
        ))}
      </dl>
      <details className="text-[12px]">
        <summary className="cursor-pointer text-ink-soft">raw JSON</summary>
        <pre className="mt-1 whitespace-pre-wrap break-words">
          {JSON.stringify(content, null, 2)}
        </pre>
      </details>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/web test "app/(admin)/admin/moderation/_components/__tests__/content-field-view.test.tsx"`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(admin)/admin/moderation/_components/content-field-view.tsx" "apps/web/app/(admin)/admin/moderation/_components/__tests__/content-field-view.test.tsx"
git commit -m "feat(admin): generic content field view for flagged items"
```

---

## Task 5: web — flagged item cards (exercise + theory)

**Files:**
- Create: `apps/web/app/(admin)/admin/moderation/_components/flagged-exercise-card.tsx`
- Create: `apps/web/app/(admin)/admin/moderation/_components/flagged-theory-card.tsx`
- Test: `apps/web/app/(admin)/admin/moderation/_components/__tests__/flagged-exercise-card.test.tsx`

- [ ] **Step 1: Write the failing test (exercise card)**

Create `apps/web/app/(admin)/admin/moderation/_components/__tests__/flagged-exercise-card.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { FlaggedExercise } from '@language-drill/api-client';
import { FlaggedExerciseCard } from '../flagged-exercise-card';

const item: FlaggedExercise = {
  id: 'ex-1',
  language: 'ES',
  level: 'A2',
  type: 'cloze',
  grammarPointKey: 'obj-pronoun',
  contentJson: { type: 'cloze', sentence: 'Maria ___ lo dio.', correctAnswer: 'se' },
  qualityScore: 0.62,
  flaggedReasons: [{ code: 'ambiguous' }],
  generatedAt: '2026-06-01T00:00:00.000Z',
};

describe('FlaggedExerciseCard', () => {
  it('renders header, reason chip, and content', () => {
    render(<FlaggedExerciseCard item={item} onResolve={vi.fn()} pending={false} demoted={false} />);
    expect(screen.getByText(/cloze/)).toBeInTheDocument();
    expect(screen.getByText(/obj-pronoun/)).toBeInTheDocument();
    expect(screen.getByText(/Ambiguous|ambiguous/)).toBeInTheDocument();
    expect(screen.getByText('Maria ___ lo dio.')).toBeInTheDocument();
  });

  it('calls onResolve with approve / reject', () => {
    const onResolve = vi.fn();
    render(<FlaggedExerciseCard item={item} onResolve={onResolve} pending={false} demoted={false} />);
    fireEvent.click(screen.getByRole('button', { name: /approve/i }));
    expect(onResolve).toHaveBeenCalledWith('approve');
    fireEvent.click(screen.getByRole('button', { name: /reject/i }));
    expect(onResolve).toHaveBeenCalledWith('reject');
  });

  it('shows the demote notice when demoted', () => {
    render(<FlaggedExerciseCard item={item} onResolve={vi.fn()} pending={false} demoted />);
    expect(screen.getByText(/already exists in this cell/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @language-drill/web test "app/(admin)/admin/moderation/_components/__tests__/flagged-exercise-card.test.tsx"`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the exercise card**

Create `apps/web/app/(admin)/admin/moderation/_components/flagged-exercise-card.tsx`:

```tsx
import { REASON_LABELS, type GenerationReasonCode } from '@language-drill/shared';
import type { FlaggedExercise } from '@language-drill/api-client';
import { Button } from '../../../../../components/ui';
import { ContentFieldView } from './content-field-view';

function reasonLabel(code: string, detail?: string): string {
  const label = REASON_LABELS[code as GenerationReasonCode] ?? code;
  return detail ? `${label}: ${detail}` : label;
}

export function FlaggedExerciseCard({
  item,
  onResolve,
  pending,
  demoted,
}: {
  item: FlaggedExercise;
  onResolve: (action: 'approve' | 'reject') => void;
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
      </div>
      <div className="flex gap-2 flex-wrap">
        {item.flaggedReasons.map((r, i) => (
          <span key={i} className="text-[12px] bg-paper-2 text-ink px-2 py-px rounded-full">
            ⚠ {reasonLabel(r.code, r.detail)}
          </span>
        ))}
      </div>
      <ContentFieldView content={item.contentJson} />
      {demoted ? (
        <p className="text-[12px] text-ink-soft">
          An approved item already exists in this cell — this item was rejected instead.
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button variant="primary" size="sm" disabled={pending} onClick={() => onResolve('approve')}>
          Approve
        </Button>
        <Button variant="secondary" size="sm" disabled={pending} onClick={() => onResolve('reject')}>
          Reject
        </Button>
      </div>
    </div>
  );
}
```

> Verify `Button` is exported from `apps/web/components/ui` with `variant`/`size` props (the invites page uses `Button variant="primary" size="sm"`). The relative depth from this file to `components/ui` is five `../` — confirm against the invites page import (`apps/web/app/(admin)/admin/invites/page.tsx` uses `../../../../components/ui`; this card is one directory deeper under `_components/`, so `../../../../../components/ui`).

- [ ] **Step 4: Implement the theory card (reuses the theory renderer)**

Create `apps/web/app/(admin)/admin/moderation/_components/flagged-theory-card.tsx`:

```tsx
import { parseTheoryTopicJson, REASON_LABELS, type GenerationReasonCode } from '@language-drill/shared';
import type { FlaggedTheory } from '@language-drill/api-client';
import { Button } from '../../../../../components/ui';
import { renderTheoryTopicJson } from '../../../../../components/theory/render-json';
import { TheorySections } from '../../../../../components/theory/theory-sections';

function reasonLabel(code: string, detail?: string): string {
  const label = REASON_LABELS[code as GenerationReasonCode] ?? code;
  return detail ? `${label}: ${detail}` : label;
}

function TheoryBody({ content, language }: { content: unknown; language: string }) {
  try {
    const topic = renderTheoryTopicJson(parseTheoryTopicJson(content));
    return (
      <TheorySections
        topic={topic}
        language={language as never}
        onSwitchTopic={() => {}}
      />
    );
  } catch {
    return (
      <pre className="text-[12px] whitespace-pre-wrap break-words">
        {JSON.stringify(content, null, 2)}
      </pre>
    );
  }
}

export function FlaggedTheoryCard({
  item,
  onResolve,
  pending,
  demoted,
}: {
  item: FlaggedTheory;
  onResolve: (action: 'approve' | 'reject') => void;
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
      </div>
      <div className="flex gap-2 flex-wrap">
        {item.flaggedReasons.map((r, i) => (
          <span key={i} className="text-[12px] bg-paper-2 text-ink px-2 py-px rounded-full">
            ⚠ {reasonLabel(r.code, r.detail)}
          </span>
        ))}
      </div>
      <TheoryBody content={item.contentJson} language={item.language ?? 'ES'} />
      {demoted ? (
        <p className="text-[12px] text-ink-soft">
          An approved item already exists in this cell — this item was rejected instead.
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button variant="primary" size="sm" disabled={pending} onClick={() => onResolve('approve')}>
          Approve
        </Button>
        <Button variant="secondary" size="sm" disabled={pending} onClick={() => onResolve('reject')}>
          Reject
        </Button>
      </div>
    </div>
  );
}
```

> `TheorySections` and `renderTheoryTopicJson` are exported functions (confirmed) but not via the theory `index.ts`; import them from their files as shown. `language` is typed `LearningLanguage` in `TheorySections`; the `as never` cast keeps the admin card decoupled from that union (the renderer only uses it for inline links, irrelevant here). If `TheorySections` requires more props than `{ topic, language, onSwitchTopic }` at the current revision, pass the minimal additional props it needs (check its signature) — do not add behavior.

- [ ] **Step 5: Run the exercise-card test**

Run: `pnpm --filter @language-drill/web test "app/(admin)/admin/moderation/_components/__tests__/flagged-exercise-card.test.tsx"`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add "apps/web/app/(admin)/admin/moderation/_components/flagged-exercise-card.tsx" "apps/web/app/(admin)/admin/moderation/_components/flagged-theory-card.tsx" "apps/web/app/(admin)/admin/moderation/_components/__tests__/flagged-exercise-card.test.tsx"
git commit -m "feat(admin): flagged exercise + theory review cards"
```

---

## Task 6: web — Moderation page + nav entry

**Files:**
- Create: `apps/web/app/(admin)/admin/moderation/page.tsx`
- Modify: `apps/web/components/admin/admin-nav-items.tsx`
- Modify: `apps/web/components/admin/__tests__/admin-nav.test.tsx`

- [ ] **Step 1: Update the nav source-of-truth test (RED)**

In `apps/web/components/admin/__tests__/admin-nav.test.tsx`, update the order assertions to include Moderation first:

```tsx
    expect(ADMIN_NAV.map((d) => d.href)).toEqual([
      '/admin/moderation',
      '/admin/generation',
      '/admin/theory',
      '/admin/invites',
    ]);
    expect(ADMIN_NAV.map((d) => d.label)).toEqual([
      'Moderation',
      'Pool',
      'Theory',
      'Invites',
    ]);
```

- [ ] **Step 2: Run the nav test to verify it fails**

Run: `pnpm --filter @language-drill/web test "components/admin/__tests__/admin-nav.test.tsx"`
Expected: FAIL — ADMIN_NAV still has 3 entries.

- [ ] **Step 3: Add the Moderation nav entry**

In `apps/web/components/admin/admin-nav-items.tsx`, prepend to `ADMIN_NAV`:

```tsx
export const ADMIN_NAV: AdminNavDestination[] = [
  { href: '/admin/moderation', label: 'Moderation' },
  { href: '/admin/generation', label: 'Pool' },
  { href: '/admin/theory', label: 'Theory' },
  { href: '/admin/invites', label: 'Invites' },
];
```

- [ ] **Step 4: Run the nav test to verify it passes**

Run: `pnpm --filter @language-drill/web test "components/admin/__tests__/admin-nav.test.tsx"`
Expected: PASS.

- [ ] **Step 5: Implement the Moderation page**

Create `apps/web/app/(admin)/admin/moderation/page.tsx`:

```tsx
'use client';

import { useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import {
  createAuthenticatedFetch,
  useFlaggedExercises,
  useFlaggedTheory,
  useResolveFlaggedExercise,
  useResolveFlaggedTheory,
  type FlaggedExerciseFilters,
} from '@language-drill/api-client';
import { FlaggedExerciseCard } from './_components/flagged-exercise-card';
import { FlaggedTheoryCard } from './_components/flagged-theory-card';

type Tab = 'exercises' | 'theory';

export default function ModerationPage() {
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  const [tab, setTab] = useState<Tab>('exercises');
  const [filters, setFilters] = useState<FlaggedExerciseFilters>({});
  const [demotedId, setDemotedId] = useState<string | null>(null);

  const exercises = useFlaggedExercises({ fetchFn, filters, enabled: tab === 'exercises' });
  const theory = useFlaggedTheory({ fetchFn, filters, enabled: tab === 'theory' });
  const resolveExercise = useResolveFlaggedExercise({ fetchFn });
  const resolveTheory = useResolveFlaggedTheory({ fetchFn });

  const setFilter = (key: keyof FlaggedExerciseFilters, value: string) =>
    setFilters((f) => ({ ...f, [key]: value || undefined }));

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-[24px] font-semibold text-ink">Moderation</h1>

      <div className="flex gap-2" role="tablist">
        <button
          role="tab"
          aria-selected={tab === 'exercises'}
          onClick={() => setTab('exercises')}
          className={tab === 'exercises' ? 'font-semibold text-ink' : 'text-ink-soft'}
        >
          Exercises{exercises.data ? ` (${exercises.data.total})` : ''}
        </button>
        <button
          role="tab"
          aria-selected={tab === 'theory'}
          onClick={() => setTab('theory')}
          className={tab === 'theory' ? 'font-semibold text-ink' : 'text-ink-soft'}
        >
          Theory{theory.data ? ` (${theory.data.total})` : ''}
        </button>
      </div>

      <div className="flex gap-2 flex-wrap text-[13px]">
        <select aria-label="language" value={filters.language ?? ''} onChange={(e) => setFilter('language', e.target.value)}>
          <option value="">All languages</option>
          <option value="ES">ES</option>
          <option value="DE">DE</option>
          <option value="TR">TR</option>
        </select>
        <select aria-label="level" value={filters.level ?? ''} onChange={(e) => setFilter('level', e.target.value)}>
          <option value="">All levels</option>
          <option value="A1">A1</option>
          <option value="A2">A2</option>
          <option value="B1">B1</option>
          <option value="B2">B2</option>
        </select>
        {tab === 'exercises' ? (
          <input
            aria-label="type"
            placeholder="type (e.g. cloze)"
            value={filters.type ?? ''}
            onChange={(e) => setFilter('type', e.target.value)}
          />
        ) : null}
        <input
          aria-label="grammar point"
          placeholder="grammar point"
          value={filters.grammarPoint ?? ''}
          onChange={(e) => setFilter('grammarPoint', e.target.value)}
        />
      </div>

      {tab === 'exercises' ? (
        <Section
          loading={exercises.isLoading}
          error={exercises.isError}
          count={exercises.data?.items.length ?? 0}
          total={exercises.data?.total ?? 0}
        >
          {exercises.data?.items.map((item) => (
            <FlaggedExerciseCard
              key={item.id}
              item={item}
              pending={resolveExercise.isPending}
              demoted={demotedId === item.id}
              onResolve={async (action) => {
                const outcome = await resolveExercise.mutateAsync({ id: item.id, action });
                setDemotedId(outcome === 'demoted' ? item.id : null);
              }}
            />
          ))}
        </Section>
      ) : (
        <Section
          loading={theory.isLoading}
          error={theory.isError}
          count={theory.data?.items.length ?? 0}
          total={theory.data?.total ?? 0}
        >
          {theory.data?.items.map((item) => (
            <FlaggedTheoryCard
              key={item.id}
              item={item}
              pending={resolveTheory.isPending}
              demoted={demotedId === item.id}
              onResolve={async (action) => {
                const outcome = await resolveTheory.mutateAsync({ id: item.id, action });
                setDemotedId(outcome === 'demoted' ? item.id : null);
              }}
            />
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({
  loading,
  error,
  count,
  total,
  children,
}: {
  loading: boolean;
  error: boolean;
  count: number;
  total: number;
  children: React.ReactNode;
}) {
  if (loading) return <p className="text-ink-soft text-[13px]">Loading…</p>;
  if (error) return <p className="text-ink-soft text-[13px]">Failed to load flagged items.</p>;
  if (count === 0) return <p className="text-ink-soft text-[13px]">No flagged items.</p>;
  return (
    <div className="flex flex-col gap-3">
      {count < total ? (
        <p className="text-[12px] text-ink-soft">Showing {count} of {total}.</p>
      ) : null}
      {children}
    </div>
  );
}
```

> Note: `FlaggedTheoryFilters` is a subset of `FlaggedExerciseFilters` (no `type`); passing the exercise-filters object to `useFlaggedTheory` is fine — the extra `type` key is ignored by `queryString` only if unset, but when the theory tab is active the `type` input isn't rendered so it stays unset. This keeps a single filter state. If the typecheck complains about the filter type on `useFlaggedTheory`, pass `{ language: filters.language, level: filters.level, grammarPoint: filters.grammarPoint }` explicitly.

- [ ] **Step 6: Typecheck the web app**

Run: `pnpm --filter @language-drill/web typecheck`
Expected: no errors. (Resolve any filter-type mismatch via the note above.)

- [ ] **Step 7: Run the moderation-related web tests**

Run: `pnpm --filter @language-drill/web test "app/(admin)/admin/moderation" "components/admin/__tests__/admin-nav.test.tsx"`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add "apps/web/app/(admin)/admin/moderation/page.tsx" "apps/web/components/admin/admin-nav-items.tsx" "apps/web/components/admin/__tests__/admin-nav.test.tsx"
git commit -m "feat(admin): moderation page with exercises/theory tabs + nav entry"
```

---

## Task 7: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Lint the web + lambda + api-client**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 2: Repo-wide typecheck**

Run: `pnpm typecheck`
Expected: no errors across all packages.

- [ ] **Step 3: Full test suite (serial, avoids the known infra parallel flake)**

Run: `pnpm turbo run test --concurrency=1`
Expected: all packages pass, including the new admin endpoint tests, api-client hook tests, and web component/page + nav tests.

- [ ] **Step 4: Commit (only if a lint/format autofix changed files; else skip)**

```bash
git add -A && git commit -m "chore(admin): verification fixes" || echo "nothing to commit"
```

---

## Self-review notes (for the implementer)

- **Spec coverage:** list endpoints (Task 1) ↔ spec "List"; approve/reject + demote (Task 2) ↔ spec "Mutate" + the demote-semantics risk; api-client hooks/schemas (Task 3) ↔ spec "api-client"; generic field view (Task 4) ↔ "content view" decision; cards incl. demote notice + theory renderer reuse (Task 5) ↔ "flagged-*-card"; page with tabs/filters/counts + Moderation nav (Task 6) ↔ "page.tsx" + IA; tests throughout + Task 7 ↔ spec "Testing". `_dedupKey` stripped server-side (Task 1) and reasons normalized (Task 1) ↔ spec risks. CLI left intact (no deletion task) ↔ spec scope.
- **Type consistency:** `ResolveOutcome` union identical in Lambda (Task 2) and api-client schema (Task 3); `FlaggedExercise`/`FlaggedTheory` shapes match the Lambda list response field names (`level`, `grammarPointKey`, `topicId`, `flaggedReasons`, `generatedAt`); cards consume those exact types; `onResolve(action)` signature consistent across cards and page.
- **Known pitfalls flagged inline:** Drizzle union on `db.update(table)` (Task 2 note), `Button` import depth (Task 5 note), theory `TheorySections` props/`language` cast (Task 5 note), filter-type on `useFlaggedTheory` (Task 6 note), workspace `pnpm build` for cross-package imports (context + Task 3 step 7).
- **No placeholders:** every code step shows complete code; every run step has an exact command + expected result.
```
