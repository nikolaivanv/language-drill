# Invite-as-Perk Usage Tiers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn invite codes from an (inert) access gate into a 10× usage perk — anyone signs up free (50 evals + 50 annotations/day), an invite code or admin status unlocks 10×, with a global kill-switch capping total spend.

**Architecture:** A stored `users.plan` column (`'free'`/`'boosted'`) is the tier source of truth, layered with a dynamic admin override (`ADMIN_USER_IDS`). A single limits module (`limitFor`) and a global-capacity guard are reused by all three AI endpoints, which now meter three **separate** buckets (eval / skim-annotation / deep-span). Redemption (`POST /invites/redeem`), a tier-aware `GET /me`, and admin invite endpoints sit on the existing Hono API; the frontend adds a slim invite layer (landing page, post-signup redemption, settings, admin page) on top of Clerk-hosted auth.

**Tech Stack:** Drizzle ORM + Neon Postgres, Hono on AWS Lambda, AWS CDK, Next.js App Router + Clerk + TanStack Query + Zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-03-invite-perk-tier-design.md`

---

## Key design refinement (vs spec)

The admin 10× override is resolved **dynamically** via `isAdmin(userId)` (env `ADMIN_USER_IDS`), layered on top of the stored plan, rather than persisted. So:
- **Effective plan** = `isAdmin(userId) || users.plan === 'boosted' ? 'boosted' : 'free'`.
- The **migration backfill** only needs to set `plan='boosted'` for existing users who already hold a claimed invitation; admins are always boosted via the env check, and adding someone to `ADMIN_USER_IDS` later boosts them instantly with no DB write.
- The **kill-switch** distinguishes admin from invited-boosted: a hard kill blocks everyone except `isAdmin` users; the soft cap blocks only `'free'` users.

## File structure

**Create:**
- `infra/lambda/src/usage/limits.ts` — `BASE_DAILY_LIMITS`, `BOOST_MULTIPLIER`, `limitFor()`. Pure.
- `infra/lambda/src/usage/limits.test.ts`
- `infra/lambda/src/usage/plan.ts` — `isAdmin()`, `getEffectivePlan()`, `effectivePlanFor()`.
- `infra/lambda/src/usage/plan.test.ts`
- `infra/lambda/src/usage/global-capacity.ts` — `checkGlobalCapacity()` + 60s cache.
- `infra/lambda/src/usage/global-capacity.test.ts`
- `infra/lambda/src/routes/me.ts` — `GET /me`.
- `infra/lambda/src/routes/me.test.ts`
- `infra/lambda/src/routes/invites.ts` — `POST /invites/redeem` + code generator.
- `infra/lambda/src/routes/invites.test.ts`
- `packages/api-client/src/schemas/me.ts`, `packages/api-client/src/schemas/invites.ts`
- `packages/api-client/src/hooks/useMe.ts`, `useRedeemInvite.ts`, `useAdminInvites.ts`
- `apps/web/app/invite/[code]/page.tsx`
- `apps/web/components/invite/redeem-code-box.tsx`
- `apps/web/components/invite/post-signup-redeem.tsx`
- `apps/web/components/settings/plan-and-limits.tsx`
- `apps/web/app/(dashboard)/admin/invites/page.tsx`

**Modify:**
- `packages/db/src/schema/users.ts` — add `plan`.
- `packages/db/src/schema/access.ts` — add `invitations.note`, `invitations.revokedAt`.
- `packages/db/migrations/<generated>.sql` — schema + backfill.
- `infra/lambda/src/routes/exercises.ts` — split bucket + tier + guard.
- `infra/lambda/src/annotate-stream/handler.ts` — skim bucket split + tier + guard.
- `infra/lambda/src/annotate-stream/deep-flow.ts` — tier + guard.
- `infra/lambda/src/routes/admin.ts` — invite admin endpoints.
- `infra/lambda/src/routes/webhooks/clerk.ts` — set plan, remove auto-claim.
- `infra/lambda/src/index.ts` — mount `me` + `invites` routers.
- Their respective `*.test.ts` files.
- `infra/lib/stack.ts`, `infra/lib/constructs/lambda.ts`, `infra/lib/constructs/annotate-stream-lambda.ts` — env vars.
- `packages/api-client/src/index.ts` — export new schemas/hooks.
- `apps/web/app/(dashboard)/settings/page.tsx` — mount Plan & Limits.

**Note on test commands:** the lambda tests import types from `@language-drill/db`. If a single-package run resolves stale types, build db first: `pnpm --filter @language-drill/db build`. (See memory: vitest-workspace-dist-resolution.)

---

## Task 1: DB schema — `users.plan`, `invitations.note`, `invitations.revokedAt`

**Files:**
- Modify: `packages/db/src/schema/users.ts:5-10`
- Modify: `packages/db/src/schema/access.ts:5-21`
- Create (generated): `packages/db/migrations/0017_*.sql`

- [ ] **Step 1: Add `plan` to the users table**

In `packages/db/src/schema/users.ts`, change the `users` table:

```typescript
export const users = pgTable('users', {
  id: text('id').primaryKey(), // Clerk user ID
  email: text('email').notNull().unique(),
  // Usage tier. 'free' = base daily limits; 'boosted' = 10x (granted by an
  // invite code). Admin users (ADMIN_USER_IDS) are boosted dynamically at
  // request time and are NOT required to carry 'boosted' here. Reserve 'pro'
  // for a future Stripe tier (treated as boosted).
  plan: text('plan').notNull().default('free'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at'),
});
```

- [ ] **Step 2: Add `note` + `revokedAt` to invitations**

In `packages/db/src/schema/access.ts`, add two columns inside the `invitations` table object (after `expiresAt`):

```typescript
    expiresAt: timestamp('expires_at'), // nullable
    note: text('note'), // nullable — free-text label, e.g. who the code is for
    revokedAt: timestamp('revoked_at'), // nullable — set when an admin revokes
    createdAt: timestamp('created_at').defaultNow(),
```

- [ ] **Step 3: Generate the migration**

Run: `pnpm --filter @language-drill/db db:generate`
Expected: a new file `packages/db/migrations/0017_<slug>.sql` containing
`ALTER TABLE "users" ADD COLUMN "plan" text DEFAULT 'free' NOT NULL;` and two
`ALTER TABLE "invitations" ADD COLUMN ...` statements, plus an updated snapshot
and `_journal.json` entry.

- [ ] **Step 4: Append the backfill to the generated migration**

Open the generated `0017_<slug>.sql` and append (the `--> statement-breakpoint`
separator is required between statements, matching `0015_tr_a1_realign_cleanup.sql`):

```sql
--> statement-breakpoint
-- Backfill: existing users who already hold a claimed invitation keep their
-- perk as a boosted plan. Admins are boosted dynamically (ADMIN_USER_IDS), so
-- they need no backfill here.
UPDATE "users" SET "plan" = 'boosted'
WHERE "id" IN (SELECT "used_by" FROM "invitations" WHERE "used_by" IS NOT NULL);
```

- [ ] **Step 5: Typecheck the db package**

Run: `pnpm --filter @language-drill/db typecheck`
Expected: PASS (no errors).

- [ ] **Step 6: Apply the migration against a scratch DB and verify**

Run (against a dev/branch DATABASE_URL — never production):
`pnpm db:migrate`
Then verify the column exists, e.g. via `pnpm db:studio` or:
`psql "$DATABASE_URL" -c "\\d users"` → shows `plan | text | not null default 'free'`.
Expected: migration applies cleanly; `plan` defaults to `'free'`.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/schema/users.ts packages/db/src/schema/access.ts packages/db/migrations/
git commit -m "feat(db): add users.plan + invitations.note/revokedAt with backfill"
```

---

## Task 2: Limits resolver module (pure, TDD)

**Files:**
- Create: `infra/lambda/src/usage/limits.ts`
- Test: `infra/lambda/src/usage/limits.test.ts`

- [ ] **Step 1: Write the failing test**

Create `infra/lambda/src/usage/limits.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { limitFor, BASE_DAILY_LIMITS, BOOST_MULTIPLIER } from './limits';

describe('limitFor', () => {
  it('returns base limits for the free plan', () => {
    expect(limitFor('ai_evaluation', 'free')).toBe(50);
    expect(limitFor('read_annotation', 'free')).toBe(50);
    expect(limitFor('read_span_annotation', 'free')).toBe(150);
  });

  it('multiplies by 10 for the boosted plan', () => {
    expect(limitFor('ai_evaluation', 'boosted')).toBe(500);
    expect(limitFor('read_annotation', 'boosted')).toBe(500);
    expect(limitFor('read_span_annotation', 'boosted')).toBe(1500);
  });

  it('exposes the base table and multiplier', () => {
    expect(BASE_DAILY_LIMITS.ai_evaluation).toBe(50);
    expect(BOOST_MULTIPLIER).toBe(10);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/lambda test src/usage/limits.test.ts`
Expected: FAIL — `Cannot find module './limits'`.

- [ ] **Step 3: Write the implementation**

Create `infra/lambda/src/usage/limits.ts`:

```typescript
// Single source of truth for per-bucket daily AI usage limits. The three AI
// endpoints (answer evaluation, skim annotation, deep-span annotation) each
// meter a SEPARATE bucket; a boosted plan raises every bucket by BOOST_MULTIPLIER.

export type MeteredEventType =
  | 'ai_evaluation'
  | 'read_annotation'
  | 'read_span_annotation';

export type Plan = 'free' | 'boosted';

export const BASE_DAILY_LIMITS: Record<MeteredEventType, number> = {
  ai_evaluation: 50,
  read_annotation: 50,
  read_span_annotation: 150,
};

export const BOOST_MULTIPLIER = 10;

export function limitFor(eventType: MeteredEventType, plan: Plan): number {
  const base = BASE_DAILY_LIMITS[eventType];
  return plan === 'boosted' ? base * BOOST_MULTIPLIER : base;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/lambda test src/usage/limits.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/usage/limits.ts infra/lambda/src/usage/limits.test.ts
git commit -m "feat(lambda): add central daily-limit resolver"
```

---

## Task 3: Plan resolver (`isAdmin` + effective plan, TDD)

**Files:**
- Create: `infra/lambda/src/usage/plan.ts`
- Test: `infra/lambda/src/usage/plan.test.ts`

- [ ] **Step 1: Write the failing test**

Create `infra/lambda/src/usage/plan.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the db module so getEffectivePlan can be tested without a real DB.
const mockLimit = vi.fn();
const mockWhere = vi.fn(() => ({ limit: mockLimit }));
const mockFrom = vi.fn(() => ({ where: mockWhere }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));
vi.mock('../db', () => ({ db: { select: () => mockSelect() } }));
vi.mock('@language-drill/db', () => ({ users: { id: 'id', plan: 'plan' } }));

describe('plan resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_USER_IDS = 'admin_1, admin_2';
  });
  afterEach(() => {
    delete process.env.ADMIN_USER_IDS;
  });

  it('isAdmin matches trimmed comma-separated ids', async () => {
    const { isAdmin } = await import('./plan');
    expect(isAdmin('admin_1')).toBe(true);
    expect(isAdmin('admin_2')).toBe(true);
    expect(isAdmin('someone_else')).toBe(false);
  });

  it('effectivePlanFor boosts admins regardless of stored plan', async () => {
    const { effectivePlanFor } = await import('./plan');
    expect(effectivePlanFor('admin_1', 'free')).toBe('boosted');
    expect(effectivePlanFor('user_x', 'boosted')).toBe('boosted');
    expect(effectivePlanFor('user_x', 'free')).toBe('free');
  });

  it('getEffectivePlan reads stored plan then applies admin override', async () => {
    const { getEffectivePlan } = await import('./plan');
    mockLimit.mockResolvedValueOnce([{ plan: 'free' }]);
    expect(await getEffectivePlan('user_x')).toBe('free');

    mockLimit.mockResolvedValueOnce([{ plan: 'boosted' }]);
    expect(await getEffectivePlan('user_x')).toBe('boosted');

    // admin with a missing row still resolves boosted
    mockLimit.mockResolvedValueOnce([]);
    expect(await getEffectivePlan('admin_1')).toBe('boosted');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/lambda test src/usage/plan.test.ts`
Expected: FAIL — `Cannot find module './plan'`.

- [ ] **Step 3: Write the implementation**

Create `infra/lambda/src/usage/plan.ts`:

```typescript
import { eq } from 'drizzle-orm';
import { users } from '@language-drill/db';
import { db } from '../db';
import type { Plan } from './limits';

/** True if the Clerk userId is in the ADMIN_USER_IDS allowlist. */
export function isAdmin(userId: string): boolean {
  return (process.env.ADMIN_USER_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(userId);
}

/** Layer the dynamic admin override on top of a stored plan. */
export function effectivePlanFor(userId: string, storedPlan: string): Plan {
  if (isAdmin(userId)) return 'boosted';
  return storedPlan === 'boosted' ? 'boosted' : 'free';
}

/** Load the stored plan for a user and apply the admin override. */
export async function getEffectivePlan(userId: string): Promise<Plan> {
  if (isAdmin(userId)) return 'boosted';
  const rows = await db
    .select({ plan: users.plan })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0]?.plan === 'boosted' ? 'boosted' : 'free';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/lambda test src/usage/plan.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/usage/plan.ts infra/lambda/src/usage/plan.test.ts
git commit -m "feat(lambda): add effective-plan resolver with admin override"
```

---

## Task 4: Global-capacity guard (kill-switch + soft cap, TDD)

**Files:**
- Create: `infra/lambda/src/usage/global-capacity.ts`
- Test: `infra/lambda/src/usage/global-capacity.test.ts`

- [ ] **Step 1: Write the failing test**

Create `infra/lambda/src/usage/global-capacity.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockWhere = vi.fn();
const mockFrom = vi.fn(() => ({ where: mockWhere }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));
vi.mock('../db', () => ({ db: { select: () => mockSelect() } }));
vi.mock('@language-drill/db', () => ({ usageEvents: { createdAt: 'created_at' } }));

describe('checkGlobalCapacity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.AI_KILL_SWITCH;
    delete process.env.AI_GLOBAL_DAILY_CAP;
    mockWhere.mockResolvedValue([{ count: 0 }]);
  });
  afterEach(() => {
    delete process.env.AI_KILL_SWITCH;
    delete process.env.AI_GLOBAL_DAILY_CAP;
  });

  it('returns ok when no controls are configured', async () => {
    const { checkGlobalCapacity } = await import('./global-capacity');
    expect(await checkGlobalCapacity({ plan: 'free', admin: false })).toBe('ok');
  });

  it('kill switch blocks non-admins but exempts admins', async () => {
    process.env.AI_KILL_SWITCH = 'on';
    const { checkGlobalCapacity } = await import('./global-capacity');
    expect(await checkGlobalCapacity({ plan: 'boosted', admin: false })).toBe('killed');
    expect(await checkGlobalCapacity({ plan: 'boosted', admin: true })).toBe('ok');
  });

  it('soft cap blocks only free users once the global count is exceeded', async () => {
    process.env.AI_GLOBAL_DAILY_CAP = '100';
    mockWhere.mockResolvedValue([{ count: 100 }]);
    const { checkGlobalCapacity } = await import('./global-capacity');
    expect(await checkGlobalCapacity({ plan: 'free', admin: false })).toBe('capped');
    expect(await checkGlobalCapacity({ plan: 'boosted', admin: false })).toBe('ok');
  });

  it('soft cap allows free users below the cap', async () => {
    process.env.AI_GLOBAL_DAILY_CAP = '100';
    mockWhere.mockResolvedValue([{ count: 99 }]);
    const { checkGlobalCapacity } = await import('./global-capacity');
    expect(await checkGlobalCapacity({ plan: 'free', admin: false })).toBe('ok');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/lambda test src/usage/global-capacity.test.ts`
Expected: FAIL — `Cannot find module './global-capacity'`.

- [ ] **Step 3: Write the implementation**

Create `infra/lambda/src/usage/global-capacity.ts`:

```typescript
import { and, count, gte } from 'drizzle-orm';
import { usageEvents } from '@language-drill/db';
import { db } from '../db';
import type { Plan } from './limits';

export type CapacityVerdict = 'ok' | 'killed' | 'capped';

// 60s module-scope cache of the trailing-24h global usage count so the soft
// cap doesn't add a COUNT(*) to every AI request. Upstash counters are the
// later scale path; at current volume a cached aggregate is plenty.
const CACHE_TTL_MS = 60_000;
let cache: { value: number; expiresAt: number } | null = null;

async function globalUsageLast24h(): Promise<number> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.value;
  const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ count: count() })
    .from(usageEvents)
    .where(and(gte(usageEvents.createdAt, oneDayAgo)));
  const value = Number(rows[0]?.count ?? 0);
  cache = { value, expiresAt: now + CACHE_TTL_MS };
  return value;
}

/** Test-only: reset the module cache between cases. */
export function __resetCapacityCache(): void {
  cache = null;
}

/**
 * Global cost/abuse brake, evaluated before the per-user cap.
 * - `killed`: AI_KILL_SWITCH is on and the caller is not an admin.
 * - `capped`: AI_GLOBAL_DAILY_CAP is set, the caller is on the free plan, and
 *   total AI usage in the trailing 24h has reached the cap. Boosted/admin pass.
 * - `ok`: otherwise.
 */
export async function checkGlobalCapacity(args: {
  plan: Plan;
  admin: boolean;
}): Promise<CapacityVerdict> {
  if ((process.env.AI_KILL_SWITCH ?? '').toLowerCase() === 'on' && !args.admin) {
    return 'killed';
  }
  const capRaw = process.env.AI_GLOBAL_DAILY_CAP;
  const cap = capRaw ? Number.parseInt(capRaw, 10) : NaN;
  if (Number.isFinite(cap) && args.plan === 'free') {
    if ((await globalUsageLast24h()) >= cap) return 'capped';
  }
  return 'ok';
}
```

Note: each test case sets env before the dynamic `import('./global-capacity')`,
and Vitest module isolation gives a fresh cache per case; `__resetCapacityCache`
is available if a test needs to re-run within one module instance.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/lambda test src/usage/global-capacity.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/usage/global-capacity.ts infra/lambda/src/usage/global-capacity.test.ts
git commit -m "feat(lambda): add global capacity guard (kill switch + soft cap)"
```

---

## Task 5: Apply tiers + guard to answer evaluation (`/exercises/:id/submit`)

**Files:**
- Modify: `infra/lambda/src/routes/exercises.ts:27,181-199`
- Test: `infra/lambda/src/routes/exercises.test.ts`

- [ ] **Step 1: Replace the constant + rate-limit block**

In `infra/lambda/src/routes/exercises.ts`, remove `const DAILY_EVAL_LIMIT = 50;`
(line 27) and add imports near the other local imports (after line 24):

```typescript
import { limitFor } from '../usage/limits';
import { getEffectivePlan, isAdmin } from '../usage/plan';
import { checkGlobalCapacity } from '../usage/global-capacity';
```

Replace the "3. Check daily usage limit" block (lines 181-199) with:

```typescript
  // 3. Resolve tier, run the global brake, then the per-user daily cap.
  const plan = await getEffectivePlan(userId);

  const capacity = await checkGlobalCapacity({ plan, admin: isAdmin(userId) });
  if (capacity !== 'ok') {
    return c.json(
      {
        error: 'AI temporarily at capacity',
        code: 'GLOBAL_CAPACITY',
      },
      503,
    );
  }

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [{ count: todayCount }] = await db
    .select({ count: count() })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.userId, userId),
        eq(usageEvents.eventType, 'ai_evaluation'),
        gte(usageEvents.createdAt, oneDayAgo),
      ),
    );

  if (Number(todayCount) >= limitFor('ai_evaluation', plan)) {
    return c.json(
      { error: 'Daily evaluation limit exceeded', code: 'RATE_LIMIT_EXCEEDED' },
      429,
    );
  }
```

- [ ] **Step 2: Add mocks for the new modules to the test file**

In `infra/lambda/src/routes/exercises.test.ts`, after the existing `vi.mock` calls,
add:

```typescript
vi.mock('../usage/plan', () => ({
  getEffectivePlan: vi.fn(async () => 'free'),
  isAdmin: vi.fn(() => false),
}));
vi.mock('../usage/global-capacity', () => ({
  checkGlobalCapacity: vi.fn(async () => 'ok'),
}));
```

(The real `../usage/limits` is pure and needs no mock.)

- [ ] **Step 3: Write the failing tests for tier + capacity behavior**

Add to `infra/lambda/src/routes/exercises.test.ts` (inside the submit describe block;
adapt the existing submit-test setup for seeding `mockLimit`/usage count and a valid
exercise — mirror the file's existing rate-limit test). Add three cases:

```typescript
  it('allows a boosted user past the free 50 cap', async () => {
    const { getEffectivePlan } = await import('../usage/plan');
    vi.mocked(getEffectivePlan).mockResolvedValueOnce('boosted');
    // usage count = 60 (over free 50, under boosted 500): expect NOT 429
    // ...seed exercise lookup + count=60 the same way the existing 429 test does,
    // then assert res.status !== 429.
  });

  it('returns 503 GLOBAL_CAPACITY when the guard trips', async () => {
    const { checkGlobalCapacity } = await import('../usage/global-capacity');
    vi.mocked(checkGlobalCapacity).mockResolvedValueOnce('capped');
    // ...seed exercise lookup, submit, assert res.status === 503 and body.code === 'GLOBAL_CAPACITY'.
  });

  it('counts only ai_evaluation toward the eval cap', async () => {
    // The where-clause builder is exercised via the existing count mock; assert
    // the eq(eventType,'ai_evaluation') predicate is used (no read_annotation).
    // Mirror the existing rate-limit test's count seeding.
  });
```

> Implementation note for the worker: the existing submit tests in this file already
> seed `mockLimit`/`mockWhere` for the exercise lookup, session check, and usage
> count. Copy that exact seeding into each new case and only change the mocked plan /
> capacity / count value and the asserted status. Do not invent a new harness.

- [ ] **Step 4: Run the tests to verify the new cases pass**

Run: `pnpm --filter @language-drill/lambda test src/routes/exercises.test.ts`
Expected: PASS — all existing tests still green, 3 new cases pass.

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/routes/exercises.ts infra/lambda/src/routes/exercises.test.ts
git commit -m "feat(lambda): tier-aware eval cap + global guard on submit"
```

---

## Task 6: Split skim-annotation bucket + tiers (`POST /read/annotate`)

**Files:**
- Modify: `infra/lambda/src/annotate-stream/handler.ts:59-60,141-159`
- Test: the handler's existing test file (`infra/lambda/src/annotate-stream/handler.test.ts` if present; otherwise add cases to the closest annotate-stream test).

- [ ] **Step 1: Replace the constant + shared-bucket rate limit**

In `infra/lambda/src/annotate-stream/handler.ts`, remove `const DAILY_EVAL_LIMIT = 50;`
(line 60) and add imports near the top-of-file imports:

```typescript
import { limitFor } from '../usage/limits';
import { getEffectivePlan, isAdmin } from '../usage/plan';
import { checkGlobalCapacity } from '../usage/global-capacity';
```

Replace the Gate 6 block (lines 141-159) with a **single-bucket** check plus the guard:

```typescript
    // ---- Gate 6: tier + global brake + per-user skim cap (own bucket) ----
    const plan = await getEffectivePlan(userId);
    const capacity = await checkGlobalCapacity({ plan, admin: isAdmin(userId) });
    if (capacity !== 'ok') {
      await writer.errorJson(503, {
        code: 'GLOBAL_CAPACITY',
        message: 'AI temporarily at capacity',
      });
      return;
    }

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const usageRows = await db
      .select({ count: count() })
      .from(usageEvents)
      .where(
        and(
          eq(usageEvents.userId, userId),
          eq(usageEvents.eventType, "read_annotation"),
          gte(usageEvents.createdAt, oneDayAgo),
        ),
      );
    if (Number(usageRows[0]?.count ?? 0) >= limitFor('read_annotation', plan)) {
      await writer.errorJson(429, {
        code: "RATE_LIMIT_EXCEEDED",
        message: "Daily annotation limit exceeded",
      });
      return;
    }
```

- [ ] **Step 2: Drop the now-unused `inArray` import if no longer referenced**

Check whether `inArray` is still used elsewhere in `handler.ts`:
Run: `grep -n "inArray" infra/lambda/src/annotate-stream/handler.ts`
If the only hit was the deleted block, remove `inArray` from the `drizzle-orm` import line.

- [ ] **Step 3: Write/adjust the failing test**

In the annotate-stream handler test, mock the new modules (same three-line mock as
Task 5 Step 2, with paths relative to the test file) and add a case asserting that a
boosted user is allowed at a skim count of 60, and that the count predicate now uses
only `read_annotation` (no `ai_evaluation`). Mirror the existing rate-limit gate test
in that file for harness/seeding.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @language-drill/lambda test src/annotate-stream/`
Expected: PASS (existing + new cases).

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/annotate-stream/handler.ts infra/lambda/src/annotate-stream/*.test.ts
git commit -m "feat(lambda): split skim-annotation bucket + tier-aware cap"
```

---

## Task 7: Tier + guard for deep-span (`POST /read/annotate-span`)

**Files:**
- Modify: `infra/lambda/src/annotate-stream/deep-flow.ts:156-175` (+ the `READ_SPAN_DAILY_LIMIT` constant declaration)
- Test: deep-flow's existing test file.

- [ ] **Step 1: Replace the dedicated-bucket rate limit**

In `infra/lambda/src/annotate-stream/deep-flow.ts`, add imports near the top:

```typescript
import { limitFor } from '../usage/limits';
import { getEffectivePlan, isAdmin } from '../usage/plan';
import { checkGlobalCapacity } from '../usage/global-capacity';
```

Remove the `const READ_SPAN_DAILY_LIMIT = 150;` declaration. Replace the rate-limit
block (lines 156-175) with:

```typescript
  // 4. Tier + global brake, then the DEDICATED read_span_annotation per-user cap.
  const plan = await getEffectivePlan(userId);
  const capacity = await checkGlobalCapacity({ plan, admin: isAdmin(userId) });
  if (capacity !== 'ok') {
    await writer.errorJson(503, {
      code: 'GLOBAL_CAPACITY',
      message: 'AI temporarily at capacity',
    });
    return { proceed: false };
  }

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const usageRows = await db
    .select({ count: count() })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.userId, userId),
        eq(usageEvents.eventType, "read_span_annotation"),
        gte(usageEvents.createdAt, oneDayAgo),
      ),
    );
  if (Number(usageRows[0]?.count ?? 0) >= limitFor('read_span_annotation', plan)) {
    await writer.errorJson(429, {
      code: "RATE_LIMIT_EXCEEDED",
      message: "Daily span-annotation limit exceeded",
    });
    return { proceed: false };
  }
```

- [ ] **Step 2: Write/adjust the failing test**

In deep-flow's test file, mock the three usage modules and add a case asserting a
boosted user is allowed at a span count of 200 (over free 150, under boosted 1500),
and a 503 case when `checkGlobalCapacity` returns `'capped'`. Mirror the existing
span rate-limit test for seeding.

- [ ] **Step 3: Run the tests**

Run: `pnpm --filter @language-drill/lambda test src/annotate-stream/`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add infra/lambda/src/annotate-stream/deep-flow.ts infra/lambda/src/annotate-stream/*.test.ts
git commit -m "feat(lambda): tier-aware deep-span cap + global guard"
```

---

## Task 8: `POST /invites/redeem` route (TDD)

**Files:**
- Create: `infra/lambda/src/routes/invites.ts`
- Test: `infra/lambda/src/routes/invites.test.ts`
- Modify: `infra/lambda/src/index.ts:78-80`

- [ ] **Step 1: Write the failing test**

Create `infra/lambda/src/routes/invites.test.ts` (model the db-mock + `app.request`
pattern from `exercises.test.ts`):

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const mockLimit = vi.fn();
const mockWhere = vi.fn(() => ({ limit: mockLimit }));
const mockFrom = vi.fn(() => ({ where: mockWhere }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));
const mockUpdateWhere = vi.fn(() => Promise.resolve());
const mockSet = vi.fn(() => ({ where: mockUpdateWhere }));
const mockUpdate = vi.fn(() => ({ set: mockSet }));
vi.mock('../db', () => ({
  db: { select: () => mockSelect(), update: () => mockUpdate() },
}));
vi.mock('@language-drill/db', () => ({
  invitations: { id: 'id', code: 'code', usedBy: 'used_by', usedAt: 'used_at', expiresAt: 'expires_at', revokedAt: 'revoked_at' },
  users: { id: 'id', plan: 'plan' },
}));

const authEnv = {
  requestContext: { authorizer: { jwt: { claims: { sub: 'user_1' } } } },
};

describe('POST /invites/redeem', () => {
  let app: Hono;
  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('./invites');
    app = new Hono();
    app.route('/', mod.default);
  });

  const post = (body: unknown) =>
    app.request('/invites/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, { event: authEnv });

  it('rejects an unknown code with kind=invalid', async () => {
    mockLimit.mockResolvedValueOnce([]); // no invitation row
    const res = await post({ code: 'AAAA1111' });
    expect(res.status).toBe(404);
    expect((await res.json()).kind).toBe('invalid');
  });

  it('rejects an expired code with kind=expired', async () => {
    mockLimit.mockResolvedValueOnce([
      { id: 'i1', usedBy: null, revokedAt: null, expiresAt: new Date(Date.now() - 1000) },
    ]);
    const res = await post({ code: 'AAAA1111' });
    expect(res.status).toBe(410);
    expect((await res.json()).kind).toBe('expired');
  });

  it('rejects a code already used by someone else with kind=used', async () => {
    mockLimit.mockResolvedValueOnce([
      { id: 'i1', usedBy: 'other_user', revokedAt: null, expiresAt: null },
    ]);
    const res = await post({ code: 'AAAA1111' });
    expect(res.status).toBe(409);
    expect((await res.json()).kind).toBe('used');
  });

  it('is a no-op success if the same user already redeemed it', async () => {
    mockLimit.mockResolvedValueOnce([
      { id: 'i1', usedBy: 'user_1', revokedAt: null, expiresAt: null },
    ]);
    const res = await post({ code: 'AAAA1111' });
    expect(res.status).toBe(200);
    expect((await res.json()).plan).toBe('boosted');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('claims a valid code, sets plan=boosted, returns limits', async () => {
    mockLimit.mockResolvedValueOnce([
      { id: 'i1', usedBy: null, revokedAt: null, expiresAt: null },
    ]);
    const res = await post({ code: 'AAAA1111' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.plan).toBe('boosted');
    expect(body.limits.evaluation).toBe(500);
    expect(mockUpdate).toHaveBeenCalledTimes(2); // invitation claim + user plan
  });

  it('400s on a malformed code', async () => {
    const res = await post({ code: 'short' });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/lambda test src/routes/invites.test.ts`
Expected: FAIL — `Cannot find module './invites'`.

- [ ] **Step 3: Write the implementation**

Create `infra/lambda/src/routes/invites.ts`:

```typescript
import { Hono } from 'hono';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { invitations, users } from '@language-drill/db';
import { db } from '../db';
import { authMiddleware } from '../middleware/auth';
import type { Bindings, Variables } from '../middleware/auth';
import { limitFor } from '../usage/limits';

const RedeemSchema = z.object({
  // 8-char alphanumeric, case-insensitive (codes are stored mixed-case but we
  // match exactly; the UI uppercases — accept both by exact match here).
  code: z.string().trim().length(8),
});

function boostedLimitsPayload() {
  return {
    plan: 'boosted' as const,
    limits: {
      evaluation: limitFor('ai_evaluation', 'boosted'),
      annotation: limitFor('read_annotation', 'boosted'),
      deepSpan: limitFor('read_span_annotation', 'boosted'),
    },
  };
}

const invites = new Hono<{ Bindings: Bindings; Variables: Variables }>();

invites.use('/invites/*', authMiddleware);

invites.post('/invites/redeem', async (c) => {
  const userId = c.get('userId');
  const parsed = RedeemSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'Invalid code', code: 'VALIDATION_ERROR', kind: 'invalid' }, 400);
  }
  const { code } = parsed.data;

  const [invite] = await db
    .select({
      id: invitations.id,
      usedBy: invitations.usedBy,
      revokedAt: invitations.revokedAt,
      expiresAt: invitations.expiresAt,
    })
    .from(invitations)
    .where(eq(invitations.code, code))
    .limit(1);

  if (!invite || invite.revokedAt) {
    return c.json({ error: 'Invite not found', code: 'INVITE_INVALID', kind: 'invalid' }, 404);
  }
  if (invite.usedBy && invite.usedBy === userId) {
    // Idempotent: this user already redeemed it.
    return c.json(boostedLimitsPayload(), 200);
  }
  if (invite.usedBy) {
    return c.json({ error: 'Invite already used', code: 'INVITE_USED', kind: 'used' }, 409);
  }
  if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) {
    return c.json({ error: 'Invite expired', code: 'INVITE_EXPIRED', kind: 'expired' }, 410);
  }

  // Claim the invite, then boost the user. Two small writes; a race where two
  // users submit the same fresh code is bounded by the per-user 10x limit and
  // is acceptable at this scale (single inviter).
  await db
    .update(invitations)
    .set({ usedBy: userId, usedAt: new Date() })
    .where(eq(invitations.id, invite.id));
  await db
    .update(users)
    .set({ plan: 'boosted', updatedAt: new Date() })
    .where(eq(users.id, userId));

  return c.json(boostedLimitsPayload(), 200);
});

export default invites;
```

- [ ] **Step 4: Mount the router**

In `infra/lambda/src/index.ts`, add the import next to the other route imports and
mount it alongside the others (after `app.route('/', review);`):

```typescript
import invites from './routes/invites';
// ...
app.route('/', invites);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/lambda test src/routes/invites.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add infra/lambda/src/routes/invites.ts infra/lambda/src/routes/invites.test.ts infra/lambda/src/index.ts
git commit -m "feat(lambda): POST /invites/redeem with idempotent claim"
```

---

## Task 9: `GET /me` route (TDD)

**Files:**
- Create: `infra/lambda/src/routes/me.ts`
- Test: `infra/lambda/src/routes/me.test.ts`
- Modify: `infra/lambda/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `infra/lambda/src/routes/me.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('../usage/plan', () => ({
  getEffectivePlan: vi.fn(async () => 'free'),
  isAdmin: vi.fn(() => false),
}));

const mockWhere = vi.fn(() => Promise.resolve([{ eventType: 'ai_evaluation', count: 3 }]));
const mockGroupBy = vi.fn(() => ({ /* unused */ }));
// usage aggregation returns rows of {eventType, count}; model the chain used in me.ts
const mockFrom = vi.fn();
const mockSelect = vi.fn(() => ({ from: mockFrom }));
vi.mock('../db', () => ({ db: { select: () => mockSelect() } }));
vi.mock('@language-drill/db', () => ({
  usageEvents: { userId: 'user_id', eventType: 'event_type', createdAt: 'created_at' },
}));

const authEnv = { event: { requestContext: { authorizer: { jwt: { claims: { sub: 'user_1' } } } } } };

describe('GET /me', () => {
  let app: Hono;
  beforeEach(async () => {
    vi.clearAllMocks();
    // from().where().groupBy() resolves to usage rows
    mockFrom.mockReturnValue({ where: () => ({ groupBy: () => Promise.resolve([
      { eventType: 'ai_evaluation', count: 3 },
      { eventType: 'read_annotation', count: 1 },
    ]) }) });
    const mod = await import('./me');
    app = new Hono();
    app.route('/', mod.default);
  });

  it('returns plan, isAdmin, limits, and usageToday', async () => {
    const res = await app.request('/me', undefined, authEnv);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.plan).toBe('free');
    expect(body.isAdmin).toBe(false);
    expect(body.limits.evaluation).toBe(50);
    expect(body.usageToday.evaluation).toBe(3);
    expect(body.usageToday.annotation).toBe(1);
  });

  it('reflects a boosted plan in the limits', async () => {
    const { getEffectivePlan } = await import('../usage/plan');
    vi.mocked(getEffectivePlan).mockResolvedValueOnce('boosted');
    const res = await app.request('/me', undefined, authEnv);
    const body = await res.json();
    expect(body.plan).toBe('boosted');
    expect(body.limits.evaluation).toBe(500);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/lambda test src/routes/me.test.ts`
Expected: FAIL — `Cannot find module './me'`.

- [ ] **Step 3: Write the implementation**

Create `infra/lambda/src/routes/me.ts`:

```typescript
import { Hono } from 'hono';
import { and, count, eq, gte } from 'drizzle-orm';
import { usageEvents } from '@language-drill/db';
import { db } from '../db';
import { authMiddleware } from '../middleware/auth';
import type { Bindings, Variables } from '../middleware/auth';
import { limitFor } from '../usage/limits';
import { getEffectivePlan, isAdmin } from '../usage/plan';

const me = new Hono<{ Bindings: Bindings; Variables: Variables }>();

me.use('/me', authMiddleware);

me.get('/me', async (c) => {
  const userId = c.get('userId');
  const plan = await getEffectivePlan(userId);

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ eventType: usageEvents.eventType, count: count() })
    .from(usageEvents)
    .where(and(eq(usageEvents.userId, userId), gte(usageEvents.createdAt, oneDayAgo)))
    .groupBy(usageEvents.eventType);

  const used = (t: string) =>
    Number(rows.find((r) => r.eventType === t)?.count ?? 0);

  return c.json({
    plan,
    isAdmin: isAdmin(userId),
    limits: {
      evaluation: limitFor('ai_evaluation', plan),
      annotation: limitFor('read_annotation', plan),
      deepSpan: limitFor('read_span_annotation', plan),
    },
    usageToday: {
      evaluation: used('ai_evaluation'),
      annotation: used('read_annotation'),
      deepSpan: used('read_span_annotation'),
    },
  });
});

export default me;
```

- [ ] **Step 4: Mount the router**

In `infra/lambda/src/index.ts`, import `me` and add `app.route('/', me);`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/lambda test src/routes/me.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add infra/lambda/src/routes/me.ts infra/lambda/src/routes/me.test.ts infra/lambda/src/index.ts
git commit -m "feat(lambda): GET /me with plan, limits, and today's usage"
```

---

## Task 10: Admin invite endpoints (TDD)

**Files:**
- Modify: `infra/lambda/src/routes/admin.ts` (add three routes + a code generator)
- Test: `infra/lambda/src/routes/admin.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `infra/lambda/src/routes/admin.test.ts` (this file already sets up the admin
app with `ADMIN_USER_IDS`; follow its existing harness). Cases:

```typescript
  it('POST /admin/invites generates N codes', async () => {
    // mock db.insert(...).values(...).returning(...) to echo rows; assert
    // res.status === 200, body.codes.length === 3, each code has length 8.
  });
  it('GET /admin/invites lists codes with status', async () => {
    // mock db.select(...).from(invitations)... to return one unused + one used row;
    // assert statuses 'unused' and 'redeemed'.
  });
  it('POST /admin/invites/:id/revoke sets revokedAt for an unused code', async () => {
    // mock the lookup to an unused row; assert res.status 200 and update called.
  });
  it('rejects revoke of an already-used code', async () => {
    // mock lookup to a row with usedBy set; assert 409.
  });
  it('non-admin gets 403 on POST /admin/invites', async () => {
    // request without an admin sub; assert 403 (existing adminMiddleware).
  });
```

> The worker should mirror the db-mock shape already present in `admin.test.ts`
> (it mocks `../db` and `@language-drill/db`). Reuse it; only add invitation-table
> fields to the `@language-drill/db` mock.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @language-drill/lambda test src/routes/admin.test.ts`
Expected: FAIL — new routes return 404.

- [ ] **Step 3: Add the code generator + routes**

In `infra/lambda/src/routes/admin.ts`, add `invitations` to the `@language-drill/db`
import, add `randomInt` from `node:crypto`, and add these routes (place after the
existing admin routes, before `export default admin;`):

```typescript
const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function generateInviteCode(): string {
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

const CreateInvitesSchema = z.object({
  count: z.number().int().min(1).max(50).default(1),
  expiresInDays: z.number().int().min(1).max(365).optional(),
  note: z.string().trim().max(200).optional(),
});

admin.post('/admin/invites', async (c) => {
  const parsed = CreateInvitesSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'Invalid body', code: 'VALIDATION_ERROR' }, 400);
  }
  const { count: n, expiresInDays, note } = parsed.data;
  const expiresAt = expiresInDays
    ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
    : null;
  const rows = Array.from({ length: n }, () => ({
    code: generateInviteCode(),
    expiresAt,
    note: note ?? null,
  }));
  const inserted = await db
    .insert(invitations)
    .values(rows)
    .returning({ id: invitations.id, code: invitations.code, expiresAt: invitations.expiresAt, note: invitations.note });
  return c.json({ codes: inserted });
});

admin.get('/admin/invites', async (c) => {
  const rows = await db
    .select({
      id: invitations.id,
      code: invitations.code,
      usedBy: invitations.usedBy,
      usedAt: invitations.usedAt,
      expiresAt: invitations.expiresAt,
      revokedAt: invitations.revokedAt,
      note: invitations.note,
      createdAt: invitations.createdAt,
    })
    .from(invitations)
    .orderBy(desc(invitations.createdAt));
  const now = Date.now();
  const items = rows.map((r) => ({
    ...r,
    status: r.revokedAt
      ? 'revoked'
      : r.usedBy
        ? 'redeemed'
        : r.expiresAt && r.expiresAt.getTime() < now
          ? 'expired'
          : 'unused',
  }));
  return c.json({ items });
});

admin.post('/admin/invites/:id/revoke', async (c) => {
  const id = c.req.param('id');
  const [row] = await db
    .select({ id: invitations.id, usedBy: invitations.usedBy, revokedAt: invitations.revokedAt })
    .from(invitations)
    .where(eq(invitations.id, id))
    .limit(1);
  if (!row) return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404);
  if (row.usedBy) return c.json({ error: 'Already used', code: 'INVITE_USED' }, 409);
  if (row.revokedAt) return c.json({ ok: true }, 200);
  await db.update(invitations).set({ revokedAt: new Date() }).where(eq(invitations.id, id));
  return c.json({ ok: true }, 200);
});
```

Add `desc` to the existing `drizzle-orm` import and `randomInt` via
`import { randomInt } from 'node:crypto';`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @language-drill/lambda test src/routes/admin.test.ts`
Expected: PASS (existing + 5 new cases).

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/routes/admin.ts infra/lambda/src/routes/admin.test.ts
git commit -m "feat(lambda): admin invite generate/list/revoke endpoints"
```

---

## Task 11: Webhook — set plan, remove auto-claim (TDD)

**Files:**
- Modify: `infra/lambda/src/routes/webhooks/clerk.ts:62-79`
- Test: `infra/lambda/src/routes/webhooks/clerk.test.ts` (if present; otherwise add one)

- [ ] **Step 1: Adjust the webhook**

In `infra/lambda/src/routes/webhooks/clerk.ts`, in the `user.created` branch:
- Keep the user upsert, but ensure inserts carry the default plan (the column
  default handles it; no change needed to the insert values).
- **Delete** the "Find first unused invitation and mark it as claimed" block
  (the `unusedInvite` select + conditional update, lines ~67-79) and remove the now
  unused `isNull` import and the `invitations` import if unused elsewhere in the file.

Resulting branch body:

```typescript
  if (event.type === 'user.created') {
    const { id: userId, email_addresses } = event.data;
    const email = email_addresses[0]?.email_address;

    if (!email) {
      return c.json({ error: 'No email address in event' }, 400);
    }

    // Create/refresh the user row. New users default to the 'free' plan
    // (column default); a boosted tier is granted explicitly via
    // POST /invites/redeem, and admins are boosted dynamically at request time.
    await db
      .insert(users)
      .values({ id: userId, email })
      .onConflictDoUpdate({
        target: users.id,
        set: { email, updatedAt: new Date() },
      });
  }
```

- [ ] **Step 2: Write/adjust the test**

In the clerk webhook test, add/adjust a case asserting that on `user.created` the
user is upserted and **no** invitation update is issued (mock `db.update` and assert
it is not called). If no test file exists, create `clerk.test.ts` modeling the
db-mock + `app.request('/webhooks/clerk', ...)` pattern, stubbing svix verification.

- [ ] **Step 3: Run the tests**

Run: `pnpm --filter @language-drill/lambda test src/routes/webhooks/`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add infra/lambda/src/routes/webhooks/clerk.ts infra/lambda/src/routes/webhooks/clerk.test.ts
git commit -m "feat(lambda): webhook stops auto-claiming invites; default plan free"
```

---

## Task 12: CDK — wire `AI_KILL_SWITCH` + `AI_GLOBAL_DAILY_CAP`

**Files:**
- Modify: `infra/lib/stack.ts:15-46`
- Modify: `infra/lib/constructs/lambda.ts:91-112`
- Modify: `infra/lib/constructs/annotate-stream-lambda.ts:103-115`

- [ ] **Step 1: Add stack props**

In `infra/lib/stack.ts`, extend `LanguageDrillStackProps` with:

```typescript
  // Global AI cost brakes. Both plain env vars (not secrets). AI_KILL_SWITCH='on'
  // hard-stops AI for non-admins; AI_GLOBAL_DAILY_CAP caps free-tier usage by the
  // trailing-24h global event count. Omit/empty to disable.
  aiKillSwitch?: string;
  aiGlobalDailyCap?: string;
```

- [ ] **Step 2: Pass them into both Lambda constructs**

In `infra/lib/stack.ts`, in the `LambdaConstruct` `additionalEnv` (the block that
already sets `ADMIN_USER_IDS`), add:

```typescript
      AI_KILL_SWITCH: props.aiKillSwitch ?? "",
      AI_GLOBAL_DAILY_CAP: props.aiGlobalDailyCap ?? "",
```

Do the same in the `additionalEnv` passed to the annotate-stream construct (find the
`new AnnotateStreamLambdaConstruct(...)` call; add an `additionalEnv` object if absent):

```typescript
    additionalEnv: {
      AI_KILL_SWITCH: props.aiKillSwitch ?? "",
      AI_GLOBAL_DAILY_CAP: props.aiGlobalDailyCap ?? "",
    },
```

- [ ] **Step 3: Ensure the constructs forward `additionalEnv`**

`lambda.ts` already spreads `...(props.additionalEnv ?? {})` into `environment`
(line 92) — no change needed. Confirm `annotate-stream-lambda.ts` does the same
(line 104, `...(props.additionalEnv ?? {})`). If the annotate-stream construct's
props type lacks `additionalEnv`, add `additionalEnv?: Record<string, string>;` to it.

- [ ] **Step 4: Typecheck infra**

Run: `pnpm --filter @language-drill/infra typecheck`
Expected: PASS.

- [ ] **Step 5: Synth to verify the env vars render**

Run: `pnpm --filter @language-drill/infra exec cdk synth LanguageDrillStack-dev > /dev/null && echo OK`
Expected: `OK` (no synth errors). (Optionally grep the synth output for
`AI_KILL_SWITCH`.)

- [ ] **Step 6: Commit**

```bash
git add infra/lib/stack.ts infra/lib/constructs/lambda.ts infra/lib/constructs/annotate-stream-lambda.ts
git commit -m "feat(infra): wire AI_KILL_SWITCH + AI_GLOBAL_DAILY_CAP env vars"
```

---

## Task 13: API client — schemas + hooks (`useMe`, `useRedeemInvite`, `useAdminInvites`)

**Files:**
- Create: `packages/api-client/src/schemas/me.ts`, `schemas/invites.ts`
- Create: `packages/api-client/src/hooks/useMe.ts`, `useRedeemInvite.ts`, `useAdminInvites.ts`
- Modify: `packages/api-client/src/index.ts`

- [ ] **Step 1: Add the Zod schemas**

Create `packages/api-client/src/schemas/me.ts`:

```typescript
import { z } from 'zod';

const LimitsSchema = z.object({
  evaluation: z.number(),
  annotation: z.number(),
  deepSpan: z.number(),
});

export const MeResponseSchema = z.object({
  plan: z.enum(['free', 'boosted']),
  isAdmin: z.boolean(),
  limits: LimitsSchema,
  usageToday: LimitsSchema,
});

export type MeResponse = z.infer<typeof MeResponseSchema>;
```

Create `packages/api-client/src/schemas/invites.ts`:

```typescript
import { z } from 'zod';

export const RedeemResponseSchema = z.object({
  plan: z.literal('boosted'),
  limits: z.object({
    evaluation: z.number(),
    annotation: z.number(),
    deepSpan: z.number(),
  }),
});
export type RedeemResponse = z.infer<typeof RedeemResponseSchema>;

export const AdminInviteSchema = z.object({
  id: z.string(),
  code: z.string(),
  usedBy: z.string().nullable(),
  usedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.string().nullable(),
  status: z.enum(['unused', 'redeemed', 'expired', 'revoked']),
});
export const AdminInvitesResponseSchema = z.object({ items: z.array(AdminInviteSchema) });
export type AdminInvite = z.infer<typeof AdminInviteSchema>;

export const CreateInvitesResponseSchema = z.object({
  codes: z.array(z.object({
    id: z.string(),
    code: z.string(),
    expiresAt: z.string().nullable(),
    note: z.string().nullable(),
  })),
});
export type CreateInvitesResponse = z.infer<typeof CreateInvitesResponseSchema>;
```

- [ ] **Step 2: Add the hooks**

Create `packages/api-client/src/hooks/useMe.ts` (model `usePreferences.ts`):

```typescript
import { useQuery } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../fetchClient';
import { MeResponseSchema, type MeResponse } from '../schemas/me';

export function useMe({ fetchFn, enabled = true }: { fetchFn: AuthenticatedFetch; enabled?: boolean }) {
  return useQuery<MeResponse, Error>({
    queryKey: ['me'],
    queryFn: async () => {
      const response = await fetchFn('/me');
      const json: unknown = await response.json();
      return MeResponseSchema.parse(json);
    },
    enabled,
    staleTime: 60 * 1000,
  });
}
```

Create `packages/api-client/src/hooks/useRedeemInvite.ts`:

```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../fetchClient';
import { RedeemResponseSchema, type RedeemResponse } from '../schemas/invites';

export class RedeemError extends Error {
  kind: 'invalid' | 'expired' | 'used';
  constructor(kind: 'invalid' | 'expired' | 'used', message: string) {
    super(message);
    this.kind = kind;
  }
}

export function useRedeemInvite({ fetchFn }: { fetchFn: AuthenticatedFetch }) {
  const queryClient = useQueryClient();
  return useMutation<RedeemResponse, RedeemError, { code: string }>({
    mutationFn: async ({ code }) => {
      const response = await fetchFn('/invites/redeem', {
        method: 'POST',
        body: JSON.stringify({ code }),
      });
      const json: unknown = await response.json();
      if (!response.ok) {
        const kind = (json as { kind?: string }).kind ?? 'invalid';
        throw new RedeemError(
          (['invalid', 'expired', 'used'].includes(kind) ? kind : 'invalid') as 'invalid' | 'expired' | 'used',
          (json as { error?: string }).error ?? 'Redemption failed',
        );
      }
      return RedeemResponseSchema.parse(json);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });
}
```

Create `packages/api-client/src/hooks/useAdminInvites.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../fetchClient';
import {
  AdminInvitesResponseSchema,
  CreateInvitesResponseSchema,
  type AdminInvite,
  type CreateInvitesResponse,
} from '../schemas/invites';

export function useAdminInvites({ fetchFn, enabled = true }: { fetchFn: AuthenticatedFetch; enabled?: boolean }) {
  return useQuery<AdminInvite[], Error>({
    queryKey: ['admin', 'invites'],
    queryFn: async () => {
      const response = await fetchFn('/admin/invites');
      const json: unknown = await response.json();
      return AdminInvitesResponseSchema.parse(json).items;
    },
    enabled,
  });
}

export function useCreateInvites({ fetchFn }: { fetchFn: AuthenticatedFetch }) {
  const queryClient = useQueryClient();
  return useMutation<CreateInvitesResponse, Error, { count: number; expiresInDays?: number; note?: string }>({
    mutationFn: async (body) => {
      const response = await fetchFn('/admin/invites', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const json: unknown = await response.json();
      return CreateInvitesResponseSchema.parse(json);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'invites'] });
    },
  });
}

export function useRevokeInvite({ fetchFn }: { fetchFn: AuthenticatedFetch }) {
  const queryClient = useQueryClient();
  return useMutation<void, Error, { id: string }>({
    mutationFn: async ({ id }) => {
      await fetchFn(`/admin/invites/${id}/revoke`, { method: 'POST' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'invites'] });
    },
  });
}
```

- [ ] **Step 3: Export from the barrel**

In `packages/api-client/src/index.ts`, add re-exports:

```typescript
export * from './schemas/me';
export * from './schemas/invites';
export { useMe } from './hooks/useMe';
export { useRedeemInvite, RedeemError } from './hooks/useRedeemInvite';
export { useAdminInvites, useCreateInvites, useRevokeInvite } from './hooks/useAdminInvites';
```

Confirm `AuthenticatedFetch` is exported from `fetchClient` (it is used by existing
hooks). If the import path differs in existing hooks, match it.

- [ ] **Step 4: Typecheck the package**

Run: `pnpm --filter @language-drill/api-client typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api-client/src
git commit -m "feat(api-client): me + invite redemption + admin invite hooks"
```

---

## Task 14: Invite landing page `/invite/[code]`

**Files:**
- Create: `apps/web/app/invite/[code]/page.tsx`
- Modify: `apps/web/middleware.ts` (allow `/invite` as public)

- [ ] **Step 1: Make `/invite` public in middleware**

In `apps/web/middleware.ts`, add `'/invite(.*)'` to the `isPublicRoute` matcher list so
an un-signed-in recipient can view the landing page:

```typescript
const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/invite(.*)',
  '/api/webhooks(.*)',
]);
```

- [ ] **Step 2: Build the landing page**

Create `apps/web/app/invite/[code]/page.tsx` (a client component; stashes the code and
hands off to Clerk sign-up). Use the prototype's copy and the `Card`/`Button` UI
primitives. Free = 50/50, boosted = 500/500.

```tsx
'use client';

import { use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Card } from '../../../components/ui';

const FREE = { evaluations: 50, annotations: 50 };
const MULT = 10;

export default function InviteLandingPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const router = useRouter();

  const accept = () => {
    try {
      localStorage.setItem('pending_invite', code);
    } catch {
      /* ignore storage failures — redemption box in settings is the fallback */
    }
    router.push('/sign-in');
  };
  const continueFree = () => {
    try {
      localStorage.removeItem('pending_invite');
    } catch { /* ignore */ }
    router.push('/sign-in');
  };

  return (
    <div className="mx-auto max-w-md p-s-6">
      <Card padding="lg">
        <p className="t-micro text-ink-mute">you've been invited</p>
        <h1 className="t-display-m mb-s-3">
          start on drill with {MULT}× the limit
        </h1>
        <p className="t-body mb-s-4 text-ink-soft">
          drill is free for everyone. your invite bumps the daily ceiling to{' '}
          <strong>{FREE.evaluations * MULT} evaluations a day</strong>.
        </p>

        <table className="mb-s-4 w-full text-sm">
          <thead>
            <tr className="text-ink-mute">
              <th className="text-left">per day</th>
              <th className="text-right">free</th>
              <th className="text-right">with invite</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>evaluations</td>
              <td className="text-right">{FREE.evaluations}</td>
              <td className="text-right font-semibold">{FREE.evaluations * MULT}</td>
            </tr>
            <tr>
              <td>annotations</td>
              <td className="text-right">{FREE.annotations}</td>
              <td className="text-right font-semibold">{FREE.annotations * MULT}</td>
            </tr>
          </tbody>
        </table>

        <Button variant="accent" size="lg" onClick={accept} className="w-full">
          accept invite &amp; sign up
        </Button>
        <button
          onClick={continueFree}
          className="mt-s-3 w-full text-center text-sm text-ink-soft"
        >
          continue without it (free plan)
        </button>
      </Card>
      <p className="mt-s-4 text-center text-sm text-ink-mute">
        already on drill? <Link href="/sign-in" className="text-accent-2">sign in</Link>
      </p>
    </div>
  );
}
```

> Note: match the exact prop names/classes used by `Button`/`Card` in
> `apps/web/components/ui` (e.g. whether `Button` accepts `className`). If `Button`
> lacks `className`, wrap it in a full-width `<div>` instead.

- [ ] **Step 3: Verify it renders**

Run: `pnpm --filter @language-drill/web lint && pnpm --filter @language-drill/web typecheck`
Expected: PASS. (Manual: visit `/invite/TESTCODE` after `pnpm dev:web`.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/invite apps/web/middleware.ts
git commit -m "feat(web): invite landing page with perk framing"
```

---

## Task 15: Post-signup redemption hook

**Files:**
- Create: `apps/web/components/invite/post-signup-redeem.tsx`
- Modify: `apps/web/app/(dashboard)/layout.tsx` (mount the hook component)

- [ ] **Step 1: Build the redemption component**

Create `apps/web/components/invite/post-signup-redeem.tsx`. It runs once after the
dashboard mounts: if `localStorage.pending_invite` is set, redeem it, clear it, and
surface a `role="alert"` banner. Reuses `useRedeemInvite`.

```tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { createAuthenticatedFetch, useRedeemInvite, RedeemError } from '@language-drill/api-client';

export function PostSignupRedeem() {
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  const redeem = useRedeemInvite({ fetchFn });
  const attempted = useRef(false);
  const [banner, setBanner] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (attempted.current) return;
    let code: string | null = null;
    try {
      code = localStorage.getItem('pending_invite');
    } catch { /* ignore */ }
    if (!code) return;
    attempted.current = true;
    try { localStorage.removeItem('pending_invite'); } catch { /* ignore */ }
    redeem.mutate(
      { code },
      {
        onSuccess: () => setBanner({ kind: 'ok', text: "Invite applied — you've got 10× the daily limit." }),
        onError: (e) =>
          setBanner({
            kind: 'err',
            text: e instanceof RedeemError && e.kind === 'used'
              ? 'That invite was already used — you’re on the free plan.'
              : e instanceof RedeemError && e.kind === 'expired'
                ? 'That invite has expired — you’re on the free plan.'
                : 'That invite code didn’t work — you’re on the free plan.',
          }),
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!banner) return null;
  return (
    <div
      role="alert"
      className={`mb-s-4 rounded-md p-s-3 text-sm ${banner.kind === 'ok' ? 'bg-ok-soft text-ink' : 'bg-accent-soft text-accent-2'}`}
    >
      {banner.text}
    </div>
  );
}
```

- [ ] **Step 2: Mount it in the dashboard layout**

In `apps/web/app/(dashboard)/layout.tsx`, render `<PostSignupRedeem />` near the top of
the authenticated content (inside `<AppShell>`, above `children`). Import it from
`../../components/invite/post-signup-redeem`.

- [ ] **Step 3: Verify**

Run: `pnpm --filter @language-drill/web lint && pnpm --filter @language-drill/web typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/invite/post-signup-redeem.tsx apps/web/app/\(dashboard\)/layout.tsx
git commit -m "feat(web): auto-redeem stashed invite after sign-in"
```

---

## Task 16: Settings — "Plan & limits" + redeem box

**Files:**
- Create: `apps/web/components/settings/plan-and-limits.tsx`
- Create: `apps/web/components/invite/redeem-code-box.tsx`
- Modify: `apps/web/app/(dashboard)/settings/page.tsx`

- [ ] **Step 1: Build the redeem-code box**

Create `apps/web/components/invite/redeem-code-box.tsx`:

```tsx
'use client';

import { useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { createAuthenticatedFetch, useRedeemInvite } from '@language-drill/api-client';
import { Button, Input } from '../ui';

export function RedeemCodeBox() {
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  const redeem = useRedeemInvite({ fetchFn });
  const [code, setCode] = useState('');

  const submit = () => {
    if (code.trim().length !== 8) return;
    redeem.mutate({ code: code.trim().toUpperCase() });
  };

  return (
    <div>
      <label className="mb-s-2 block text-sm font-medium">redeem an invite code</label>
      <div className="flex gap-s-2">
        <Input
          type="text"
          placeholder="XXXXXXXX"
          value={code}
          maxLength={8}
          onChange={(e) => setCode(e.target.value)}
        />
        <Button variant="primary" onClick={submit} loading={redeem.isPending} disabled={code.trim().length !== 8}>
          apply
        </Button>
      </div>
      {redeem.isError && (
        <p role="alert" className="mt-s-2 text-sm text-accent-2">
          {redeem.error.message}
        </p>
      )}
      {redeem.isSuccess && (
        <p role="alert" className="mt-s-2 text-sm text-ink">
          applied — you now have 10× the daily limit.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build the Plan & limits panel**

Create `apps/web/components/settings/plan-and-limits.tsx`:

```tsx
'use client';

import { useMemo } from 'react';
import { useAuth } from '@clerk/nextjs';
import { createAuthenticatedFetch, useMe } from '@language-drill/api-client';
import { Card } from '../ui';
import { RedeemCodeBox } from '../invite/redeem-code-box';

export function PlanAndLimits() {
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  const me = useMe({ fetchFn });

  return (
    <Card padding="lg">
      <h2 className="t-display-s mb-s-3">plan &amp; limits</h2>
      {me.isLoading && <p className="t-body text-ink-soft">loading…</p>}
      {me.error && <p role="alert" className="t-body text-accent-2">couldn’t load your plan.</p>}
      {me.data && (
        <>
          <p className="mb-s-3 text-sm">
            plan: <strong>{me.data.plan === 'boosted' ? `${me.data.isAdmin ? '★ ' : ''}10× plan` : 'free plan'}</strong>
          </p>
          <div className="mb-s-4 grid grid-cols-3 gap-s-3">
            {([
              ['evaluations', 'evaluation'],
              ['annotations', 'annotation'],
              ['deep taps', 'deepSpan'],
            ] as const).map(([label, key]) => (
              <div key={key} className="rounded-md border p-s-3">
                <div className="t-mono text-lg">
                  {me.data!.usageToday[key]} / {me.data!.limits[key]}
                </div>
                <div className="t-micro text-ink-mute">{label} today</div>
              </div>
            ))}
          </div>
          {me.data.plan === 'free' && <RedeemCodeBox />}
        </>
      )}
    </Card>
  );
}
```

- [ ] **Step 3: Mount it in settings**

Replace `apps/web/app/(dashboard)/settings/page.tsx` body with the heading plus
`<PlanAndLimits />`:

```tsx
import { PlanAndLimits } from '../../../components/settings/plan-and-limits';

export default function SettingsPage() {
  return (
    <div>
      <h1 className="t-display-l mb-s-4">settings</h1>
      <PlanAndLimits />
    </div>
  );
}
```

- [ ] **Step 4: Verify**

Run: `pnpm --filter @language-drill/web lint && pnpm --filter @language-drill/web typecheck`
Expected: PASS. (Manual: `/settings` shows the plan + usage; free users see the box.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/settings apps/web/components/invite/redeem-code-box.tsx apps/web/app/\(dashboard\)/settings/page.tsx
git commit -m "feat(web): settings plan & limits panel + redeem box"
```

---

## Task 17: Admin invites page

**Files:**
- Create: `apps/web/app/(dashboard)/admin/invites/page.tsx`

(The existing `apps/web/app/(dashboard)/admin/layout.tsx` already server-gates the whole
`/admin` subtree on `publicMetadata.admin`; the API enforces `ADMIN_USER_IDS`
independently. No new gating code needed.)

- [ ] **Step 1: Build the page**

Create `apps/web/app/(dashboard)/admin/invites/page.tsx`:

```tsx
'use client';

import { useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import {
  createAuthenticatedFetch,
  useAdminInvites,
  useCreateInvites,
  useRevokeInvite,
} from '@language-drill/api-client';
import { Button, Card, Input } from '../../../../components/ui';

export default function AdminInvitesPage() {
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  const list = useAdminInvites({ fetchFn });
  const create = useCreateInvites({ fetchFn });
  const revoke = useRevokeInvite({ fetchFn });
  const [count, setCount] = useState(1);
  const [note, setNote] = useState('');

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const copyLink = (code: string) => {
    void navigator.clipboard?.writeText(`${origin}/invite/${code}`);
  };

  return (
    <div className="space-y-s-6">
      <h1 className="t-display-l">invites</h1>

      <Card padding="lg">
        <h2 className="t-display-s mb-s-3">generate codes</h2>
        <div className="flex flex-wrap items-end gap-s-3">
          <div>
            <label className="mb-s-1 block text-sm">count</label>
            <Input type="number" min={1} max={50} value={count}
              onChange={(e) => setCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))} />
          </div>
          <div className="flex-1">
            <label className="mb-s-1 block text-sm">note (optional)</label>
            <Input type="text" value={note} placeholder="who is this for?"
              onChange={(e) => setNote(e.target.value)} />
          </div>
          <Button variant="primary" loading={create.isPending}
            onClick={() => create.mutate({ count, note: note || undefined })}>
            generate
          </Button>
        </div>
      </Card>

      <Card padding="lg">
        <h2 className="t-display-s mb-s-3">all codes</h2>
        {list.isLoading && <p className="t-body text-ink-soft">loading…</p>}
        {list.data && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-ink-mute">
                <th className="text-left">code</th>
                <th className="text-left">status</th>
                <th className="text-left">note</th>
                <th className="text-right">actions</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((inv) => (
                <tr key={inv.id} className="border-t">
                  <td className="t-mono">{inv.code}</td>
                  <td>{inv.status}</td>
                  <td>{inv.note ?? ''}</td>
                  <td className="text-right">
                    <button className="mr-s-3 text-accent-2" onClick={() => copyLink(inv.code)}>copy link</button>
                    {inv.status === 'unused' && (
                      <button className="text-ink-soft" onClick={() => revoke.mutate({ id: inv.id })}>revoke</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
```

> Adjust the relative import depth for `components/ui` to match the actual nesting
> (`app/(dashboard)/admin/invites/page.tsx` → `../../../../components/ui`).

- [ ] **Step 2: Verify**

Run: `pnpm --filter @language-drill/web lint && pnpm --filter @language-drill/web typecheck`
Expected: PASS. (Manual: `/admin/invites` generates + lists codes; copy-link works.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/\(dashboard\)/admin/invites/page.tsx
git commit -m "feat(web): admin invites page (generate/list/copy/revoke)"
```

---

## Task 18: Full verification sweep + docs

**Files:**
- Modify: `CLAUDE.md` (Access Control section), optional `docs/architecture.md`

- [ ] **Step 1: Run the full suite from the repo root**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: all three PASS with zero failures. Fix any failures before proceeding.

- [ ] **Step 2: Manual smoke (local)**

With `pnpm dev` running (and `ANTHROPIC_API_KEY` set), verify, as `dev_user_001`:
- `GET /me` returns plan `free`, limits `{50,50,150}`.
- Seed a code (`pnpm --filter @language-drill/db ...` or admin page), redeem via
  `/settings` → `GET /me` flips to `boosted` `{500,500,1500}`.
- Add `dev_user_001` to `ADMIN_USER_IDS` in `.env` → `/me` shows `isAdmin: true`,
  boosted even without a code.
- Set `AI_KILL_SWITCH=on` for a non-admin → an eval submit returns 503
  `GLOBAL_CAPACITY`; unset returns to normal.

- [ ] **Step 3: Update CLAUDE.md Access Control section**

In `CLAUDE.md`, update the "Access Control & Monetization" bullet list to reflect:
free tier (50 eval + 50 annotation + 150 deep-span/day), invite/admin = 10×, the
`AI_KILL_SWITCH` / `AI_GLOBAL_DAILY_CAP` brakes, and that invites are now a perk
(not a gate). Note the new env vars in the env matrix.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/
git commit -m "docs: document invite-perk tiers + global AI brakes"
```

- [ ] **Step 5: Open the PR**

```bash
git push -u origin feat/invite-perk-tiers
gh pr create --fill --base main
```

---

## Self-review notes

- **Spec coverage:** plan column + backfill (T1), separate buckets + 10× all three
  (T2/T5/T6/T7), redemption (T8), `/me` (T9), admin endpoints + page (T10/T17),
  webhook de-gate (T11), kill-switch + soft cap (T4/T12), landing + post-signup +
  settings (T14/T15/T16), `ADMIN_USER_IDS` reuse (T3). All spec sections map to a task.
- **Deferred deploy/backfill:** the migration runs in CI on merge (forward-only);
  the production backfill of existing invited users runs as part of that migration.
- **Naming consistency:** `getEffectivePlan` / `effectivePlanFor` / `isAdmin` /
  `limitFor` / `checkGlobalCapacity` are used identically across tasks; usage-bucket
  event types are `ai_evaluation` / `read_annotation` / `read_span_annotation`
  throughout; the `/me` and redeem payload limit keys are `evaluation` / `annotation`
  / `deepSpan` everywhere.
