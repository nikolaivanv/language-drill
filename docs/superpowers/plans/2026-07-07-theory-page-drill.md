# Drill from the Theory Detail Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user launch a targeted drill (mixed or single-mode) from a theory detail page for any grammar point at any CEFR level, with the exercise pool filtered at the point's own level.

**Architecture:** Three additive changes: (1) `POST /sessions` derives the session difficulty from the grammar-point key when one is present (server-side, fixes all entry points at once) and returns the difficulty it used; (2) a new authed `GET /progress/points/:grammarPointKey` endpoint returns per-type approved-exercise counts (mirroring the session filter exactly) plus the user's mastery row; (3) a new `DrillThisPoint` web component at the end of the theory article renders mastery + drill buttons only for modes that actually have exercises.

**Tech Stack:** Hono (Lambda), Drizzle, Zod + TanStack Query (api-client), Next.js App Router + React Testing Library (web), Vitest everywhere.

**Spec:** `docs/superpowers/specs/2026-07-07-theory-page-drill-design.md`

## Global Constraints

- No DB migrations; no prompt edits (so no `*_PROMPT_VERSION` bumps needed).
- API changes are additive only — existing clients keep working.
- Monorepo test commands: run per-package with `pnpm --filter <pkg> test`; full pre-push gate is `pnpm lint && pnpm typecheck && pnpm test` from the repo root.
- `rm -rf infra/lambda/dist` before running the full suite (stale compiled `dist/**/*.test.js` files cause phantom failures).
- Known mock hazard in `sessions.test.ts` / `progress.test.ts`: `beforeEach` uses `vi.clearAllMocks()` (not reset), so `mockResolvedValueOnce` / `mockImplementationOnce` values left unconsumed bleed into later tests. Every `...Once` stub a test queues must actually be consumed by that test.
- All new UI copy is lowercase (matches existing drawer copy: "drill this point", "mixed drill — adapts to your weak spots", "or pick one mode").

---

### Task 1: Server — derive session difficulty from the grammar-point key

**Files:**
- Modify: `infra/lambda/src/routes/sessions.ts` (schema block ~line 62, handler ~line 91, `insertSessionAndBuildManifest` ~line 306)
- Test: `infra/lambda/src/routes/sessions.test.ts`

**Interfaces:**
- Consumes: `getGrammarPoint(key)` from `@language-drill/db` (already imported in sessions.ts line 13); `CefrLevel` from `@language-drill/shared`.
- Produces: exported `resolveSessionDifficulty(requested: CefrLevel, grammarPointKey: string | undefined): CefrLevel`; `POST /sessions` response gains a top-level `difficulty: string` field (Task 3's client schema and Task 6's page depend on this).

- [ ] **Step 1: Write the failing tests**

In `infra/lambda/src/routes/sessions.test.ts`:

(a) Route `getGrammarPoint` through a vi.fn so tests can stub it. Replace the current static mock entry (line ~137-139):

```ts
  // getGrammarPoint is a pure in-memory function — return undefined for unknown
  // keys so prereqsOf yields [] and the prereq penalty doesn't fire in tests.
  getGrammarPoint: (_key: string) => undefined,
```

with a delegate (and declare the vi.fn ABOVE the `vi.mock('@language-drill/db', ...)` call, next to the other mock declarations around line 46):

```ts
// Default: unknown key (prereqsOf yields [], no difficulty derivation). Tests
// stub curriculum hits via mockImplementationOnce — the Once form only, so
// nothing bleeds past vi.clearAllMocks() into later tests.
const mockGetGrammarPoint = vi.fn((_key: string): unknown => undefined);
```

and inside the `vi.mock('@language-drill/db', ...)` factory:

```ts
  getGrammarPoint: (key: string) => mockGetGrammarPoint(key),
```

(b) Update the top-of-file import (line 3) to include the new helper:

```ts
import { CreateSessionRequestSchema, levelsAtOrBelow, resolveSessionDifficulty } from './sessions';
```

(c) Add a unit-test describe block after the `levelsAtOrBelow` describe:

```ts
describe('resolveSessionDifficulty', () => {
  it('returns the requested difficulty when no grammarPointKey is given', () => {
    expect(resolveSessionDifficulty(CefrLevel.B1, undefined)).toBe(CefrLevel.B1);
  });

  it('returns the requested difficulty for a key not in the curriculum', () => {
    // mockGetGrammarPoint default → undefined
    expect(resolveSessionDifficulty(CefrLevel.B1, 'es-zz-not-real')).toBe(CefrLevel.B1);
  });

  it("returns the point's own level for a curriculum key", () => {
    mockGetGrammarPoint.mockImplementationOnce(() => ({
      key: 'es-a2-ser-vs-estar',
      cefrLevel: CefrLevel.A2,
    }));
    expect(resolveSessionDifficulty(CefrLevel.B1, 'es-a2-ser-vs-estar')).toBe(CefrLevel.A2);
  });
});
```

(d) Add two route tests inside the existing `describe('POST /sessions', ...)` block (they reuse its `app`/`authEnv`/`beforeEach`). Query-queue map for the targeted path: `buildRankContext` consumes two `mockSelectAwait` results (mastery await, errors groupBy); the targeted over-fetch consumes one `mockLimit` result (`.orderBy().limit()`); the insert consumes one `mockReturning` result. When the targeted pull already satisfies `exerciseCount`, no top-up query runs.

```ts
  function targetedRow(id: string, difficulty: string) {
    return {
      id,
      type: 'cloze',
      language: 'ES',
      difficulty,
      grammarPointKey: 'es-a2-ser-vs-estar',
      contentJson: { sentence: `___ ${id}`, options: ['a', 'b'] },
      audioS3Key: null,
      createdAt: new Date(),
    };
  }

  it('targeted: derives the session difficulty from the grammar-point key (B1 request → A2 session)', async () => {
    // resolveSessionDifficulty is the FIRST getGrammarPoint call in the request;
    // later prereqsOf calls fall through to the undefined default.
    mockGetGrammarPoint.mockImplementationOnce(() => ({
      key: 'es-a2-ser-vs-estar',
      cefrLevel: 'A2',
      prerequisiteKeys: [],
    }));
    // buildRankContext: mastery + errors → empty
    mockSelectAwait.mockResolvedValueOnce([]);
    mockSelectAwait.mockResolvedValueOnce([]);
    // Targeted over-fetch satisfies the request outright (5 ≥ exerciseCount) → no top-up pull.
    mockLimit.mockResolvedValueOnce(
      ['t1', 't2', 't3', 't4', 't5'].map((id) => targetedRow(id, 'A2')),
    );
    mockReturning.mockResolvedValueOnce([{ id: 'session-uuid-targeted' }]);

    const res = await app.request(
      '/sessions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          language: 'ES',
          difficulty: 'B1',
          exerciseCount: 5,
          grammarPointKey: 'es-a2-ser-vs-estar',
        }),
      },
      authEnv,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.id).toBe('session-uuid-targeted');
    // The response reports the difficulty the session was ACTUALLY created at.
    expect(body.difficulty).toBe('A2');
    // The persisted session row stores the derived difficulty, not the request's B1.
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({ difficulty: 'A2' }),
    );
  });

  it('targeted: keeps the requested difficulty when the key is not in the curriculum', async () => {
    // mockGetGrammarPoint default → undefined (no curriculum hit)
    mockSelectAwait.mockResolvedValueOnce([]);
    mockSelectAwait.mockResolvedValueOnce([]);
    mockLimit.mockResolvedValueOnce(
      ['t1', 't2', 't3', 't4', 't5'].map((id) => targetedRow(id, 'B1')),
    );
    mockReturning.mockResolvedValueOnce([{ id: 'session-uuid-passthrough' }]);

    const res = await app.request(
      '/sessions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          language: 'ES',
          difficulty: 'B1',
          exerciseCount: 5,
          grammarPointKey: 'es-a2-ser-vs-estar',
        }),
      },
      authEnv,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.difficulty).toBe('B1');
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({ difficulty: 'B1' }),
    );
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @language-drill/lambda test -- src/routes/sessions.test.ts`
Expected: FAIL — `resolveSessionDifficulty` is not exported (SyntaxError/undefined import), and the two route tests fail on `body.difficulty` being `undefined`.

- [ ] **Step 3: Implement**

In `infra/lambda/src/routes/sessions.ts`:

(a) Add the helper directly below `CreateSessionRequestSchema` (after line 62):

```ts
/**
 * Effective difficulty for a session. A targeted drill must filter the pool at
 * the grammar point's OWN CEFR level (the key encodes it: `es-a2-…` → A2) —
 * the client sends the profile level, which can differ when the drill is
 * launched from a cross-level surface (theory detail page, /progress
 * next-level preview). Unknown keys keep the requested difficulty, so a stale
 * or malformed key degrades to today's behavior instead of a new 4xx.
 */
export function resolveSessionDifficulty(
  requested: CefrLevel,
  grammarPointKey: string | undefined,
): CefrLevel {
  if (!grammarPointKey) return requested;
  return getGrammarPoint(grammarPointKey)?.cefrLevel ?? requested;
}
```

(b) In the `POST /sessions` handler, replace line 91:

```ts
  const { language, difficulty, exerciseCount, exerciseType, grammarPointKey } = bodyResult.data;
```

with:

```ts
  const { language, exerciseCount, exerciseType, grammarPointKey } = bodyResult.data;
  const difficulty = resolveSessionDifficulty(bodyResult.data.difficulty, grammarPointKey);
```

(c) In `insertSessionAndBuildManifest` (~line 306), include the difficulty in the return value so the client can reflect the level the session was actually created at:

```ts
  return { id: inserted[0].id, difficulty, exercises };
```

(Both POST paths — structured and targeted/flat — end in this function, so the response field is always present.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @language-drill/lambda test -- src/routes/sessions.test.ts`
Expected: PASS — all pre-existing tests (untargeted path never calls `getGrammarPoint` with a key, so the delegate default preserves behavior) plus the 5 new ones.

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/routes/sessions.ts infra/lambda/src/routes/sessions.test.ts
git commit -m "feat(sessions): derive targeted-drill difficulty from the grammar-point key"
```

---

### Task 2: Server — GET /progress/points/:grammarPointKey (counts + mastery)

**Files:**
- Modify: `infra/lambda/src/routes/progress.ts` (add route after `GET /progress/curriculum`, ~line 272)
- Test: `infra/lambda/src/routes/progress.test.ts`

**Interfaces:**
- Consumes: `getGrammarPoint(key)` (already imported); `approvedStatusFilter` / `audioReadyFilter` from `../lib/exercise-filters` (new import — these are the SAME predicates `POST /sessions` uses, which is what guarantees a shown button can't 422).
- Produces: `GET /progress/points/:key` → 200 `{ grammarPointKey: string, exerciseCounts: Record<string, number>, mastery: { masteryScore, confidence, evidenceCount, lastPracticedAt } | null }`; 404 `{ error, code: 'NOT_FOUND' }` for unknown keys; 401 unauthenticated (existing `/progress/*` middleware). Task 3's Zod schema mirrors this exactly.

- [ ] **Step 1: Write the failing tests**

In `infra/lambda/src/routes/progress.test.ts`:

(a) Extend the `exercises` table object inside the `vi.mock('@language-drill/db', ...)` factory (~line 130) with the columns the new route touches:

```ts
  exercises: {
    id: 'id',
    type: 'type',
    difficulty: 'difficulty',
    language: 'language',
    contentJson: 'content_json',
    grammarPointKey: 'grammar_point_key',
    reviewStatus: 'review_status',
    audioS3Key: 'audio_s3_key',
  },
```

(b) Add a new top-level describe at the end of the file. Query order inside the route's `Promise.all` is build-order: counts first (`.from().where().groupBy()`), mastery second (`.from().where().limit(1)`) — both terminate in `mockReviewWhere`, stubbed per-call via `mockImplementationOnce(() => makeChainResult(rows))`.

```ts
// ---------------------------------------------------------------------------
// GET /progress/points/:key
// ---------------------------------------------------------------------------

describe('GET /progress/points/:key', () => {
  let app: Hono;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('./progress');
    app = new Hono();
    app.route('/', mod.default);
  });

  it('returns 401 for unauthenticated requests', async () => {
    const res = await app.request(
      '/progress/points/tr-a2-possessive-case-stacking',
      undefined,
      unauthEnv,
    );
    expect(res.status).toBe(401);
  });

  it('returns 404 NOT_FOUND for a key not in the curriculum', async () => {
    const res = await app.request(
      '/progress/points/tr-b9-not-a-point',
      undefined,
      authEnv,
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as AnyJson;
    expect(body.code).toBe('NOT_FOUND');
  });

  it('returns per-type approved counts and the mastery snapshot', async () => {
    // Query 1: counts GROUP BY type
    mockReviewWhere.mockImplementationOnce(() =>
      makeChainResult([
        { type: 'cloze', n: 12 },
        { type: 'translation', n: 8 },
      ]),
    );
    // Query 2: mastery row
    mockReviewWhere.mockImplementationOnce(() =>
      makeChainResult([
        {
          masteryScore: 0.82,
          confidence: 0.9,
          evidenceCount: 10,
          lastPracticedAt: new Date('2026-07-01T00:00:00.000Z'),
        },
      ]),
    );

    const res = await app.request(
      '/progress/points/tr-a2-possessive-case-stacking',
      undefined,
      authEnv,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body).toEqual({
      grammarPointKey: 'tr-a2-possessive-case-stacking',
      exerciseCounts: { cloze: 12, translation: 8 },
      mastery: {
        masteryScore: 0.82,
        confidence: 0.9,
        evidenceCount: 10,
        lastPracticedAt: '2026-07-01T00:00:00.000Z',
      },
    });
  });

  it('returns empty counts and mastery: null for a never-practiced point with no pool', async () => {
    mockReviewWhere.mockImplementationOnce(() => makeChainResult([]));
    mockReviewWhere.mockImplementationOnce(() => makeChainResult([]));

    const res = await app.request(
      '/progress/points/tr-a1-vowel-harmony',
      undefined,
      authEnv,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.exerciseCounts).toEqual({});
    expect(body.mastery).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @language-drill/lambda test -- src/routes/progress.test.ts`
Expected: FAIL — the four new tests get 404s (route missing) / wrong bodies; all pre-existing radar + curriculum tests still PASS.

- [ ] **Step 3: Implement the route**

In `infra/lambda/src/routes/progress.ts`:

(a) Add to the imports:

```ts
import { approvedStatusFilter, audioReadyFilter } from '../lib/exercise-filters';
```

(b) Add the route after the `GET /progress/curriculum` handler (before `export default progress;`):

```ts
// ---------------------------------------------------------------------------
// GET /progress/points/:key — targeted-drill facts for ONE grammar point,
// regardless of the user's active level. Consumed by the theory detail page's
// "drill this point" block. `exerciseCounts` applies the exact same filters as
// POST /sessions' pool pull (approved + audio-ready + the point's OWN level),
// so a mode rendered from these counts can never 422 with
// INSUFFICIENT_EXERCISES on launch.
// ---------------------------------------------------------------------------
progress.get('/progress/points/:key', async (c) => {
  const key = c.req.param('key');
  const point = getGrammarPoint(key);
  if (!point) {
    return c.json({ error: 'Unknown grammar point', code: 'NOT_FOUND' }, 404);
  }
  const userId = c.get('userId');

  const [countRows, masteryRows] = await Promise.all([
    db
      .select({ type: exercises.type, n: sql<number>`count(*)::int` })
      .from(exercises)
      .where(
        and(
          eq(exercises.language, point.language),
          eq(exercises.difficulty, point.cefrLevel),
          eq(exercises.grammarPointKey, key),
          approvedStatusFilter(exercises),
          audioReadyFilter(exercises),
        ),
      )
      .groupBy(exercises.type),
    db
      .select({
        masteryScore: userGrammarMastery.masteryScore,
        confidence: userGrammarMastery.confidence,
        evidenceCount: userGrammarMastery.evidenceCount,
        lastPracticedAt: userGrammarMastery.lastPracticedAt,
      })
      .from(userGrammarMastery)
      .where(
        and(
          eq(userGrammarMastery.userId, userId),
          eq(userGrammarMastery.grammarPointKey, key),
        ),
      )
      .limit(1),
  ]);

  const exerciseCounts: Record<string, number> = {};
  for (const r of countRows) {
    if (r.type) exerciseCounts[r.type] = Number(r.n);
  }

  const m = masteryRows[0];
  return c.json({
    grammarPointKey: key,
    exerciseCounts,
    mastery: m
      ? {
          masteryScore: m.masteryScore,
          confidence: m.confidence,
          evidenceCount: m.evidenceCount,
          lastPracticedAt: m.lastPracticedAt,
        }
      : null,
  });
});
```

(`c.json` serializes the `Date` in `lastPracticedAt` to an ISO string via `JSON.stringify`.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @language-drill/lambda test -- src/routes/progress.test.ts`
Expected: PASS (all pre-existing + 4 new).

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/routes/progress.ts infra/lambda/src/routes/progress.test.ts
git commit -m "feat(progress): GET /progress/points/:key — per-type exercise counts + mastery for one grammar point"
```

---

### Task 3: api-client — response schemas + usePointDrillInfo hook

**Files:**
- Modify: `packages/api-client/src/schemas/session.ts` (CreateSessionResponseSchema)
- Modify: `packages/api-client/src/schemas/progress.ts` (append)
- Create: `packages/api-client/src/hooks/usePointDrillInfo.ts`
- Create: `packages/api-client/src/hooks/usePointDrillInfo.test.ts`
- Modify: `packages/api-client/src/index.ts` (exports)
- Possibly modify: `packages/api-client/src/schemas/session.test.ts`, `packages/api-client/src/hooks/useSession.test.ts` (fixtures gaining the required `difficulty` field)

**Interfaces:**
- Consumes: Task 1's `POST /sessions` response `difficulty` field; Task 2's `GET /progress/points/:key` shape.
- Produces (Tasks 4–6 depend on these exact names):
  - `CreateSessionResponse` gains `difficulty: CefrLevel`.
  - `PointDrillInfoResponseSchema` / `type PointDrillInfoResponse = { grammarPointKey: string; exerciseCounts: Record<string, number>; mastery: { masteryScore: number; confidence: number; evidenceCount: number; lastPracticedAt: string | null } | null }`.
  - `usePointDrillInfo({ fetchFn, grammarPointKey, enabled? }): UseQueryResult<PointDrillInfoResponse, Error>` with query key `['progress', 'point', grammarPointKey]`.

- [ ] **Step 1: Write the failing hook test**

Create `packages/api-client/src/hooks/usePointDrillInfo.test.ts` (mirrors `usePoolCell.test.ts`):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import type { AuthenticatedFetch } from '../fetchClient';
import { usePointDrillInfo } from './usePointDrillInfo';

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

function buildQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function buildWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

const DRILL_INFO = {
  grammarPointKey: 'es-a2-ser-vs-estar',
  exerciseCounts: { cloze: 12, translation: 8 },
  mastery: {
    masteryScore: 0.82,
    confidence: 0.9,
    evidenceCount: 10,
    lastPracticedAt: '2026-07-01T00:00:00.000Z',
  },
};

describe('usePointDrillInfo', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = buildQueryClient();
  });

  it('fetches /progress/points/:key and parses the response', async () => {
    const fetchFn = vi.fn<AuthenticatedFetch>().mockResolvedValue(jsonResponse(DRILL_INFO));

    const { result } = renderHook(
      () => usePointDrillInfo({ fetchFn, grammarPointKey: 'es-a2-ser-vs-estar' }),
      { wrapper: buildWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(DRILL_INFO);
    expect(fetchFn.mock.calls[0]?.[0]).toBe('/progress/points/es-a2-ser-vs-estar');
  });

  it('parses a never-practiced point (mastery: null, empty counts)', async () => {
    const fetchFn = vi.fn<AuthenticatedFetch>().mockResolvedValue(
      jsonResponse({ grammarPointKey: 'es-a1-noun-gender', exerciseCounts: {}, mastery: null }),
    );

    const { result } = renderHook(
      () => usePointDrillInfo({ fetchFn, grammarPointKey: 'es-a1-noun-gender' }),
      { wrapper: buildWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.mastery).toBeNull();
  });

  it('rejects a malformed payload (schema mismatch surfaces as query error)', async () => {
    const fetchFn = vi.fn<AuthenticatedFetch>().mockResolvedValue(
      jsonResponse({ topics: [] }),
    );

    const { result } = renderHook(
      () => usePointDrillInfo({ fetchFn, grammarPointKey: 'es-a2-ser-vs-estar' }),
      { wrapper: buildWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @language-drill/api-client test -- src/hooks/usePointDrillInfo.test.ts`
Expected: FAIL — cannot resolve `./usePointDrillInfo`.

- [ ] **Step 3: Implement schemas + hook + exports**

(a) Append to `packages/api-client/src/schemas/progress.ts`:

```ts
// ---------------------------------------------------------------------------
// GET /progress/points/:key response — targeted-drill facts for one grammar
// point (any CEFR level). `exerciseCounts` is keyed by ExerciseType string and
// only contains types that actually have approved, servable exercises at the
// point's own level.
// ---------------------------------------------------------------------------

export const PointMasterySnapshotSchema = z.object({
  masteryScore: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  evidenceCount: z.number().int().min(0),
  lastPracticedAt: z.string().nullable(),
});

export type PointMasterySnapshot = z.infer<typeof PointMasterySnapshotSchema>;

export const PointDrillInfoResponseSchema = z.object({
  grammarPointKey: z.string(),
  exerciseCounts: z.record(z.string(), z.number().int().min(0)),
  mastery: PointMasterySnapshotSchema.nullable(),
});

export type PointDrillInfoResponse = z.infer<typeof PointDrillInfoResponseSchema>;
```

(b) In `packages/api-client/src/schemas/session.ts`, add the difficulty the server actually used to `CreateSessionResponseSchema`:

```ts
// Response body for POST /sessions
export const CreateSessionResponseSchema = z.object({
  id: z.string().uuid(),
  // The difficulty the session was ACTUALLY created at. For a targeted drill
  // the server derives it from the grammar-point key (es-a2-… → A2), which can
  // differ from the requested (profile) difficulty.
  difficulty: z.nativeEnum(CefrLevel),
  exercises: z.array(ExerciseResponseSchema),
});
```

(c) Create `packages/api-client/src/hooks/usePointDrillInfo.ts`:

```ts
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { PointDrillInfoResponseSchema, type PointDrillInfoResponse } from '../schemas/progress';
import type { AuthenticatedFetch } from '../fetchClient';

const STALE_TIME_MS = 5 * 60 * 1000;

export type UsePointDrillInfoParams = {
  fetchFn: AuthenticatedFetch;
  grammarPointKey: string;
  enabled?: boolean;
};

/**
 * Targeted-drill facts for one grammar point (any CEFR level): per-type
 * approved-exercise counts + the caller's mastery snapshot. Backs the theory
 * detail page's "drill this point" block.
 */
export function usePointDrillInfo({
  fetchFn,
  grammarPointKey,
  enabled = true,
}: UsePointDrillInfoParams): UseQueryResult<PointDrillInfoResponse, Error> {
  return useQuery<PointDrillInfoResponse, Error>({
    queryKey: ['progress', 'point', grammarPointKey],
    queryFn: async () => {
      const response = await fetchFn(`/progress/points/${encodeURIComponent(grammarPointKey)}`);
      const json: unknown = await response.json();
      return PointDrillInfoResponseSchema.parse(json);
    },
    enabled: enabled && grammarPointKey.length > 0,
    staleTime: STALE_TIME_MS,
  });
}
```

(d) In `packages/api-client/src/index.ts`, extend the `./schemas/progress` export block:

```ts
export {
  RadarAxisKeyEnum,
  RadarAxisSchema,
  ProgressRadarResponseSchema,
  PointMasterySnapshotSchema,
  PointDrillInfoResponseSchema,
  type RadarAxisKey,
  type RadarAxis,
  type ProgressRadarResponse,
  type PointMasterySnapshot,
  type PointDrillInfoResponse,
} from './schemas/progress';
```

and add next to the other hook exports:

```ts
export { usePointDrillInfo, type UsePointDrillInfoParams } from './hooks/usePointDrillInfo';
```

- [ ] **Step 4: Run the package tests; fix fixtures broken by the now-required `difficulty`**

Run: `pnpm --filter @language-drill/api-client test`
Expected: the new hook tests PASS. Any `session.test.ts` / `useSession.test.ts` fixtures that build a `CreateSessionResponse` without `difficulty` now FAIL schema parsing — add `difficulty: 'B1'` (or the fixture's own level) to each such fixture object. Find them with:

```bash
grep -rn "CreateSessionResponse\|exercises: \[" packages/api-client/src/schemas/session.test.ts packages/api-client/src/hooks/useSession.test.ts
```

Re-run until: PASS with zero failures.

- [ ] **Step 5: Typecheck the package and its dependents**

Run: `pnpm typecheck`
Expected: PASS (nothing else consumes `CreateSessionResponse.difficulty` yet; the field is additive for reads).

- [ ] **Step 6: Commit**

```bash
git add packages/api-client/src
git commit -m "feat(api-client): PointDrillInfo schema + usePointDrillInfo; session response carries actual difficulty"
```

---

### Task 4: Web — key inverse helper + DrillThisPoint component

**Files:**
- Modify: `apps/web/lib/theory-topic-map.ts`
- Create: `apps/web/app/(dashboard)/theory/_components/drill-this-point.tsx`
- Create: `apps/web/app/(dashboard)/theory/_components/__tests__/drill-this-point.test.tsx`
- Test (helper): `apps/web/lib/__tests__/theory-topic-map.test.ts` (exists — append to it).

**Interfaces:**
- Consumes: `usePointDrillInfo`, `PointDrillInfoResponse` (Task 3); `Button` (`components/ui/button`, supports `href`/`variant`/`size`); `typeLabel` (`app/(dashboard)/_lib/timeline-labels`); `confidenceBand` (`app/(dashboard)/progress/_components/confidence-band`).
- Produces: `grammarPointKeyForTopicId(topicId: string | null | undefined, language: LearningLanguage): string | null`; `DrillThisPoint({ grammarPointKey: string; fetchFn: AuthenticatedFetch })` — renders `null` on error/empty pool, a skeleton while loading (Task 5 wires it into `TheoryDetail`).

- [ ] **Step 1: Write the failing tests**

(a) Helper tests — append to `apps/web/lib/__tests__/theory-topic-map.test.ts` (match its existing import style):

```ts
import { Language } from '@language-drill/shared';
import { grammarPointKeyForTopicId } from '../theory-topic-map';

describe('grammarPointKeyForTopicId', () => {
  it('prefixes the topic id with the lowercased language', () => {
    expect(grammarPointKeyForTopicId('a2-ser-vs-estar', Language.ES)).toBe('es-a2-ser-vs-estar');
  });

  it('returns null for a missing topic id', () => {
    expect(grammarPointKeyForTopicId(null, Language.ES)).toBeNull();
    expect(grammarPointKeyForTopicId('', Language.ES)).toBeNull();
  });
});
```

(b) Component tests — create `apps/web/app/(dashboard)/theory/_components/__tests__/drill-this-point.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '@language-drill/api-client';
import { DrillThisPoint } from '../drill-this-point';

const FIND = { timeout: 5000 } as const;

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

function makeFetch(body: unknown): AuthenticatedFetch {
  return vi.fn<AuthenticatedFetch>(async () => jsonResponse(body)) as unknown as AuthenticatedFetch;
}

function renderBlock(fetchFn: AuthenticatedFetch) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return render(
    <DrillThisPoint grammarPointKey="es-a2-ser-vs-estar" fetchFn={fetchFn} />,
    { wrapper: Wrapper },
  );
}

const INFO = {
  grammarPointKey: 'es-a2-ser-vs-estar',
  exerciseCounts: { cloze: 12, translation: 8, conjugation: 4 },
  mastery: {
    masteryScore: 0.82,
    confidence: 0.9,
    evidenceCount: 10,
    lastPracticedAt: '2026-07-01T00:00:00.000Z',
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DrillThisPoint', () => {
  it('renders the mixed-drill link targeting the grammar point', async () => {
    renderBlock(makeFetch(INFO));

    const mixed = await screen.findByRole('link', { name: /mixed drill/i }, FIND);
    expect(mixed).toHaveAttribute(
      'href',
      '/drill?start=quick&grammarPoint=es-a2-ser-vs-estar',
    );
  });

  it('renders one chip per stocked mode with the right hrefs (conjugation has its own route)', async () => {
    renderBlock(makeFetch(INFO));
    await screen.findByRole('link', { name: /mixed drill/i }, FIND);

    expect(screen.getByRole('link', { name: 'cloze' })).toHaveAttribute(
      'href',
      '/drill?start=quick&grammarPoint=es-a2-ser-vs-estar&exerciseType=cloze',
    );
    expect(screen.getByRole('link', { name: 'translation' })).toHaveAttribute(
      'href',
      '/drill?start=quick&grammarPoint=es-a2-ser-vs-estar&exerciseType=translation',
    );
    expect(screen.getByRole('link', { name: 'conjugation' })).toHaveAttribute(
      'href',
      '/drill/conjugation?grammarPoint=es-a2-ser-vs-estar',
    );
  });

  it('shows the mastery readout when mastery exists', async () => {
    renderBlock(makeFetch(INFO));
    await screen.findByRole('link', { name: /mixed drill/i }, FIND);

    expect(screen.getByText('82%')).toBeInTheDocument();
    expect(screen.getByText('high')).toBeInTheDocument(); // confidenceBand(90)
    expect(screen.getByText('10')).toBeInTheDocument();
  });

  it('omits the mastery readout for a never-practiced point', async () => {
    renderBlock(
      makeFetch({ ...INFO, mastery: null }),
    );
    await screen.findByRole('link', { name: /mixed drill/i }, FIND);

    expect(screen.queryByText(/mastery/)).not.toBeInTheDocument();
  });

  it('renders nothing when the point has no exercises', async () => {
    const { container } = renderBlock(
      makeFetch({ grammarPointKey: 'es-a2-ser-vs-estar', exerciseCounts: {}, mastery: null }),
    );

    // Wait for the query to settle, then assert an empty render.
    await vi.waitFor(() => {
      expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the request fails (malformed payload → query error)', async () => {
    const { container } = renderBlock(makeFetch({ topics: [] }));

    await vi.waitFor(() => {
      expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    });
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @language-drill/web test -- drill-this-point theory-topic-map`
Expected: FAIL — `grammarPointKeyForTopicId` and `../drill-this-point` don't exist.

- [ ] **Step 3: Implement**

(a) Append to `apps/web/lib/theory-topic-map.ts`:

```ts
// Inverse of `topicIdForGrammarPointKey`: derives the grammar-point key from a
// theory topic id by prefixing the lowercased language (`a2-ser-vs-estar` +
// ES → `es-a2-ser-vs-estar`). Purely a string transform — it does NOT check
// that the key exists in the curriculum; `GET /progress/points/:key` 404s for
// unknown keys and the caller hides the drill block on error.
export function grammarPointKeyForTopicId(
  topicId: string | null | undefined,
  language: LearningLanguage,
): string | null {
  if (!topicId) return null;
  return `${language.toLowerCase()}-${topicId}`;
}
```

(b) Create `apps/web/app/(dashboard)/theory/_components/drill-this-point.tsx`:

```tsx
'use client';

import type { AuthenticatedFetch } from '@language-drill/api-client';
import { usePointDrillInfo } from '@language-drill/api-client';
import { ExerciseType } from '@language-drill/shared';
import { Button } from '../../../../components/ui/button';
import { typeLabel } from '../../_lib/timeline-labels';
import { confidenceBand } from '../../progress/_components/confidence-band';

// ---------------------------------------------------------------------------
// DrillThisPoint — "drill this point" block at the end of a theory article.
// Mirrors the lower half of the /progress PointDetailSheet, but availability
// is inventory-checked: buttons render only for modes with approved exercises
// at the point's OWN level (GET /progress/points/:key), so a tap can't land on
// INSUFFICIENT_EXERCISES. The whole block hides (renders null) when the pool
// is empty or the lookup fails — the article stays a clean read.
// ---------------------------------------------------------------------------

// Fixed chip order; grammar-drillable types only. Types produced by
// non-grammar curriculum kinds (vocab/dictation/free-writing) never chart
// here — a theory page maps to a grammar point.
const MODE_ORDER: readonly ExerciseType[] = [
  ExerciseType.CLOZE,
  ExerciseType.TRANSLATION,
  ExerciseType.SENTENCE_CONSTRUCTION,
  ExerciseType.CONJUGATION,
];

export type DrillThisPointProps = {
  grammarPointKey: string;
  fetchFn: AuthenticatedFetch;
};

function chipHref(type: ExerciseType, key: string): string {
  if (type === ExerciseType.CONJUGATION) {
    return `/drill/conjugation?grammarPoint=${encodeURIComponent(key)}`;
  }
  return `/drill?start=quick&grammarPoint=${encodeURIComponent(key)}&exerciseType=${type}`;
}

export function DrillThisPoint({ grammarPointKey, fetchFn }: DrillThisPointProps) {
  const query = usePointDrillInfo({ fetchFn, grammarPointKey });

  if (query.isLoading) {
    return (
      <section
        aria-busy="true"
        aria-label="drill this point"
        style={{ borderTop: '1px solid var(--color-rule)', marginTop: 40, paddingTop: 24 }}
      >
        <div
          aria-hidden="true"
          style={{ height: 120, borderRadius: 8, background: 'var(--color-paper-2)' }}
        />
      </section>
    );
  }

  if (!query.data) return null;

  const { exerciseCounts, mastery } = query.data;
  const total = Object.values(exerciseCounts).reduce((sum, n) => sum + n, 0);
  if (total === 0) return null;

  const modes = MODE_ORDER.filter((type) => (exerciseCounts[type] ?? 0) > 0);

  return (
    <section
      aria-label="drill this point"
      style={{ borderTop: '1px solid var(--color-rule)', marginTop: 40, paddingTop: 24 }}
    >
      {mastery && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', gap: 20, justifyContent: 'space-between', maxWidth: 420 }}>
            <div>
              <div className="t-micro" style={{ color: 'var(--color-ink-mute)' }}>
                mastery
              </div>
              <div className="t-mono" style={{ fontSize: 18, marginTop: 2, color: 'var(--color-ink)' }}>
                {Math.round(mastery.masteryScore * 100)}%
              </div>
            </div>
            <div>
              <div className="t-micro" style={{ color: 'var(--color-ink-mute)' }}>
                confidence
              </div>
              <div className="t-mono" style={{ fontSize: 18, marginTop: 2, color: 'var(--color-ink)' }}>
                {confidenceBand(Math.round(mastery.confidence * 100)).label}
              </div>
            </div>
            <div>
              <div className="t-micro" style={{ color: 'var(--color-ink-mute)' }}>
                evidence
              </div>
              <div className="t-mono" style={{ fontSize: 18, marginTop: 2, color: 'var(--color-ink)' }}>
                {mastery.evidenceCount}
              </div>
            </div>
          </div>
          <p className="t-small text-ink-mute mt-s-2">
            mastery = your recent accuracy on this point, weighted by difficulty &amp; recency
          </p>
        </div>
      )}

      <div className="t-micro" style={{ color: 'var(--color-ink-mute)', marginBottom: 10 }}>
        drill this point
      </div>
      <Button
        href={`/drill?start=quick&grammarPoint=${encodeURIComponent(grammarPointKey)}`}
        variant="primary"
        size="md"
        className="w-full"
      >
        mixed drill — adapts to your weak spots
      </Button>

      {modes.length > 0 && (
        <>
          <div className="t-micro" style={{ color: 'var(--color-ink-mute)', marginTop: 16, marginBottom: 8 }}>
            or pick one mode
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
            {modes.map((type) => (
              <Button key={type} href={chipHref(type, grammarPointKey)} variant="ghost" size="sm">
                {typeLabel(type)}
              </Button>
            ))}
          </div>
          <div className="t-small" style={{ color: 'var(--color-ink-mute)' }}>
            each mode launches a single-mode targeted drill on this point.
          </div>
        </>
      )}
    </section>
  );
}
```

(Verified: `typeLabel` returns `'cloze'` / `'translation'` / `'conjugation'` for those three types, so the chip-name assertions in Step 1(b) are exact. `Button` renders an internal `href` as an anchor, so `getByRole('link', ...)` works.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @language-drill/web test -- drill-this-point theory-topic-map`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/theory-topic-map.ts apps/web/lib/__tests__/theory-topic-map.test.ts "apps/web/app/(dashboard)/theory/_components/drill-this-point.tsx" "apps/web/app/(dashboard)/theory/_components/__tests__/drill-this-point.test.tsx"
git commit -m "feat(web): DrillThisPoint block — inventory-checked drill launcher for a grammar point"
```

---

### Task 5: Web — wire DrillThisPoint into the theory detail page

**Files:**
- Modify: `apps/web/app/(dashboard)/theory/_components/theory-detail.tsx`
- Test: `apps/web/app/(dashboard)/theory/_components/__tests__/theory-detail.test.tsx`

**Interfaces:**
- Consumes: `DrillThisPoint`, `grammarPointKeyForTopicId` (Task 4).
- Produces: the block renders inside `.theory-scroll` after `TheorySections`, keyed off the LOADED topic's id.

- [ ] **Step 1: Write the failing integration test**

In `theory-detail.test.tsx`:

(a) Teach `makeFetch` to serve the new endpoint. Extend `FetchOpts` and the dispatcher:

```ts
type FetchOpts = { topicStatus?: number; drillInfo?: unknown };

function makeFetch({ topicStatus = 200, drillInfo }: FetchOpts = {}): AuthenticatedFetch {
  return vi.fn<AuthenticatedFetch>(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.startsWith('/progress/points/')) {
      if (drillInfo === undefined) {
        // Default: unknown point → the block must hide itself.
        throw errorWithStatus('not found', 404);
      }
      return jsonResponse(drillInfo);
    }
    const isTopicReq = /\/theory\/[^/]+\/[^/]+$/.test(url);
    if (isTopicReq) {
      if (topicStatus !== 200) {
        throw errorWithStatus('topic request failed', topicStatus);
      }
      return jsonResponse(TOPIC_BODY);
    }
    return jsonResponse({ topics: LIST_TOPICS });
  }) as unknown as AuthenticatedFetch;
}
```

(b) Add a describe block:

```ts
describe('TheoryDetail drill block', () => {
  it('renders the drill block (keyed off the topic id + language) when the point has exercises', async () => {
    const fetchFn = makeFetch({
      drillInfo: {
        grammarPointKey: 'de-der-dativ',
        exerciseCounts: { cloze: 3 },
        mastery: null,
      },
    });
    renderDetail(fetchFn);
    await screen.findByRole('heading', { level: 1, name: 'der dativ' }, FIND);

    const mixed = await screen.findByRole('link', { name: /mixed drill/i }, FIND);
    expect(mixed).toHaveAttribute(
      'href',
      '/drill?start=quick&grammarPoint=de-der-dativ',
    );
    // The drill-info request derived the key from topicId + language.
    const calls = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    expect(calls).toContain('/progress/points/de-der-dativ');
  });

  it('renders no drill block when the point lookup 404s', async () => {
    renderDetail(makeFetch()); // no drillInfo → the endpoint rejects
    await screen.findByRole('heading', { level: 1, name: 'der dativ' }, FIND);

    expect(screen.queryByRole('link', { name: /mixed drill/i })).not.toBeInTheDocument();
  });
});
```

(The fixture topic id `der-dativ` has no CEFR infix, so the derived key `de-der-dativ` is deliberately synthetic — the assertion is about the string transform and the wiring, not curriculum validity.)

- [ ] **Step 2: Run to verify the new tests fail (and the old ones still pass)**

Run: `pnpm --filter @language-drill/web test -- theory-detail`
Expected: the two new tests FAIL (no drill block rendered); all pre-existing tests PASS.

- [ ] **Step 3: Implement the wiring**

In `theory-detail.tsx`:

(a) Add imports:

```ts
import { grammarPointKeyForTopicId } from '../../../../lib/theory-topic-map';
import { DrillThisPoint } from './drill-this-point';
```

(b) Derive the key once the topic is loaded (below the `activeSectionId` line):

```ts
  // Targeted-drill key for the loaded topic. Derived from the LOADED topic's
  // id (not the route param) so the block always matches the article shown.
  const drillKey = topic ? grammarPointKeyForTopicId(topic.id, language) : null;
```

(c) Render the block inside the scroller, after `<TheorySections ... />` and before the `{isMobile && <TheoryBrowseAllButton ... />}` line:

```tsx
            {drillKey && (
              <DrillThisPoint grammarPointKey={drillKey} fetchFn={fetchFn} />
            )}
```

- [ ] **Step 4: Run the tests to verify everything passes**

Run: `pnpm --filter @language-drill/web test -- theory-detail drill-this-point`
Expected: PASS — new tests plus every pre-existing theory-detail test (the footer tests assert "exactly one footer"; the drill block adds none).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(dashboard)/theory/_components/theory-detail.tsx" "apps/web/app/(dashboard)/theory/_components/__tests__/theory-detail.test.tsx"
git commit -m "feat(web): drill-this-point block on the theory detail page"
```

---

### Task 6: Web — drill page reflects the server-derived difficulty

**Files:**
- Modify: `apps/web/app/(dashboard)/drill/page.tsx` (create-session `onSuccess`, ~line 184)
- Test: whatever test file covers the drill page's session-creation flow — find with `grep -rln "useCreateSession" "apps/web/app/(dashboard)/drill" --include="*.test.*"`

**Interfaces:**
- Consumes: `CreateSessionResponse.difficulty` (Task 3).
- Produces: after a targeted create, the page's `difficulty` state (DrillMeta level pill, `track` payloads) shows the level the session actually runs at.

- [ ] **Step 1: Update the onSuccess handler**

Replace the `createSession.mutate(config, { onSuccess: ... })` success callback (page.tsx lines 185-194) with:

```ts
      onSuccess: (data) => {
        // A targeted session may have been re-leveled by the server (the
        // grammar point's own CEFR level wins over the profile level) —
        // reflect the level the session was actually created at.
        if (data.difficulty !== difficulty) setDifficulty(data.difficulty);
        track('drill_started', { language: activeLanguage, cefr: data.difficulty });
        dispatch({ type: 'CREATE_SUCCEEDED', session: data });
        // Reflect the live session in the URL so a full page reload (e.g.
        // toggling Chrome device emulation, an accidental refresh) resumes it
        // via the existing ?resume flow instead of dropping back to the hub.
        // `resumeId`/`startIntent` are read once at mount, so this replace does
        // not disturb the current session — it only matters on the next load.
        router.replace(`/drill?resume=${data.id}`, { scroll: false });
      },
```

(The kickoff effect lists `difficulty` in its deps, but by the time `setDifficulty` fires, `state.kind` is `inSession`, so the re-run hits the `state.kind !== 'idle'` early-return — no re-create loop.)

- [ ] **Step 2: Fix any affected tests**

Run: `pnpm --filter @language-drill/web test`
Expected: any drill-page test that stubs `useCreateSession`'s success data without a `difficulty` field may now fail on the `setDifficulty`/`track` lines (`data.difficulty` undefined). Add `difficulty: 'B1'` (or the fixture's level) to those mocked response objects. Grep guidance:

```bash
grep -rn "CREATE_SUCCEEDED\|mutate.*onSuccess\|session: {" "apps/web/app/(dashboard)/drill" --include="*.test.*" | head -30
```

Re-run until PASS with zero failures.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/app/(dashboard)/drill/page.tsx" <any-updated-test-files>
git commit -m "feat(web): drill page shows the difficulty the session was actually created at"
```

---

### Task 7: Full gate + end-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Full pre-push suite**

```bash
rm -rf infra/lambda/dist
pnpm lint && pnpm typecheck && pnpm test
```

Expected: zero failures across all packages. (Known flake context: infra CDK-synth tests are serialized already; if an unrelated `sessions.test.ts` failure appears right after edits, check for unconsumed `...Once` mock values bleeding between tests before assuming a regression.)

- [ ] **Step 2: Verify the flow end-to-end against the local stack**

Invoke the `verify` skill (per repo convention) to drive the real flow. Manual fallback:

```bash
pnpm dev   # API :3001 + web :3000
```

Then with the seeded dev user (profile level ≠ target point level if possible):
1. Open `http://localhost:3000/theory/<some-topic-with-approved-exercises>` — the "drill this point" block should appear with mode chips matching real pool contents (`GET http://localhost:3001/progress/points/<key>` shows the counts).
2. Click **mixed drill** — the drill page should create a session and the level pill should show the POINT's level, not the profile level.
3. Pick a topic whose grammar point has no approved exercises (or a key that 404s) — the article should render with no drill block.
4. `curl -s localhost:3001/progress/points/es-a2-ser-vs-estar | jq` (dev auth bypass) — sanity-check the payload shape.

- [ ] **Step 3: Screenshot the new block (UI change verification)**

```bash
pnpm --filter @language-drill/web shoot --route /theory/<topic-id>
```

Inspect `apps/web/e2e/.shots/` — the block should sit at the end of the article, above the footer, visually consistent with the /progress drawer (mastery row, primary mixed-drill button, ghost mode chips).

- [ ] **Step 4: Commit any verification fixes, then hand off**

If verification surfaced fixes, commit them. Then use the `superpowers:finishing-a-development-branch` skill (branch → PR → squash-merge per repo convention).
