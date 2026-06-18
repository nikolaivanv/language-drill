# User-flagged exercises + admin review — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user flag an exercise attempt as wrong (bad answer-acceptance or bad explanation), and give admins a queue to review each flag (exercise + the user's answer + the evaluator's response) and reject the exercise or dismiss the flag.

**Architecture:** A new `exercise_flags` table records one flag per `user_exercise_history` row (the specific attempt). A user route inserts flags; the submit endpoint now returns the `submissionId` so the UI knows what to flag. Admin routes list open flags (joined to the exercise content + the attempt's `responseJson`) and resolve them (reject → exercise `reviewStatus='rejected'`, or dismiss → no change), recording an audit entry. The web app gets a low-emphasis flag control on the drill feedback surface and a new `/admin/flags` review page.

**Tech Stack:** Drizzle ORM + Neon Postgres, Hono on AWS Lambda, TanStack Query + Zod (`packages/api-client`), Next.js App Router + React Testing Library, Vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-18-user-exercise-flags-design.md`.
- Flags are a review queue: flagging has **no** effect on the exercise's pool status until an admin acts.
- Flag categories (exact values): `'wrong_answer' | 'misleading_explanation' | 'confusing_prompt' | 'other'`.
- Flag statuses (exact values): `'open' | 'resolved_rejected' | 'resolved_dismissed'`.
- "Reject" is terminal: it sets `exercises.reviewStatus='rejected'` (the existing pulled-from-pool status). It must NOT route into the soft `'flagged'` moderation queue.
- One flag per attempt: unique on `exercise_flags.history_id`; a duplicate returns `409` with code `ALREADY_FLAGGED`.
- Admin auth: all `/admin/*` routes are already gated by `authMiddleware` + `adminMiddleware` (`ADMIN_USER_IDS`). The web `(admin)` layout gates UX on `GET /me`'s `isAdmin`.
- Drizzle migrations are forward-only. Generate with `pnpm --filter @language-drill/db db:generate` (do NOT hand-write the SQL). If the next `NNNN` slot collides with `main`, take main's `migrations/meta`, `git rm` the stale `.sql`, and regenerate (see project memory `drizzle-migration-renumber-on-merge-conflict`).
- Do NOT apply this migration to the shared Neon `dev` branch from local `.env` (it pollutes per-PR CI forks — project memory `dev-branch-ci-fork-pollution`). The migration only needs to *generate* and *typecheck*; CI applies it on an ephemeral branch.
- `packages/ai` source must not import `@language-drill/db` (build-cycle memory) — not relevant here, but don't introduce it.
- Pre-push gate (run from repo root, must be green): `pnpm lint`, `pnpm typecheck`, then `pnpm turbo run test --concurrency=1` (parallel `pnpm test` flakes on `infra`). If you see phantom `infra/lambda/dist/**/*.test.js` failures, `rm -rf infra/lambda/dist` first (project memory `lambda-stale-dist-test-files`).

---

## File Structure

**Create:**
- `packages/db/src/schema/exercise-flags.ts` — `exerciseFlags` table.
- `packages/db/migrations/NNNN_*.sql` (+ `meta` update) — generated migration.
- `infra/lambda/src/routes/exercise-flags.ts` — user `POST /exercises/:exerciseId/flag` + admin `GET /admin/flags`, `POST /admin/flags/:id/reject|dismiss`. (Kept as its own route module so the user-facing and admin-facing flag endpoints live together and `admin.ts` doesn't grow.)
- `infra/lambda/src/routes/exercise-flags.test.ts` — route tests.
- `packages/api-client/src/schemas/user-flags.ts` — Zod request/response + queue item schemas.
- `packages/api-client/src/hooks/useUserFlags.ts` — `useFlagExercise`, `useUserFlagsQueue`, `useResolveUserFlag`.
- `apps/web/app/(dashboard)/drill/_components/flag-exercise-control.tsx` — the user-facing flag button + dialog.
- `apps/web/app/(dashboard)/drill/_components/__tests__/flag-exercise-control.test.tsx`.
- `apps/web/app/(admin)/admin/flags/page.tsx` — admin review queue page.
- `apps/web/app/(admin)/admin/flags/_components/flag-card.tsx` — one flag's review card.
- `apps/web/app/(admin)/admin/flags/__tests__/page.test.tsx`.

**Modify:**
- `packages/db/src/schema/index.ts` — export the new table.
- `infra/lambda/src/lib/admin-audit.ts` — add `'user_flag.reject' | 'user_flag.dismiss'` actions and `'exercise_flag'` target type.
- `infra/lambda/src/routes/exercises.ts` — return `submissionId` from all four submit return sites.
- `infra/lambda/src/routes/exercises.test.ts` — assert submit returns `submissionId`; add `exerciseFlags` mock sentinel if needed.
- `infra/lambda/src/index.ts` — mount the new route module.
- `packages/api-client/src/schemas/exercise.ts` — add optional `submissionId` to the three submit-result schemas.
- `packages/api-client/src/index.ts` — export the new schemas + hooks.
- `apps/web/app/(dashboard)/drill/_components/types.ts` — carry `submissionId` on the evaluated submission state.
- `apps/web/app/(dashboard)/drill/_components/session-reducer.ts` — thread `submissionId` through `ITEM_EVALUATED`.
- `apps/web/app/(dashboard)/drill/page.tsx` — capture `submissionId` on submit; render `<FlagExerciseControl>` under the evaluated exercise.
- `apps/web/components/admin/admin-nav-items.tsx` — add the "User flags" nav entry.
- `apps/web/app/(admin)/admin/audit/page.tsx` — add the two new audit actions to the `ACTIONS` filter list and `'exercise_flag'` to `TARGET_TYPES`.

---

## Task 1: `exercise_flags` schema + migration

**Files:**
- Create: `packages/db/src/schema/exercise-flags.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create (generated): `packages/db/migrations/NNNN_*.sql` + `packages/db/migrations/meta/*`

**Interfaces:**
- Produces: `exerciseFlags` pgTable with columns `id, historyId, exerciseId, userId, category, note, status, resolvedBy, resolvedAt, createdAt`; types `ExerciseFlag`, `NewExerciseFlag`. Unique index on `historyId`; index on `(status, createdAt)`.

- [ ] **Step 1: Write the schema module**

Create `packages/db/src/schema/exercise-flags.ts` (mirrors the FK/onDelete conventions in `progress.ts` and the index idiom in `audit.ts`):

```typescript
import { type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { exercises } from './exercises';
import { userExerciseHistory } from './progress';
import { users } from './users';

// User-submitted reports that an exercise attempt looked wrong (bad
// answer-acceptance or bad explanation). One row per attempt (unique history_id).
// Flagging has NO effect on the exercise pool — an admin reviews and decides.
export const exerciseFlags = pgTable(
  'exercise_flags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // The specific attempt being flagged. Cascade so right-to-erasure sweeps it.
    historyId: uuid('history_id')
      .notNull()
      .references(() => userExerciseHistory.id, { onDelete: 'cascade' }),
    // Denormalized for cheap admin filtering/joins; cascade with the exercise.
    exerciseId: uuid('exercise_id')
      .notNull()
      .references(() => exercises.id, { onDelete: 'cascade' }),
    // Who flagged. Cascade matches the user-owned-table erasure convention.
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // 'wrong_answer' | 'misleading_explanation' | 'confusing_prompt' | 'other'
    category: text('category').notNull(),
    note: text('note'), // nullable free-text
    // 'open' | 'resolved_rejected' | 'resolved_dismissed'
    status: text('status').notNull().default('open'),
    resolvedBy: text('resolved_by'), // admin userId; nullable
    resolvedAt: timestamp('resolved_at', { withTimezone: true }), // nullable
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // One flag per attempt.
    historyIdUnique: uniqueIndex('exercise_flags_history_id_unique').on(table.historyId),
    // Admin queue: filter by status, newest first.
    statusCreatedAtIdx: index('exercise_flags_status_created_at_idx').on(
      table.status,
      table.createdAt,
    ),
  }),
);

export type ExerciseFlag = InferSelectModel<typeof exerciseFlags>;
export type NewExerciseFlag = InferInsertModel<typeof exerciseFlags>;
```

- [ ] **Step 2: Export from the schema barrel**

In `packages/db/src/schema/index.ts`, after the `export { adminAuditLog } from './audit';` line add:

```typescript
export { exerciseFlags } from './exercise-flags';
export type { ExerciseFlag, NewExerciseFlag } from './exercise-flags';
```

- [ ] **Step 3: Generate the migration**

Run: `pnpm --filter @language-drill/db db:generate`
Expected: a new `packages/db/migrations/NNNN_<name>.sql` containing `CREATE TABLE "exercise_flags"` with the unique + status index, plus updated `migrations/meta/_journal.json` and a snapshot. Do NOT edit the SQL by hand.

- [ ] **Step 4: Build the db package and typecheck**

Run: `pnpm --filter @language-drill/db build && pnpm --filter @language-drill/db typecheck`
Expected: PASS. (Building refreshes `db/dist` so downstream package typechecks/tests resolve the new export — project memory `vitest-workspace-dist-resolution`.)

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/exercise-flags.ts packages/db/src/schema/index.ts packages/db/migrations
git commit -m "feat(db): exercise_flags table for user-submitted exercise flags"
```

---

## Task 2: Submit endpoint returns `submissionId`

The submit endpoint already mints `submissionId` and stores it as `user_exercise_history.id` but returns only the evaluation. Expose it so the UI can flag the attempt. Four return sites in `infra/lambda/src/routes/exercises.ts`: conjugation (`~370`), free-writing (`~483`), standard eval (`~533`), and dictation shares the standard-eval return.

**Files:**
- Modify: `infra/lambda/src/routes/exercises.ts`
- Modify: `infra/lambda/src/routes/exercises.test.ts`
- Modify: `packages/api-client/src/schemas/exercise.ts`

**Interfaces:**
- Produces: `POST /exercises/:id/submit` JSON now includes `submissionId: string` (uuid) alongside the existing result fields. The api-client `EvaluationResultSchema`, `DictationResultSchema`, `FreeWritingEvaluationSchema` each gain `submissionId: z.string().uuid().optional()`.

- [ ] **Step 1: Write the failing test (submit returns submissionId)**

In `infra/lambda/src/routes/exercises.test.ts`, find the existing happy-path submit test (the one asserting a 200 + evaluation body) and add an assertion next to it. If the suite has a conjugation submit test (zero-Claude path) use that — it needs no Claude mock. Add:

```typescript
it('returns the submissionId so the answer can be flagged', async () => {
  // ...existing arrange for a successful submit (reuse the nearest passing test's setup)...
  const res = await app.request(/* same request as the passing submit test */);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { submissionId?: string };
  expect(body.submissionId).toEqual(expect.any(String));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/lambda test -- exercises.test.ts -t "submissionId"`
Expected: FAIL — `body.submissionId` is `undefined`.

- [ ] **Step 3: Add `submissionId` to all four return sites**

In `infra/lambda/src/routes/exercises.ts`:
- Conjugation path: change `return c.json(result);` (the one right after the conjugation `userExerciseHistory` insert, ~line 370) to `return c.json({ ...result, submissionId });`.
- Free-writing path: change `return c.json(evaluation);` (~line 483) to `return c.json({ ...evaluation, submissionId });`.
- Standard eval / dictation path: change `return c.json(result);` (~line 533) to `return c.json({ ...result, submissionId });`.

`submissionId` is already in scope at each site (minted before the insert). Leave the Claude-failure `502` path untouched (no history row, nothing to flag).

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/lambda test -- exercises.test.ts -t "submissionId"`
Expected: PASS.

- [ ] **Step 5: Add `submissionId` to the api-client submit schemas**

In `packages/api-client/src/schemas/exercise.ts`, add `submissionId: z.string().uuid().optional(),` as the last field of each of: `EvaluationResultSchema` (after `estimatedCefrEvidence`), `DictationResultSchema` (after `criteria`), and `FreeWritingEvaluationSchema` (after `improvedWordCount`). Optional so existing callers and older responses still parse; `.parse()` will now preserve the field instead of stripping it.

- [ ] **Step 6: Build + typecheck the api-client**

Run: `pnpm --filter @language-drill/api-client build && pnpm --filter @language-drill/api-client typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add infra/lambda/src/routes/exercises.ts infra/lambda/src/routes/exercises.test.ts packages/api-client/src/schemas/exercise.ts
git commit -m "feat(api): return submissionId from exercise submit so attempts can be flagged"
```

---

## Task 3: Audit action types

**Files:**
- Modify: `infra/lambda/src/lib/admin-audit.ts`

**Interfaces:**
- Produces: `AdminAuditAction` includes `'user_flag.reject' | 'user_flag.dismiss'`; `AdminAuditTargetType` includes `'exercise_flag'`.

- [ ] **Step 1: Extend the action + target unions**

In `infra/lambda/src/lib/admin-audit.ts`, add to `AdminAuditAction`:

```typescript
  | 'user_flag.reject'
  | 'user_flag.dismiss'
```

and add `'exercise_flag'` to `AdminAuditTargetType`:

```typescript
export type AdminAuditTargetType = 'exercise' | 'theory_topic' | 'cell' | 'invite' | 'exercise_flag';
```

(The reject action targets the **exercise** with `targetType: 'exercise'`; `'exercise_flag'` is used as the dismiss target so the trail records which flag was dismissed. Both are valid here.)

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @language-drill/lambda typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add infra/lambda/src/lib/admin-audit.ts
git commit -m "feat(lambda): add user_flag audit actions"
```

---

## Task 4: Backend route — create a flag (user)

**Files:**
- Create: `infra/lambda/src/routes/exercise-flags.ts`
- Create: `infra/lambda/src/routes/exercise-flags.test.ts`
- Modify: `infra/lambda/src/index.ts`

**Interfaces:**
- Consumes: `exerciseFlags`, `userExerciseHistory` from `@language-drill/db`; `authMiddleware`, `Bindings`, `Variables` from `../middleware/auth`; `db` from `../db`.
- Produces: Hono router (default export) mounted at `/`. `POST /exercises/:exerciseId/flag` → body `{ submissionId: uuid, category: <enum>, note?: string }`. Returns `201 { id, status: 'open', createdAt }`; `400 VALIDATION_ERROR`; `404 SUBMISSION_NOT_FOUND` (no history row for this user matching the exercise); `409 ALREADY_FLAGGED`.

- [ ] **Step 1: Write the failing tests**

Create `infra/lambda/src/routes/exercise-flags.test.ts`. Model the DB mock on `admin.test.ts` (the `makeChain`/`queryQueue`/`vi.mock('../db')`/`vi.mock('@language-drill/db')` harness — copy it and add an `exerciseFlags: { __mock: 'exerciseFlags' }` sentinel). Auth env fixtures (`adminEnv`, `nonAdminEnv`, `unauthEnv`) come from the same file's pattern; here use a plain authenticated user env:

```typescript
const userEnv = { event: { requestContext: { authorizer: { jwt: { claims: { sub: 'user_1' } } } } } };
const otherUserEnv = { event: { requestContext: { authorizer: { jwt: { claims: { sub: 'user_2' } } } } } };

describe('POST /exercises/:exerciseId/flag', () => {
  it('400s on an invalid body', async () => {
    const res = await app.request('/exercises/11111111-1111-1111-1111-111111111111/flag', {
      method: 'POST', body: JSON.stringify({ category: 'nope' }), headers: { 'content-type': 'application/json' },
    }, userEnv);
    expect(res.status).toBe(400);
  });

  it('404s when the submission is not the caller\'s / does not match the exercise', async () => {
    queryQueue.push([]); // ownership lookup returns no row
    const res = await app.request('/exercises/11111111-1111-1111-1111-111111111111/flag', {
      method: 'POST',
      body: JSON.stringify({ submissionId: '22222222-2222-2222-2222-222222222222', category: 'wrong_answer' }),
      headers: { 'content-type': 'application/json' },
    }, otherUserEnv);
    expect(res.status).toBe(404);
  });

  it('inserts an open flag and returns 201', async () => {
    queryQueue.push([{ id: '22222222-2222-2222-2222-222222222222', userId: 'user_1', exerciseId: '11111111-1111-1111-1111-111111111111' }]); // ownership lookup
    const res = await app.request('/exercises/11111111-1111-1111-1111-111111111111/flag', {
      method: 'POST',
      body: JSON.stringify({ submissionId: '22222222-2222-2222-2222-222222222222', category: 'misleading_explanation', note: 'the reference answer is wrong' }),
      headers: { 'content-type': 'application/json' },
    }, userEnv);
    expect(res.status).toBe(201);
    const inserted = insertedValuesByTable['exerciseFlags'] as Record<string, unknown>;
    expect(inserted).toMatchObject({ historyId: '22222222-2222-2222-2222-222222222222', exerciseId: '11111111-1111-1111-1111-111111111111', userId: 'user_1', category: 'misleading_explanation', status: 'open' });
  });

  it('409s on a duplicate flag (unique history_id violation)', async () => {
    queryQueue.push([{ id: '22222222-2222-2222-2222-222222222222', userId: 'user_1', exerciseId: '11111111-1111-1111-1111-111111111111' }]);
    const dupErr = Object.assign(new Error('dup'), { code: '23505' });
    dbInsert.mockImplementationOnce(() => { const c = makeChain(); c.values = vi.fn(() => { throw dupErr; }); return c; });
    const res = await app.request('/exercises/11111111-1111-1111-1111-111111111111/flag', {
      method: 'POST',
      body: JSON.stringify({ submissionId: '22222222-2222-2222-2222-222222222222', category: 'other' }),
      headers: { 'content-type': 'application/json' },
    }, userEnv);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code?: string }).code).toBe('ALREADY_FLAGGED');
  });
});
```

(Note: `dbInsert` and `makeChain` must be exported/visible in the test file — copy them from `admin.test.ts`. The ownership lookup is staged on `queryQueue` because `db.select()...` awaits to the next queued value.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @language-drill/lambda test -- exercise-flags.test.ts`
Expected: FAIL — module `./exercise-flags` not found / route returns 404 for everything.

- [ ] **Step 3: Implement the user flag route**

Create `infra/lambda/src/routes/exercise-flags.ts`:

```typescript
import { Hono } from 'hono';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { exerciseFlags, exercises, userExerciseHistory } from '@language-drill/db';
import { db } from '../db';
import { authMiddleware } from '../middleware/auth';
import { adminMiddleware } from '../middleware/admin';
import type { Bindings, Variables } from '../middleware/auth';
import { recordAdminAction } from '../lib/admin-audit';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// User-facing: authenticate (no admin gate).
app.use('/exercises/:exerciseId/flag', authMiddleware);

const FlagCategory = z.enum([
  'wrong_answer',
  'misleading_explanation',
  'confusing_prompt',
  'other',
]);

const FlagBodySchema = z.object({
  submissionId: z.string().uuid(),
  category: FlagCategory,
  note: z.string().trim().max(1000).optional(),
});

function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 8; depth++) {
    if (current instanceof Error && 'code' in current && (current as { code: unknown }).code === '23505') return true;
    if (current instanceof Error && current.cause !== undefined) { current = current.cause; continue; }
    return false;
  }
  return false;
}

app.post('/exercises/:exerciseId/flag', async (c) => {
  const userId = c.get('userId');
  const exerciseId = c.req.param('exerciseId');
  if (!z.string().uuid().safeParse(exerciseId).success) {
    return c.json({ error: 'Invalid exercise id', code: 'VALIDATION_ERROR' }, 400);
  }
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON', code: 'VALIDATION_ERROR' }, 400); }
  const parsed = FlagBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid flag', code: 'VALIDATION_ERROR', details: parsed.error.flatten() }, 400);
  }
  const { submissionId, category, note } = parsed.data;

  // The attempt must exist, belong to the caller, and match the exercise in the
  // path — a user can only flag their own attempt of this exercise.
  const rows = await db
    .select({ id: userExerciseHistory.id, userId: userExerciseHistory.userId, exerciseId: userExerciseHistory.exerciseId })
    .from(userExerciseHistory)
    .where(and(eq(userExerciseHistory.id, submissionId), eq(userExerciseHistory.userId, userId), eq(userExerciseHistory.exerciseId, exerciseId)))
    .limit(1);
  if (rows.length === 0) {
    return c.json({ error: 'Submission not found', code: 'SUBMISSION_NOT_FOUND' }, 404);
  }

  const id = crypto.randomUUID();
  const createdAt = new Date();
  try {
    await db.insert(exerciseFlags).values({
      id, historyId: submissionId, exerciseId, userId, category, note: note ?? null, status: 'open', createdAt,
    });
  } catch (err) {
    if (isUniqueViolation(err)) return c.json({ error: 'Already flagged', code: 'ALREADY_FLAGGED' }, 409);
    throw err;
  }
  return c.json({ id, status: 'open', createdAt: createdAt.toISOString() }, 201);
});

export default app;
```

(Use `crypto.randomUUID()` — available in the Lambda Node runtime global; `exercises` is imported now because Task 5's admin GET joins it in this same file.)

- [ ] **Step 4: Mount the route**

In `infra/lambda/src/index.ts`, add the import after `import admin from './routes/admin';`:

```typescript
import exerciseFlags from './routes/exercise-flags';
```

and the mount after `app.route('/', admin);`:

```typescript
app.route('/', exerciseFlags);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @language-drill/lambda test -- exercise-flags.test.ts`
Expected: PASS (the 4 user-flag tests).

- [ ] **Step 6: Commit**

```bash
git add infra/lambda/src/routes/exercise-flags.ts infra/lambda/src/routes/exercise-flags.test.ts infra/lambda/src/index.ts
git commit -m "feat(lambda): POST /exercises/:id/flag — user-submitted exercise flags"
```

---

## Task 5: Backend routes — admin list + resolve flags

**Files:**
- Modify: `infra/lambda/src/routes/exercise-flags.ts`
- Modify: `infra/lambda/src/routes/exercise-flags.test.ts`

**Interfaces:**
- Consumes: `exerciseFlags`, `exercises`, `userExerciseHistory`; `recordAdminAction`; `adminMiddleware`.
- Produces:
  - `GET /admin/flags?status=open|resolved_rejected|resolved_dismissed|all` (default `open`) → `{ items: UserFlagQueueItem[], total }`, newest first, `limit` 1–200 (default 100). `UserFlagQueueItem = { id, status, category, note, createdAt, resolvedAt, exerciseId, submissionId, exercise: { language, level, type, grammarPointKey, reviewStatus, contentJson }, userAnswer, evaluation }`.
  - `POST /admin/flags/:id/reject` → sets exercise `reviewStatus='rejected'` (from any non-rejected status), flag → `resolved_rejected`; audit `user_flag.reject`. Returns `{ outcome }` where outcome ∈ `'rejected' | 'already_resolved' | 'not_found'`.
  - `POST /admin/flags/:id/dismiss` → flag → `resolved_dismissed`, exercise untouched; audit `user_flag.dismiss`. Returns `{ outcome }` where outcome ∈ `'dismissed' | 'already_resolved' | 'not_found'`.

- [ ] **Step 1: Write the failing tests**

Append to `infra/lambda/src/routes/exercise-flags.test.ts`. Reuse the `adminEnv`/`nonAdminEnv` fixtures and `process.env.ADMIN_USER_IDS` setup from `admin.test.ts` (set it in `beforeEach`, restore in `afterEach`). Stage `queryQueue` / `dbUpdate` results in call order:

```typescript
describe('GET /admin/flags', () => {
  it('403s for a non-admin', async () => {
    const res = await app.request('/admin/flags', undefined, nonAdminEnv);
    expect(res.status).toBe(403);
  });

  it('returns open flags joined to exercise + attempt', async () => {
    // list query (join) then count query, in Promise.all order
    queryQueue.push([{
      id: 'f1', status: 'open', category: 'wrong_answer', note: 'bad', createdAt: new Date('2026-06-18T00:00:00Z'), resolvedAt: null,
      exerciseId: 'ex1', submissionId: 'h1',
      exLanguage: 'ES', exLevel: 'B1', exType: 'cloze', exGrammar: 'es-b1-x', exReviewStatus: 'auto-approved', exContent: { type: 'cloze' },
      responseJson: { userAnswer: 'mi respuesta', evaluation: { score: 1, feedback: 'ok' } },
    }]);
    queryQueue.push([{ count: 1 }]);
    const res = await app.request('/admin/flags', undefined, adminEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<Record<string, unknown>>; total: number };
    expect(body.total).toBe(1);
    expect(body.items[0]).toMatchObject({ id: 'f1', userAnswer: 'mi respuesta', exerciseId: 'ex1' });
    expect((body.items[0].exercise as Record<string, unknown>).reviewStatus).toBe('auto-approved');
  });
});

describe('POST /admin/flags/:id/reject', () => {
  it('rejects the exercise and resolves the flag', async () => {
    // flag lookup → returns the open flag with its exerciseId
    queryQueue.push([{ id: 'f1', exerciseId: 'ex1', status: 'open' }]);
    // exercise reject update returns 1 row; flag resolve update returns 1 row
    // (dbUpdate chains pull from queryQueue via .returning() → then)
    queryQueue.push([{ id: 'ex1' }]);
    queryQueue.push([{ id: 'f1' }]);
    const res = await app.request('/admin/flags/f1/reject', { method: 'POST' }, adminEnv);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { outcome: string }).outcome).toBe('rejected');
  });

  it('returns not_found for an unknown flag', async () => {
    queryQueue.push([]); // flag lookup empty
    const res = await app.request('/admin/flags/missing/reject', { method: 'POST' }, adminEnv);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { outcome: string }).outcome).toBe('not_found');
  });
});

describe('POST /admin/flags/:id/dismiss', () => {
  it('resolves the flag without touching the exercise', async () => {
    queryQueue.push([{ id: 'f1', exerciseId: 'ex1', status: 'open' }]); // flag lookup
    queryQueue.push([{ id: 'f1' }]); // flag resolve update
    const res = await app.request('/admin/flags/f1/dismiss', { method: 'POST' }, adminEnv);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { outcome: string }).outcome).toBe('dismissed');
    // exercises table must not be updated on dismiss
    expect(dbUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ __mock: 'exercises' }));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @language-drill/lambda test -- exercise-flags.test.ts`
Expected: FAIL — admin routes not defined (404/401).

- [ ] **Step 3: Implement the admin routes**

In `infra/lambda/src/routes/exercise-flags.ts`, add the admin gate and three handlers (above `export default app;`). The list selects via a join from `exerciseFlags` → `userExerciseHistory` (for `responseJson`) → `exercises` (for content/status):

```typescript
// Admin-gated flag review + resolution.
app.use('/admin/flags', authMiddleware, adminMiddleware);
app.use('/admin/flags/*', authMiddleware, adminMiddleware);

const ListQuerySchema = z.object({
  status: z.enum(['open', 'resolved_rejected', 'resolved_dismissed', 'all']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

app.get('/admin/flags', async (c) => {
  const parsed = ListQuerySchema.safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: 'Invalid query', code: 'VALIDATION_ERROR', details: parsed.error.flatten() }, 400);
  const status = parsed.data.status ?? 'open';
  const limit = parsed.data.limit ?? 100;
  const where = status === 'all' ? undefined : eq(exerciseFlags.status, status);

  const baseSelect = {
    id: exerciseFlags.id, status: exerciseFlags.status, category: exerciseFlags.category,
    note: exerciseFlags.note, createdAt: exerciseFlags.createdAt, resolvedAt: exerciseFlags.resolvedAt,
    exerciseId: exerciseFlags.exerciseId, submissionId: exerciseFlags.historyId,
    exLanguage: exercises.language, exLevel: exercises.difficulty, exType: exercises.type,
    exGrammar: exercises.grammarPointKey, exReviewStatus: exercises.reviewStatus, exContent: exercises.contentJson,
    responseJson: userExerciseHistory.responseJson,
  };
  const listChain = db.select(baseSelect)
    .from(exerciseFlags)
    .innerJoin(userExerciseHistory, eq(userExerciseHistory.id, exerciseFlags.historyId))
    .innerJoin(exercises, eq(exercises.id, exerciseFlags.exerciseId));
  const countChain = db.select({ count: sql<number>`count(*)` }).from(exerciseFlags);

  const [rows, totalRows] = await Promise.all([
    (where ? listChain.where(where) : listChain).orderBy(desc(exerciseFlags.createdAt)).limit(limit),
    where ? countChain.where(where) : countChain,
  ]);

  const items = rows.map((r) => {
    const resp = (r.responseJson ?? {}) as { userAnswer?: unknown; evaluation?: unknown };
    return {
      id: r.id, status: r.status, category: r.category, note: r.note,
      createdAt: r.createdAt ? r.createdAt.toISOString() : null,
      resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
      exerciseId: r.exerciseId, submissionId: r.submissionId,
      exercise: { language: r.exLanguage, level: r.exLevel, type: r.exType, grammarPointKey: r.exGrammar, reviewStatus: r.exReviewStatus, contentJson: r.exContent },
      userAnswer: resp.userAnswer ?? null,
      evaluation: resp.evaluation ?? null,
    };
  });
  return c.json({ items, total: Number(totalRows[0]?.count ?? 0) });
});

type FlagResolveOutcome = 'rejected' | 'dismissed' | 'already_resolved' | 'not_found';

async function loadOpenFlag(id: string): Promise<{ exerciseId: string } | 'not_found' | 'already_resolved'> {
  const rows = await db.select({ id: exerciseFlags.id, exerciseId: exerciseFlags.exerciseId, status: exerciseFlags.status })
    .from(exerciseFlags).where(eq(exerciseFlags.id, id)).limit(1);
  if (rows.length === 0) return 'not_found';
  if (rows[0].status !== 'open') return 'already_resolved';
  return { exerciseId: rows[0].exerciseId };
}

app.post('/admin/flags/:id/reject', async (c) => {
  const id = c.req.param('id');
  const flag = await loadOpenFlag(id);
  if (flag === 'not_found' || flag === 'already_resolved') return c.json({ outcome: flag });
  // Terminal reject: pull from pool (from any non-rejected status).
  await db.update(exercises).set({ reviewStatus: 'rejected' }).where(eq(exercises.id, flag.exerciseId)).returning({ id: exercises.id });
  await db.update(exerciseFlags).set({ status: 'resolved_rejected', resolvedBy: c.get('userId'), resolvedAt: new Date() })
    .where(eq(exerciseFlags.id, id)).returning({ id: exerciseFlags.id });
  await recordAdminAction(db, { adminUserId: c.get('userId'), action: 'user_flag.reject', targetType: 'exercise', targetId: flag.exerciseId, metadata: { flagId: id } });
  return c.json({ outcome: 'rejected' as FlagResolveOutcome });
});

app.post('/admin/flags/:id/dismiss', async (c) => {
  const id = c.req.param('id');
  const flag = await loadOpenFlag(id);
  if (flag === 'not_found' || flag === 'already_resolved') return c.json({ outcome: flag });
  await db.update(exerciseFlags).set({ status: 'resolved_dismissed', resolvedBy: c.get('userId'), resolvedAt: new Date() })
    .where(eq(exerciseFlags.id, id)).returning({ id: exerciseFlags.id });
  await recordAdminAction(db, { adminUserId: c.get('userId'), action: 'user_flag.dismiss', targetType: 'exercise_flag', targetId: id, metadata: { exerciseId: flag.exerciseId } });
  return c.json({ outcome: 'dismissed' as FlagResolveOutcome });
});
```

Add `sql` to the `drizzle-orm` import at the top of the file: `import { and, desc, eq, sql } from 'drizzle-orm';`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @language-drill/lambda test -- exercise-flags.test.ts`
Expected: PASS (all user + admin tests).

- [ ] **Step 5: Typecheck the lambda package**

Run: `pnpm --filter @language-drill/lambda typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add infra/lambda/src/routes/exercise-flags.ts infra/lambda/src/routes/exercise-flags.test.ts
git commit -m "feat(lambda): admin GET /admin/flags + reject/dismiss resolution"
```

---

## Task 6: api-client schemas + hooks

**Files:**
- Create: `packages/api-client/src/schemas/user-flags.ts`
- Create: `packages/api-client/src/hooks/useUserFlags.ts`
- Modify: `packages/api-client/src/index.ts`

**Interfaces:**
- Consumes: `POST /exercises/:exerciseId/flag`, `GET /admin/flags`, `POST /admin/flags/:id/(reject|dismiss)` from Tasks 4–5.
- Produces:
  - Schemas: `FlagCategoryEnum`, `FlagExerciseRequestSchema`, `FlagExerciseResponseSchema`, `UserFlagQueueItemSchema`, `UserFlagsResponseSchema`, `ResolveUserFlagResponseSchema`, and the inferred types.
  - Hooks: `useFlagExercise({ fetchFn })` (mutation, vars `{ exerciseId, submissionId, category, note? }`), `useUserFlagsQueue({ fetchFn, status?, enabled? })` (query, key `['admin', 'user-flags', status]`), `useResolveUserFlag({ fetchFn })` (mutation, vars `{ id, action: 'reject' | 'dismiss' }`, invalidates `['admin', 'user-flags']`).

- [ ] **Step 1: Write the schemas**

Create `packages/api-client/src/schemas/user-flags.ts`:

```typescript
import { z } from 'zod';

export const FlagCategoryEnum = z.enum([
  'wrong_answer',
  'misleading_explanation',
  'confusing_prompt',
  'other',
]);
export type FlagCategory = z.infer<typeof FlagCategoryEnum>;

export const FlagExerciseRequestSchema = z.object({
  submissionId: z.string().uuid(),
  category: FlagCategoryEnum,
  note: z.string().trim().max(1000).optional(),
});
export type FlagExerciseRequest = z.infer<typeof FlagExerciseRequestSchema>;

export const FlagExerciseResponseSchema = z.object({
  id: z.string(),
  status: z.literal('open'),
  createdAt: z.string(),
});
export type FlagExerciseResponse = z.infer<typeof FlagExerciseResponseSchema>;

export const UserFlagQueueItemSchema = z.object({
  id: z.string(),
  status: z.enum(['open', 'resolved_rejected', 'resolved_dismissed']),
  category: FlagCategoryEnum,
  note: z.string().nullable(),
  createdAt: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  exerciseId: z.string(),
  submissionId: z.string(),
  exercise: z.object({
    language: z.string().nullable(),
    level: z.string().nullable(),
    type: z.string().nullable(),
    grammarPointKey: z.string().nullable(),
    reviewStatus: z.string().nullable(),
    contentJson: z.unknown(),
  }),
  userAnswer: z.unknown(),
  evaluation: z.unknown(),
});
export type UserFlagQueueItem = z.infer<typeof UserFlagQueueItemSchema>;

export const UserFlagsResponseSchema = z.object({
  items: z.array(UserFlagQueueItemSchema),
  total: z.number(),
});
export type UserFlagsResponse = z.infer<typeof UserFlagsResponseSchema>;

export const ResolveUserFlagOutcomeSchema = z.enum(['rejected', 'dismissed', 'already_resolved', 'not_found']);
export const ResolveUserFlagResponseSchema = z.object({ outcome: ResolveUserFlagOutcomeSchema });
export type ResolveUserFlagOutcome = z.infer<typeof ResolveUserFlagOutcomeSchema>;
```

- [ ] **Step 2: Write the hooks**

Create `packages/api-client/src/hooks/useUserFlags.ts`:

```typescript
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../fetchClient';
import {
  FlagExerciseResponseSchema,
  UserFlagsResponseSchema,
  ResolveUserFlagResponseSchema,
  type FlagCategory,
  type ResolveUserFlagOutcome,
} from '../schemas/user-flags';

export type UserFlagStatus = 'open' | 'resolved_rejected' | 'resolved_dismissed' | 'all';

export function useFlagExercise({ fetchFn }: { fetchFn: AuthenticatedFetch }) {
  return useMutation<
    { id: string; status: 'open'; createdAt: string },
    Error,
    { exerciseId: string; submissionId: string; category: FlagCategory; note?: string }
  >({
    mutationFn: async ({ exerciseId, submissionId, category, note }) => {
      const body: Record<string, unknown> = { submissionId, category };
      if (note !== undefined && note !== '') body.note = note;
      const res = await fetchFn(`/exercises/${exerciseId}/flag`, { method: 'POST', body: JSON.stringify(body) });
      const json: unknown = await res.json();
      return FlagExerciseResponseSchema.parse(json);
    },
  });
}

export function useUserFlagsQueue({
  fetchFn, status = 'open', enabled = true,
}: { fetchFn: AuthenticatedFetch; status?: UserFlagStatus; enabled?: boolean }) {
  return useQuery({
    queryKey: ['admin', 'user-flags', status],
    queryFn: async () => {
      const res = await fetchFn(`/admin/flags?status=${status}`);
      const json: unknown = await res.json();
      return UserFlagsResponseSchema.parse(json);
    },
    enabled,
  });
}

export function useResolveUserFlag({ fetchFn }: { fetchFn: AuthenticatedFetch }) {
  const queryClient = useQueryClient();
  return useMutation<ResolveUserFlagOutcome, Error, { id: string; action: 'reject' | 'dismiss' }>({
    mutationFn: async ({ id, action }) => {
      const res = await fetchFn(`/admin/flags/${id}/${action}`, { method: 'POST' });
      const json: unknown = await res.json();
      return ResolveUserFlagResponseSchema.parse(json).outcome;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'user-flags'] });
    },
  });
}
```

- [ ] **Step 3: Export from the barrel**

In `packages/api-client/src/index.ts`, add near the other schema/hook exports:

```typescript
export {
  FlagCategoryEnum, type FlagCategory,
  FlagExerciseRequestSchema, type FlagExerciseRequest,
  FlagExerciseResponseSchema, type FlagExerciseResponse,
  UserFlagQueueItemSchema, type UserFlagQueueItem,
  UserFlagsResponseSchema, type UserFlagsResponse,
  ResolveUserFlagResponseSchema, type ResolveUserFlagOutcome,
} from './schemas/user-flags';
export {
  useFlagExercise, useUserFlagsQueue, useResolveUserFlag, type UserFlagStatus,
} from './hooks/useUserFlags';
```

- [ ] **Step 4: Build + typecheck the api-client**

Run: `pnpm --filter @language-drill/api-client build && pnpm --filter @language-drill/api-client typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api-client/src/schemas/user-flags.ts packages/api-client/src/hooks/useUserFlags.ts packages/api-client/src/index.ts
git commit -m "feat(api-client): user-flags schemas + hooks (flag, queue, resolve)"
```

---

## Task 7: User UI — flag control on the drill surface

The flag control renders at the page level under `<ExercisePane>` when the current item is `evaluated` and a `submissionId` is present — rather than inside `FeedbackShell`, which would require threading `fetchFn`/ids through six per-type exercise components.

**Files:**
- Modify: `apps/web/app/(dashboard)/drill/_components/types.ts`
- Modify: `apps/web/app/(dashboard)/drill/_components/session-reducer.ts`
- Create: `apps/web/app/(dashboard)/drill/_components/flag-exercise-control.tsx`
- Create: `apps/web/app/(dashboard)/drill/_components/__tests__/flag-exercise-control.test.tsx`
- Modify: `apps/web/app/(dashboard)/drill/page.tsx`

**Interfaces:**
- Consumes: `useFlagExercise` (Task 6); `SubmissionState` evaluated variant gains optional `submissionId?: string`.
- Produces: `<FlagExerciseControl exerciseId submissionId fetchFn />` React component.

- [ ] **Step 1: Carry submissionId on the evaluated submission state**

In `apps/web/app/(dashboard)/drill/_components/types.ts`, change the evaluated variant:

```typescript
  | { kind: 'evaluated'; result: SubmissionResult; meta: SubmissionMeta; submissionId?: string }
```

- [ ] **Step 2: Thread submissionId through the reducer**

In `apps/web/app/(dashboard)/drill/_components/session-reducer.ts`:
- Change the `ITEM_EVALUATED` action type to include it:

```typescript
  | { type: 'ITEM_EVALUATED'; result: SubmissionResult; meta: SubmissionMeta; submissionId?: string }
```

- In the `ITEM_EVALUATED` case, pass it through:

```typescript
        perItemSubmission: {
          kind: 'evaluated',
          result: action.result,
          meta: action.meta,
          submissionId: action.submissionId,
        },
```

- [ ] **Step 3: Write the failing test for the control**

Create `apps/web/app/(dashboard)/drill/_components/__tests__/flag-exercise-control.test.tsx`:

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockMutate = vi.fn();
const mockUseFlagExercise = vi.fn(() => ({ mutate: mockMutate, isPending: false, isSuccess: false, isError: false }));
vi.mock('@language-drill/api-client', async () => {
  const actual = await vi.importActual<typeof import('@language-drill/api-client')>('@language-drill/api-client');
  return { ...actual, useFlagExercise: (args: unknown) => mockUseFlagExercise(args) };
});

import { FlagExerciseControl } from '../flag-exercise-control';

const fetchFn = vi.fn();

beforeEach(() => { mockMutate.mockReset(); });

describe('FlagExerciseControl', () => {
  it('opens the dialog and submits a category + note', () => {
    render(<FlagExerciseControl exerciseId="ex1" submissionId="sub1" fetchFn={fetchFn} />);
    fireEvent.click(screen.getByRole('button', { name: /flag this exercise/i }));
    fireEvent.click(screen.getByLabelText(/answer is wrong/i));
    fireEvent.change(screen.getByLabelText(/note/i), { target: { value: 'the reference is wrong' } });
    fireEvent.click(screen.getByRole('button', { name: /submit flag/i }));
    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({ exerciseId: 'ex1', submissionId: 'sub1', category: 'wrong_answer', note: 'the reference is wrong' }),
      expect.anything(),
    );
  });

  it('shows a confirmation after a successful flag', () => {
    mockUseFlagExercise.mockReturnValueOnce({ mutate: mockMutate, isPending: false, isSuccess: true, isError: false });
    render(<FlagExerciseControl exerciseId="ex1" submissionId="sub1" fetchFn={fetchFn} />);
    expect(screen.getByText(/flagged for review/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /flag this exercise/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/web test -- flag-exercise-control`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement the control**

Create `apps/web/app/(dashboard)/drill/_components/flag-exercise-control.tsx` (follow the app's existing primitives — `Button` from `components/ui`, the `t-*` type classes, `text-ink-*`/`bg-paper-*` tokens seen in sibling components):

```tsx
'use client';

import * as React from 'react';
import { useFlagExercise } from '@language-drill/api-client';
import type { AuthenticatedFetch } from '@language-drill/api-client';
import { Button } from '../../../../components/ui';

const CATEGORIES: { value: 'wrong_answer' | 'misleading_explanation' | 'confusing_prompt' | 'other'; label: string }[] = [
  { value: 'wrong_answer', label: 'The accepted answer is wrong' },
  { value: 'misleading_explanation', label: 'The explanation is wrong or misleading' },
  { value: 'confusing_prompt', label: 'The prompt is confusing' },
  { value: 'other', label: 'Something else' },
];

export interface FlagExerciseControlProps {
  exerciseId: string;
  submissionId: string;
  fetchFn: AuthenticatedFetch;
}

export function FlagExerciseControl({ exerciseId, submissionId, fetchFn }: FlagExerciseControlProps) {
  const [open, setOpen] = React.useState(false);
  const [category, setCategory] = React.useState<typeof CATEGORIES[number]['value']>('wrong_answer');
  const [note, setNote] = React.useState('');
  const flag = useFlagExercise({ fetchFn });

  if (flag.isSuccess) {
    return <p className="t-small text-ink-mute mt-s-3">Thanks — flagged for review.</p>;
  }

  if (!open) {
    return (
      <div className="mt-s-3 flex justify-end">
        <button
          type="button"
          className="t-small text-ink-mute underline underline-offset-2 hover:text-ink"
          onClick={() => setOpen(true)}
        >
          Flag this exercise
        </button>
      </div>
    );
  }

  return (
    <div className="mt-s-3 rounded-lg bg-paper-2 p-s-4">
      <p className="t-small font-medium">What's wrong with this exercise?</p>
      <fieldset className="mt-s-3 flex flex-col gap-s-2">
        {CATEGORIES.map((cat) => (
          <label key={cat.value} className="t-small flex items-center gap-s-2">
            <input
              type="radio"
              name="flag-category"
              value={cat.value}
              checked={category === cat.value}
              onChange={() => setCategory(cat.value)}
            />
            {cat.label}
          </label>
        ))}
      </fieldset>
      <label className="t-small mt-s-3 block">
        Note (optional)
        <textarea
          className="mt-s-1 w-full rounded-md bg-paper-1 p-s-2 t-small"
          rows={2}
          maxLength={1000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      {flag.isError && <p className="t-small text-[var(--color-accent)] mt-s-2">Couldn't submit — try again.</p>}
      <div className="mt-s-3 flex justify-end gap-s-2">
        <Button variant="ghost" onClick={() => setOpen(false)} disabled={flag.isPending}>Cancel</Button>
        <Button
          variant="accent"
          disabled={flag.isPending}
          onClick={() => flag.mutate({ exerciseId, submissionId, category, note: note.trim() || undefined }, { onSuccess: () => setOpen(false) })}
        >
          Submit flag
        </Button>
      </div>
    </div>
  );
}
```

(Check `components/ui` exports a `Button` with `variant="ghost"`; if not, use the variant the existing components use for a secondary button — grep `variant=` in sibling `_components`. Keep the radio labels matching the test's `getByLabelText(/answer is wrong/i)`.)

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/web test -- flag-exercise-control`
Expected: PASS.

- [ ] **Step 7: Wire submissionId + the control into the drill page**

In `apps/web/app/(dashboard)/drill/page.tsx`:
- In `handleSubmit`'s `onSuccess`, capture the id:

```typescript
        onSuccess: (result) =>
          dispatch({
            type: 'ITEM_EVALUATED',
            result: result as EvaluationResult,
            meta,
            submissionId: (result as { submissionId?: string }).submissionId,
          }),
```

- Import the control near the other `_components` imports:

```typescript
import { FlagExerciseControl } from './_components/flag-exercise-control';
```

- Render it just after `<ExercisePane ... />` inside the `state.kind === 'inSession' && currentItem` block, gated on the evaluated state + a present submissionId:

```tsx
          <ExercisePane
            exercise={currentItem}
            language={activeLanguage}
            submission={state.perItemSubmission}
            onSubmit={handleSubmit}
            onNext={handleNext}
            nextLabel={selectIsLastItem(state) ? 'see results' : 'next'}
          />
          {state.perItemSubmission.kind === 'evaluated' &&
            state.perItemSubmission.submissionId && (
              <FlagExerciseControl
                exerciseId={currentItem.id}
                submissionId={state.perItemSubmission.submissionId}
                fetchFn={fetchFn}
              />
            )}
```

- [ ] **Step 8: Typecheck + run the drill page/reducer tests**

Run: `pnpm --filter @language-drill/web typecheck && pnpm --filter @language-drill/web test -- session-reducer drill`
Expected: PASS. (If a reducer test constructs `ITEM_EVALUATED` actions, the new optional field is backward-compatible; if a test asserts the full evaluated object shape, add `submissionId: undefined` — grep `ITEM_EVALUATED` in tests first.)

- [ ] **Step 9: Commit**

```bash
git add apps/web/app/\(dashboard\)/drill/_components/types.ts apps/web/app/\(dashboard\)/drill/_components/session-reducer.ts apps/web/app/\(dashboard\)/drill/_components/flag-exercise-control.tsx apps/web/app/\(dashboard\)/drill/_components/__tests__/flag-exercise-control.test.tsx apps/web/app/\(dashboard\)/drill/page.tsx
git commit -m "feat(web): flag-this-exercise control on the drill feedback surface"
```

---

## Task 8: Admin UI — `/admin/flags` review page

**Files:**
- Create: `apps/web/app/(admin)/admin/flags/_components/flag-card.tsx`
- Create: `apps/web/app/(admin)/admin/flags/page.tsx`
- Create: `apps/web/app/(admin)/admin/flags/__tests__/page.test.tsx`
- Modify: `apps/web/components/admin/admin-nav-items.tsx`
- Modify: `apps/web/app/(admin)/admin/audit/page.tsx`

**Interfaces:**
- Consumes: `useUserFlagsQueue`, `useResolveUserFlag`, `UserFlagQueueItem` (Task 6).
- Produces: default-exported `FlagsPage` React component at route `/admin/flags`.

- [ ] **Step 1: Write the failing page test**

Create `apps/web/app/(admin)/admin/flags/__tests__/page.test.tsx` (mirror the audit page test's mocking of the api-client hooks):

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@clerk/nextjs', () => ({ useAuth: () => ({ getToken: vi.fn() }) }));

const mockUseQueue = vi.fn();
const mockResolveMutate = vi.fn();
vi.mock('@language-drill/api-client', async () => {
  const actual = await vi.importActual<typeof import('@language-drill/api-client')>('@language-drill/api-client');
  return {
    ...actual,
    createAuthenticatedFetch: () => vi.fn(),
    useUserFlagsQueue: (args: unknown) => mockUseQueue(args),
    useResolveUserFlag: () => ({ mutate: mockResolveMutate, isPending: false }),
  };
});

import FlagsPage from '../page';

const sampleFlag = {
  id: 'f1', status: 'open', category: 'wrong_answer', note: 'reference looks wrong',
  createdAt: '2026-06-18T00:00:00.000Z', resolvedAt: null, exerciseId: 'ex1', submissionId: 'h1',
  exercise: { language: 'ES', level: 'B1', type: 'cloze', grammarPointKey: 'es-b1-x', reviewStatus: 'auto-approved', contentJson: { type: 'cloze', prompt: 'Yo ___ feliz', answer: 'soy' } },
  userAnswer: 'estoy', evaluation: { score: 0, feedback: 'Not quite' },
};

beforeEach(() => { mockUseQueue.mockReset(); mockResolveMutate.mockReset(); });

describe('FlagsPage', () => {
  it('renders a flag card with the answer and the evaluator feedback', () => {
    mockUseQueue.mockReturnValue({ isLoading: false, isError: false, data: { items: [sampleFlag], total: 1 } });
    render(<FlagsPage />);
    expect(screen.getByText(/reference looks wrong/i)).toBeInTheDocument();
    expect(screen.getByText(/estoy/)).toBeInTheDocument();
    expect(screen.getByText(/not quite/i)).toBeInTheDocument();
  });

  it('calls reject', () => {
    mockUseQueue.mockReturnValue({ isLoading: false, isError: false, data: { items: [sampleFlag], total: 1 } });
    render(<FlagsPage />);
    fireEvent.click(screen.getByRole('button', { name: /reject exercise/i }));
    expect(mockResolveMutate).toHaveBeenCalledWith(expect.objectContaining({ id: 'f1', action: 'reject' }));
  });

  it('calls dismiss', () => {
    mockUseQueue.mockReturnValue({ isLoading: false, isError: false, data: { items: [sampleFlag], total: 1 } });
    render(<FlagsPage />);
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(mockResolveMutate).toHaveBeenCalledWith(expect.objectContaining({ id: 'f1', action: 'dismiss' }));
  });

  it('shows the empty state', () => {
    mockUseQueue.mockReturnValue({ isLoading: false, isError: false, data: { items: [], total: 0 } });
    render(<FlagsPage />);
    expect(screen.getByText(/no open flags/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/web test -- admin/flags`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the flag card**

Create `apps/web/app/(admin)/admin/flags/_components/flag-card.tsx`:

```tsx
'use client';

import * as React from 'react';
import type { UserFlagQueueItem } from '@language-drill/api-client';

const CATEGORY_LABEL: Record<string, string> = {
  wrong_answer: 'Accepted answer is wrong',
  misleading_explanation: 'Explanation is wrong/misleading',
  confusing_prompt: 'Prompt is confusing',
  other: 'Other',
};

function render(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

export interface FlagCardProps {
  flag: UserFlagQueueItem;
  onReject: () => void;
  onDismiss: () => void;
  disabled?: boolean;
}

export function FlagCard({ flag, onReject, onDismiss, disabled }: FlagCardProps) {
  const ex = flag.exercise;
  return (
    <div className="rounded-lg border border-line bg-paper-1 p-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-soft">
        <span className="font-medium text-ink">{CATEGORY_LABEL[flag.category] ?? flag.category}</span>
        <span>· {ex.language ?? '—'} {ex.level ?? ''} {ex.type ?? ''}</span>
        {ex.grammarPointKey && <span>· {ex.grammarPointKey}</span>}
        <span>· status: {ex.reviewStatus ?? '—'}</span>
        {flag.createdAt && <span>· {new Date(flag.createdAt).toLocaleString()}</span>}
      </div>

      {flag.note && <p className="text-[13px] text-ink">“{flag.note}”</p>}

      <details>
        <summary className="cursor-pointer text-[12px] text-ink-soft">Exercise</summary>
        <pre className="mt-1 whitespace-pre-wrap break-words text-[12px]">{render(ex.contentJson)}</pre>
      </details>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <div>
          <p className="text-[12px] text-ink-soft">User's answer</p>
          <pre className="mt-1 whitespace-pre-wrap break-words text-[13px]">{render(flag.userAnswer)}</pre>
        </div>
        <div>
          <p className="text-[12px] text-ink-soft">Evaluator response</p>
          <pre className="mt-1 whitespace-pre-wrap break-words text-[12px]">{render(flag.evaluation)}</pre>
        </div>
      </div>

      {flag.status === 'open' ? (
        <div className="flex gap-2">
          <button type="button" disabled={disabled} onClick={onReject} className="rounded-md bg-[var(--color-accent)] px-3 py-1 text-[13px] text-paper-1 disabled:opacity-40">Reject exercise</button>
          <button type="button" disabled={disabled} onClick={onDismiss} className="rounded-md bg-paper-3 px-3 py-1 text-[13px] disabled:opacity-40">Dismiss</button>
        </div>
      ) : (
        <p className="text-[12px] text-ink-soft">Resolved: {flag.status === 'resolved_rejected' ? 'rejected' : 'dismissed'}</p>
      )}
    </div>
  );
}
```

(Rename the local `render` helper if it shadows anything; the token/border classes mirror the audit/content admin components — grep a sibling admin `_components` card for the exact class names if `border-line`/`text-ink-soft` differ.)

- [ ] **Step 4: Implement the page**

Create `apps/web/app/(admin)/admin/flags/page.tsx`:

```tsx
'use client';

import { useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { createAuthenticatedFetch, useUserFlagsQueue, useResolveUserFlag, type UserFlagStatus } from '@language-drill/api-client';
import { FlagCard } from './_components/flag-card';

const STATUSES: UserFlagStatus[] = ['open', 'resolved_rejected', 'resolved_dismissed', 'all'];

export default function FlagsPage() {
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  const [status, setStatus] = useState<UserFlagStatus>('open');

  const queue = useUserFlagsQueue({ fetchFn, status });
  const resolve = useResolveUserFlag({ fetchFn });
  const items = queue.data?.items ?? [];

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-[24px] font-semibold text-ink">User flags</h1>

      <div className="flex gap-2 text-[13px]">
        <select aria-label="status" value={status} onChange={(e) => setStatus(e.target.value as UserFlagStatus)}>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {queue.isLoading ? <p className="text-ink-soft text-[13px]">Loading…</p>
        : queue.isError ? <p className="text-ink-soft text-[13px]">Failed to load flags.</p>
        : items.length === 0 ? <p className="text-ink-soft text-[13px]">No {status === 'open' ? 'open ' : ''}flags.</p>
        : (
          <div className="flex flex-col gap-3">
            {items.map((flag) => (
              <FlagCard
                key={flag.id}
                flag={flag}
                disabled={resolve.isPending}
                onReject={() => resolve.mutate({ id: flag.id, action: 'reject' })}
                onDismiss={() => resolve.mutate({ id: flag.id, action: 'dismiss' })}
              />
            ))}
          </div>
        )}
    </div>
  );
}
```

(The empty-state copy must contain "No open flags" when `status==='open'` to satisfy the test.)

- [ ] **Step 5: Add the nav entry**

In `apps/web/components/admin/admin-nav-items.tsx`, add to `ADMIN_NAV` after the `Moderation` entry:

```typescript
  { href: '/admin/flags', label: 'User flags' },
```

- [ ] **Step 6: Add the new audit actions to the audit page filters**

In `apps/web/app/(admin)/admin/audit/page.tsx`, update the hardcoded lists:
- `ACTIONS` array: add `'user_flag.reject', 'user_flag.dismiss'`.
- `TARGET_TYPES` array: add `'exercise_flag'`.

- [ ] **Step 7: Run the page test + the admin nav test**

Run: `pnpm --filter @language-drill/web test -- admin/flags admin-nav`
Expected: PASS. (If `admin-nav.test.tsx` asserts the exact nav-item count or list, update it to include "User flags" — project memory `component-label-route-change-grep-all-tests`: grep the app for `ADMIN_NAV`/nav labels.)

- [ ] **Step 8: Commit**

```bash
git add apps/web/app/\(admin\)/admin/flags apps/web/components/admin/admin-nav-items.tsx apps/web/app/\(admin\)/admin/audit/page.tsx
git commit -m "feat(web): /admin/flags review page + nav entry"
```

---

## Task 9: Full gate + branch wrap-up

**Files:** none (verification only).

- [ ] **Step 1: Clear stale lambda dist (guards phantom test failures)**

Run: `rm -rf infra/lambda/dist`
Expected: no output.

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: PASS, zero errors.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS across all packages.

- [ ] **Step 4: Full test suite (serialized to avoid the infra parallel flake)**

Run: `pnpm turbo run test --concurrency=1`
Expected: PASS across `db`, `shared`, `api-client`, `lambda`, `web`, `infra`. Report `X passed, Y failed`; if any fail, fix before continuing.

- [ ] **Step 5: Confirm the branch is clean and push**

Run: `git status` and `git log --oneline main..HEAD`
Expected: working tree clean; the commits from Tasks 1–8 present on `feat/user-exercise-flags`. Then push and open a PR (squash-merge per project convention).

---

## Self-Review

**Spec coverage:**
- New `exercise_flags` table → Task 1. ✓
- Flag references the specific attempt (history row) → unique `history_id`, ownership validation in Task 4. ✓
- Submit returns `submissionId` → Task 2. ✓
- User flag endpoint (category + optional note, no pool effect) → Task 4. ✓
- `409 ALREADY_FLAGGED` on duplicate → Task 4 Step 1/3. ✓
- Admin list joined to exercise content + attempt answer/evaluation → Task 5 GET. ✓
- Reject = terminal `reviewStatus='rejected'` + resolve + audit; Dismiss = no change + audit → Task 5. ✓
- Audit actions `user_flag.reject`/`user_flag.dismiss` → Task 3 (+ surfaced in audit page filters, Task 8). ✓
- api-client schemas + hooks (`user-flags`, avoiding the generation-time `flagged` collision) → Task 6. ✓
- User UI flag control (renders only when `submissionId` present) → Task 7. ✓
- New `/admin/flags` page + nav entry → Task 8. ✓
- Testing across db/lambda/api-client/web → each task + Task 9. ✓
- Out of scope (auto-demote thresholds, "my flags", notifications, free-writing flag UI) → not implemented; the backend endpoint nonetheless accepts any exercise type's attempt, so the free-writing surface can add the control later without backend change. ✓

**Placeholder scan:** No TBD/TODO; every code step shows concrete code; every command has an expected result.

**Type consistency:** `submissionId` (string/uuid) is consistent across submit response, reducer, control, and the admin item's `submissionId` (= `historyId`). Category enum values identical in db (text), lambda `FlagCategory`, api-client `FlagCategoryEnum`, and the web control. Status values identical across schema, lambda, and api-client. Resolve action verbs (`reject`/`dismiss`) consistent between the lambda routes, `useResolveUserFlag` vars, and the admin page buttons. Outcome enum (`rejected`/`dismissed`/`already_resolved`/`not_found`) matches between Task 5 and `ResolveUserFlagOutcomeSchema`.

**Note on the duplicate-flag code constant:** the canonical string is `ALREADY_FLAGGED` everywhere (Task 4 route + test).
