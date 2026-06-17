# Admin Audit Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an append-only `admin_audit_log` table and record every mutating admin action (flagged approve/reject, content demote/reject, generate, invite create/revoke) via a best-effort `recordAdminAction` helper.

**Architecture:** New Drizzle table + migration 0026. A `recordAdminAction(db, entry)` helper inserts one row and swallows/logs errors (best-effort — an audit-write failure never fails an already-succeeded action). Each mutating route calls it after the action succeeds, recording only effective state changes.

**Tech Stack:** Drizzle + Neon (Postgres), drizzle-kit migrations, Hono (Lambda), Vitest.

---

## Context the implementer needs

Work from the worktree `/Users/seal/dev/language-drill/.claude/worktrees/feat-admin-audit-log` (branch `feat-admin-audit-log`). `cd` into it in every Bash call. Paths contain a `(admin)` route-group segment — quote them. (This feature touches no web pages.)

**Workspace dist:** the Lambda imports `adminAuditLog` + `Db` from `@language-drill/db`'s build output, so after Task 1 adds the table you MUST `pnpm --filter @language-drill/db build` before the Lambda typechecks/tests can resolve it. If a test errors resolving `@language-drill/*`, run `pnpm build` at repo root.

**⚠️ Do NOT run `pnpm db:migrate` (or `db:migrate` in any package).** The local `.env` `DATABASE_URL` points at the shared Neon `dev` branch; applying an unmerged migration there pollutes per-PR CI forks. Only `db:generate` (offline schema diff — no DB connection) is run here. CI applies the migration on the PR's ephemeral branch and on merge.

**Single-file test commands:**
- db: `pnpm --filter @language-drill/db test <path>`
- Lambda: `pnpm --filter @language-drill/lambda test <path>`

**Key existing code:**
- Schema: `packages/db/src/schema/access.ts` is the table-style template (`pgTable`, column helpers, index map). Barrel `packages/db/src/schema/index.ts` re-exports tables (`export { invitations, usageEvents } from './access';`). `packages/db/src/index.ts` does `export * from './client'` (which exports `type Db = ReturnType<typeof createDb>`) and `export * from './schema'`.
- Migrations: `pnpm --filter @language-drill/db db:generate` runs `drizzle-kit generate` (offline; writes a new `migrations/NNNN_*.sql` + updates `migrations/meta`). Latest is `0025_real_starhawk.sql` → next is `0026`.
- `infra/lambda/src/db.ts` exports `db` (Drizzle/Neon). Insert pattern: `await db.insert(table).values({...})`.
- `infra/lambda/src/routes/admin.ts` mutating routes, all with `c.get('userId')` for the actor:
  - **Content** (~line 641): `for (const action of ['demote','reject'] as const) { const toStatus = action==='demote' ? 'flagged' : 'rejected'; admin.post('/admin/content/exercises/:id/'+action, …→ transitionContentExercise(id,toStatus)); admin.post('/admin/content/theory/:id/'+action, …→ transitionContentTheory(id,toStatus)); }`. Transition returns `'demoted'|'rejected'|'not_found'|'already_resolved'`.
  - **Flagged** (~line 834): `for (const [kind, resolve] of [['exercises',resolveExerciseFlagged],['theory',resolveTheoryFlagged]] as const) { for (const action of ['approve','reject'] as const) { admin.post('/admin/flagged/'+kind+'/:id/'+action, async (c) => { … const outcome = await resolve(id, action); return c.json({outcome}); }); } }`. Resolve returns `'approved'|'rejected'|'demoted'|'not_found'|'already_resolved'`.
  - **Generate** (~line 870): `admin.post('/admin/generate', …)` — after `getSqsClient().send(...)`, before `return c.json({ jobId, status:'queued' })`. `cellKey` and `count` and `jobId` are in scope.
  - **Invites create** (~line 942): after `const inserted = await db.insert(invitations).values(rows).returning({...})`, before `return c.json({ codes: inserted })`. `n` (count) in scope.
  - **Invites revoke** (~line 1003): the success branch is the one that runs `await db.update(invitations).set({ revokedAt: new Date() })...` then `return c.json({ ok:true }, 200)`. The 404 / `INVITE_USED` (409) / already-revoked (no-op 200) branches return earlier and must NOT record.
- `admin.test.ts` mock: `vi.mock('../db')` with a chain mock; `db.insert(table)` → `dbInsert(table)` which captures `.values(rows)` into `insertedValuesByTable[table.__mock]`. Awaiting any chain shifts `queryQueue`. The `@language-drill/db` mock spreads `...actual` and overrides specific tables with `{ __mock: '<name>', ...cols }` sentinels — a NEW table must be added there to be captured.

---

## File structure

**db (create/modify):** `packages/db/src/schema/audit.ts` (new table), `packages/db/src/schema/index.ts` (export), `packages/db/migrations/0026_*.sql` + `meta` (generated), `packages/db/src/schema/audit.test.ts` (new).
**Lambda (create/modify):** `infra/lambda/src/lib/admin-audit.ts` (helper + types) + `admin-audit.test.ts` (new); `infra/lambda/src/routes/admin.ts` (wire 6 routes); `infra/lambda/src/routes/admin.test.ts` (mock sentinel + assertions).

---

## Task 1: DB — `admin_audit_log` table + migration

**Files:** Create `packages/db/src/schema/audit.ts`, `packages/db/src/schema/audit.test.ts`; modify `packages/db/src/schema/index.ts`; generate `migrations/0026_*.sql` + meta.

- [ ] **Step 1: Create the table**

`packages/db/src/schema/audit.ts`:
```ts
import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Append-only trail of mutating admin actions. No FK on adminUserId: admins may be
// env-listed IDs without a users row, and the trail must survive user deletion.
export const adminAuditLog = pgTable(
  'admin_audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adminUserId: text('admin_user_id').notNull(),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    createdAtIdx: index('admin_audit_log_created_at_idx').on(table.createdAt),
  }),
);
```

- [ ] **Step 2: Export it from the barrel**

In `packages/db/src/schema/index.ts`, add near the other exports:
```ts
export { adminAuditLog } from './audit';
```

- [ ] **Step 3: Write the failing schema test**

`packages/db/src/schema/audit.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { adminAuditLog } from './index';

describe('admin_audit_log schema', () => {
  it('has the expected columns with correct nullability', () => {
    const cfg = getTableConfig(adminAuditLog);
    expect(cfg.name).toBe('admin_audit_log');
    const byName = Object.fromEntries(cfg.columns.map((c) => [c.name, c]));
    expect(Object.keys(byName).sort()).toEqual(
      ['action', 'admin_user_id', 'created_at', 'id', 'metadata', 'target_id', 'target_type'].sort(),
    );
    expect(byName['admin_user_id'].notNull).toBe(true);
    expect(byName['action'].notNull).toBe(true);
    expect(byName['target_type'].notNull).toBe(true);
    expect(byName['target_id'].notNull).toBe(false);
    expect(byName['metadata'].notNull).toBe(false);
  });

  it('has no foreign keys (trail survives user deletion)', () => {
    const cfg = getTableConfig(adminAuditLog);
    expect(cfg.foreignKeys).toHaveLength(0);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/db test src/schema/audit.test.ts`
Expected: FAIL — `adminAuditLog` not exported yet (if Steps 1–2 not done) OR passes if done; ensure Steps 1–2 are complete, then this should PASS. (If it already passes after Steps 1–2, that's fine — the test is the gate, written alongside.)

- [ ] **Step 5: Generate migration 0026 (offline; NO db:migrate)**

Run: `pnpm --filter @language-drill/db db:generate`
Expected: a new `packages/db/migrations/0026_*.sql` containing `CREATE TABLE "admin_audit_log"` + the `admin_audit_log_created_at_idx` index, and an updated `migrations/meta/_journal.json` + `0026_snapshot.json`.

Verify the SQL:
Run: `cat packages/db/migrations/0026_*.sql`
Expected: a `CREATE TABLE "admin_audit_log" (...)` with the 7 columns + the index. No other table changes (if the diff includes unrelated tables, STOP and report — the schema may be out of sync).

- [ ] **Step 6: Build the db package (so the Lambda can import the new table)**

Run: `pnpm --filter @language-drill/db build`
Expected: success.

- [ ] **Step 7: Typecheck + test the db package**

Run: `pnpm --filter @language-drill/db typecheck && pnpm --filter @language-drill/db test src/schema/audit.test.ts`
Expected: clean + 2 passing.

- [ ] **Step 8: Commit**

```bash
git add packages/db/src/schema/audit.ts packages/db/src/schema/index.ts packages/db/src/schema/audit.test.ts packages/db/migrations
git commit -m "feat(db): admin_audit_log table + migration 0026"
```

---

## Task 2: Lambda — `recordAdminAction` helper

**Files:** Create `infra/lambda/src/lib/admin-audit.ts`, `infra/lambda/src/lib/admin-audit.test.ts`.

- [ ] **Step 1: Write the failing test**

`infra/lambda/src/lib/admin-audit.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { recordAdminAction } from './admin-audit';

function fakeDb(insertImpl: (values: unknown) => Promise<unknown>) {
  return {
    insert: vi.fn(() => ({ values: (v: unknown) => insertImpl(v) })),
  } as unknown as Parameters<typeof recordAdminAction>[0];
}

describe('recordAdminAction', () => {
  it('inserts the audit row', async () => {
    const captured: unknown[] = [];
    const db = fakeDb(async (v) => { captured.push(v); return []; });
    await recordAdminAction(db, {
      adminUserId: 'admin-1', action: 'flagged.approve', targetType: 'exercise',
      targetId: 'ex-1', metadata: { outcome: 'approved' },
    });
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      adminUserId: 'admin-1', action: 'flagged.approve', targetType: 'exercise',
      targetId: 'ex-1', metadata: { outcome: 'approved' },
    });
  });

  it('swallows insert errors and warns (never throws)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const db = fakeDb(async () => { throw new Error('db down'); });
    await expect(
      recordAdminAction(db, { adminUserId: 'a', action: 'invite.revoke', targetType: 'invite', targetId: 'i1' }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('defaults metadata to null when omitted', async () => {
    const captured: Array<{ metadata?: unknown }> = [];
    const db = fakeDb(async (v) => { captured.push(v as { metadata?: unknown }); return []; });
    await recordAdminAction(db, { adminUserId: 'a', action: 'invite.create', targetType: 'invite', targetId: null });
    expect(captured[0].metadata).toBeNull();
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `pnpm --filter @language-drill/lambda test src/lib/admin-audit.test.ts`

- [ ] **Step 3: Implement**

`infra/lambda/src/lib/admin-audit.ts`:
```ts
import { adminAuditLog, type Db } from '@language-drill/db';

export type AdminAuditAction =
  | 'flagged.approve'
  | 'flagged.reject'
  | 'content.demote'
  | 'content.reject'
  | 'generation.trigger'
  | 'invite.create'
  | 'invite.revoke';

export type AdminAuditTargetType = 'exercise' | 'theory_topic' | 'cell' | 'invite';

export type AdminAuditEntry = {
  adminUserId: string;
  action: AdminAuditAction;
  targetType: AdminAuditTargetType;
  targetId: string | null;
  metadata?: Record<string, unknown>;
};

/**
 * Append one row to admin_audit_log. Best-effort: a failed audit write logs a
 * warning and resolves — it must never fail an already-succeeded admin action.
 */
export async function recordAdminAction(db: Db, entry: AdminAuditEntry): Promise<void> {
  try {
    await db.insert(adminAuditLog).values({
      adminUserId: entry.adminUserId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      metadata: entry.metadata ?? null,
    });
  } catch (err) {
    console.warn('admin audit log insert failed', {
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      err,
    });
  }
}
```

- [ ] **Step 4: Run, expect PASS (3)** — `pnpm --filter @language-drill/lambda test src/lib/admin-audit.test.ts` (run `pnpm --filter @language-drill/db build` first if `@language-drill/db` doesn't resolve `adminAuditLog`/`Db`)
- [ ] **Step 5: Typecheck** — `pnpm --filter @language-drill/lambda typecheck` → clean
- [ ] **Step 6: Commit**
```bash
git add infra/lambda/src/lib/admin-audit.ts infra/lambda/src/lib/admin-audit.test.ts
git commit -m "feat(admin): recordAdminAction best-effort audit helper"
```

---

## Task 3: Wire audit into flagged + content routes

**Files:** Modify `infra/lambda/src/routes/admin.ts`, `infra/lambda/src/routes/admin.test.ts`.

> **Important — mock/queue behavior:** `recordAdminAction` does `await db.insert(adminAuditLog).values(...)`, which in the test mock (a) captures the row into `insertedValuesByTable.adminAuditLog` and (b) shifts one `queryQueue` entry (getting `[]` if none staged — harmless, the result is ignored). So adding it does NOT require existing effective-path tests to stage extra entries. After wiring, run the FULL `admin.test.ts` and confirm no pre-existing test regressed; if one did because it relied on exact queue exhaustion, that's the signal to inspect — but in practice the trailing insert shift is benign.

- [ ] **Step 1: Add the `adminAuditLog` sentinel to the test mock**

In `infra/lambda/src/routes/admin.test.ts`, in the `vi.mock('@language-drill/db', ...)` override object, add:
```ts
adminAuditLog: { __mock: 'adminAuditLog' },
```
(alongside the other table sentinels).

- [ ] **Step 2: Write failing tests (flagged + content audit)**

Append to `admin.test.ts`:
```ts
describe('audit log — flagged + content', () => {
  it('records flagged.approve on an effective approve (exercise)', async () => {
    delete insertedValuesByTable.adminAuditLog;
    queryQueue.push([{ id: 'ex-1' }]); // UPDATE ... returning → approved
    const id = '11111111-1111-1111-1111-111111111111';
    await request(`/admin/flagged/exercises/${id}/approve`, { method: 'POST' });
    expect(insertedValuesByTable.adminAuditLog).toMatchObject({
      action: 'flagged.approve', targetType: 'exercise', targetId: id, metadata: { outcome: 'approved' },
    });
  });

  it('does NOT record when the flagged approve is already_resolved', async () => {
    delete insertedValuesByTable.adminAuditLog;
    queryQueue.push([]); // UPDATE → 0 rows
    queryQueue.push([{ reviewStatus: 'manual-approved' }]); // re-read
    const id = '22222222-2222-2222-2222-222222222222';
    await request(`/admin/flagged/exercises/${id}/approve`, { method: 'POST' });
    expect(insertedValuesByTable.adminAuditLog).toBeUndefined();
  });

  it('records content.demote on an effective demote (theory)', async () => {
    delete insertedValuesByTable.adminAuditLog;
    queryQueue.push([{ id: 'th-1' }]); // UPDATE → demoted
    const id = '33333333-3333-3333-3333-333333333333';
    await request(`/admin/content/theory/${id}/demote`, { method: 'POST' });
    expect(insertedValuesByTable.adminAuditLog).toMatchObject({
      action: 'content.demote', targetType: 'theory_topic', targetId: id, metadata: { outcome: 'demoted' },
    });
  });
});
```
(Use the file's actual request helper + valid uuids; adapt to the existing admin-auth env helper the other tests use.)

- [ ] **Step 3: Run, expect FAIL** — `pnpm --filter @language-drill/lambda test src/routes/admin.test.ts`

- [ ] **Step 4: Implement — wire the flagged loop**

In `admin.ts`, add the import: `import { recordAdminAction } from '../lib/admin-audit';`

Replace the flagged route loop body so it records effective outcomes:
```ts
const EFFECTIVE_FLAGGED = new Set(['approved', 'rejected', 'demoted']);

for (const [kind, resolve] of [
  ['exercises', resolveExerciseFlagged],
  ['theory', resolveTheoryFlagged],
] as const) {
  const targetType = kind === 'exercises' ? ('exercise' as const) : ('theory_topic' as const);
  for (const action of ['approve', 'reject'] as const) {
    admin.post(`/admin/flagged/${kind}/:id/${action}`, async (c) => {
      const idParsed = FlaggedIdSchema.safeParse(c.req.param('id'));
      if (!idParsed.success) {
        return c.json({ error: 'Invalid id', code: 'VALIDATION_ERROR' }, 400);
      }
      const outcome = await resolve(idParsed.data, action);
      if (EFFECTIVE_FLAGGED.has(outcome)) {
        await recordAdminAction(db, {
          adminUserId: c.get('userId'),
          action: action === 'approve' ? 'flagged.approve' : 'flagged.reject',
          targetType,
          targetId: idParsed.data,
          metadata: { outcome },
        });
      }
      return c.json({ outcome });
    });
  }
}
```

Wire the content loop similarly:
```ts
const EFFECTIVE_CONTENT = new Set(['demoted', 'rejected']);

for (const action of ['demote', 'reject'] as const) {
  const toStatus = action === 'demote' ? ('flagged' as const) : ('rejected' as const);
  const auditAction = action === 'demote' ? ('content.demote' as const) : ('content.reject' as const);
  admin.post(`/admin/content/exercises/:id/${action}`, async (c) => {
    const idParsed = ContentIdSchema.safeParse(c.req.param('id'));
    if (!idParsed.success) return c.json({ error: 'Invalid id', code: 'VALIDATION_ERROR' }, 400);
    const outcome = await transitionContentExercise(idParsed.data, toStatus);
    if (EFFECTIVE_CONTENT.has(outcome)) {
      await recordAdminAction(db, { adminUserId: c.get('userId'), action: auditAction, targetType: 'exercise', targetId: idParsed.data, metadata: { outcome } });
    }
    return c.json({ outcome });
  });
  admin.post(`/admin/content/theory/:id/${action}`, async (c) => {
    const idParsed = ContentIdSchema.safeParse(c.req.param('id'));
    if (!idParsed.success) return c.json({ error: 'Invalid id', code: 'VALIDATION_ERROR' }, 400);
    const outcome = await transitionContentTheory(idParsed.data, toStatus);
    if (EFFECTIVE_CONTENT.has(outcome)) {
      await recordAdminAction(db, { adminUserId: c.get('userId'), action: auditAction, targetType: 'theory_topic', targetId: idParsed.data, metadata: { outcome } });
    }
    return c.json({ outcome });
  });
}
```

- [ ] **Step 5: Run the FULL admin test file, expect PASS** — `pnpm --filter @language-drill/lambda test src/routes/admin.test.ts` (run `pnpm --filter @language-drill/db build` first if needed). Confirm the new tests pass AND no pre-existing flagged/content test regressed.
- [ ] **Step 6: Typecheck** — `pnpm --filter @language-drill/lambda typecheck` → clean
- [ ] **Step 7: Commit**
```bash
git add infra/lambda/src/routes/admin.ts infra/lambda/src/routes/admin.test.ts
git commit -m "feat(admin): audit-log flagged approve/reject + content demote/reject"
```

---

## Task 4: Wire audit into generate + invites

**Files:** Modify `infra/lambda/src/routes/admin.ts`, `infra/lambda/src/routes/admin.test.ts`.

- [ ] **Step 1: Write failing tests**

Append to `admin.test.ts` (reuse the generate-test env `beforeAll`/`afterAll` if in a shared describe; otherwise set `AWS_REGION`/`GENERATION_QUEUE_URL` as the existing generate tests do):
```ts
describe('audit log — generate + invites', () => {
  it('records generation.trigger after a successful enqueue', async () => {
    delete insertedValuesByTable.adminAuditLog;
    queryQueue.push([]); // in-flight check: none
    const res = await request('/admin/generate', {
      method: 'POST',
      body: JSON.stringify({ language: 'ES', level: 'B1', type: 'cloze', grammarPoint: 'es-b1-present-subjunctive', count: 7 }),
    });
    const body = await res.json();
    expect(insertedValuesByTable.adminAuditLog).toMatchObject({
      action: 'generation.trigger', targetType: 'cell', metadata: { count: 7, jobId: body.jobId },
    });
  });

  it('does NOT record generation.trigger on a 409 in-flight', async () => {
    delete insertedValuesByTable.adminAuditLog;
    queryQueue.push([{ id: 'existing' }]); // in-flight found → 409
    await request('/admin/generate', {
      method: 'POST',
      body: JSON.stringify({ language: 'ES', level: 'B1', type: 'cloze', grammarPoint: 'es-b1-present-subjunctive', count: 5 }),
    });
    expect(insertedValuesByTable.adminAuditLog).toBeUndefined();
  });

  it('records invite.create after generating codes', async () => {
    delete insertedValuesByTable.adminAuditLog;
    queryQueue.push([{ id: 'i1', code: 'AAAAAAAA', expiresAt: null, note: null }]); // invites insert .returning
    await request('/admin/invites', { method: 'POST', body: JSON.stringify({ count: 1 }) });
    expect(insertedValuesByTable.adminAuditLog).toMatchObject({
      action: 'invite.create', targetType: 'invite', targetId: null, metadata: { count: 1 },
    });
  });

  it('records invite.revoke only when actually revoked', async () => {
    delete insertedValuesByTable.adminAuditLog;
    queryQueue.push([{ id: 'inv-1', usedBy: null, revokedAt: null }]); // select → revocable
    await request('/admin/invites/inv-1/revoke', { method: 'POST' });
    expect(insertedValuesByTable.adminAuditLog).toMatchObject({
      action: 'invite.revoke', targetType: 'invite', targetId: 'inv-1',
    });
  });

  it('does NOT record invite.revoke when already used (409)', async () => {
    delete insertedValuesByTable.adminAuditLog;
    queryQueue.push([{ id: 'inv-2', usedBy: 'user-x', revokedAt: null }]); // select → used
    await request('/admin/invites/inv-2/revoke', { method: 'POST' });
    expect(insertedValuesByTable.adminAuditLog).toBeUndefined();
  });
});
```
(Adapt request helper + the generate env setup to match the file. The invite-revoke success path: the route SELECTs the row (staged), then UPDATEs `revokedAt`, then records — the audit insert is the last write.)

- [ ] **Step 2: Run, expect FAIL** — `pnpm --filter @language-drill/lambda test src/routes/admin.test.ts`

- [ ] **Step 3: Implement — generate**

In the `POST /admin/generate` handler, after `await getSqsClient().send(...)` and before `return c.json({ jobId, status: 'queued' })`:
```ts
  await recordAdminAction(db, {
    adminUserId: c.get('userId'),
    action: 'generation.trigger',
    targetType: 'cell',
    targetId: cellKey,
    metadata: { count, jobId },
  });
```

- [ ] **Step 4: Implement — invites create**

In `POST /admin/invites`, after `const inserted = await db.insert(invitations).values(rows).returning({...})` and before `return c.json({ codes: inserted })`:
```ts
  await recordAdminAction(db, {
    adminUserId: c.get('userId'),
    action: 'invite.create',
    targetType: 'invite',
    targetId: null,
    metadata: { count: n },
  });
```
(`n` is the destructured `count`. If the route names it differently, use that name.)

- [ ] **Step 5: Implement — invites revoke**

In `POST /admin/invites/:id/revoke`, ONLY on the branch that performs the update — after `await db.update(invitations).set({ revokedAt: new Date() })...` and before its `return c.json({ ok: true }, 200)`:
```ts
  await recordAdminAction(db, {
    adminUserId: c.get('userId'),
    action: 'invite.revoke',
    targetType: 'invite',
    targetId: id,
    metadata: {},
  });
```
Do NOT add it to the 404 / `INVITE_USED` / already-revoked-no-op branches.

- [ ] **Step 6: Run the FULL admin test file, expect PASS** — `pnpm --filter @language-drill/lambda test src/routes/admin.test.ts`. Confirm new tests pass + no regression.
- [ ] **Step 7: Typecheck** — `pnpm --filter @language-drill/lambda typecheck` → clean
- [ ] **Step 8: Commit**
```bash
git add infra/lambda/src/routes/admin.ts infra/lambda/src/routes/admin.test.ts
git commit -m "feat(admin): audit-log generation trigger + invite create/revoke"
```

---

## Task 5: Full verification

**Files:** none.

- [ ] **Step 1: Build workspace packages** — `pnpm build` (ensures `@language-drill/db` dist has `adminAuditLog` for downstream typecheck/tests). Expected: success.
- [ ] **Step 2: Lint** — `pnpm lint` → no errors
- [ ] **Step 3: Repo typecheck** — `pnpm typecheck` → no errors (all packages)
- [ ] **Step 4: Full serial test suite** — `pnpm turbo run test --concurrency=1` → all packages pass. (If `@language-drill/lambda` reports phantom failures from stale compiled `infra/lambda/dist/**/*.test.js`, `rm -rf infra/lambda/dist` and re-run — a known worktree artifact.)
- [ ] **Step 5: Confirm the migration is the only schema change + not applied locally**
  - `git status --porcelain packages/db/migrations` → the new `0026_*.sql` + `meta` are committed; nothing uncommitted.
  - Do NOT run `db:migrate`.
- [ ] **Step 6: Commit (only if a lint/format autofix changed files; else skip)**
```bash
git add -A && git commit -m "chore(admin): verification fixes" || echo "nothing to commit"
```

---

## Self-review notes

- **Spec coverage:** table + migration 0026 + no-FK + createdAt index (Task 1); `recordAdminAction` best-effort helper + action/targetType unions (Task 2); wiring with effective-only recording into flagged/content (Task 3) and generate/invites (Task 4); the don't-apply-locally + verification (Tasks 1, 5). The exact taxonomy + per-route metadata match the spec's wiring table.
- **Type consistency:** `AdminAuditAction`/`AdminAuditTargetType`/`AdminAuditEntry` (Task 2) used verbatim at every call site (Tasks 3–4); column names in `audit.ts` (Task 1) match the helper's `.values({...})` keys (Task 2) and the schema test assertions; `adminAuditLog` table name `admin_audit_log` consistent across schema, mock sentinel, and migration.
- **Known pitfalls flagged inline:** db dist rebuild before Lambda resolves the new table; the audit insert's benign extra `queryQueue` shift (Task 3 note); `db:generate` offline / never `db:migrate` locally; migration-number collision risk; stale `infra/lambda/dist` (Task 5).
- **No placeholders:** every code step is complete; every run step has a command + expected result.
```
