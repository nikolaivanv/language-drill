# Admin User-Activity Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `/admin/activity` panel with three server-truth lenses on user activity — problematic-session drill-down (#2), most-failed exercises (#3), and a user roster (#1).

**Architecture:** New read-side Hono routes under `/admin/activity/*` in `infra/lambda/src/routes/admin.ts`, gated by the existing `authMiddleware`+`adminMiddleware` chain. Each endpoint gets a Zod response schema + a TanStack-Query hook in `packages/api-client`, consumed by a new client page `apps/web/app/(admin)/admin/activity/page.tsx` with three tabs. No new DB tables — all aggregates run over existing tables/indexes.

**Tech Stack:** Hono, Drizzle ORM (Postgres), Zod, TanStack Query, Next.js App Router (client components), Clerk auth, Vitest + React Testing Library.

## Global Constraints

- No new DB tables or migrations — read-only aggregates over `practiceSessions`, `userExerciseHistory`, `errorObservations`, `exerciseFlags`, `usageEvents`, `exercises`.
- All `/admin/*` routes inherit `authMiddleware, adminMiddleware` (already mounted via `admin.use('/admin/*', ...)` in `admin.ts`) — do NOT re-add auth per handler.
- Validate every query/param with Zod `.safeParse()`; return `c.json({ error, code: 'VALIDATION_ERROR', details }, 400)` on failure (match existing handlers).
- Windowed aggregates only (7d / 30d). Paginate feeds (`limit`/`offset`, default limit 25). No real-time.
- Languages enum: `'ES' | 'DE' | 'TR'`. Levels enum: `'A1' | 'A2' | 'B1' | 'B2'`.
- "Problematic" session = has an open flag OR abandoned (`completedAt IS NULL AND startedAt < now()-30m`) OR low-score (`completedAt IS NOT NULL AND correctCount/exerciseCount < 0.5`).
- Failure-aggregate false-positive guards: default `attempts >= 5`; always surface `distinctUsers`.
- Reuse existing `useResolveContentExercise` mutation + `POST /admin/content/exercises/:id/{demote,reject}` for #3 actions — do NOT add new moderation endpoints.
- Pre-push gate (run from repo root before any push): `pnpm lint && pnpm typecheck && pnpm test`.
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

**Lambda (`infra/lambda/src/`)**
- Modify `routes/admin.ts` — add three route groups (`activity/sessions`, `activity/sessions/:id`, `activity/failures`, `activity/roster`) + their Zod query schemas. Keep handlers thin; push SQL into small local helpers in the same file (mirrors existing style).
- Modify `routes/admin.test.ts` — add `describe` blocks per new endpoint using the existing `queryQueue` mock harness.

**api-client (`packages/api-client/src/`)**
- Create `schemas/admin-activity.ts` — Zod response schemas + inferred types for all four endpoints.
- Create `schemas/admin-activity.test.ts` — schema parse tests.
- Create `hooks/useActivitySessions.ts`, `hooks/useActivitySessionDetail.ts`, `hooks/useActivityFailures.ts`, `hooks/useActivityRoster.ts`.
- Modify `index.ts` — barrel-export the new schemas, types, and hooks.

**Web (`apps/web/`)**
- Create `app/(admin)/admin/activity/page.tsx` — tabbed page (Sessions / Failures / Roster).
- Create `app/(admin)/admin/activity/__tests__/page.test.tsx` — component tests.
- Modify `components/admin/admin-nav-items.tsx` — add the Activity nav entry.

---

## Phase 1 — View #2: Session drill-down

### Task 1: Lambda — `GET /admin/activity/sessions` feed

**Files:**
- Modify: `infra/lambda/src/routes/admin.ts`
- Test: `infra/lambda/src/routes/admin.test.ts`

**Interfaces:**
- Produces (response JSON, an array): `Array<{ sessionId: string; userId: string; language: string; difficulty: string; exerciseCount: number; correctCount: number; completedAt: string | null; startedAt: string; signals: ('flagged'|'abandoned'|'low_score')[]; primarySignal: 'flagged'|'abandoned'|'low_score' }>`

- [ ] **Step 1: Write the failing test**

Add to `infra/lambda/src/routes/admin.test.ts` (the `db.select()` mock returns `makeChain()`, which resolves to the next `queryQueue` entry — so push one array for the single feed query):

```typescript
describe('GET /admin/activity/sessions', () => {
  it('returns problematic sessions ordered flagged > abandoned > low_score', async () => {
    // Single query result: rows already carry computed signal flags from SQL.
    queryQueue.push([
      { sessionId: 's-low', userId: 'u1', language: 'TR', difficulty: 'A2',
        exerciseCount: 8, correctCount: 2, completedAt: '2026-06-22T10:00:00Z',
        startedAt: '2026-06-22T09:50:00Z', hasOpenFlag: false, isAbandoned: false, isLowScore: true },
      { sessionId: 's-flag', userId: 'u2', language: 'ES', difficulty: 'B1',
        exerciseCount: 5, correctCount: 4, completedAt: '2026-06-22T11:00:00Z',
        startedAt: '2026-06-22T10:55:00Z', hasOpenFlag: true, isAbandoned: false, isLowScore: false },
      { sessionId: 's-aband', userId: 'u3', language: 'DE', difficulty: 'A2',
        exerciseCount: 6, correctCount: 1, completedAt: null,
        startedAt: '2026-06-22T08:00:00Z', hasOpenFlag: false, isAbandoned: true, isLowScore: false },
    ]);
    const res = await app.request('/admin/activity/sessions', undefined, adminEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ sessionId: string; primarySignal: string; signals: string[] }>;
    expect(body.map((r) => r.sessionId)).toEqual(['s-flag', 's-aband', 's-low']);
    expect(body[0].primarySignal).toBe('flagged');
    expect(body[2].signals).toContain('low_score');
  });

  it('rejects an invalid language filter with 400', async () => {
    const res = await app.request('/admin/activity/sessions?language=FR', undefined, adminEnv);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('VALIDATION_ERROR');
  });

  it('returns 403 for a non-admin', async () => {
    const res = await app.request('/admin/activity/sessions', undefined,
      { event: { requestContext: { authorizer: { jwt: { claims: { sub: 'nope' } } } } } });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/lambda test -- admin.test.ts -t "admin/activity/sessions"`
Expected: FAIL (route not registered → 404, body assertion fails).

- [ ] **Step 3: Write the handler**

In `infra/lambda/src/routes/admin.ts`, ensure `lt`, `lte`, `or`, `sql` are imported from `drizzle-orm` (add any missing to the existing `import { and, asc, count, desc, eq, gte, inArray, isNotNull, sql, type SQL } from 'drizzle-orm';` line → add `lt, or`). Also ensure `practiceSessions`, `exerciseFlags` are imported from `@language-drill/db` (add to the existing barrel import). Then add:

```typescript
const ActivitySessionsQuerySchema = z.object({
  language: z.enum(['ES', 'DE', 'TR']).optional(),
  userId: z.string().min(1).optional(),
  all: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

type ActivitySessionRow = {
  sessionId: string;
  userId: string;
  language: string;
  difficulty: string;
  exerciseCount: number;
  correctCount: number;
  completedAt: Date | null;
  startedAt: Date;
  hasOpenFlag: boolean;
  isAbandoned: boolean;
  isLowScore: boolean;
};

admin.get('/admin/activity/sessions', async (c) => {
  const parsed = ActivitySessionsQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'Invalid query parameters', code: 'VALIDATION_ERROR', details: parsed.error.flatten() }, 400);
  }
  const { language, userId, all, limit = 25, offset = 0 } = parsed.data;

  // Computed per-session signal flags. `correctCount::float / NULLIF(exerciseCount,0)` guards /0.
  const hasOpenFlag = sql<boolean>`EXISTS (
    SELECT 1 FROM ${exerciseFlags} ef
    JOIN ${userExerciseHistory} ueh ON ueh.id = ef.history_id
    WHERE ueh.session_id = ${practiceSessions.id} AND ef.status = 'open'
  )`;
  const isAbandoned = sql<boolean>`${practiceSessions.completedAt} IS NULL AND ${practiceSessions.startedAt} < NOW() - INTERVAL '30 minutes'`;
  const isLowScore = sql<boolean>`${practiceSessions.completedAt} IS NOT NULL AND ${practiceSessions.exerciseCount} > 0 AND (${practiceSessions.correctCount}::float / ${practiceSessions.exerciseCount}) < 0.5`;

  const conditions: SQL[] = [];
  if (language) conditions.push(eq(practiceSessions.language, language));
  if (userId) conditions.push(eq(practiceSessions.userId, userId));
  const problematic = or(hasOpenFlag, isAbandoned, isLowScore)!;
  if (all !== 'true') conditions.push(problematic);

  const rows = (await db
    .select({
      sessionId: practiceSessions.id,
      userId: practiceSessions.userId,
      language: practiceSessions.language,
      difficulty: practiceSessions.difficulty,
      exerciseCount: practiceSessions.exerciseCount,
      correctCount: practiceSessions.correctCount,
      completedAt: practiceSessions.completedAt,
      startedAt: practiceSessions.startedAt,
      hasOpenFlag,
      isAbandoned,
      isLowScore,
    })
    .from(practiceSessions)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(practiceSessions.startedAt))
    .limit(limit)
    .offset(offset)) as ActivitySessionRow[];

  // Rank: flagged(0) > abandoned(1) > low_score(2), then newest-first (already sorted by query).
  const rank = (r: ActivitySessionRow) => (r.hasOpenFlag ? 0 : r.isAbandoned ? 1 : 2);
  const ranked = [...rows].sort((a, b) => rank(a) - rank(b) || (b.startedAt > a.startedAt ? 1 : -1));

  const items = ranked.map((r) => {
    const signals: ('flagged' | 'abandoned' | 'low_score')[] = [];
    if (r.hasOpenFlag) signals.push('flagged');
    if (r.isAbandoned) signals.push('abandoned');
    if (r.isLowScore) signals.push('low_score');
    return {
      sessionId: r.sessionId,
      userId: r.userId,
      language: r.language,
      difficulty: r.difficulty,
      exerciseCount: r.exerciseCount,
      correctCount: r.correctCount,
      completedAt: r.completedAt ? r.completedAt.toISOString() : null,
      startedAt: r.startedAt.toISOString(),
      signals,
      primarySignal: signals[0],
    };
  });
  return c.json(items);
});
```

Note for the test mock: the mock chain resolves string dates fine because `.toISOString()` is only called on `Date`. In the test, `startedAt`/`completedAt` are strings, so replace `.toISOString()` calls would throw — instead the handler must tolerate both. Use this guard helper at the top of the file (once) and use it in the map:

```typescript
const toIso = (v: Date | string | null): string | null =>
  v == null ? null : typeof v === 'string' ? v : v.toISOString();
```

Replace the two `r.completedAt ? ... : null` / `r.startedAt.toISOString()` expressions with `toIso(r.completedAt)` and `toIso(r.startedAt)!`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @language-drill/lambda test -- admin.test.ts -t "admin/activity/sessions"`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/routes/admin.ts infra/lambda/src/routes/admin.test.ts
git commit -m "feat(admin): problematic-sessions feed endpoint

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Lambda — `GET /admin/activity/sessions/:id` detail

**Files:**
- Modify: `infra/lambda/src/routes/admin.ts`
- Test: `infra/lambda/src/routes/admin.test.ts`

**Interfaces:**
- Consumes: `toIso` helper from Task 1.
- Produces (response JSON):
```
{
  session: { sessionId, userId, language, difficulty, exerciseCount, correctCount, startedAt, completedAt },
  exercises: Array<{
    exerciseId: string; order: number;
    type: string | null; content: unknown;        // exercises.contentJson
    score: number | null;                          // userExerciseHistory.score
    response: unknown;                             // userExerciseHistory.responseJson (raw passthrough)
    evaluatedAt: string | null;
    errors: Array<{ errorType: string; severity: string; wrongText: string; correction: string; errorGrammarPointKey: string | null }>;
    flag: { category: string; note: string | null; status: string; createdAt: string } | null;
  }>
}
```
Returns `404` `{ error, code: 'NOT_FOUND' }` if the session id does not exist.

- [ ] **Step 1: Write the failing test**

The handler issues 4 queries in order: (1) session row, (2) history rows for the session, (3) error observations for the session, (4) flags joined to history for the session. Stage them in `queryQueue` in that order:

```typescript
describe('GET /admin/activity/sessions/:id', () => {
  const SID = '11111111-1111-1111-1111-111111111111';
  it('assembles ordered exercises with errors and flags', async () => {
    queryQueue.push(
      [{ sessionId: SID, userId: 'u1', language: 'TR', difficulty: 'A2', exerciseCount: 2,
         correctCount: 1, startedAt: '2026-06-22T09:00:00Z', completedAt: '2026-06-22T09:10:00Z',
         exerciseIds: ['ex-b', 'ex-a'] }],                       // (1) session
      [{ exerciseId: 'ex-a', type: 'cloze', content: { p: 'a' }, score: 0.2,
         response: { answer: 'x' }, evaluatedAt: '2026-06-22T09:05:00Z' },
       { exerciseId: 'ex-b', type: 'cloze', content: { p: 'b' }, score: 1,
         response: { answer: 'y' }, evaluatedAt: '2026-06-22T09:02:00Z',
         historyId: 'h-b' }],                                     // (2) history
      [{ exerciseId: 'ex-a', errorType: 'grammar', severity: 'major',
         wrongText: 'x', correction: 'X', errorGrammarPointKey: null }], // (3) errors
      [{ exerciseId: 'ex-b', category: 'wrong_answer', note: null,
         status: 'open', createdAt: '2026-06-22T09:03:00Z' }],    // (4) flags
    );
    const res = await app.request(`/admin/activity/sessions/${SID}`, undefined, adminEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { exercises: Array<{ exerciseId: string; errors: unknown[]; flag: unknown }> };
    // exerciseIds order is ['ex-b','ex-a'] → preserved
    expect(body.exercises.map((e) => e.exerciseId)).toEqual(['ex-b', 'ex-a']);
    expect(body.exercises[0].flag).not.toBeNull();      // ex-b has the flag
    expect(body.exercises[1].errors).toHaveLength(1);   // ex-a has the error
  });

  it('returns 404 for an unknown session', async () => {
    queryQueue.push([]); // (1) session → empty
    const res = await app.request(`/admin/activity/sessions/${SID}`, undefined, adminEnv);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('NOT_FOUND');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/lambda test -- admin.test.ts -t "admin/activity/sessions/:id"`
Expected: FAIL (404 / route missing).

- [ ] **Step 3: Write the handler**

Ensure `errorObservations` is imported from `@language-drill/db`. Add:

```typescript
const SessionIdSchema = z.string().uuid();

admin.get('/admin/activity/sessions/:id', async (c) => {
  const idParsed = SessionIdSchema.safeParse(c.req.param('id'));
  if (!idParsed.success) {
    return c.json({ error: 'Invalid session id', code: 'VALIDATION_ERROR' }, 400);
  }
  const sessionId = idParsed.data;

  const sessionRows = (await db
    .select({
      sessionId: practiceSessions.id,
      userId: practiceSessions.userId,
      language: practiceSessions.language,
      difficulty: practiceSessions.difficulty,
      exerciseCount: practiceSessions.exerciseCount,
      correctCount: practiceSessions.correctCount,
      startedAt: practiceSessions.startedAt,
      completedAt: practiceSessions.completedAt,
      exerciseIds: practiceSessions.exerciseIds,
    })
    .from(practiceSessions)
    .where(eq(practiceSessions.id, sessionId))
    .limit(1)) as Array<{
      sessionId: string; userId: string; language: string; difficulty: string;
      exerciseCount: number; correctCount: number; startedAt: Date | string;
      completedAt: Date | string | null; exerciseIds: string[];
    }>;

  if (sessionRows.length === 0) {
    return c.json({ error: 'Session not found', code: 'NOT_FOUND' }, 404);
  }
  const session = sessionRows[0];

  const [historyRows, errorRows, flagRows] = await Promise.all([
    db
      .select({
        exerciseId: exercises.id,
        type: exercises.type,
        content: exercises.contentJson,
        score: userExerciseHistory.score,
        response: userExerciseHistory.responseJson,
        evaluatedAt: userExerciseHistory.evaluatedAt,
        historyId: userExerciseHistory.id,
      })
      .from(userExerciseHistory)
      .innerJoin(exercises, eq(userExerciseHistory.exerciseId, exercises.id))
      .where(eq(userExerciseHistory.sessionId, sessionId)),
    db
      .select({
        exerciseId: errorObservations.exerciseId,
        errorType: errorObservations.errorType,
        severity: errorObservations.severity,
        wrongText: errorObservations.wrongText,
        correction: errorObservations.correction,
        errorGrammarPointKey: errorObservations.errorGrammarPointKey,
      })
      .from(errorObservations)
      .where(eq(errorObservations.sessionId, sessionId)),
    db
      .select({
        exerciseId: exerciseFlags.exerciseId,
        category: exerciseFlags.category,
        note: exerciseFlags.note,
        status: exerciseFlags.status,
        createdAt: exerciseFlags.createdAt,
      })
      .from(exerciseFlags)
      .innerJoin(userExerciseHistory, eq(exerciseFlags.historyId, userExerciseHistory.id))
      .where(eq(userExerciseHistory.sessionId, sessionId)),
  ]);

  const historyByExercise = new Map(historyRows.map((h) => [h.exerciseId, h]));
  const errorsByExercise = new Map<string, typeof errorRows>();
  for (const e of errorRows) {
    const list = errorsByExercise.get(e.exerciseId) ?? [];
    list.push(e);
    errorsByExercise.set(e.exerciseId, list);
  }
  const flagByExercise = new Map(flagRows.map((f) => [f.exerciseId, f]));

  // Preserve session.exerciseIds order; fall back to any history rows not in the array.
  const orderedIds = [
    ...session.exerciseIds,
    ...historyRows.map((h) => h.exerciseId).filter((id) => !session.exerciseIds.includes(id)),
  ];

  const exercisesOut = orderedIds.map((exerciseId, order) => {
    const h = historyByExercise.get(exerciseId);
    const flag = flagByExercise.get(exerciseId);
    return {
      exerciseId,
      order,
      type: h?.type ?? null,
      content: h?.content ?? null,
      score: h?.score ?? null,
      response: h?.response ?? null,
      evaluatedAt: h ? toIso(h.evaluatedAt as Date | string | null) : null,
      errors: (errorsByExercise.get(exerciseId) ?? []).map((e) => ({
        errorType: e.errorType, severity: e.severity, wrongText: e.wrongText,
        correction: e.correction, errorGrammarPointKey: e.errorGrammarPointKey,
      })),
      flag: flag
        ? { category: flag.category, note: flag.note, status: flag.status, createdAt: toIso(flag.createdAt as Date | string)! }
        : null,
    };
  });

  return c.json({
    session: {
      sessionId: session.sessionId, userId: session.userId, language: session.language,
      difficulty: session.difficulty, exerciseCount: session.exerciseCount,
      correctCount: session.correctCount, startedAt: toIso(session.startedAt)!,
      completedAt: toIso(session.completedAt),
    },
    exercises: exercisesOut,
  });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @language-drill/lambda test -- admin.test.ts -t "admin/activity/sessions/:id"`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/routes/admin.ts infra/lambda/src/routes/admin.test.ts
git commit -m "feat(admin): session-detail drill-down endpoint

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: api-client — session schemas + hooks

**Files:**
- Create: `packages/api-client/src/schemas/admin-activity.ts`
- Create: `packages/api-client/src/schemas/admin-activity.test.ts`
- Create: `packages/api-client/src/hooks/useActivitySessions.ts`
- Create: `packages/api-client/src/hooks/useActivitySessionDetail.ts`
- Modify: `packages/api-client/src/index.ts`

**Interfaces:**
- Consumes: response shapes from Tasks 1–2.
- Produces: `useActivitySessions({ fetchFn, params, enabled })`, `useActivitySessionDetail({ fetchFn, sessionId, enabled })`, and types `ActivitySessionListItem`, `ActivitySessionDetail`.

- [ ] **Step 1: Write the failing schema test**

Create `packages/api-client/src/schemas/admin-activity.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { ActivitySessionListItemSchema, ActivitySessionDetailSchema } from './admin-activity';

describe('ActivitySessionListItemSchema', () => {
  it('parses a feed row', () => {
    const parsed = ActivitySessionListItemSchema.parse({
      sessionId: 's1', userId: 'u1', language: 'TR', difficulty: 'A2',
      exerciseCount: 8, correctCount: 2, completedAt: null, startedAt: '2026-06-22T09:00:00Z',
      signals: ['abandoned'], primarySignal: 'abandoned',
    });
    expect(parsed.primarySignal).toBe('abandoned');
  });
});

describe('ActivitySessionDetailSchema', () => {
  it('parses a detail payload with raw response passthrough', () => {
    const parsed = ActivitySessionDetailSchema.parse({
      session: { sessionId: 's1', userId: 'u1', language: 'TR', difficulty: 'A2',
        exerciseCount: 1, correctCount: 0, startedAt: '2026-06-22T09:00:00Z', completedAt: null },
      exercises: [{ exerciseId: 'e1', order: 0, type: 'cloze', content: { p: 1 }, score: 0.2,
        response: { anything: true }, evaluatedAt: '2026-06-22T09:05:00Z',
        errors: [{ errorType: 'grammar', severity: 'major', wrongText: 'x', correction: 'X', errorGrammarPointKey: null }],
        flag: null }],
    });
    expect(parsed.exercises[0].response).toEqual({ anything: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/api-client test -- admin-activity`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the schemas**

Create `packages/api-client/src/schemas/admin-activity.ts`:

```typescript
import { z } from 'zod';

const SignalSchema = z.enum(['flagged', 'abandoned', 'low_score']);

export const ActivitySessionListItemSchema = z.object({
  sessionId: z.string(),
  userId: z.string(),
  language: z.string(),
  difficulty: z.string(),
  exerciseCount: z.number(),
  correctCount: z.number(),
  completedAt: z.string().nullable(),
  startedAt: z.string(),
  signals: SignalSchema.array(),
  primarySignal: SignalSchema,
});
export type ActivitySessionListItem = z.infer<typeof ActivitySessionListItemSchema>;

const SessionDetailExerciseSchema = z.object({
  exerciseId: z.string(),
  order: z.number(),
  type: z.string().nullable(),
  content: z.unknown(),
  score: z.number().nullable(),
  response: z.unknown(),
  evaluatedAt: z.string().nullable(),
  errors: z
    .object({
      errorType: z.string(),
      severity: z.string(),
      wrongText: z.string(),
      correction: z.string(),
      errorGrammarPointKey: z.string().nullable(),
    })
    .array(),
  flag: z
    .object({ category: z.string(), note: z.string().nullable(), status: z.string(), createdAt: z.string() })
    .nullable(),
});

export const ActivitySessionDetailSchema = z.object({
  session: z.object({
    sessionId: z.string(),
    userId: z.string(),
    language: z.string(),
    difficulty: z.string(),
    exerciseCount: z.number(),
    correctCount: z.number(),
    startedAt: z.string(),
    completedAt: z.string().nullable(),
  }),
  exercises: SessionDetailExerciseSchema.array(),
});
export type ActivitySessionDetail = z.infer<typeof ActivitySessionDetailSchema>;
```

- [ ] **Step 4: Run schema test to verify it passes**

Run: `pnpm --filter @language-drill/api-client test -- admin-activity`
Expected: PASS.

- [ ] **Step 5: Write the hooks**

Create `packages/api-client/src/hooks/useActivitySessions.ts`:

```typescript
import { useQuery } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../fetchClient';
import { buildQueryString } from '../lib/build-query-string';
import { ActivitySessionListItemSchema } from '../schemas/admin-activity';

export type ActivitySessionsParams = {
  language?: string;
  userId?: string;
  all?: boolean;
  limit?: number;
  offset?: number;
};

export function useActivitySessions({
  fetchFn, params = {}, enabled = true,
}: { fetchFn: AuthenticatedFetch; params?: ActivitySessionsParams; enabled?: boolean }) {
  return useQuery({
    queryKey: ['admin', 'activity', 'sessions', params],
    queryFn: async () => {
      const qs = buildQueryString({
        language: params.language,
        userId: params.userId,
        all: params.all ? 'true' : undefined,
        limit: params.limit,
        offset: params.offset,
      });
      const res = await fetchFn(`/admin/activity/sessions${qs}`);
      const json: unknown = await res.json();
      return ActivitySessionListItemSchema.array().parse(json);
    },
    enabled,
  });
}
```

Create `packages/api-client/src/hooks/useActivitySessionDetail.ts`:

```typescript
import { useQuery } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../fetchClient';
import { ActivitySessionDetailSchema } from '../schemas/admin-activity';

export function useActivitySessionDetail({
  fetchFn, sessionId, enabled = true,
}: { fetchFn: AuthenticatedFetch; sessionId: string | null; enabled?: boolean }) {
  return useQuery({
    queryKey: ['admin', 'activity', 'session', sessionId],
    queryFn: async () => {
      const res = await fetchFn(`/admin/activity/sessions/${sessionId!}`);
      const json: unknown = await res.json();
      return ActivitySessionDetailSchema.parse(json);
    },
    enabled: enabled && !!sessionId,
  });
}
```

- [ ] **Step 6: Add barrel exports**

In `packages/api-client/src/index.ts`, add near the other admin schema/hook exports (around line 394):

```typescript
export {
  ActivitySessionListItemSchema, type ActivitySessionListItem,
  ActivitySessionDetailSchema, type ActivitySessionDetail,
} from './schemas/admin-activity';
export { useActivitySessions, type ActivitySessionsParams } from './hooks/useActivitySessions';
export { useActivitySessionDetail } from './hooks/useActivitySessionDetail';
```

- [ ] **Step 7: Run package typecheck + tests**

Run: `pnpm --filter @language-drill/api-client typecheck && pnpm --filter @language-drill/api-client test -- admin-activity`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/api-client/src/schemas/admin-activity.ts packages/api-client/src/schemas/admin-activity.test.ts packages/api-client/src/hooks/useActivitySessions.ts packages/api-client/src/hooks/useActivitySessionDetail.ts packages/api-client/src/index.ts
git commit -m "feat(api-client): activity session schemas + hooks

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Web — `/admin/activity` page, Sessions tab + nav

**Files:**
- Create: `apps/web/app/(admin)/admin/activity/page.tsx`
- Create: `apps/web/app/(admin)/admin/activity/__tests__/page.test.tsx`
- Modify: `apps/web/components/admin/admin-nav-items.tsx`

**Interfaces:**
- Consumes: `useActivitySessions`, `useActivitySessionDetail`, `createAuthenticatedFetch`.
- Produces: a client page with a `Tab = 'sessions' | 'failures' | 'roster'` state (Failures/Roster are empty placeholders filled in Tasks 7 & 10).

- [ ] **Step 1: Add the nav entry**

In `apps/web/components/admin/admin-nav-items.tsx`, add to the `ADMIN_NAV` array (after `Usage & cost`):

```typescript
  { href: '/admin/activity', label: 'Activity' },
```

- [ ] **Step 2: Write the failing component test**

Create `apps/web/app/(admin)/admin/activity/__tests__/page.test.tsx`:

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ActivitySessionListItem } from '@language-drill/api-client';

vi.mock('@clerk/nextjs', () => ({ useAuth: () => ({ getToken: vi.fn() }) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('') }));

const mockSessions = vi.fn();
const mockDetail = vi.fn();

vi.mock('@language-drill/api-client', async () => {
  const actual = await vi.importActual<typeof import('@language-drill/api-client')>('@language-drill/api-client');
  return {
    ...actual,
    createAuthenticatedFetch: () => vi.fn(),
    useActivitySessions: (a: unknown) => mockSessions(a),
    useActivitySessionDetail: (a: unknown) => mockDetail(a),
  };
});

import ActivityPage from '../page';

const feed: ActivitySessionListItem[] = [
  { sessionId: 's-flag', userId: 'user_aaaaaaaa', language: 'ES', difficulty: 'B1',
    exerciseCount: 5, correctCount: 4, completedAt: '2026-06-22T11:00:00Z',
    startedAt: '2026-06-22T10:55:00Z', signals: ['flagged'], primarySignal: 'flagged' },
];

beforeEach(() => {
  mockSessions.mockReturnValue({ isLoading: false, isError: false, data: feed });
  mockDetail.mockReturnValue({ isLoading: false, isError: false, data: undefined });
});

describe('ActivityPage — Sessions tab', () => {
  it('renders the feed with a problem badge', () => {
    render(<ActivityPage />);
    expect(screen.getByRole('heading', { name: 'Activity' })).toBeInTheDocument();
    expect(screen.getByText(/flagged/i)).toBeInTheDocument();
    expect(screen.getByText(/4\s*\/\s*5/)).toBeInTheDocument();
  });

  it('selects a session on row click and requests its detail', () => {
    render(<ActivityPage />);
    fireEvent.click(screen.getByRole('button', { name: /s-flag/i }));
    // Detail hook called with the clicked sessionId
    expect(mockDetail).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's-flag' }));
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @language-drill/web test -- activity`
Expected: FAIL (page module not found).

- [ ] **Step 4: Write the page**

Create `apps/web/app/(admin)/admin/activity/page.tsx`. Mirror the `pool/page.tsx` structure (client component, `Suspense` wrapper, `createAuthenticatedFetch`). The Langfuse deep-link uses `process.env.NEXT_PUBLIC_LANGFUSE_TRACE_URL_TEMPLATE` (hidden when unset).

```typescript
'use client';

import { Suspense, useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import {
  createAuthenticatedFetch,
  useActivitySessions,
  useActivitySessionDetail,
} from '@language-drill/api-client';

type Tab = 'sessions' | 'failures' | 'roster';

function SignalBadge({ signal }: { signal: string }) {
  const label = signal === 'low_score' ? 'low score' : signal;
  return <span className="inline-block px-s-2 py-px rounded-sm text-[11px] bg-paper-2 text-ink-soft">{label}</span>;
}

function SessionsTab() {
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  const [showAll, setShowAll] = useState(false);
  const [userId, setUserId] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const sessions = useActivitySessions({
    fetchFn,
    params: { all: showAll, userId: userId || undefined },
  });
  const detail = useActivitySessionDetail({ fetchFn, sessionId: selected });

  return (
    <div className="flex flex-col gap-s-4">
      <div className="flex items-center gap-s-3">
        <label className="flex items-center gap-s-2 text-[13px]">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          show all recent
        </label>
        <input
          aria-label="user id"
          placeholder="filter by user id"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          className="px-s-2 py-s-1 border border-line rounded-sm text-[13px]"
        />
      </div>

      {sessions.isLoading && <div className="text-ink-soft text-[13px]">Loading…</div>}
      {sessions.isError && <div className="text-danger text-[13px]">Failed to load sessions.</div>}

      <ul className="flex flex-col gap-s-1 list-none p-0 m-0">
        {(sessions.data ?? []).map((s) => (
          <li key={s.sessionId}>
            <button
              onClick={() => setSelected(s.sessionId)}
              className="w-full flex items-center gap-s-3 text-left px-s-3 py-s-2 rounded-sm hover:bg-paper-2"
            >
              <span className="flex gap-s-1">{s.signals.map((sig) => <SignalBadge key={sig} signal={sig} />)}</span>
              <span className="font-mono text-[12px] text-ink-soft">{s.userId.slice(0, 12)}…</span>
              <span className="text-[12px]">{s.language}·{s.difficulty}</span>
              <span className="text-[12px] text-ink-soft">
                {s.completedAt ? `${s.correctCount} / ${s.exerciseCount}` : 'abandoned'}
              </span>
              <span className="ml-auto font-mono text-[11px] text-ink-soft">{s.sessionId.slice(0, 8)}</span>
            </button>
          </li>
        ))}
      </ul>

      {selected && (
        <SessionDetail detail={detail.data} loading={detail.isLoading} error={detail.isError} />
      )}
    </div>
  );
}

function SessionDetail({
  detail, loading, error,
}: {
  detail: ReturnType<typeof useActivitySessionDetail>['data'];
  loading: boolean;
  error: boolean;
}) {
  const template = process.env.NEXT_PUBLIC_LANGFUSE_TRACE_URL_TEMPLATE;
  if (loading) return <div className="text-ink-soft text-[13px]">Loading session…</div>;
  if (error) return <div className="text-danger text-[13px]">Failed to load session.</div>;
  if (!detail) return null;
  return (
    <div className="flex flex-col gap-s-3 border-t border-line pt-s-3">
      {detail.exercises.map((ex) => (
        <div key={ex.exerciseId} className="flex flex-col gap-s-1 border border-line rounded-sm p-s-3">
          <div className="flex items-center gap-s-2 text-[12px]">
            <span className="font-mono text-ink-soft">#{ex.order + 1}</span>
            <span>{ex.type}</span>
            <span className="text-ink-soft">score: {ex.score ?? '—'}</span>
            {ex.flag && <SignalBadge signal="flagged" />}
            {template && (
              <a className="ml-auto text-[11px] underline" href={template.replace('{cellKey}', ex.exerciseId)} target="_blank" rel="noreferrer">
                Langfuse
              </a>
            )}
          </div>
          <pre className="text-[11px] bg-paper-2 rounded-sm p-s-2 overflow-x-auto">{JSON.stringify(ex.response, null, 2)}</pre>
          {ex.errors.length > 0 && (
            <ul className="text-[11px] list-none p-0 m-0">
              {ex.errors.map((e, i) => (
                <li key={i}>
                  <span className="text-danger">{e.wrongText}</span> → <span className="text-success">{e.correction}</span>
                  <span className="text-ink-soft"> ({e.errorType}/{e.severity})</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

function ActivityPageInner() {
  const [tab, setTab] = useState<Tab>('sessions');
  return (
    <div className="p-s-6 flex flex-col gap-s-5">
      <h1 className="text-h3 m-0">Activity</h1>
      <div className="flex gap-s-2">
        {(['sessions', 'failures', 'roster'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            aria-current={tab === t ? 'page' : undefined}
            className={tab === t ? 'px-s-3 py-s-1 rounded-sm bg-ink text-paper text-[13px]' : 'px-s-3 py-s-1 rounded-sm text-ink-soft text-[13px]'}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === 'sessions' && <SessionsTab />}
      {tab === 'failures' && <div className="text-ink-soft text-[13px]">Failures — coming in Task 7.</div>}
      {tab === 'roster' && <div className="text-ink-soft text-[13px]">Roster — coming in Task 10.</div>}
    </div>
  );
}

export default function ActivityPage() {
  return (
    <Suspense fallback={<div className="p-s-6" />}>
      <ActivityPageInner />
    </Suspense>
  );
}
```

> Note: if any Tailwind token used above (`text-h3`, `text-danger`, `text-success`, `bg-paper-2`, `border-line`, `px-s-*`) is not defined in this app, substitute the nearest existing token by checking `pool/page.tsx` and `globals.css`. The test does not assert on classes.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @language-drill/web test -- activity`
Expected: PASS (2 tests).

- [ ] **Step 6: Run the admin-nav test (label change ripple)**

Run: `pnpm --filter @language-drill/web test -- admin-nav`
Expected: PASS (if a nav snapshot/list test exists it now includes "Activity"; update the expected list if it asserts exact entries).

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/\(admin\)/admin/activity apps/web/components/admin/admin-nav-items.tsx
git commit -m "feat(admin): activity page + sessions drill-down tab

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase 2 — View #3: Most-failed exercises

### Task 5: Lambda — `GET /admin/activity/failures`

**Files:**
- Modify: `infra/lambda/src/routes/admin.ts`
- Test: `infra/lambda/src/routes/admin.test.ts`

**Interfaces:**
- Produces (response JSON, array): `Array<{ exerciseId: string; language: string; difficulty: string; type: string; grammarPointKey: string | null; attempts: number; distinctUsers: number; failRate: number; avgScore: number; qualityScore: number | null; openFlags: number }>`

- [ ] **Step 1: Write the failing test**

The handler runs ONE aggregate query (joins history→exercises, LEFT JOINs an open-flag count). Stage one array:

```typescript
describe('GET /admin/activity/failures', () => {
  it('returns per-exercise failure aggregates', async () => {
    queryQueue.push([
      { exerciseId: 'e1', language: 'TR', difficulty: 'A2', type: 'cloze', grammarPointKey: 'tr-a2-x',
        attempts: 10, distinctUsers: 6, failCount: 7, avgScore: 0.31, qualityScore: 0.8, openFlags: 1 },
    ]);
    const res = await app.request('/admin/activity/failures', undefined, adminEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ exerciseId: string; failRate: number; distinctUsers: number }>;
    expect(body[0].exerciseId).toBe('e1');
    expect(body[0].failRate).toBeCloseTo(0.7);
    expect(body[0].distinctUsers).toBe(6);
  });

  it('rejects minAttempts below 1 with 400', async () => {
    const res = await app.request('/admin/activity/failures?minAttempts=0', undefined, adminEnv);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/lambda test -- admin.test.ts -t "admin/activity/failures"`
Expected: FAIL.

- [ ] **Step 3: Write the handler**

```typescript
const ActivityFailuresQuerySchema = z.object({
  language: z.enum(['ES', 'DE', 'TR']).optional(),
  level: z.enum(['A1', 'A2', 'B1', 'B2']).optional(),
  type: z.string().optional(),
  grammarPointKey: z.string().optional(),
  windowDays: z.coerce.number().int().min(1).max(365).optional(),
  minAttempts: z.coerce.number().int().min(1).max(1000).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

admin.get('/admin/activity/failures', async (c) => {
  const parsed = ActivityFailuresQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'Invalid query parameters', code: 'VALIDATION_ERROR', details: parsed.error.flatten() }, 400);
  }
  const { language, level, type, grammarPointKey, windowDays = 30, minAttempts = 5, limit = 50 } = parsed.data;

  const conditions: SQL[] = [
    gte(userExerciseHistory.evaluatedAt, sql`NOW() - (${windowDays}::text || ' days')::interval`),
  ];
  if (language) conditions.push(eq(exercises.language, language));
  if (level) conditions.push(eq(exercises.difficulty, level));
  if (type) conditions.push(eq(exercises.type, type));
  if (grammarPointKey) conditions.push(eq(exercises.grammarPointKey, grammarPointKey));

  const openFlags = sql<number>`(
    SELECT COUNT(*)::int FROM ${exerciseFlags} ef
    WHERE ef.exercise_id = ${exercises.id} AND ef.status = 'open'
  )`;

  const rows = (await db
    .select({
      exerciseId: exercises.id,
      language: exercises.language,
      difficulty: exercises.difficulty,
      type: exercises.type,
      grammarPointKey: exercises.grammarPointKey,
      qualityScore: exercises.qualityScore,
      attempts: sql<number>`COUNT(*)::int`,
      distinctUsers: sql<number>`COUNT(DISTINCT ${userExerciseHistory.userId})::int`,
      failCount: sql<number>`COUNT(*) FILTER (WHERE ${userExerciseHistory.score} < 0.5)::int`,
      avgScore: sql<number>`AVG(${userExerciseHistory.score})::float`,
      openFlags,
    })
    .from(userExerciseHistory)
    .innerJoin(exercises, eq(userExerciseHistory.exerciseId, exercises.id))
    .where(and(...conditions))
    .groupBy(exercises.id)
    .having(sql`COUNT(*) >= ${minAttempts}`)
    .orderBy(desc(sql`COUNT(*) FILTER (WHERE ${userExerciseHistory.score} < 0.5)`))
    .limit(limit)) as Array<{
      exerciseId: string; language: string; difficulty: string; type: string;
      grammarPointKey: string | null; qualityScore: number | null; attempts: number;
      distinctUsers: number; failCount: number; avgScore: number; openFlags: number;
    }>;

  const items = rows.map((r) => ({
    exerciseId: r.exerciseId,
    language: r.language,
    difficulty: r.difficulty,
    type: r.type,
    grammarPointKey: r.grammarPointKey,
    attempts: r.attempts,
    distinctUsers: r.distinctUsers,
    failRate: r.attempts > 0 ? r.failCount / r.attempts : 0,
    avgScore: r.avgScore ?? 0,
    qualityScore: r.qualityScore ?? null,
    openFlags: r.openFlags,
  }));
  return c.json(items);
});
```

> Verify `exercises.qualityScore` exists in the schema (it is referenced in the design). If the column name differs, adjust the projection. The reference extraction confirmed `exercises.qualityScore` (real, nullable).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @language-drill/lambda test -- admin.test.ts -t "admin/activity/failures"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/routes/admin.ts infra/lambda/src/routes/admin.test.ts
git commit -m "feat(admin): most-failed-exercises aggregate endpoint

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: api-client — failures schema + hook

**Files:**
- Modify: `packages/api-client/src/schemas/admin-activity.ts`
- Modify: `packages/api-client/src/schemas/admin-activity.test.ts`
- Create: `packages/api-client/src/hooks/useActivityFailures.ts`
- Modify: `packages/api-client/src/index.ts`

**Interfaces:**
- Produces: `useActivityFailures({ fetchFn, params, enabled })`, type `ActivityFailureItem`.

- [ ] **Step 1: Add a failing schema test**

Append to `admin-activity.test.ts`:

```typescript
import { ActivityFailureItemSchema } from './admin-activity';

describe('ActivityFailureItemSchema', () => {
  it('parses a failure row', () => {
    const parsed = ActivityFailureItemSchema.parse({
      exerciseId: 'e1', language: 'TR', difficulty: 'A2', type: 'cloze', grammarPointKey: 'tr-a2-x',
      attempts: 10, distinctUsers: 6, failRate: 0.7, avgScore: 0.31, qualityScore: 0.8, openFlags: 1,
    });
    expect(parsed.failRate).toBeCloseTo(0.7);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @language-drill/api-client test -- admin-activity`
Expected: FAIL (`ActivityFailureItemSchema` undefined).

- [ ] **Step 3: Add the schema**

Append to `packages/api-client/src/schemas/admin-activity.ts`:

```typescript
export const ActivityFailureItemSchema = z.object({
  exerciseId: z.string(),
  language: z.string(),
  difficulty: z.string(),
  type: z.string(),
  grammarPointKey: z.string().nullable(),
  attempts: z.number(),
  distinctUsers: z.number(),
  failRate: z.number(),
  avgScore: z.number(),
  qualityScore: z.number().nullable(),
  openFlags: z.number(),
});
export type ActivityFailureItem = z.infer<typeof ActivityFailureItemSchema>;
```

- [ ] **Step 4: Run schema test to verify it passes**

Run: `pnpm --filter @language-drill/api-client test -- admin-activity`
Expected: PASS.

- [ ] **Step 5: Write the hook**

Create `packages/api-client/src/hooks/useActivityFailures.ts`:

```typescript
import { useQuery } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../fetchClient';
import { buildQueryString } from '../lib/build-query-string';
import { ActivityFailureItemSchema } from '../schemas/admin-activity';

export type ActivityFailuresParams = {
  language?: string;
  level?: string;
  type?: string;
  grammarPointKey?: string;
  windowDays?: number;
  minAttempts?: number;
  limit?: number;
};

export function useActivityFailures({
  fetchFn, params = {}, enabled = true,
}: { fetchFn: AuthenticatedFetch; params?: ActivityFailuresParams; enabled?: boolean }) {
  return useQuery({
    queryKey: ['admin', 'activity', 'failures', params],
    queryFn: async () => {
      const res = await fetchFn(`/admin/activity/failures${buildQueryString({ ...params })}`);
      const json: unknown = await res.json();
      return ActivityFailureItemSchema.array().parse(json);
    },
    enabled,
  });
}
```

- [ ] **Step 6: Add barrel exports**

In `packages/api-client/src/index.ts`:

```typescript
export { ActivityFailureItemSchema, type ActivityFailureItem } from './schemas/admin-activity';
export { useActivityFailures, type ActivityFailuresParams } from './hooks/useActivityFailures';
```

- [ ] **Step 7: Run typecheck + tests; commit**

Run: `pnpm --filter @language-drill/api-client typecheck && pnpm --filter @language-drill/api-client test -- admin-activity`
Expected: PASS.

```bash
git add packages/api-client/src/schemas/admin-activity.ts packages/api-client/src/schemas/admin-activity.test.ts packages/api-client/src/hooks/useActivityFailures.ts packages/api-client/src/index.ts
git commit -m "feat(api-client): activity failures schema + hook

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Web — Failures tab

**Files:**
- Modify: `apps/web/app/(admin)/admin/activity/page.tsx`
- Modify: `apps/web/app/(admin)/admin/activity/__tests__/page.test.tsx`

**Interfaces:**
- Consumes: `useActivityFailures`, and the existing `useResolveContentExercise` mutation hook (already exported from api-client) for demote/reject.

- [ ] **Step 1: Add a failing test**

In `__tests__/page.test.tsx`, extend the api-client mock and add a test. Add to the mock factory: `useActivityFailures: (a: unknown) => mockFailures(a)`, `useResolveContentExercise: () => ({ mutate: resolveMutate, isPending: false })`; declare `const mockFailures = vi.fn();` and `const resolveMutate = vi.fn();` at top; in `beforeEach` add `mockFailures.mockReturnValue({ isLoading: false, isError: false, data: failRows });` with:

```typescript
const failRows = [{
  exerciseId: 'e1', language: 'TR', difficulty: 'A2', type: 'cloze', grammarPointKey: 'tr-a2-x',
  attempts: 10, distinctUsers: 6, failRate: 0.7, avgScore: 0.31, qualityScore: 0.8, openFlags: 1,
}];
```

Test:

```typescript
describe('ActivityPage — Failures tab', () => {
  it('shows failure rows with distinct-user count and a demote action', () => {
    render(<ActivityPage />);
    fireEvent.click(screen.getByRole('button', { name: 'failures' }));
    expect(screen.getByText(/tr-a2-x/)).toBeInTheDocument();
    expect(screen.getByText(/6 users/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /demote/i }));
    expect(resolveMutate).toHaveBeenCalledWith(expect.objectContaining({ id: 'e1', action: 'demote' }));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @language-drill/web test -- activity`
Expected: FAIL (failures tab is still the placeholder).

- [ ] **Step 3: Implement the FailuresTab**

In `page.tsx`, import `useActivityFailures, useResolveContentExercise`, add the component, and replace the `tab === 'failures'` placeholder with `<FailuresTab />`:

```typescript
function FailuresTab() {
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  const [filters, setFilters] = useState<{ language?: string; level?: string }>({});
  const failures = useActivityFailures({ fetchFn, params: filters });
  const resolve = useResolveContentExercise({ fetchFn });

  return (
    <div className="flex flex-col gap-s-3">
      {failures.isLoading && <div className="text-ink-soft text-[13px]">Loading…</div>}
      {failures.isError && <div className="text-danger text-[13px]">Failed to load failures.</div>}
      <table className="w-full text-[12px] border-collapse">
        <thead>
          <tr className="text-left text-ink-soft">
            <th className="py-s-1">exercise</th><th>fail rate</th><th>attempts</th>
            <th>users</th><th>avg</th><th>quality</th><th>flags</th><th></th>
          </tr>
        </thead>
        <tbody>
          {(failures.data ?? []).map((f) => (
            <tr key={f.exerciseId} className="border-t border-line">
              <td className="py-s-1">
                <span className="font-mono">{f.grammarPointKey ?? f.type}</span>{' '}
                <span className="text-ink-soft">{f.language}·{f.difficulty}</span>
              </td>
              <td>{Math.round(f.failRate * 100)}%</td>
              <td>{f.attempts}</td>
              <td>{f.distinctUsers} users</td>
              <td>{f.avgScore.toFixed(2)}</td>
              <td>{f.qualityScore == null ? '—' : f.qualityScore.toFixed(2)}</td>
              <td>{f.openFlags}</td>
              <td className="flex gap-s-1">
                <button
                  onClick={() => resolve.mutate({ id: f.exerciseId, action: 'demote' })}
                  className="px-s-2 py-px rounded-sm bg-paper-2 hover:bg-line"
                >demote</button>
                <button
                  onClick={() => resolve.mutate({ id: f.exerciseId, action: 'reject' })}
                  className="px-s-2 py-px rounded-sm bg-paper-2 hover:bg-line"
                >reject</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @language-drill/web test -- activity`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/\(admin\)/admin/activity
git commit -m "feat(admin): most-failed-exercises tab with demote/reject

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase 3 — View #1: Roster

### Task 8: Lambda — `GET /admin/activity/roster`

**Files:**
- Modify: `infra/lambda/src/routes/admin.ts`
- Test: `infra/lambda/src/routes/admin.test.ts`

**Interfaces:**
- Produces (response JSON, array): `Array<{ userId: string; lastActiveAt: string | null; sessions7d: number; sessions30d: number; drills7d: number; drills30d: number; languages: string[]; avgScore30d: number | null; aiEvents7d: number }>`

- [ ] **Step 1: Write the failing test**

The handler runs ONE aggregate query over `userExerciseHistory` LEFT-joined to per-user session/usage subqueries. Stage one array:

```typescript
describe('GET /admin/activity/roster', () => {
  it('returns per-user activity aggregates ordered by last active', async () => {
    queryQueue.push([
      { userId: 'u1', lastActiveAt: '2026-06-22T10:00:00Z', sessions7d: 3, sessions30d: 9,
        drills7d: 20, drills30d: 75, languages: ['TR', 'ES'], avgScore30d: 0.62, aiEvents7d: 21 },
    ]);
    const res = await app.request('/admin/activity/roster', undefined, adminEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ userId: string; drills7d: number; languages: string[] }>;
    expect(body[0].userId).toBe('u1');
    expect(body[0].drills7d).toBe(20);
    expect(body[0].languages).toEqual(['TR', 'ES']);
  });

  it('rejects an invalid limit with 400', async () => {
    const res = await app.request('/admin/activity/roster?limit=0', undefined, adminEnv);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/lambda test -- admin.test.ts -t "admin/activity/roster"`
Expected: FAIL.

- [ ] **Step 3: Write the handler**

Aggregate everything per user in a single query using `FILTER (WHERE ...)` windows and correlated subqueries for session/usage counts (keeps the mock harness to one `queryQueue` entry):

```typescript
const ActivityRosterQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

admin.get('/admin/activity/roster', async (c) => {
  const parsed = ActivityRosterQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'Invalid query parameters', code: 'VALIDATION_ERROR', details: parsed.error.flatten() }, 400);
  }
  const { limit = 100, offset = 0 } = parsed.data;

  const sessions7d = sql<number>`(SELECT COUNT(*)::int FROM ${practiceSessions} ps WHERE ps.user_id = ${userExerciseHistory.userId} AND ps.started_at >= NOW() - INTERVAL '7 days')`;
  const sessions30d = sql<number>`(SELECT COUNT(*)::int FROM ${practiceSessions} ps WHERE ps.user_id = ${userExerciseHistory.userId} AND ps.started_at >= NOW() - INTERVAL '30 days')`;
  const aiEvents7d = sql<number>`(SELECT COUNT(*)::int FROM ${usageEvents} ue WHERE ue.user_id = ${userExerciseHistory.userId} AND ue.created_at >= NOW() - INTERVAL '7 days')`;

  const rows = (await db
    .select({
      userId: userExerciseHistory.userId,
      lastActiveAt: sql<Date | null>`MAX(${userExerciseHistory.evaluatedAt})`,
      drills7d: sql<number>`COUNT(*) FILTER (WHERE ${userExerciseHistory.evaluatedAt} >= NOW() - INTERVAL '7 days')::int`,
      drills30d: sql<number>`COUNT(*) FILTER (WHERE ${userExerciseHistory.evaluatedAt} >= NOW() - INTERVAL '30 days')::int`,
      avgScore30d: sql<number | null>`AVG(${userExerciseHistory.score}) FILTER (WHERE ${userExerciseHistory.evaluatedAt} >= NOW() - INTERVAL '30 days')`,
      languages: sql<string[]>`COALESCE(ARRAY_AGG(DISTINCT ${exercises.language}) FILTER (WHERE ${exercises.language} IS NOT NULL), ARRAY[]::text[])`,
      sessions7d,
      sessions30d,
      aiEvents7d,
    })
    .from(userExerciseHistory)
    .leftJoin(exercises, eq(userExerciseHistory.exerciseId, exercises.id))
    .groupBy(userExerciseHistory.userId)
    .orderBy(desc(sql`MAX(${userExerciseHistory.evaluatedAt})`))
    .limit(limit)
    .offset(offset)) as Array<{
      userId: string | null; lastActiveAt: Date | string | null; drills7d: number; drills30d: number;
      avgScore30d: number | null; languages: string[]; sessions7d: number; sessions30d: number; aiEvents7d: number;
    }>;

  const items = rows
    .filter((r) => r.userId != null)
    .map((r) => ({
      userId: r.userId as string,
      lastActiveAt: toIso(r.lastActiveAt),
      sessions7d: r.sessions7d,
      sessions30d: r.sessions30d,
      drills7d: r.drills7d,
      drills30d: r.drills30d,
      languages: r.languages,
      avgScore30d: r.avgScore30d ?? null,
      aiEvents7d: r.aiEvents7d,
    }));
  return c.json(items);
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @language-drill/lambda test -- admin.test.ts -t "admin/activity/roster"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/routes/admin.ts infra/lambda/src/routes/admin.test.ts
git commit -m "feat(admin): user-activity roster endpoint

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: api-client — roster schema + hook

**Files:**
- Modify: `packages/api-client/src/schemas/admin-activity.ts`
- Modify: `packages/api-client/src/schemas/admin-activity.test.ts`
- Create: `packages/api-client/src/hooks/useActivityRoster.ts`
- Modify: `packages/api-client/src/index.ts`

**Interfaces:**
- Produces: `useActivityRoster({ fetchFn, params, enabled })`, type `ActivityRosterItem`.

- [ ] **Step 1: Add a failing schema test**

Append to `admin-activity.test.ts`:

```typescript
import { ActivityRosterItemSchema } from './admin-activity';

describe('ActivityRosterItemSchema', () => {
  it('parses a roster row', () => {
    const parsed = ActivityRosterItemSchema.parse({
      userId: 'u1', lastActiveAt: '2026-06-22T10:00:00Z', sessions7d: 3, sessions30d: 9,
      drills7d: 20, drills30d: 75, languages: ['TR'], avgScore30d: 0.62, aiEvents7d: 21,
    });
    expect(parsed.drills30d).toBe(75);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @language-drill/api-client test -- admin-activity`
Expected: FAIL.

- [ ] **Step 3: Add the schema**

Append to `packages/api-client/src/schemas/admin-activity.ts`:

```typescript
export const ActivityRosterItemSchema = z.object({
  userId: z.string(),
  lastActiveAt: z.string().nullable(),
  sessions7d: z.number(),
  sessions30d: z.number(),
  drills7d: z.number(),
  drills30d: z.number(),
  languages: z.string().array(),
  avgScore30d: z.number().nullable(),
  aiEvents7d: z.number(),
});
export type ActivityRosterItem = z.infer<typeof ActivityRosterItemSchema>;
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @language-drill/api-client test -- admin-activity`
Expected: PASS.

- [ ] **Step 5: Write the hook**

Create `packages/api-client/src/hooks/useActivityRoster.ts`:

```typescript
import { useQuery } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../fetchClient';
import { buildQueryString } from '../lib/build-query-string';
import { ActivityRosterItemSchema } from '../schemas/admin-activity';

export type ActivityRosterParams = { limit?: number; offset?: number };

export function useActivityRoster({
  fetchFn, params = {}, enabled = true,
}: { fetchFn: AuthenticatedFetch; params?: ActivityRosterParams; enabled?: boolean }) {
  return useQuery({
    queryKey: ['admin', 'activity', 'roster', params],
    queryFn: async () => {
      const res = await fetchFn(`/admin/activity/roster${buildQueryString({ ...params })}`);
      const json: unknown = await res.json();
      return ActivityRosterItemSchema.array().parse(json);
    },
    enabled,
  });
}
```

- [ ] **Step 6: Add barrel exports**

In `packages/api-client/src/index.ts`:

```typescript
export { ActivityRosterItemSchema, type ActivityRosterItem } from './schemas/admin-activity';
export { useActivityRoster, type ActivityRosterParams } from './hooks/useActivityRoster';
```

- [ ] **Step 7: Run typecheck + tests; commit**

Run: `pnpm --filter @language-drill/api-client typecheck && pnpm --filter @language-drill/api-client test -- admin-activity`
Expected: PASS.

```bash
git add packages/api-client/src/schemas/admin-activity.ts packages/api-client/src/schemas/admin-activity.test.ts packages/api-client/src/hooks/useActivityRoster.ts packages/api-client/src/index.ts
git commit -m "feat(api-client): activity roster schema + hook

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Web — Roster tab

**Files:**
- Modify: `apps/web/app/(admin)/admin/activity/page.tsx`
- Modify: `apps/web/app/(admin)/admin/activity/__tests__/page.test.tsx`

**Interfaces:**
- Consumes: `useActivityRoster`. Each row links into the Sessions tab scoped to that user (sets the shared `userId` filter + switches tab).

- [ ] **Step 1: Add a failing test**

Extend the api-client mock with `useActivityRoster: (a: unknown) => mockRoster(a)`; declare `const mockRoster = vi.fn();`; in `beforeEach` add `mockRoster.mockReturnValue({ isLoading: false, isError: false, data: rosterRows });` with:

```typescript
const rosterRows = [{
  userId: 'user_bbbbbbbb', lastActiveAt: '2026-06-22T10:00:00Z', sessions7d: 3, sessions30d: 9,
  drills7d: 20, drills30d: 75, languages: ['TR'], avgScore30d: 0.62, aiEvents7d: 21,
}];
```

Test:

```typescript
describe('ActivityPage — Roster tab', () => {
  it('lists users with drill counts', () => {
    render(<ActivityPage />);
    fireEvent.click(screen.getByRole('button', { name: 'roster' }));
    expect(screen.getByText(/user_bbbb/i)).toBeInTheDocument();
    expect(screen.getByText('75')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @language-drill/web test -- activity`
Expected: FAIL (roster is still the placeholder).

- [ ] **Step 3: Implement the RosterTab**

Lift the `userId` filter and `tab` setter so a roster row can deep-link into Sessions. In `ActivityPageInner`, hold shared state: `const [userFilter, setUserFilter] = useState('')`. Pass `userFilter/setUserFilter` into `SessionsTab` (replace its local `userId` state with these props) and a `goToUserSessions` callback into `RosterTab` that sets the filter and switches to the sessions tab. Add:

```typescript
function RosterTab({ onOpenUser }: { onOpenUser: (userId: string) => void }) {
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  const roster = useActivityRoster({ fetchFn });
  return (
    <div className="flex flex-col gap-s-3">
      {roster.isLoading && <div className="text-ink-soft text-[13px]">Loading…</div>}
      {roster.isError && <div className="text-danger text-[13px]">Failed to load roster.</div>}
      <table className="w-full text-[12px] border-collapse">
        <thead>
          <tr className="text-left text-ink-soft">
            <th className="py-s-1">user</th><th>last active</th><th>sessions 7/30d</th>
            <th>drills 7/30d</th><th>langs</th><th>avg 30d</th><th>ai 7d</th>
          </tr>
        </thead>
        <tbody>
          {(roster.data ?? []).map((u) => (
            <tr key={u.userId} className="border-t border-line">
              <td className="py-s-1">
                <button className="font-mono underline" onClick={() => onOpenUser(u.userId)}>
                  {u.userId.slice(0, 12)}…
                </button>
              </td>
              <td>{u.lastActiveAt ? u.lastActiveAt.slice(0, 10) : '—'}</td>
              <td>{u.sessions7d} / {u.sessions30d}</td>
              <td>{u.drills7d} / {u.drills30d}</td>
              <td>{u.languages.join(', ')}</td>
              <td>{u.avgScore30d == null ? '—' : u.avgScore30d.toFixed(2)}</td>
              <td>{u.aiEvents7d}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

Wire the placeholder: replace `tab === 'roster'` branch with `<RosterTab onOpenUser={(id) => { setUserFilter(id); setTab('sessions'); }} />`. Import `useActivityRoster`.

> The `{u.drills30d}` value `75` must render as a standalone cell so the test's `getByText('75')` matches. The combined `drills 7/30d` cell renders `20 / 75` — adjust the test to `getByText('20 / 75')` if a standalone `75` is ambiguous, OR keep drills30d in its own column. Choose the standalone-column option: render `<td>{u.drills7d}</td><td>{u.drills30d}</td>` with headers `drills 7d` / `drills 30d` so `getByText('75')` is unambiguous.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @language-drill/web test -- activity`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/\(admin\)/admin/activity
git commit -m "feat(admin): user-activity roster tab

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification (after Task 10)

- [ ] **Full gate from repo root:**

```bash
pnpm lint && pnpm typecheck && pnpm test
```

Expected: zero failures. If `infra/lambda/dist/**` produces phantom test failures, `rm -rf infra/lambda/dist` and re-run (known stale-dist issue).

- [ ] **Manual smoke (optional, requires local stack + a populated dev DB):** `pnpm dev`, sign in as an admin user (in `ADMIN_USER_IDS`), visit `/admin/activity`, confirm the three tabs load.

---

## Self-Review Notes (author)

- **Spec coverage:** #2 feed (Task 1) + detail (Task 2) + UI (Task 4); #3 endpoint (Task 5) + UI w/ reused moderation (Task 7); #1 endpoint (Task 8) + UI (Task 10). Shared infra (nav, page shell) in Task 4. PII gating inherited from `adminMiddleware` (Global Constraints). Langfuse deep-link in Task 4. False-positive guards (distinctUsers, minAttempts) in Tasks 5/7. ✓ All spec sections mapped.
- **Type consistency:** `toIso` defined once (Task 1), reused (Tasks 2, 8). Hook/param/type names match between api-client tasks and web tasks. `useResolveContentExercise` reused (not redefined). Signal union `'flagged'|'abandoned'|'low_score'` consistent across lambda + schema + UI.
- **Known risk to verify during impl:** `exercises.qualityScore` column name (Task 5) — confirm against schema before relying on it. Tailwind tokens in web tasks — substitute per existing pages if any are undefined (tests don't assert classes).
