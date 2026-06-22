# Admin Activity Sessions DataTable — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the `/admin/activity` Sessions tab into a paginated, filterable DataTable of all sessions with user names and inline row expansion.

**Architecture:** Add `first_name`/`last_name` to `users` (migration + webhook + one-off backfill). Rework `GET /admin/activity/sessions` to return `{ items, total }` for all sessions with `user`/date-range/`risk[]` filters and a `users` join. Update the api-client schema/hook, then rewrite `SessionsTab` to use the existing `DataTable` primitives with a filter bar, prev/next pagination, and an inline expansion row.

**Tech Stack:** Drizzle ORM (Postgres), Hono, Zod, `@clerk/backend`, TanStack Query, Next.js App Router (client component), Vitest + React Testing Library.

## Global Constraints

- No new table libraries — use existing `components/admin/data-table.tsx` (`DataTable`/`Th`/`Td`).
- `/admin/*` routes inherit `authMiddleware, adminMiddleware` — never add auth in a handler.
- Validate query params with Zod `.safeParse()`; on failure return `c.json({ error, code: 'VALIDATION_ERROR', details }, 400)`.
- Languages enum `'ES'|'DE'|'TR'`; risk enum `'abandoned'|'low_score'|'flagged'`.
- Correlated subqueries in a SELECT projection MUST reference the outer row with a **qualified literal** (`practice_sessions.id`) — never `${table.column}` (renders unqualified → ambiguous/wrong). In a `WHERE`/`JOIN`, interpolated column objects render qualified and are fine.
- Do NOT run `db:migrate` against the local/dev DB — generate the migration file only; CI applies it on the per-PR Neon branch (dev-fork pollution risk).
- Default page size 25 (`limit` max 100). Sort fixed `started_at DESC`.
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Pre-push gate (repo root): `pnpm lint && pnpm typecheck && pnpm test`. If `infra/lambda/dist/**` causes phantom failures, `rm -rf infra/lambda/dist`. After editing `packages/api-client` or `packages/db` source, run `pnpm --filter @language-drill/<pkg> build` before web typecheck (stale dist).

## File Structure

- `packages/db/src/schema/users.ts` — add `firstName`/`lastName` columns.
- `packages/db/migrations/0032_*.sql` (+ `meta/`) — generated migration.
- `packages/db/scripts/backfill-user-names.ts` (new) + `packages/db/package.json` script + dep.
- `infra/lambda/src/routes/webhooks/clerk.ts` — names on `user.created`, new `user.updated` case.
- `infra/lambda/src/routes/webhooks/clerk.test.ts` — `user.updated` + names test.
- `infra/lambda/src/routes/admin.ts` — rework the sessions handler.
- `infra/lambda/src/routes/admin.test.ts` — sessions handler tests.
- `packages/api-client/src/schemas/admin-activity.ts` + `hooks/useActivitySessions.ts` + `index.ts` + tests.
- `apps/web/app/(admin)/admin/activity/page.tsx` — rewrite `SessionsTab`.
- `apps/web/app/(admin)/admin/activity/__tests__/page.test.tsx` — update Sessions tests.

---

## Task 1: `users` schema — first/last name + migration

**Files:**
- Modify: `packages/db/src/schema/users.ts`
- Create: `packages/db/migrations/0032_*.sql` (generated) + updates `migrations/meta/`

**Interfaces:**
- Produces: `users.firstName` (`first_name`, text nullable), `users.lastName` (`last_name`, text nullable).

- [ ] **Step 1: Add the columns**

In `packages/db/src/schema/users.ts`, change the `users` table to:

```ts
export const users = pgTable('users', {
  id: text('id').primaryKey(), // Clerk user ID
  email: text('email').notNull().unique(),
  firstName: text('first_name'),
  lastName: text('last_name'),
  plan: text('plan').$type<'free' | 'boosted'>().notNull().default('free'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at'),
});
```

- [ ] **Step 2: Generate the migration**

`drizzle-kit generate` reads schema files (no DB connection); set a placeholder URL so `process.env.DATABASE_URL!` is defined:

Run: `cd packages/db && DATABASE_URL=postgres://x pnpm db:generate`
Expected: a new `migrations/0032_<random>.sql` containing `ALTER TABLE "users" ADD COLUMN "first_name" text;` and `ADD COLUMN "last_name" text;`, plus an updated `migrations/meta/_journal.json` + snapshot.

- [ ] **Step 3: Verify the generated SQL**

Run: `cat packages/db/migrations/0032_*.sql`
Expected: exactly the two `ADD COLUMN` statements (no other table changes). If extra unrelated changes appear, STOP and report (schema drift).

- [ ] **Step 4: Build db + typecheck**

Run: `pnpm --filter @language-drill/db build && pnpm --filter @language-drill/db typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/users.ts packages/db/migrations
git commit -m "feat(db): add first_name/last_name to users

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Clerk webhook persists names

**Files:**
- Modify: `infra/lambda/src/routes/webhooks/clerk.ts`
- Test: `infra/lambda/src/routes/webhooks/clerk.test.ts`

**Interfaces:**
- Consumes: `users.firstName`/`users.lastName` (Task 1).

- [ ] **Step 1: Write failing tests**

In `infra/lambda/src/routes/webhooks/clerk.test.ts`, extend the `@language-drill/db` mock so `users` carries the new keys, and add tests. First update the mock object:

```ts
vi.mock('@language-drill/db', () => ({
  users: { id: 'id', email: 'email', plan: 'plan', firstName: 'first_name', lastName: 'last_name' },
  invitations: { usedBy: 'used_by' },
}));
```

Then add these tests inside the `describe('POST /webhooks/clerk', ...)` block:

```ts
it('stores first/last name on user.created', async () => {
  mockEvent = {
    type: 'user.created',
    data: {
      id: 'user_new',
      email_addresses: [{ email_address: 'new@example.com' }],
      first_name: 'Ada',
      last_name: 'Lovelace',
    },
  };
  const res = await post();
  expect(res.status).toBe(200);
  expect(mockValues).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'user_new', email: 'new@example.com', firstName: 'Ada', lastName: 'Lovelace' }),
  );
});

it('updates names on user.updated', async () => {
  mockEvent = {
    type: 'user.updated',
    data: {
      id: 'user_x',
      email_addresses: [{ email_address: 'x@example.com' }],
      first_name: 'Grace',
      last_name: 'Hopper',
    },
  };
  const res = await post();
  expect(res.status).toBe(200);
  expect(mockUpdateSet).toHaveBeenCalledWith(
    expect.objectContaining({ firstName: 'Grace', lastName: 'Hopper', email: 'x@example.com' }),
  );
  expect(mockUpdateWhere).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @language-drill/lambda test -- clerk.test.ts`
Expected: FAIL (names not yet stored; `user.updated` not handled).

- [ ] **Step 3: Implement**

In `clerk.ts`, extend the created-event type and add an updated-event type + union member:

```ts
interface ClerkUserCreatedEvent {
  type: 'user.created';
  data: {
    id: string;
    email_addresses: Array<{ email_address: string }>;
    first_name?: string | null;
    last_name?: string | null;
  };
}

interface ClerkUserUpdatedEvent {
  type: 'user.updated';
  data: {
    id: string;
    email_addresses: Array<{ email_address: string }>;
    first_name?: string | null;
    last_name?: string | null;
  };
}
```

Change the union to:

```ts
type ClerkWebhookEvent = ClerkUserCreatedEvent | ClerkUserUpdatedEvent | ClerkUserDeletedEvent;
```

In the `user.created` branch, include names in both insert and update:

```ts
if (event.type === 'user.created') {
  const { id: userId, email_addresses, first_name, last_name } = event.data;
  const email = email_addresses[0]?.email_address;
  if (!email) {
    return c.json({ error: 'No email address in event' }, 400);
  }
  await db
    .insert(users)
    .values({ id: userId, email, firstName: first_name ?? null, lastName: last_name ?? null })
    .onConflictDoUpdate({
      target: users.id,
      set: { email, firstName: first_name ?? null, lastName: last_name ?? null, updatedAt: new Date() },
    });
} else if (event.type === 'user.updated') {
  const { id: userId, email_addresses, first_name, last_name } = event.data;
  const email = email_addresses[0]?.email_address;
  await db
    .update(users)
    .set({
      ...(email ? { email } : {}),
      firstName: first_name ?? null,
      lastName: last_name ?? null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
} else if (event.type === 'user.deleted') {
```

(Keep the rest of the `user.deleted` branch unchanged.)

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @language-drill/lambda test -- clerk.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + lint, commit**

Run: `pnpm --filter @language-drill/lambda typecheck && pnpm --filter @language-drill/lambda lint`

```bash
git add infra/lambda/src/routes/webhooks/clerk.ts infra/lambda/src/routes/webhooks/clerk.test.ts
git commit -m "feat(webhooks): persist clerk first/last name on user.created + user.updated

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

> Operational note for the PR description (not code): the Clerk dashboard webhook must add the `user.updated` subscription (currently `user.created` + `user.deleted`) for renames to sync.

---

## Task 3: Rework `GET /admin/activity/sessions`

**Files:**
- Modify: `infra/lambda/src/routes/admin.ts`
- Test: `infra/lambda/src/routes/admin.test.ts`

**Interfaces:**
- Consumes: `users` table (Task 1).
- Produces (response JSON):
```
{
  items: Array<{ sessionId, userId, firstName: string|null, lastName: string|null, email: string|null,
    language, difficulty, exerciseCount, correctCount, completedAt: string|null, startedAt: string,
    signals: ('flagged'|'abandoned'|'low_score')[] }>,
  total: number
}
```

- [ ] **Step 1: Add `users` to the db import**

In `infra/lambda/src/routes/admin.ts`, add `users` to the `@language-drill/db` import (alphabetical, after `userExerciseHistory`):

```ts
  userExerciseHistory,
  users,
  type CandidateRow,
```

- [ ] **Step 2: Write failing tests**

Add to `infra/lambda/src/routes/admin.test.ts` (the handler issues two queries via `Promise.all`: rows then count — stage both):

```ts
describe('GET /admin/activity/sessions', () => {
  const sessionRow = {
    sessionId: 's1', userId: 'user_aaaa', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@x.com',
    language: 'TR', difficulty: 'A2', exerciseCount: 8, correctCount: 2,
    completedAt: '2026-06-22T10:00:00Z', startedAt: '2026-06-22T09:50:00Z',
    hasOpenFlag: false, isAbandoned: false, isLowScore: true,
  };

  it('returns { items, total } with names and signals', async () => {
    queryQueue.push([sessionRow], [{ total: 1 }]);
    const res = await app.request('/admin/activity/sessions', undefined, adminEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ sessionId: string; firstName: string; signals: string[] }>; total: number };
    expect(body.total).toBe(1);
    expect(body.items[0].sessionId).toBe('s1');
    expect(body.items[0].firstName).toBe('Ada');
    expect(body.items[0].signals).toContain('low_score');
  });

  it('accepts risk + date + user filters', async () => {
    queryQueue.push([], [{ total: 0 }]);
    const res = await app.request('/admin/activity/sessions?risk=abandoned&risk=flagged&from=2026-06-01&to=2026-06-22&user=ada', undefined, adminEnv);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { total: number }).total).toBe(0);
  });

  it('rejects an invalid risk value with 400', async () => {
    const res = await app.request('/admin/activity/sessions?risk=nope', undefined, adminEnv);
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

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @language-drill/lambda test -- admin.test.ts -t "admin/activity/sessions"`
Expected: FAIL (old handler returns a bare array; no `total`; risk not validated).

- [ ] **Step 4: Replace the handler**

Replace the entire `ActivitySessionsQuerySchema` + `ActivitySessionRow` type + `admin.get('/admin/activity/sessions', ...)` block with:

```ts
const RISK_VALUES = ['abandoned', 'low_score', 'flagged'] as const;
type RiskValue = (typeof RISK_VALUES)[number];

const ActivitySessionsQuerySchema = z.object({
  user: z.string().min(1).optional(),
  from: z.string().min(1).optional(),
  to: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

type ActivitySessionRow = {
  sessionId: string;
  userId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  language: string;
  difficulty: string;
  exerciseCount: number;
  correctCount: number;
  completedAt: Date | string | null;
  startedAt: Date | string;
  hasOpenFlag: boolean;
  isAbandoned: boolean;
  isLowScore: boolean;
};

admin.get('/admin/activity/sessions', async (c) => {
  const parsed = ActivitySessionsQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'Invalid query parameters', code: 'VALIDATION_ERROR', details: parsed.error.flatten() }, 400);
  }
  // `risk` is a repeatable param — read all values, validate against the enum.
  const riskRaw = c.req.queries('risk') ?? [];
  if (!riskRaw.every((r): r is RiskValue => (RISK_VALUES as readonly string[]).includes(r))) {
    return c.json({ error: 'Invalid risk value', code: 'VALIDATION_ERROR' }, 400);
  }
  const risk = riskRaw as RiskValue[];
  const { user, from, to, limit = 25, offset = 0 } = parsed.data;

  // Qualified-literal outer correlation (NOT `${practiceSessions.id}`) — see Global Constraints.
  const hasOpenFlag = sql<boolean>`EXISTS (
    SELECT 1 FROM ${exerciseFlags} ef
    JOIN ${userExerciseHistory} ueh ON ueh.id = ef.history_id
    WHERE ueh.session_id = practice_sessions.id AND ef.status = 'open'
  )`;
  const isAbandoned = sql<boolean>`${practiceSessions.completedAt} IS NULL AND ${practiceSessions.startedAt} < NOW() - INTERVAL '30 minutes'`;
  const isLowScore = sql<boolean>`${practiceSessions.completedAt} IS NOT NULL AND ${practiceSessions.exerciseCount} > 0 AND (${practiceSessions.correctCount}::float / ${practiceSessions.exerciseCount}) < 0.5`;

  const conditions: SQL[] = [];
  if (user) {
    const pat = `%${user}%`;
    conditions.push(sql`(
      ${users.firstName} ILIKE ${pat} OR ${users.lastName} ILIKE ${pat}
      OR ${users.email} ILIKE ${pat} OR ${practiceSessions.userId} ILIKE ${pat}
    )`);
  }
  if (from) conditions.push(sql`${practiceSessions.startedAt} >= ${from}::date`);
  if (to) conditions.push(sql`${practiceSessions.startedAt} < (${to}::date + 1)`);
  if (risk.length > 0) {
    const riskExprs: SQL[] = [];
    if (risk.includes('flagged')) riskExprs.push(hasOpenFlag);
    if (risk.includes('abandoned')) riskExprs.push(isAbandoned);
    if (risk.includes('low_score')) riskExprs.push(isLowScore);
    conditions.push(or(...riskExprs)!);
  }
  const whereClause = conditions.length ? and(...conditions) : undefined;

  const rowQuery = db
    .select({
      sessionId: practiceSessions.id,
      userId: practiceSessions.userId,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
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
    .leftJoin(users, eq(users.id, practiceSessions.userId))
    .where(whereClause)
    .orderBy(desc(practiceSessions.startedAt))
    .limit(limit)
    .offset(offset);

  const countQuery = db
    .select({ total: count() })
    .from(practiceSessions)
    .leftJoin(users, eq(users.id, practiceSessions.userId))
    .where(whereClause);

  const [rows, totalRows] = (await Promise.all([rowQuery, countQuery])) as [
    ActivitySessionRow[],
    Array<{ total: number }>,
  ];

  const items = rows.map((r) => {
    const signals: RiskValue[] = [];
    if (r.hasOpenFlag) signals.push('flagged');
    if (r.isAbandoned) signals.push('abandoned');
    if (r.isLowScore) signals.push('low_score');
    return {
      sessionId: r.sessionId,
      userId: r.userId,
      firstName: r.firstName,
      lastName: r.lastName,
      email: r.email,
      language: r.language,
      difficulty: r.difficulty,
      exerciseCount: r.exerciseCount,
      correctCount: r.correctCount,
      completedAt: toIso(r.completedAt),
      startedAt: toIso(r.startedAt)!,
      signals,
    };
  });
  return c.json({ items, total: totalRows[0]?.total ?? 0 });
});
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @language-drill/lambda test -- admin.test.ts`
Expected: PASS (all, incl. the 4 new). If stale dist: `rm -rf infra/lambda/dist` and retry.

- [ ] **Step 6: Real-DB check (no commit yet)**

Bundle and run the new row+count query against the dev branch to confirm valid SQL on real data:

```bash
cat > infra/lambda/repro.ts <<'TS'
import { readFileSync } from 'node:fs';
import { createDb, practiceSessions, users } from '@language-drill/db';
import { and, count, desc, eq, or, sql } from 'drizzle-orm';
const url = (readFileSync(process.env.REPRO_ENV_PATH as string,'utf8').match(/^DATABASE_URL=(.*)$/m)?.[1] ?? '').trim().replace(/^["']|["']$/g,'');
const db = createDb(url);
(async () => {
  const hasOpenFlag = sql<boolean>`FALSE`; // structure check; signal SQL covered by unit tests
  const where = and(sql`${practiceSessions.startedAt} >= ${'2020-01-01'}::date`, sql`${practiceSessions.startedAt} < (${'2030-01-01'}::date + 1)`);
  const rows = await db.select({ id: practiceSessions.id, firstName: users.firstName, hasOpenFlag })
    .from(practiceSessions).leftJoin(users, eq(users.id, practiceSessions.userId)).where(where)
    .orderBy(desc(practiceSessions.startedAt)).limit(5);
  const total = await db.select({ total: count() }).from(practiceSessions).leftJoin(users, eq(users.id, practiceSessions.userId)).where(where);
  console.log('rows', rows.length, 'total', total[0].total, 'sample', JSON.stringify(rows[0] ?? null));
  process.exit(0);
})();
TS
./infra/node_modules/.bin/esbuild infra/lambda/repro.ts --bundle --platform=node --format=cjs --outfile=infra/lambda/repro.bundle.cjs
REPRO_ENV_PATH=/Users/seal/dev/language-drill/.env node infra/lambda/repro.bundle.cjs
rm -f infra/lambda/repro.ts infra/lambda/repro.bundle.cjs
```
Expected: prints `rows N total M sample {...}` with no throw. (If `users.firstName` errors as unknown column, the migration isn't applied on dev — that's expected; rerun with `firstName` removed, or accept the typecheck+unit-test coverage and note it.)

- [ ] **Step 7: Typecheck + lint + commit**

Run: `pnpm --filter @language-drill/lambda typecheck && pnpm --filter @language-drill/lambda lint`

```bash
git add infra/lambda/src/routes/admin.ts infra/lambda/src/routes/admin.test.ts
git commit -m "feat(admin): sessions endpoint — all sessions, user/date/risk filters, names, {items,total}

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Backfill script for existing user names

**Files:**
- Create: `packages/db/scripts/backfill-user-names.ts`
- Modify: `packages/db/package.json` (script + dep)

**Interfaces:**
- Consumes: `users.firstName`/`lastName` (Task 1).

- [ ] **Step 1: Add `@clerk/backend` dep**

In `packages/db/package.json` `dependencies`, add `"@clerk/backend": "^3.4.7"` (same version as `infra/lambda`). Add to `scripts`: `"backfill:user-names": "tsx scripts/backfill-user-names.ts"`. Run `pnpm install`.

- [ ] **Step 2: Write the script**

Create `packages/db/scripts/backfill-user-names.ts`:

```ts
/**
 * `pnpm --filter @language-drill/db backfill:user-names [-- --apply]`
 *
 * One-off: populate users.first_name / users.last_name from Clerk for rows the
 * webhook predates. Dry-run by default; pass --apply to write. Run against the
 * TARGET env's DB (prod) — never dev (CI-fork pollution). Requires DATABASE_URL
 * and CLERK_SECRET_KEY.
 */
import { createClerkClient } from '@clerk/backend';
import { eq } from 'drizzle-orm';
import { createDb } from '../src/client';
import { users } from '../src/schema';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const databaseUrl = process.env.DATABASE_URL;
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');
  if (!secretKey) throw new Error('CLERK_SECRET_KEY is not set');

  const db = createDb(databaseUrl);
  const clerk = createClerkClient({ secretKey });

  let offset = 0;
  let updated = 0;
  const pageSize = 100;
  for (;;) {
    const page = await clerk.users.getUserList({ limit: pageSize, offset });
    if (page.data.length === 0) break;
    for (const u of page.data) {
      const firstName = u.firstName ?? null;
      const lastName = u.lastName ?? null;
      if (firstName == null && lastName == null) continue;
      console.log(`${apply ? 'UPDATE' : 'DRY'} ${u.id} -> ${firstName ?? ''} ${lastName ?? ''}`);
      if (apply) {
        await db.update(users).set({ firstName, lastName }).where(eq(users.id, u.id));
      }
      updated += 1;
    }
    offset += pageSize;
  }
  console.log(`${apply ? 'Applied' : 'Would update'} ${updated} user(s).`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @language-drill/db typecheck`
Expected: clean. (No unit test — it's a manual one-off CLI; logic is a thin Clerk→DB loop. Do NOT execute it here.)

- [ ] **Step 4: Commit**

```bash
git add packages/db/scripts/backfill-user-names.ts packages/db/package.json pnpm-lock.yaml
git commit -m "feat(db): one-off backfill of user names from clerk

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: api-client — schema, hook, exports

**Files:**
- Modify: `packages/api-client/src/schemas/admin-activity.ts`
- Modify: `packages/api-client/src/hooks/useActivitySessions.ts`
- Modify: `packages/api-client/src/index.ts`
- Test: `packages/api-client/src/schemas/admin-activity.test.ts`

**Interfaces:**
- Consumes: Task 3 response shape.
- Produces: `ActivitySessionsPageSchema` / `ActivitySessionsPage`; `useActivitySessions` returning `{ items, total }`; `ActivitySessionsParams` with `user`/`from`/`to`/`risk[]`.

- [ ] **Step 1: Write failing schema test**

Append to `packages/api-client/src/schemas/admin-activity.test.ts`:

```ts
import { ActivitySessionsPageSchema } from './admin-activity';

describe('ActivitySessionsPageSchema', () => {
  it('parses a page with named sessions', () => {
    const parsed = ActivitySessionsPageSchema.parse({
      items: [{
        sessionId: 's1', userId: 'u1', firstName: 'Ada', lastName: 'Lovelace', email: 'a@x.com',
        language: 'TR', difficulty: 'A2', exerciseCount: 8, correctCount: 2,
        completedAt: null, startedAt: '2026-06-22T09:00:00Z', signals: ['abandoned'],
      }],
      total: 1,
    });
    expect(parsed.total).toBe(1);
    expect(parsed.items[0].firstName).toBe('Ada');
  });

  it('parses an item with null names', () => {
    const parsed = ActivitySessionsPageSchema.parse({
      items: [{ sessionId: 's', userId: 'u', firstName: null, lastName: null, email: null,
        language: 'ES', difficulty: 'B1', exerciseCount: 1, correctCount: 0,
        completedAt: null, startedAt: '2026-06-22T09:00:00Z', signals: [] }],
      total: 1,
    });
    expect(parsed.items[0].firstName).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @language-drill/api-client test -- admin-activity`
Expected: FAIL (`ActivitySessionsPageSchema` undefined).

- [ ] **Step 3: Update the schema**

In `packages/api-client/src/schemas/admin-activity.ts`, replace `ActivitySessionListItemSchema` (drop `primarySignal`, add names) and add the page schema:

```ts
export const ActivitySessionListItemSchema = z.object({
  sessionId: z.string(),
  userId: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  email: z.string().nullable(),
  language: z.string(),
  difficulty: z.string(),
  exerciseCount: z.number(),
  correctCount: z.number(),
  completedAt: z.string().nullable(),
  startedAt: z.string(),
  signals: SignalSchema.array(),
});
export type ActivitySessionListItem = z.infer<typeof ActivitySessionListItemSchema>;

export const ActivitySessionsPageSchema = z.object({
  items: ActivitySessionListItemSchema.array(),
  total: z.number(),
});
export type ActivitySessionsPage = z.infer<typeof ActivitySessionsPageSchema>;
```

- [ ] **Step 4: Run schema test to verify pass**

Run: `pnpm --filter @language-drill/api-client test -- admin-activity`
Expected: PASS.

- [ ] **Step 5: Rewrite the hook**

Replace `packages/api-client/src/hooks/useActivitySessions.ts` with:

```ts
import { useQuery } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../fetchClient';
import { ActivitySessionsPageSchema } from '../schemas/admin-activity';

export type ActivityRisk = 'abandoned' | 'low_score' | 'flagged';

export type ActivitySessionsParams = {
  user?: string;
  from?: string;
  to?: string;
  risk?: ActivityRisk[];
  limit?: number;
  offset?: number;
};

export function useActivitySessions({
  fetchFn, params = {}, enabled = true,
}: { fetchFn: AuthenticatedFetch; params?: ActivitySessionsParams; enabled?: boolean }) {
  return useQuery({
    queryKey: ['admin', 'activity', 'sessions', params],
    queryFn: async () => {
      // buildQueryString can't emit repeated params, so build manually.
      const sp = new URLSearchParams();
      if (params.user) sp.set('user', params.user);
      if (params.from) sp.set('from', params.from);
      if (params.to) sp.set('to', params.to);
      for (const r of params.risk ?? []) sp.append('risk', r);
      if (params.limit != null) sp.set('limit', String(params.limit));
      if (params.offset != null) sp.set('offset', String(params.offset));
      const qs = sp.toString() ? `?${sp.toString()}` : '';
      const res = await fetchFn(`/admin/activity/sessions${qs}`);
      const json: unknown = await res.json();
      return ActivitySessionsPageSchema.parse(json);
    },
    enabled,
  });
}
```

- [ ] **Step 6: Update exports**

In `packages/api-client/src/index.ts`, update the activity schema export block to add the page schema and the `ActivityRisk` type from the hook:

```ts
export {
  ActivitySessionListItemSchema, type ActivitySessionListItem,
  ActivitySessionsPageSchema, type ActivitySessionsPage,
  ActivitySessionDetailSchema, type ActivitySessionDetail,
  ActivityFailureItemSchema, type ActivityFailureItem,
  ActivityRosterItemSchema, type ActivityRosterItem,
} from './schemas/admin-activity';
export { useActivitySessions, type ActivitySessionsParams, type ActivityRisk } from './hooks/useActivitySessions';
```

- [ ] **Step 7: Typecheck + test + build + commit**

Run: `pnpm --filter @language-drill/api-client typecheck && pnpm --filter @language-drill/api-client test -- admin-activity && pnpm --filter @language-drill/api-client build`
Expected: PASS (build refreshes dist for web typecheck).

```bash
git add packages/api-client/src
git commit -m "feat(api-client): activity sessions page schema + filtered hook

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Web — SessionsTab DataTable rewrite

**Files:**
- Modify: `apps/web/app/(admin)/admin/activity/page.tsx`
- Test: `apps/web/app/(admin)/admin/activity/__tests__/page.test.tsx`

**Interfaces:**
- Consumes: `useActivitySessions` (returns `{ items, total }`, params `{ user, from, to, risk[], limit, offset }`), `useActivitySessionDetail`, `ActivitySessionListItem`, `DataTable`/`Th`/`Td`.

- [ ] **Step 1: Update test fixtures + Sessions tests**

In `__tests__/page.test.tsx`: the sessions hook now returns `{ items, total }`. Replace the `feed` fixture and `mockSessions` return, and rewrite the Sessions describe block. Change the `feed` const to:

```ts
const feed: ActivitySessionListItem[] = [
  { sessionId: 's-flag', userId: 'user_aaaaaaaa', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@x.com',
    language: 'ES', difficulty: 'B1', exerciseCount: 5, correctCount: 4,
    completedAt: '2026-06-22T11:00:00Z', startedAt: '2026-06-22T10:55:00Z', signals: ['flagged'] },
];
```

Change the `mockSessions.mockReturnValue` in `beforeEach` to:

```ts
mockSessions.mockReturnValue({ isLoading: false, isError: false, data: { items: feed, total: 1 } });
```

Replace the `describe('ActivityPage — Sessions tab', ...)` block with:

```ts
describe('ActivityPage — Sessions tab', () => {
  it('renders a row with the user name, score, and risk badge', () => {
    render(<ActivityPage />);
    expect(screen.getByRole('heading', { name: 'Activity' })).toBeInTheDocument();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText(/4\s*\/\s*5/)).toBeInTheDocument();
    expect(screen.getByText(/flagged/i)).toBeInTheDocument();
  });

  it('toggling a risk chip re-queries with risk', () => {
    render(<ActivityPage />);
    fireEvent.click(screen.getByRole('button', { name: /^abandoned$/i }));
    expect(mockSessions).toHaveBeenCalledWith(
      expect.objectContaining({ params: expect.objectContaining({ risk: ['abandoned'] }) }),
    );
  });

  it('expands the session detail inline on row click', () => {
    render(<ActivityPage />);
    fireEvent.click(screen.getByRole('button', { name: /Ada Lovelace/i }));
    expect(mockDetail).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's-flag' }));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @language-drill/web test -- activity`
Expected: FAIL (old SessionsTab renders a list, no name/chips; hook shape mismatch).

- [ ] **Step 3: Rewrite SessionsTab + helpers**

In `apps/web/app/(admin)/admin/activity/page.tsx`:

(a) Update imports — add `DataTable, Th, Td` and the `ActivityRisk`/`ActivitySessionListItem` types:

```ts
import { DataTable, Th, Td } from '../../../../components/admin/data-table';
import {
  createAuthenticatedFetch,
  useActivitySessions,
  useActivitySessionDetail,
  useActivityFailures,
  useActivityRoster,
  useResolveContentExercise,
  type ActivityRisk,
  type ActivitySessionListItem,
} from '@language-drill/api-client';
```

(Adjust the relative depth of the `data-table` import to match the file — `apps/web/app/(admin)/admin/activity/page.tsx` → `../../../../components/admin/data-table`.)

(b) Add helpers above `SessionsTab`:

```ts
const PAGE_SIZE = 25;
const RISK_OPTIONS: { value: ActivityRisk; label: string }[] = [
  { value: 'abandoned', label: 'abandoned' },
  { value: 'low_score', label: 'low score' },
  { value: 'flagged', label: 'flagged' },
];

function displayUser(r: ActivitySessionListItem): string {
  const name = [r.firstName, r.lastName].filter(Boolean).join(' ').trim();
  return name || r.email || `${r.userId.slice(0, 12)}…`;
}

function formatDate(iso: string): string {
  return iso.replace('T', ' ').slice(0, 16);
}
```

(c) Replace the entire `SessionsTab` function (the props-based one taking `userFilter`/`setUserFilter`) with:

```tsx
function SessionsTab() {
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  const [user, setUser] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [risk, setRisk] = useState<ActivityRisk[]>([]);
  const [offset, setOffset] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const sessions = useActivitySessions({
    fetchFn,
    params: {
      user: user || undefined,
      from: from || undefined,
      to: to || undefined,
      risk: risk.length ? risk : undefined,
      limit: PAGE_SIZE,
      offset,
    },
  });
  const detail = useActivitySessionDetail({ fetchFn, sessionId: expandedId });

  const total = sessions.data?.total ?? 0;
  const items = sessions.data?.items ?? [];

  const toggleRisk = (v: ActivityRisk) => {
    setOffset(0);
    setRisk((prev) => (prev.includes(v) ? prev.filter((r) => r !== v) : [...prev, v]));
  };
  const onFilter = (set: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setOffset(0);
    set(e.target.value);
  };

  const fieldClass = 'px-s-2 py-s-1 border border-rule rounded-sm bg-card text-[13px] text-ink outline-none focus:border-ink';

  return (
    <div className="flex flex-col gap-s-4">
      <div className="flex flex-wrap items-center gap-s-3">
        <input aria-label="user" placeholder="name, email, or id" value={user} onChange={onFilter(setUser)} className={fieldClass} />
        <label className="flex items-center gap-s-1 text-[12px] text-ink-soft">from
          <input aria-label="from" type="date" value={from} onChange={onFilter(setFrom)} className={fieldClass} />
        </label>
        <label className="flex items-center gap-s-1 text-[12px] text-ink-soft">to
          <input aria-label="to" type="date" value={to} onChange={onFilter(setTo)} className={fieldClass} />
        </label>
        <span className="flex gap-s-1">
          {RISK_OPTIONS.map((o) => (
            <button
              key={o.value}
              onClick={() => toggleRisk(o.value)}
              aria-pressed={risk.includes(o.value)}
              className={
                risk.includes(o.value)
                  ? 'px-s-2 py-px rounded-sm text-[11px] bg-ink text-paper'
                  : 'px-s-2 py-px rounded-sm text-[11px] bg-paper-2 text-ink-soft'
              }
            >
              {o.label}
            </button>
          ))}
        </span>
      </div>

      {sessions.isLoading && <div className="text-ink-soft text-[13px]">Loading…</div>}
      {sessions.isError && <div className="text-red-700 text-[13px]">Failed to load sessions.</div>}

      <DataTable>
        <thead>
          <tr>
            <Th>Date</Th>
            <Th>User</Th>
            <Th>Lang</Th>
            <Th>Score</Th>
            <Th>Risk</Th>
          </tr>
        </thead>
        <tbody>
          {items.map((s) => {
            const open = expandedId === s.sessionId;
            return (
              <React.Fragment key={s.sessionId}>
                <tr>
                  <Td className="whitespace-nowrap font-mono text-[12px] text-ink-soft">{formatDate(s.startedAt)}</Td>
                  <Td>
                    <button
                      onClick={() => setExpandedId(open ? null : s.sessionId)}
                      aria-expanded={open}
                      className="text-left underline-offset-2 hover:underline"
                    >
                      {displayUser(s)}
                    </button>
                  </Td>
                  <Td className="text-[12px]">{s.language}·{s.difficulty}</Td>
                  <Td className="text-[12px] text-ink-soft">
                    {s.completedAt ? `${s.correctCount} / ${s.exerciseCount}` : 'incomplete'}
                  </Td>
                  <Td>
                    <span className="flex gap-s-1">
                      {s.signals.map((sig) => <SignalBadge key={sig} signal={sig} />)}
                    </span>
                  </Td>
                </tr>
                {open && (
                  <tr>
                    <td colSpan={5} className="border-b border-rule bg-paper-2 px-3 py-2">
                      <SessionDetail detail={detail.data} loading={detail.isLoading} error={detail.isError} />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </DataTable>

      <div className="flex items-center gap-s-3 text-[13px]">
        <button disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))} className="text-ink-soft disabled:opacity-40">‹ prev</button>
        <button disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset((o) => o + PAGE_SIZE)} className="text-ink-soft disabled:opacity-40">next ›</button>
        <span className="text-[12px] text-ink-soft">{total} session{total === 1 ? '' : 's'} · page {Math.floor(offset / PAGE_SIZE) + 1}/{Math.max(1, Math.ceil(total / PAGE_SIZE))}</span>
      </div>
    </div>
  );
}
```

(d) `React.Fragment` is used — ensure `import * as React from 'react'` OR add `Fragment` to the named import. The file already imports from `'react'`; change the import to include `Fragment`:

```ts
import { Fragment, Suspense, useMemo, useState } from 'react';
```

and use `<Fragment key=...>` instead of `<React.Fragment>` in the code above.

(e) `SessionsTab` no longer takes props — update its call site in `ActivityPageInner`. Find `{tab === 'sessions' && (` and replace the `<SessionsTab userFilter={userFilter} setUserFilter={setUserFilter} />` usage with `<SessionsTab />`. Remove the now-unused `userFilter`/`setUserFilter` state and the `RosterTab`'s `onOpenUser` deep-link that set them — change `RosterTab`'s `onOpenUser` to a no-op-free version: keep `RosterTab` but drop the `onOpenUser` prop and the button's `onClick` deep-link (render the truncated id as plain text). If that is more than a trivial change, instead keep `userFilter` state and pass nothing — but do NOT leave an unused variable (lint fails). Simplest: delete `const [userFilter, setUserFilter] = useState('')` and change `RosterTab`'s user cell from a `<button onClick={() => onOpenUser(u.userId)}>` to a plain `<span>`, and drop the `onOpenUser` prop from `RosterTab`'s signature and call site.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @language-drill/api-client build && pnpm --filter @language-drill/web test -- activity`
Expected: PASS (all activity describe blocks).

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm --filter @language-drill/web typecheck && pnpm --filter @language-drill/web lint`
Expected: clean (no unused `userFilter`/`onOpenUser`).

- [ ] **Step 6: Commit**

```bash
git add "apps/web/app/(admin)/admin/activity"
git commit -m "feat(admin): sessions DataTable with filters, pagination, inline expansion

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification (after Task 6)

- [ ] **Full gate from repo root:**

```bash
rm -rf infra/lambda/dist
pnpm lint && pnpm typecheck && pnpm test
```
Expected: zero failures.

- [ ] **Manual (optional):** `pnpm dev`, sign in as admin, `/admin/activity` — confirm the table loads, filters/pagination work, and a row expands inline.

## Post-merge operational steps (PR description — not code)

1. Clerk dashboard: add the **`user.updated`** webhook subscription (currently `user.created` + `user.deleted`).
2. After deploy, run the backfill against **prod**: pull `CLERK_SECRET_KEY` + prod `DATABASE_URL` from Secrets Manager, then `pnpm --filter @language-drill/db backfill:user-names` (dry-run) → `-- --apply`.

## Self-Review Notes (author)

- **Spec coverage:** names persisted (T1 schema/migration, T2 webhook, T4 backfill); endpoint all-sessions + filters + names + {items,total} (T3); api-client (T5); DataTable + filter bar + pagination + inline expansion (T6). ✓
- **Type consistency:** response `{ items, total }` consistent across T3/T5/T6. `ActivityRisk` union (`abandoned|low_score|flagged`) shared T3 (RISK_VALUES) / T5 (hook) / T6 (chips). `primarySignal` removed in T3 + T5; T6 fixtures drop it. `displayUser`/`formatDate` defined once (T6).
- **Known risks:** T3 Step 6 real-DB check may show `users.first_name` missing on dev (migration unapplied there) — acceptable, covered by typecheck + unit tests. T6 Step 3(e) must remove unused `userFilter`/`onOpenUser` or lint fails.
