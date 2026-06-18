# Resume an In-Progress Today-Session — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking "start" on the next-up today-plan row resumes the existing incomplete today-session at its first unattempted exercise, instead of creating a brand-new 5-item session.

**Architecture:** The backend exposes the in-progress session id on `GET /sessions/today` (`resumeSessionId`) and adds a new owner-checked `GET /sessions/:id` that returns the session's ordered exercises plus which ids were attempted. The today timeline links the next-up row to `/drill?resume=<id>` when a resume handle is present; the drill page fetches that session and seeds the session reducer at the first unattempted exercise via a new `RESUME_SUCCEEDED` action.

**Tech Stack:** Hono + Drizzle (Lambda), Zod + TanStack Query (api-client), Next.js + React + Vitest/Testing-Library (web).

## Global Constraints

- **TDD throughout:** write the failing test, watch it fail, implement minimal, watch it pass, commit.
- **api-client is consumed by web via its built `dist`.** After changing `packages/api-client`, run `pnpm build --filter @language-drill/shared --filter @language-drill/db --filter @language-drill/api-client` before running web tests/typecheck (stale-dist resolution).
- **Lambda full-suite hazard:** stale compiled `infra/lambda/dist/**/*.test.js` can produce phantom failures. If the full lambda suite misbehaves, `rm -rf infra/lambda/dist` and re-run. Single-file vitest runs from source are unaffected.
- **Route precedence:** register `GET /sessions/:id` *after* `GET /sessions/today` (Hono prioritizes the static `today` segment over the `:id` param, but keep registration order explicit).
- **No `review_status` filter** on session-manifest reads (a flagged exercise already in a manifest must still hydrate its slot) — mirror Path A and the debrief route.
- **Pre-push:** `pnpm lint`, `pnpm typecheck`, `pnpm turbo run test --concurrency=1` all green before the PR.

---

### Task 1: `resumeSessionId` on `GET /sessions/today`

**Files:**
- Modify: `infra/lambda/src/routes/sessions.ts` (the three `c.json(...)` returns inside the `GET /sessions/today` handler: Path A ~370, Path B insufficient ~427, Path B success ~437)
- Test: `infra/lambda/src/routes/sessions.test.ts`

**Interfaces:**
- Produces: `GET /sessions/today` response now carries `resumeSessionId: string | null` — the session id when a today-session exists and is **not** completed; `null` otherwise (Path B and completed Path A).

- [ ] **Step 1: Write the failing test**

Add to `sessions.test.ts`, in the `GET /sessions/today` describe block (reuse that block's existing db-mock setup for Path A — a today session row with `completedAt: null` and its items left-join). Mirror the nearest existing Path A test's arrange step, then assert the new field:

```ts
it('returns resumeSessionId for an incomplete today-session (Path A)', async () => {
  // ...arrange Path A exactly like the existing incomplete-session test:
  //   todayRows -> one row { sessionId: 'sess-1', exerciseIds: ['e1','e2'],
  //     exerciseCount: 2, correctCount: 0, startedAt: <today>, completedAt: null }
  //   items left-join -> e1 attempted, e2 not
  const res = await app.request('/sessions/today?language=ES', {}, env);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.resumeSessionId).toBe('sess-1');
});

it('returns null resumeSessionId when no today-session exists (Path B)', async () => {
  // ...arrange Path B exactly like the existing fresh-plan test (todayRows empty,
  //   pool sample returns candidates)...
  const res = await app.request('/sessions/today?language=ES', {}, env);
  const body = await res.json();
  expect(body.resumeSessionId).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/lambda test -- sessions.test.ts -t resumeSessionId`
Expected: FAIL — `body.resumeSessionId` is `undefined`.

- [ ] **Step 3: Implement**

In the Path A return (the `c.json({ ... })` at ~370), add the field. `session` here is `todayRows[0]` with `completedAt`:

```ts
    return c.json({
      language,
      generatedAt: new Date().toISOString(),
      totalEstimatedMinutes: items.reduce(
        (sum, it) => sum + it.estimatedMinutes,
        0,
      ),
      items: items.map(toWireItem),
      summary,
      code: null,
      resumeSessionId: session.completedAt === null ? session.sessionId : null,
      freeWriting,
    });
```

In the Path B **insufficient** return (~427) and the Path B **success** return (~437), add `resumeSessionId: null,` alongside `summary` / `code`:

```ts
      summary: null,
      code: 'INSUFFICIENT_POOL' as const, // (or `code: null` in the success branch)
      resumeSessionId: null,
      freeWriting,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @language-drill/lambda test -- sessions.test.ts -t resumeSessionId`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/routes/sessions.ts infra/lambda/src/routes/sessions.test.ts
git commit -m "feat(lambda): expose resumeSessionId on GET /sessions/today"
```

---

### Task 2: New `GET /sessions/:id` (resume payload)

**Files:**
- Modify: `infra/lambda/src/routes/sessions.ts` (add the handler immediately after the `GET /sessions/today` handler, before `GET /sessions/:id/debrief`)
- Test: `infra/lambda/src/routes/sessions.test.ts`

**Interfaces:**
- Produces: `GET /sessions/:id` → `200 { id: string, exercises: Array<{ id, type, language, difficulty, grammarPointKey, contentJson }>, attemptedExerciseIds: string[], completedAt: string | null }` in stored `exerciseIds` order, audio presigned. `404 { code: 'SESSION_NOT_FOUND' }` for unknown id or non-owner. `400 VALIDATION_ERROR` for a non-UUID id.
- Consumes: `presignAudioUrl`, `withAudioUrl`, `exercisesTable`, `practiceSessions`, `userExerciseHistory` (all already imported at the top of `sessions.ts`).

- [ ] **Step 1: Write the failing test**

```ts
describe('GET /sessions/:id', () => {
  it('returns ordered exercises + attemptedExerciseIds for the owner', async () => {
    // Arrange: session row { id: 'sess-1', userId: <caller>, exerciseIds: ['e2','e1'],
    //   completedAt: null }. exercises rows for e1,e2. history rows: only e2 attempted.
    // Wire the db mocks so:
    //   - first select(session by id+userId) -> [sessionRow]
    //   - select(exercises by inArray) -> [{id:'e1',...},{id:'e2',...}]
    //   - select(distinct history exerciseId by sessionId) -> [{ exerciseId: 'e2' }]
    const res = await app.request('/sessions/sess-1', {}, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe('sess-1');
    // Order follows exerciseIds (['e2','e1']), not the exercises-table return order.
    expect(body.exercises.map((e: { id: string }) => e.id)).toEqual(['e2', 'e1']);
    expect(body.attemptedExerciseIds).toEqual(['e2']);
    expect(body.completedAt).toBeNull();
  });

  it('404s for a session the caller does not own', async () => {
    // select(session by id+userId) -> []  (ownership predicate yields no row)
    const res = await app.request('/sessions/sess-x', {}, env);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('SESSION_NOT_FOUND');
  });
});
```

(Use a real UUID string in place of `'sess-1'` if the handler validates UUIDs — see Step 3; the assertions are unchanged.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/lambda test -- sessions.test.ts -t "GET /sessions/:id"`
Expected: FAIL — route not found (404 with no `SESSION_NOT_FOUND` body, or Hono's default 404).

- [ ] **Step 3: Implement the handler**

Insert after the `GET /sessions/today` handler:

```ts
// ---------------------------------------------------------------------------
// GET /sessions/:id — fetch a session's manifest + attempt state for resume
// ---------------------------------------------------------------------------
sessions.get('/sessions/:id', async (c) => {
  const id = c.req.param('id');
  const userId = c.get('userId');

  const idResult = z.string().uuid().safeParse(id);
  if (!idResult.success) {
    c.header('Cache-Control', 'no-store');
    return c.json(
      { error: 'Invalid session id', code: 'VALIDATION_ERROR', details: idResult.error.flatten() },
      400,
    );
  }

  // Ownership in the predicate: cross-user / unknown both collapse to 404.
  const sessionRows = await db
    .select({
      id: practiceSessions.id,
      exerciseIds: practiceSessions.exerciseIds,
      completedAt: practiceSessions.completedAt,
    })
    .from(practiceSessions)
    .where(and(eq(practiceSessions.id, id), eq(practiceSessions.userId, userId)))
    .limit(1);

  if (sessionRows.length === 0) {
    c.header('Cache-Control', 'no-store');
    return c.json({ error: 'Session not found', code: 'SESSION_NOT_FOUND' }, 404);
  }

  const session = sessionRows[0];
  const exerciseIds = (session.exerciseIds ?? []) as string[];

  // Manifest rows (no review_status filter — see Path A rationale) + attempted set.
  const [rows, historyRows] = await Promise.all([
    db
      .select()
      .from(exercisesTable)
      .where(inArray(exercisesTable.id, exerciseIds)),
    db
      .selectDistinct({ exerciseId: userExerciseHistory.exerciseId })
      .from(userExerciseHistory)
      .where(eq(userExerciseHistory.sessionId, id)),
  ]);

  const rowMap = new Map(rows.map((r) => [r.id, r]));
  const exercises = await Promise.all(
    exerciseIds
      .map((eid) => rowMap.get(eid))
      .filter((r): r is NonNullable<typeof r> => r != null) // drop deleted exercises
      .map(async (r) => ({
        id: r.id,
        type: r.type,
        language: r.language,
        difficulty: r.difficulty,
        grammarPointKey: r.grammarPointKey,
        contentJson: withAudioUrl(r.contentJson, await presignAudioUrl(r.audioS3Key)),
      })),
  );

  const attemptedExerciseIds = historyRows.map((h) => h.exerciseId);

  return c.json({
    id: session.id,
    exercises,
    attemptedExerciseIds,
    completedAt: session.completedAt ? new Date(session.completedAt as Date).toISOString() : null,
  });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @language-drill/lambda test -- sessions.test.ts -t "GET /sessions/:id"`
Expected: PASS (both cases). Also confirm `GET /sessions/today` tests still pass (route precedence).

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/routes/sessions.ts infra/lambda/src/routes/sessions.test.ts
git commit -m "feat(lambda): GET /sessions/:id returns manifest + attempt state for resume"
```

---

### Task 3: `resumeSessionId` in the today api-client schema

**Files:**
- Modify: `packages/api-client/src/schemas/today.ts` (`TodayPlanResponseSchema`)
- Test: `packages/api-client/src/schemas/today.test.ts`

**Interfaces:**
- Produces: `TodayPlanResponse.resumeSessionId: string | null`.

- [ ] **Step 1: Write the failing test**

Add to `today.test.ts` (follow the file's existing fixture style):

```ts
it('parses resumeSessionId when present', () => {
  const parsed = TodayPlanResponseSchema.parse({
    language: 'ES',
    generatedAt: '2026-06-18T10:00:00.000Z',
    totalEstimatedMinutes: 0,
    items: [],
    summary: null,
    code: null,
    resumeSessionId: '11111111-1111-1111-1111-111111111111',
    freeWriting: null,
  });
  expect(parsed.resumeSessionId).toBe('11111111-1111-1111-1111-111111111111');
});

it('defaults resumeSessionId to null when omitted', () => {
  const parsed = TodayPlanResponseSchema.parse({
    language: 'ES',
    generatedAt: '2026-06-18T10:00:00.000Z',
    totalEstimatedMinutes: 0,
    items: [],
    summary: null,
    code: null,
    freeWriting: null,
  });
  expect(parsed.resumeSessionId).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/api-client test -- today.test.ts -t resumeSessionId`
Expected: FAIL — first case: `resumeSessionId` is `undefined` (unknown key stripped); second: `undefined`.

- [ ] **Step 3: Implement**

In `today.ts`, add to `TodayPlanResponseSchema` (after `code`):

```ts
  // The in-progress today-session id when one exists and is not yet completed —
  // drives the timeline's "continue" link. Null on a fresh plan or a completed
  // session. `.default(null)` keeps older payloads (pre-resume API) parseable.
  resumeSessionId: z.string().nullable().default(null),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @language-drill/api-client test -- today.test.ts -t resumeSessionId`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api-client/src/schemas/today.ts packages/api-client/src/schemas/today.test.ts
git commit -m "feat(api-client): resumeSessionId on TodayPlanResponse schema"
```

---

### Task 4: Resume-session schema + `useResumeSession` hook

**Files:**
- Modify: `packages/api-client/src/schemas/session.ts` (add `ResumeSessionResponseSchema`)
- Modify: `packages/api-client/src/hooks/useSession.ts` (add `useResumeSession`)
- Modify: `packages/api-client/src/index.ts` (export the new schema, type, and hook)
- Test: `packages/api-client/src/schemas/session.test.ts`, `packages/api-client/src/hooks/useSession.test.ts`

**Interfaces:**
- Produces:
  - `ResumeSessionResponseSchema` / `ResumeSessionResponse` = `{ id: string; exercises: ExerciseResponse[]; attemptedExerciseIds: string[]; completedAt: string | null }`.
  - `useResumeSession({ sessionId, fetchFn, enabled }): UseQueryResult<ResumeSessionResponse, Error>` — GETs `/sessions/:sessionId`.

- [ ] **Step 1: Write the failing schema test**

Add to `session.test.ts`:

```ts
import {
  ResumeSessionResponseSchema,
} from './session';

it('parses a resume-session response', () => {
  const parsed = ResumeSessionResponseSchema.parse({
    id: '11111111-1111-1111-1111-111111111111',
    exercises: [
      { id: 'e2', type: 'cloze', language: 'EN', difficulty: 'B1', grammarPointKey: null, contentJson: {} },
    ],
    attemptedExerciseIds: ['e2'],
    completedAt: null,
  });
  expect(parsed.exercises[0].id).toBe('e2');
  expect(parsed.attemptedExerciseIds).toEqual(['e2']);
  expect(parsed.completedAt).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/api-client test -- session.test.ts -t "resume-session"`
Expected: FAIL — `ResumeSessionResponseSchema` is not exported.

- [ ] **Step 3: Implement the schema**

In `session.ts` (after `CreateSessionResponseSchema`):

```ts
// Response body for GET /sessions/:id — used to resume an in-progress session.
export const ResumeSessionResponseSchema = z.object({
  id: z.string().uuid(),
  exercises: z.array(ExerciseResponseSchema),
  attemptedExerciseIds: z.array(z.string()),
  completedAt: z.string().datetime().nullable(),
});

export type ResumeSessionResponse = z.infer<typeof ResumeSessionResponseSchema>;
```

- [ ] **Step 4: Run schema test — PASS**

Run: `pnpm --filter @language-drill/api-client test -- session.test.ts -t "resume-session"`
Expected: PASS.

- [ ] **Step 5: Write the failing hook test**

Add to `useSession.test.ts` (mirror the existing `useCreateSession` test's QueryClient + mock-fetch harness):

```ts
it('useResumeSession GETs /sessions/:id and returns the parsed payload', async () => {
  const fetchFn = vi.fn(async () => ({
    json: async () => ({
      id: '11111111-1111-1111-1111-111111111111',
      exercises: [{ id: 'e1', type: 'cloze', language: 'EN', difficulty: 'B1', grammarPointKey: null, contentJson: {} }],
      attemptedExerciseIds: [],
      completedAt: null,
    }),
  })) as unknown as AuthenticatedFetch;

  const { result } = renderHook(
    () => useResumeSession({ sessionId: '11111111-1111-1111-1111-111111111111', fetchFn }),
    { wrapper },
  );

  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(fetchFn).toHaveBeenCalledWith('/sessions/11111111-1111-1111-1111-111111111111');
  expect(result.current.data?.exercises[0].id).toBe('e1');
});
```

- [ ] **Step 6: Run hook test to verify it fails**

Run: `pnpm --filter @language-drill/api-client test -- useSession.test.ts -t useResumeSession`
Expected: FAIL — `useResumeSession` not exported.

- [ ] **Step 7: Implement the hook**

In `useSession.ts`, add the import and the hook:

```ts
import { useMutation, useQuery } from '@tanstack/react-query';
// ...add to the existing schema import:
import {
  // ...existing...
  ResumeSessionResponseSchema,
  type ResumeSessionResponse,
} from '../schemas/session';
```

```ts
// ---------------------------------------------------------------------------
// useResumeSession
// ---------------------------------------------------------------------------
// Read-only query that fetches an in-progress session's manifest + attempt
// state from `GET /sessions/:sessionId`, so the drill page can resume it at the
// first unattempted exercise. `enabled` gates the fetch to the resume entry
// only. No staleTime: the attempt state must be fresh on each resume entry.
// ---------------------------------------------------------------------------
export type UseResumeSessionOptions = {
  sessionId: string;
  fetchFn: AuthenticatedFetch;
  enabled?: boolean;
};

export function useResumeSession({ sessionId, fetchFn, enabled = true }: UseResumeSessionOptions) {
  return useQuery<ResumeSessionResponse, Error>({
    queryKey: ['session-resume', sessionId],
    queryFn: async () => {
      const response = await fetchFn(`/sessions/${sessionId}`);
      const json: unknown = await response.json();
      return ResumeSessionResponseSchema.parse(json);
    },
    enabled,
  });
}
```

- [ ] **Step 8: Export from index**

In `packages/api-client/src/index.ts`, add to the existing session re-exports:

```ts
export {
  ResumeSessionResponseSchema,
} from './schemas/session';
export type { ResumeSessionResponse } from './schemas/session';
export { useResumeSession } from './hooks/useSession';
```

(Match the file's existing export grouping/style — fold into the existing `./schemas/session` and `./hooks/useSession` export blocks if present rather than duplicating.)

- [ ] **Step 9: Run hook test — PASS, then build**

Run: `pnpm --filter @language-drill/api-client test -- useSession.test.ts -t useResumeSession`
Expected: PASS.
Then rebuild so web sees it: `pnpm build --filter @language-drill/shared --filter @language-drill/db --filter @language-drill/api-client`

- [ ] **Step 10: Commit**

```bash
git add packages/api-client/src
git commit -m "feat(api-client): ResumeSessionResponse schema + useResumeSession hook"
```

---

### Task 5: Reducer `RESUME_SUCCEEDED`

**Files:**
- Modify: `apps/web/app/(dashboard)/drill/_components/session-reducer.ts`
- Test: `apps/web/app/(dashboard)/drill/_components/__tests__/session-reducer.test.ts`

**Interfaces:**
- Consumes: `ResumeSessionResponse` from api-client.
- Produces: action `{ type: 'RESUME_SUCCEEDED'; session: ResumeSessionResponse; startIndex: number }` → from `creating`, yields `inSession` with `items = session.exercises`, `index = startIndex`. Exported helper `firstUnattemptedIndex(exercises, attemptedIds): number` (returns `-1` when all attempted).

- [ ] **Step 1: Write the failing test**

Add to `session-reducer.test.ts`:

```ts
import { firstUnattemptedIndex } from '../session-reducer';

const sampleResumeResponse = {
  id: sampleCreateResponse.id,
  exercises: sampleItems,
  attemptedExerciseIds: ['ex-0'],
  completedAt: null,
};

it('firstUnattemptedIndex returns the first item not in the attempted set', () => {
  expect(firstUnattemptedIndex(sampleItems, new Set(['ex-0']))).toBe(1);
  expect(firstUnattemptedIndex(sampleItems, new Set())).toBe(0);
  expect(firstUnattemptedIndex(sampleItems, new Set(['ex-0', 'ex-1']))).toBe(-1);
});

it('RESUME_SUCCEEDED enters inSession at the given startIndex from creating', () => {
  const creating: SessionState = { kind: 'creating' };
  const next = sessionReducer(creating, {
    type: 'RESUME_SUCCEEDED',
    session: sampleResumeResponse,
    startIndex: 1,
  });
  expect(next.kind).toBe('inSession');
  if (next.kind !== 'inSession') throw new Error('expected inSession');
  expect(next.index).toBe(1);
  expect(next.items).toEqual(sampleItems);
  expect(next.session.id).toBe(sampleResumeResponse.id);
});

it('RESUME_SUCCEEDED is ignored when not in creating', () => {
  const next = sessionReducer(inSessionState, {
    type: 'RESUME_SUCCEEDED',
    session: sampleResumeResponse,
    startIndex: 1,
  });
  expect(next).toBe(inSessionState);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/web test -- session-reducer.test.ts -t RESUME`
Expected: FAIL — `firstUnattemptedIndex` not exported; `RESUME_SUCCEEDED` not a valid action.

- [ ] **Step 3: Implement**

In `session-reducer.ts`, add the import, the action to the union, the helper, and the case:

```ts
import type {
  CreateSessionResponse,
  ExerciseResponse,
  ResumeSessionResponse,
} from '@language-drill/api-client';
```

Add to `SessionAction`:

```ts
  | { type: 'RESUME_SUCCEEDED'; session: ResumeSessionResponse; startIndex: number }
```

Add the case (next to `CREATE_SUCCEEDED`):

```ts
    case 'RESUME_SUCCEEDED':
      if (state.kind !== 'creating') return state;
      return {
        kind: 'inSession',
        session: { id: action.session.id },
        items: action.session.exercises,
        index: action.startIndex,
        perItemSubmission: { kind: 'idle' },
        skippedCount: 0,
      };
```

Add the helper (below the reducer, near the selectors):

```ts
/**
 * Index of the first exercise with no recorded attempt, or -1 if every
 * exercise has been attempted. Drives where a resumed session re-enters.
 */
export function firstUnattemptedIndex(
  exercises: readonly ExerciseResponse[],
  attemptedIds: ReadonlySet<string>,
): number {
  return exercises.findIndex((e) => !attemptedIds.has(e.id));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @language-drill/web test -- session-reducer.test.ts -t RESUME`
Expected: PASS (all three).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(dashboard)/drill/_components/session-reducer.ts" "apps/web/app/(dashboard)/drill/_components/__tests__/session-reducer.test.ts"
git commit -m "feat(web): RESUME_SUCCEEDED reducer action + firstUnattemptedIndex"
```

---

### Task 6: Timeline links to resume + "continue" label

**Files:**
- Modify: `apps/web/app/(dashboard)/_components/timeline-item.tsx` (add `ctaLabel` prop)
- Modify: `apps/web/app/(dashboard)/_components/today-timeline.tsx` (compute resume href + label)
- Test: `apps/web/app/(dashboard)/_components/__tests__/today-timeline.test.tsx`, `apps/web/app/(dashboard)/_components/__tests__/timeline-item.test.tsx`

**Interfaces:**
- Consumes: `TodayPlanResponse.resumeSessionId`.
- Produces: next-up row's "start" button → `href = /drill?resume=<id>` with text "continue →" when `resumeSessionId` is set; otherwise `href = /drill?start=quick` with "start →".

- [ ] **Step 1: Write the failing timeline test**

Add to `today-timeline.test.tsx`. The `makeResponse` helper already spreads overrides, so pass `resumeSessionId` through it:

```ts
it('links next-up to ?resume and labels it "continue" when resumeSessionId is set', () => {
  const items = [makeItem(1, 'done'), makeItem(2, 'queued'), makeItem(3, 'queued')];
  render(
    <TodayTimeline
      {...baseProps}
      isLoading={false}
      error={null}
      data={makeResponse(items, { resumeSessionId: '11111111-1111-1111-1111-111111111111' })}
    />,
  );
  const cta = screen.getByRole('link', { name: /continue/i });
  expect(cta).toHaveAttribute('href', '/drill?resume=11111111-1111-1111-1111-111111111111');
});

it('links next-up to ?start=quick with "start" when no resumeSessionId', () => {
  const items = [makeItem(1, 'done'), makeItem(2, 'queued'), makeItem(3, 'queued')];
  render(
    <TodayTimeline
      {...baseProps}
      isLoading={false}
      error={null}
      data={makeResponse(items, { resumeSessionId: null })}
    />,
  );
  const cta = screen.getByRole('link', { name: /start/i });
  expect(cta).toHaveAttribute('href', '/drill?start=quick');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/web test -- today-timeline.test.tsx -t resume`
Expected: FAIL — link still `/drill?start=quick` / no "continue" text.

- [ ] **Step 3: Implement `ctaLabel` in `timeline-item.tsx`**

Add to `Props`:

```ts
  /** Primary CTA text for the next-up row. Defaults to 'start →'. */
  ctaLabel?: string;
```

Destructure it (`ctaLabel = 'start →'`) and use it in the button:

```tsx
            {isNextUp && href && (
              <Button variant="primary" size="md" href={href}>
                {ctaLabel}
              </Button>
            )}
```

(Default keeps every other caller — and the existing `timeline-item.test.tsx` — green.)

- [ ] **Step 4: Implement href + label in `today-timeline.tsx`**

Replace the `drillHref` line (`:76`) and thread the label into the next-up row:

```ts
  // Resume the in-progress today-session when one exists; otherwise launch fresh.
  const drillHref = data.resumeSessionId
    ? `/drill?resume=${data.resumeSessionId}`
    : `/drill?start=quick`;
  const ctaLabel = data.resumeSessionId ? 'continue →' : 'start →';
```

In the `TimelineItem` render, pass the label only to the next-up row:

```tsx
          <TimelineItem
            key={item.index}
            index={item.index}
            type={item.type}
            topicHint={item.topicHint}
            itemCount={item.itemCount}
            estimatedMinutes={item.estimatedMinutes}
            status={status}
            isLast={idx === itemsWithStatus.length - 1}
            href={status === 'next-up' ? drillHref : null}
            ctaLabel={status === 'next-up' ? ctaLabel : undefined}
          />
```

(The `AllDoneCard` branch keeps `drillHref` = `/drill?start=quick` since `resumeSessionId` is null when complete.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @language-drill/web test -- today-timeline.test.tsx timeline-item.test.tsx`
Expected: PASS (new resume cases + all existing rows, including the unchanged `timeline-item` default "start →").

- [ ] **Step 6: Commit**

```bash
git add "apps/web/app/(dashboard)/_components/timeline-item.tsx" "apps/web/app/(dashboard)/_components/today-timeline.tsx" "apps/web/app/(dashboard)/_components/__tests__/today-timeline.test.tsx"
git commit -m "feat(web): today timeline resumes in-progress session via ?resume"
```

---

### Task 7: Drill page resume effect

**Files:**
- Modify: `apps/web/app/(dashboard)/drill/page.tsx`
- Verify: manual (the page composes Clerk + many hooks; the resume seams — reducer, hook, timeline — are unit-tested in Tasks 4–6).

**Interfaces:**
- Consumes: `useResumeSession`, `firstUnattemptedIndex`, `RESUME_SUCCEEDED`.
- Behavior: with `?resume=<id>`, fetch the session; show the existing "creating" UI while loading; on data, resume at the first unattempted exercise. If already completed or all-attempted, finalize/redirect to the debrief instead of entering an empty session. `?start=quick` / `?start=dictation` behavior is unchanged.

- [ ] **Step 1: Parse the resume id**

Near the `startIntent` state (`page.tsx:76`):

```ts
  const [resumeId] = useState<string | null>(() => {
    const r = searchParams.get('resume');
    return r && z.string().uuid().safeParse(r).success ? r : null;
  });
```

(Import `z` from `zod` at the top — or reuse a simple regex if the page avoids a zod dep; the lambda re-validates regardless.)

- [ ] **Step 2: Wire the query**

After `createSession` is set up (`page.tsx:109`):

```ts
  const resumeQuery = useResumeSession({
    sessionId: resumeId ?? '',
    fetchFn,
    enabled: resumeId !== null && (state.kind === 'idle' || state.kind === 'creating'),
  });
```

Add `useResumeSession` and `firstUnattemptedIndex` to the existing imports (api-client and `./_components/session-reducer` respectively).

- [ ] **Step 3: Add the resume effect**

Alongside the create-session effect (`page.tsx:128`):

```ts
  const resumeKickoffRef = useRef(false);
  useEffect(() => {
    if (resumeId === null) return;
    // Show the loading ('creating') UI immediately, before the fetch resolves.
    if (state.kind === 'idle') {
      dispatch({ type: 'CREATE_REQUESTED' });
      return;
    }
    if (state.kind !== 'creating') return;
    if (resumeQuery.isError) {
      dispatch({ type: 'CREATE_FAILED', error: resumeQuery.error as Error });
      return;
    }
    const data = resumeQuery.data;
    if (!data) return;
    if (resumeKickoffRef.current) return;
    resumeKickoffRef.current = true;

    // Already finalized → straight to the debrief.
    if (data.completedAt !== null) {
      router.push(`/drill/debrief/${data.id}`);
      return;
    }
    const startIndex = firstUnattemptedIndex(
      data.exercises,
      new Set(data.attemptedExerciseIds),
    );
    // Every exercise attempted but not finalized → complete it, then debrief.
    if (startIndex === -1) {
      completeSession.mutate(
        { sessionId: data.id },
        {
          onSuccess: () => router.push(`/drill/debrief/${data.id}`),
          onError: (err) => dispatch({ type: 'CREATE_FAILED', error: err as Error }),
        },
      );
      return;
    }
    dispatch({ type: 'RESUME_SUCCEEDED', session: data, startIndex });
  }, [resumeId, state.kind, resumeQuery.data, resumeQuery.isError, resumeQuery.error, router, completeSession]);
```

- [ ] **Step 4: Guard the create effect against the resume path**

The create-session effect already returns early when `startIntent === null` (`page.tsx:130`). With `?resume`, `startIntent` is `null`, so no new session is created — no change needed. Confirm by reading the guard. (If a difficulty-change RESET path exists that could re-fire while resuming, it only runs from the idle hub, which the resume effect leaves via `CREATE_REQUESTED` — no extra guard required.)

- [ ] **Step 5: Typecheck + manual verification**

Run: `pnpm build --filter @language-drill/shared --filter @language-drill/db --filter @language-drill/api-client && pnpm --filter @language-drill/web typecheck`
Expected: exit 0.

Manual (use the `verify` skill / `pnpm dev`, dev auth bypass):
1. From "today", start the next-up row; answer exercise 1; go back to "today".
2. The next-up row now reads **continue →** and links to `/drill?resume=<id>`.
3. Click it → the **same** session reopens at exercise 2 of 5 (dots 1 filled), not a fresh 5-item session.
4. Finish the session → debrief as usual. Re-entering a completed day's "start" creates a fresh session (unchanged).

- [ ] **Step 6: Commit**

```bash
git add "apps/web/app/(dashboard)/drill/page.tsx"
git commit -m "feat(web): drill page resumes in-progress today-session via ?resume"
```

---

## Final verification

- [ ] `pnpm lint` — clean
- [ ] `pnpm typecheck` — clean
- [ ] `pnpm turbo run test --concurrency=1` — green (avoids the infra parallel-load flake; `rm -rf infra/lambda/dist` first if the lambda suite shows phantom failures)
- [ ] Manual flow from Task 7 Step 5 confirmed

## Self-review notes (coverage vs spec)

- Spec "resume handle on today response" → Task 1 + Task 3. ✓
- Spec "new GET /sessions/:id" → Task 2. ✓
- Spec "api-client hook + schema" → Task 4. ✓
- Spec "timeline link + continue label" → Task 6. ✓
- Spec "drill page resume path (+ all-attempted→debrief, completed→debrief)" → Task 7. ✓
- Spec "reducer RESUME_SUCCEEDED at first unattempted" → Task 5. ✓
- Spec edge "exercise deleted between create and resume" → Task 2 drops missing rows; `firstUnattemptedIndex` runs over survivors. ✓
- Out of scope (plan fidelity, multi-session dedupe) → not implemented, as agreed. ✓
