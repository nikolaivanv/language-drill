# Exclude Broken-Exercise Evidence From Progress — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop counting a learner's attempts on genuinely-defective exercises toward their mastery, radar, coach and weekly-email scores — retroactively and going forward — while continuing to count attempts on exercises demoted purely for pool hygiene.

**Architecture:** A new nullable `exercises.demotion_reason` column records *why* a row left the pool. Two of its four values (`quality`, `learner-flag`) mark the row's attempts as non-evidence. One shared Drizzle predicate (`scoringEvidenceFilter`) applies that rule; every demotion write site sets the column; the existing `backfill:mastery` replay rebuilds stored mastery under the filter; four read-time score surfaces gain the predicate.

**Tech Stack:** TypeScript, Drizzle ORM (Postgres/Neon), Hono on AWS Lambda, Vitest, pnpm workspaces + Turborepo.

## Global Constraints

- **Worktree:** all work happens in `/Users/seal/dev/language-drill/.claude/worktrees/exclude-broken-evidence` on branch `feat/exclude-broken-evidence`. Use absolute paths rooted there — main-repo absolute paths silently write to the main checkout.
- **First-run setup:** a fresh worktree has no `node_modules`. Before the first test run: `pnpm install && pnpm build` from the worktree root. `packages/shared` and `packages/db` are consumed from `dist/`, so re-run `pnpm build` after editing `packages/db/src`.
- **Design source of truth:** `docs/superpowers/specs/2026-08-08-exclude-broken-evidence-from-progress-design.md`.
- **Demotion reason vocabulary — exactly these four string literals:** `'quality'`, `'learner-flag'`, `'duplicate'`, `'pool-hygiene'`. Non-evidence set: `'quality'`, `'learner-flag'`.
- **Learner-flag status literal is `'resolved_rejected'`**, not `'rejected'`. `exercise_flags.status` ∈ `{'open','resolved_rejected','resolved_dismissed'}`. Using `'rejected'` matches zero rows.
- **Migrations are forward-only.** Generate with `pnpm --filter @language-drill/db db:generate`; never hand-edit `packages/db/migrations/meta`.
- **Barrel imports only.** Cross-package consumers import from `@language-drill/db`, never deep relative paths. `packages/db` must not import from `infra/lambda` (lambda depends on db — the reverse is a cycle).
- **Lambda tests must `vi.mock('../db')`** or they break under turbo/CI without `DATABASE_URL`.
- **Pre-push gate, from the worktree root, zero failures:** `pnpm lint && pnpm typecheck && pnpm test`.
- **Prod is read-only until Task 7.** Prod Neon: project `twilight-smoke-01114337`, branch `br-green-waterfall-ancrvpr5`. The local `.env` `DATABASE_URL` points at the **dev** branch.

---

## File Structure

**Create**
- `packages/db/src/lib/evidence.ts` — the demotion-reason vocabulary, the pure predicate, and the Drizzle SQL predicate. Single source of truth for "does this attempt count?".
- `packages/db/src/lib/evidence.test.ts`
- `packages/db/scripts/backfill-demotion-reason.ts` — one-off classifier for existing rejected rows.
- `packages/db/scripts/backfill-demotion-reason.test.ts`
- `packages/db/migrations/00XX_*.sql` — generated, adds the column.

**Modify**
- `packages/db/src/schema/exercises.ts` — add `demotionReason` column.
- `packages/db/src/index.ts` — export the evidence module.
- `infra/lambda/src/lib/exercise-filters.ts` — re-export `scoringEvidenceFilter` + document call sites.
- `infra/lambda/src/lib/exercise-filters.test.ts` — SQL-render test + call-site guard.
- `packages/db/scripts/backfill-mastery.ts` — filter the replay.
- `packages/db/scripts/demote-cell-pool.ts` — required `--reason`.
- `packages/db/scripts/demote-cell-pool.test.ts` — arg tests.
- `packages/db/scripts/dedup-sc-pool.ts`, `dedupe-conjugation-pool.ts`, `revalidate-cloze-pool.ts` — write the reason.
- `infra/lambda/src/routes/exercise-flags.ts` — write `'learner-flag'`.
- `infra/lambda/src/routes/admin.ts` — moderation reject writes `'quality'`.
- `infra/lambda/src/routes/progress.ts`, `routes/insights.ts`, `routes/sessions.ts`, `email/gather.ts` — apply the predicate.
- `packages/db/package.json`, root `package.json` — `backfill:demotion-reason` script.
- `docs/runbooks/prompt-update-and-revalidate.md`, `CLAUDE.md` — document the new step and CLI.

**A note on testing read paths — a deliberate deviation from the spec.** Spec §6 asks for "one case per filtered surface (mocked db)". That test cannot work: the Lambda route tests mock the `db` module, so the mock returns its canned rows regardless of the `WHERE` clause. A mocked route test would pass whether or not the predicate is applied. Verification is therefore split three ways: the predicate's rendered SQL is unit-tested (Task 2), the four call sites are guarded structurally (Task 2 Step 7), and the behavioural proof is the prod before/after diff (Task 7). Do not write mocked route tests that appear to verify filtering — they would be theatre. Spec §6's admin-pool-status non-regression check is covered by running `admin.test.ts` in Task 3 Step 8.

---

### Task 1: `demotion_reason` column + migration

**Files:**
- Modify: `packages/db/src/schema/exercises.ts:30` (immediately after `flaggedReasons`)
- Create: `packages/db/migrations/00XX_<generated_name>.sql`

**Interfaces:**
- Produces: `exercises.demotionReason` — Drizzle column `text('demotion_reason')`, nullable, no default. Every later task depends on it.

- [ ] **Step 1: Add the column**

In `packages/db/src/schema/exercises.ts`, insert directly below the `flaggedReasons` line:

```ts
    // Why this row left the pool. NULL for rows that were never demoted, and
    // for `flagged` rows (unadjudicated — pre-judging them would discard
    // evidence on a suspicion). 'quality' | 'learner-flag' mark the row's
    // learner attempts as non-evidence (see packages/db/src/lib/evidence.ts);
    // 'duplicate' | 'pool-hygiene' leave them counting — the item was
    // answerable, it just should not be served again.
    demotionReason: text('demotion_reason'),
```

`text` is already imported at the top of the file — do not add an import.

- [ ] **Step 2: Generate the migration**

Run: `pnpm --filter @language-drill/db db:generate`
Expected: a new `packages/db/migrations/0039_*.sql` containing
`ALTER TABLE "exercises" ADD COLUMN "demotion_reason" text;` plus an updated `migrations/meta` snapshot.

- [ ] **Step 3: Verify the generated SQL**

Run: `cat packages/db/migrations/0039_*.sql`
Expected: exactly one `ADD COLUMN` statement, no `DROP`, no table rewrite. If the diff contains anything else, the local schema had drifted — stop and report rather than committing it.

- [ ] **Step 4: Rebuild and typecheck**

Run: `pnpm build && pnpm --filter @language-drill/db typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/exercises.ts packages/db/migrations
git commit -m "feat(db): add exercises.demotion_reason column"
```

---

### Task 2: The shared evidence predicate

**Files:**
- Create: `packages/db/src/lib/evidence.ts`
- Create: `packages/db/src/lib/evidence.test.ts`
- Modify: `packages/db/src/index.ts` (add export near the mastery exports, ~line 118)
- Modify: `infra/lambda/src/lib/exercise-filters.ts`
- Modify: `infra/lambda/src/lib/exercise-filters.test.ts`

**Interfaces:**
- Consumes: `exercises.demotionReason` (Task 1).
- Produces:
  - `type DemotionReason = 'quality' | 'learner-flag' | 'duplicate' | 'pool-hygiene'`
  - `const DEMOTION_REASONS: readonly DemotionReason[]`
  - `const NON_EVIDENCE_DEMOTION_REASONS: readonly ['quality', 'learner-flag']`
  - `function scoringEvidenceFilter(table: typeof exercises): SQL`
  - All re-exported from `@language-drill/db`; `scoringEvidenceFilter` additionally re-exported from `infra/lambda/src/lib/exercise-filters.ts`.

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/lib/evidence.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { exercises } from '../schema';
import {
  DEMOTION_REASONS,
  NON_EVIDENCE_DEMOTION_REASONS,
  scoringEvidenceFilter,
} from './evidence';

describe('demotion reason vocabulary', () => {
  it('exposes the non-evidence set as a subset of the vocabulary', () => {
    for (const r of NON_EVIDENCE_DEMOTION_REASONS) {
      expect(DEMOTION_REASONS).toContain(r);
    }
  });

  it('keeps pool-hygiene demotions out of the non-evidence set', () => {
    expect(NON_EVIDENCE_DEMOTION_REASONS).not.toContain('duplicate');
    expect(NON_EVIDENCE_DEMOTION_REASONS).not.toContain('pool-hygiene');
  });
});

describe('scoringEvidenceFilter', () => {
  it('renders a coalesce-guarded NOT IN so NULL rows survive', () => {
    const { sql } = new PgDialect().sqlToQuery(scoringEvidenceFilter(exercises));
    const lower = sql.toLowerCase();
    expect(lower).toContain('coalesce');
    expect(lower).toContain('demotion_reason');
    expect(lower).toContain('not in');
    // Qualified reference — an unqualified column would be ambiguous once the
    // predicate is composed into a join against user_exercise_history.
    expect(lower).toContain('"exercises"."demotion_reason"');
  });

  it('binds every non-evidence reason as a parameter', () => {
    const { params } = new PgDialect().sqlToQuery(scoringEvidenceFilter(exercises));
    expect(params).toContain('quality');
    expect(params).toContain('learner-flag');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/db exec vitest run src/lib/evidence.test.ts`
Expected: FAIL — `Failed to resolve import "./evidence"`.

- [ ] **Step 3: Write the implementation**

Create `packages/db/src/lib/evidence.ts`:

```ts
// Which learner attempts count as evidence toward mastery and progress scores.
//
// An attempt is scored against the exercise as it was at the time. When an
// exercise is later demoted the attempt survives — demotion never DELETEs,
// because user_exercise_history references exercises.id without cascade. That
// is correct for pool hygiene (a duplicate was still answerable, the learner
// still did the work) and wrong for defects (a mis-keyed answer or ambiguous
// blank marked the learner down for the item's fault, not theirs).
//
// `exercises.demotion_reason` records which case a demotion was, and this
// module is the single place that decides what follows from it.
import { sql, type SQL } from 'drizzle-orm';

import { exercises } from '../schema/exercises';

export type DemotionReason =
  | 'quality' // validator / revalidator / admin judged the item defective
  | 'learner-flag' // learner flagged it, admin upheld
  | 'duplicate' // dedup sweep
  | 'pool-hygiene'; // diversity, regeneration, other pool management

export const DEMOTION_REASONS = [
  'quality',
  'learner-flag',
  'duplicate',
  'pool-hygiene',
] as const satisfies readonly DemotionReason[];

/**
 * Demotion reasons whose attempts must not count toward learner scoring.
 * Everything else counts, including NULL and any future unrecognised value —
 * the cost of keeping a bad row is a slightly unfair score, the cost of
 * dropping a good one is destroying real evidence.
 */
export const NON_EVIDENCE_DEMOTION_REASONS = ['quality', 'learner-flag'] as const;

/**
 * Drizzle predicate constraining a query to exercises whose attempts count as
 * learner evidence. Pass the `exercises` table reference; composes under
 * `and(...)` alongside the user/language/window predicates.
 *
 * `coalesce` rather than `notInArray`: SQL `NOT IN` evaluates to NULL — not
 * true — when the column is NULL, which would silently drop every row that was
 * never demoted (i.e. almost all of them).
 */
export function scoringEvidenceFilter(table: typeof exercises): SQL {
  return sql`coalesce(${table.demotionReason}, '') not in ('quality', 'learner-flag')`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @language-drill/db exec vitest run src/lib/evidence.test.ts`
Expected: PASS (4 tests).

If the `"exercises"."demotion_reason"` assertion fails, print the rendered SQL and check qualification — do **not** weaken the assertion. An unqualified column here reproduces the ambiguous-column 500 that this predicate is composed into joins to avoid.

- [ ] **Step 5: Export from the barrel**

In `packages/db/src/index.ts`, directly below the `export * from './errors/observations';` line, add:

```ts
// Evidence eligibility — which demoted exercises' attempts still count toward
// learner scoring. Consumed by the Lambda read paths and the mastery backfill.
export * from './lib/evidence';
```

- [ ] **Step 6: Re-export from the Lambda filter module**

In `infra/lambda/src/lib/exercise-filters.ts`, change line 1 to:

```ts
import {
  exercises as exercisesTable,
  userExerciseHistory,
  scoringEvidenceFilter,
} from '@language-drill/db';
```

and append at the end of the file:

```ts
/**
 * Re-exported from `@language-drill/db` so every serve-path and scoring
 * predicate is reachable from one module. Distinct from
 * `approvedStatusFilter`: that one decides what may be *served*, this one
 * decides what may be *scored*.
 *
 * Scoring call sites (must use `scoringEvidenceFilter`):
 *   - routes/progress.ts:  GET /progress/radar
 *   - routes/insights.ts:  error observations + attempt counts
 *   - routes/sessions.ts:  GET /sessions/:id/debrief skill movements
 *   - email/gather.ts:     weekly summary accuracy
 *
 * Sites that intentionally do NOT filter:
 *   - routes/admin.ts (all)      — admin surfaces show raw truth
 *   - session debrief item lists — a record of what you did, not a score
 *   - routes/user-export.ts      — portability means the complete record
 *   - serve paths                — already gated by `approvedStatusFilter`
 */
export { scoringEvidenceFilter };
```

- [ ] **Step 7: Verify the re-export compiles**

Run: `pnpm build && pnpm --filter @language-drill/lambda exec vitest run src/lib/exercise-filters.test.ts`
Expected: PASS — the pre-existing `freshFirstOrderBy` test still passes and the new re-export resolves.

The call-site guard test that pins the four scoring surfaces lives in Task 5, alongside the code it guards — writing it here would commit a knowingly-failing test and violate the project's "tests must pass before moving to the next task" rule.

- [ ] **Step 8: Build, typecheck, commit**

```bash
pnpm build && pnpm --filter @language-drill/db typecheck && pnpm --filter @language-drill/lambda typecheck
git add packages/db/src/lib/evidence.ts packages/db/src/lib/evidence.test.ts \
        packages/db/src/index.ts infra/lambda/src/lib/exercise-filters.ts \
        infra/lambda/src/lib/exercise-filters.test.ts
git commit -m "feat(db): add scoring-evidence predicate for demoted exercises"
```

---

### Task 3: Record demotion intent at every write site

**Files:**
- Modify: `packages/db/scripts/demote-cell-pool.ts` (args ~line 43-73, write ~line 126)
- Modify: `packages/db/scripts/demote-cell-pool.test.ts`
- Modify: `packages/db/scripts/dedup-sc-pool.ts:158`
- Modify: `packages/db/scripts/dedupe-conjugation-pool.ts:282`
- Modify: `packages/db/scripts/revalidate-cloze-pool.ts:210-216`
- Modify: `infra/lambda/src/routes/exercise-flags.ts:148`
- Modify: `infra/lambda/src/routes/admin.ts:939-953`

**Interfaces:**
- Consumes: `DemotionReason`, `DEMOTION_REASONS` (Task 2).
- Produces: `DemoteArgs` gains `reason: DemotionReason`. Every `set({ reviewStatus: 'rejected' })` in the repo also sets `demotionReason`.

- [ ] **Step 1: Write the failing arg tests**

Add to `packages/db/scripts/demote-cell-pool.test.ts`, inside the existing `parseDemoteArgs` describe block (match the surrounding test style — check how existing cases build `argv`):

```ts
  it('requires --reason so demotion intent is never guessed later', () => {
    expect(() =>
      parseDemoteArgs(['--language', 'TR', '--cefr', 'A1', '--type', 'cloze', '--grammar-point', 'tr-a1-locative']),
    ).toThrow(/--reason/);
  });

  it('rejects a reason outside the vocabulary', () => {
    expect(() =>
      parseDemoteArgs([
        '--language', 'TR', '--cefr', 'A1', '--type', 'cloze',
        '--grammar-point', 'tr-a1-locative', '--reason', 'because-i-said-so',
      ]),
    ).toThrow(/--reason/);
  });

  it('accepts each documented reason', () => {
    for (const reason of ['quality', 'learner-flag', 'duplicate', 'pool-hygiene'] as const) {
      const args = parseDemoteArgs([
        '--language', 'TR', '--cefr', 'A1', '--type', 'cloze',
        '--grammar-point', 'tr-a1-locative', '--reason', reason,
      ]);
      expect(args.reason).toBe(reason);
    }
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @language-drill/db exec vitest run scripts/demote-cell-pool.test.ts`
Expected: FAIL — no `--reason` handling; `args.reason` is `undefined`.

- [ ] **Step 3: Implement the required flag**

In `packages/db/scripts/demote-cell-pool.ts`, add to the imports:

```ts
import { DEMOTION_REASONS, type DemotionReason } from '../src/lib/evidence';
```

(relative path — this is an internal consumer inside `packages/db`.)

Add `reason: DemotionReason;` to the `DemoteArgs` type, then in `parseDemoteArgs`, after the existing required-flag check:

```ts
  const reason = get('--reason');
  if (!reason || !(DEMOTION_REASONS as readonly string[]).includes(reason)) {
    throw new Error(
      `--reason is required and must be one of: ${DEMOTION_REASONS.join(' | ')}. ` +
        `It decides whether learners keep credit for attempts on these rows — ` +
        `'quality' and 'learner-flag' revoke it, 'duplicate' and 'pool-hygiene' keep it.`,
    );
  }
```

and add `reason: reason as DemotionReason,` to the returned object.

- [ ] **Step 4: Write the reason and the reminder**

Replace the write loop (`packages/db/scripts/demote-cell-pool.ts:126`):

```ts
  for (const r of rows) {
    await db
      .update(exercises)
      .set({ reviewStatus: 'rejected', demotionReason: args.reason })
      .where(eq(exercises.id, r.id));
  }

  console.log(`[demote-pool] demoted ${rows.length} rows to 'rejected' (reason: ${args.reason}).`);

  if (args.reason === 'quality' || args.reason === 'learner-flag') {
    console.log(
      '[demote-pool] These attempts no longer count as learner evidence. ' +
        'Stored mastery is now stale — run `pnpm backfill:mastery --apply` against this database.',
    );
  }
```

Delete the old `console.log` that this replaces, and include `--reason` in the usage examples in the file's header comment.

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @language-drill/db exec vitest run scripts/demote-cell-pool.test.ts`
Expected: PASS.

- [ ] **Step 6: Set the reason at the four other write sites**

`packages/db/scripts/dedup-sc-pool.ts:158` — a dedup sweep; the duplicate was answerable:

```ts
    await db
      .update(exercises)
      .set({ reviewStatus: 'rejected', demotionReason: 'duplicate' })
      .where(eq(exercises.id, id));
```

`packages/db/scripts/dedupe-conjugation-pool.ts:282` — same change:

```ts
    await db
      .update(exercises)
      .set({ reviewStatus: 'rejected', demotionReason: 'duplicate' })
      .where(eq(exercises.id, d.id));
```

`packages/db/scripts/revalidate-cloze-pool.ts` — in `applyDemotion`, the revalidator found a defect. Note `action.to` may be `'flagged'` rather than `'rejected'`; only a rejection revokes evidence:

```ts
  await db
    .update(exercises)
    .set({
      reviewStatus: action.to,
      flaggedReasons: action.reasons,
      qualityScore,
      ...(action.to === 'rejected' ? { demotionReason: 'quality' as const } : {}),
    })
    .where(eq(exercises.id, rowId));
```

`infra/lambda/src/routes/exercise-flags.ts:148` — the learner flagged it and an admin upheld:

```ts
    await tx.update(exercises)
      .set({ reviewStatus: 'rejected', demotionReason: 'learner-flag' })
      .where(eq(exercises.id, flag.exerciseId)).returning({ id: exercises.id });
```

`infra/lambda/src/routes/admin.ts:939-953` — moderation resolving a flagged exercise as rejected. Update the two `'rejected'` set-payloads in `resolveFlaggedExercise` (the `: { reviewStatus: 'rejected' as const }` branch of the ternary at ~939, and the fallback `.set({ reviewStatus: 'rejected' as const })` at ~952) to:

```ts
{ reviewStatus: 'rejected' as const, demotionReason: 'quality' as const }
```

Leave the `'manual-approved'` branch untouched.

- [ ] **Step 7: Verify no unmarked demotion remains**

Run: `rg -a -n "reviewStatus: 'rejected'" packages infra apps`
Expected: every hit also sets `demotionReason` on the same statement. Any hit that does not is a site this task missed — fix it before committing.

- [ ] **Step 8: Run the affected suites**

Run: `pnpm build && pnpm --filter @language-drill/db test && pnpm --filter @language-drill/lambda exec vitest run src/routes/exercise-flags.test.ts src/routes/admin.test.ts`
Expected: PASS. If `admin.test.ts` fails on mock ordering, re-derive the mock push order rather than changing assertions — its pool-status mock drains one queue with `db.execute` shifting synchronously and `db.select` lazily.

- [ ] **Step 9: Commit**

```bash
git add packages/db/scripts infra/lambda/src/routes/exercise-flags.ts infra/lambda/src/routes/admin.ts
git commit -m "feat(db): record demotion intent at every demotion write site"
```

---

### Task 4: Classify the existing rejected rows

**Files:**
- Create: `packages/db/scripts/backfill-demotion-reason.ts`
- Create: `packages/db/scripts/backfill-demotion-reason.test.ts`
- Modify: `packages/db/package.json` (scripts block, next to the other `backfill:*` entries)
- Modify: root `package.json` (scripts block, next to `backfill:mastery`)

**Interfaces:**
- Consumes: `exercises.demotionReason` (Task 1).
- Produces: `BACKFILL_STEPS: readonly { reason: DemotionReason; label: string; predicate: SQL }[]`, applied in array order; `pnpm backfill:demotion-reason [--apply]`.

- [ ] **Step 1: Write the failing test**

Create `packages/db/scripts/backfill-demotion-reason.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { BACKFILL_STEPS } from './backfill-demotion-reason';

const render = (i: number) => new PgDialect().sqlToQuery(BACKFILL_STEPS[i].predicate);

describe('BACKFILL_STEPS', () => {
  it('classifies in narrowest-first order so the catch-all cannot swallow the others', () => {
    expect(BACKFILL_STEPS.map((s) => s.reason)).toEqual([
      'quality',
      'learner-flag',
      'pool-hygiene',
    ]);
  });

  it('treats rows carrying validator reasons as quality demotions', () => {
    expect(render(0).sql.toLowerCase()).toContain('flagged_reasons');
  });

  it('matches upheld learner flags on resolved_rejected, not rejected', () => {
    const { sql, params } = render(1);
    const all = (sql + JSON.stringify(params)).toLowerCase();
    expect(all).toContain('resolved_rejected');
    expect(all).toContain('user_flag.reject');
  });

  it('files everything else still unclassified as pool hygiene', () => {
    expect(render(2).sql.toLowerCase()).toContain('demotion_reason');
  });

  it('scopes every step to rejected rows only', () => {
    for (let i = 0; i < BACKFILL_STEPS.length; i += 1) {
      expect(render(i).sql.toLowerCase()).toContain('review_status');
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @language-drill/db exec vitest run scripts/backfill-demotion-reason.test.ts`
Expected: FAIL — `Failed to resolve import "./backfill-demotion-reason"`.

- [ ] **Step 3: Write the script**

Create `packages/db/scripts/backfill-demotion-reason.ts`:

```ts
/**
 * `pnpm backfill:demotion-reason` — one-off classifier for exercises that were
 * demoted before `exercises.demotion_reason` existed.
 *
 * Three passes, narrowest first; each only touches rows still NULL:
 *   1. quality      — the row carries validator/revalidator flagged_reasons
 *   2. learner-flag — an admin upheld a learner's flag on it
 *   3. pool-hygiene — everything else that left the pool
 *
 * Known, accepted gap: `demote:pool` was also used for genuine quality sweeps
 * (self-revealing-target, cloze tense-determinacy, answer/stem overlap). Those
 * rows wrote no flagged_reasons and carry no demotion timestamp, so pass 3
 * files them as pool-hygiene and their attempts keep counting. This
 * under-excludes; it never over-excludes. Guessing the other way would destroy
 * legitimate evidence, and Task 3 makes this the last cohort that can be
 * ambiguous.
 *
 * Dry-run by default; pass --apply to write. Idempotent.
 *
 * Required env: DATABASE_URL.
 */
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';

import { createDb } from '../src/client';
import { exercises } from '../src/schema';
import type { DemotionReason } from '../src/lib/evidence';

export const BACKFILL_STEPS: readonly {
  reason: DemotionReason;
  label: string;
  predicate: SQL;
}[] = [
  {
    reason: 'quality',
    label: 'carries validator/revalidator flagged_reasons',
    predicate: sql`${exercises.reviewStatus} = 'rejected'
      and ${exercises.demotionReason} is null
      and ${exercises.flaggedReasons} is not null`,
  },
  {
    reason: 'learner-flag',
    label: 'an admin upheld a learner flag on it',
    predicate: sql`${exercises.reviewStatus} = 'rejected'
      and ${exercises.demotionReason} is null
      and ${exercises.id} in (
        select exercise_id from exercise_flags where status = 'resolved_rejected'
        union
        select target_id::uuid from admin_audit_log
         where action = 'user_flag.reject' and target_type = 'exercise'
      )`,
  },
  {
    reason: 'pool-hygiene',
    label: 'left the pool for some other reason',
    predicate: sql`${exercises.reviewStatus} = 'rejected'
      and ${exercises.demotionReason} is null`,
  },
];

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }
  const db = createDb(databaseUrl);

  for (const step of BACKFILL_STEPS) {
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(exercises)
      .where(step.predicate);

    console.log(
      `[demotion-reason] ${apply ? 'APPLY' : 'DRY-RUN'} ${step.reason}: ` +
        `${n} rows — ${step.label}`,
    );

    if (apply && n > 0) {
      await db.update(exercises).set({ demotionReason: step.reason }).where(step.predicate);
    }
  }

  const [{ remaining }] = await db
    .select({ remaining: sql<number>`count(*)::int` })
    .from(exercises)
    .where(and(eq(exercises.reviewStatus, 'rejected'), isNull(exercises.demotionReason)));

  console.log(
    apply
      ? `[demotion-reason] done — ${remaining} rejected rows still unclassified (expected 0).`
      : '[demotion-reason] dry-run only — pass --apply to write.',
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @language-drill/db exec vitest run scripts/backfill-demotion-reason.test.ts`
Expected: PASS (5 tests).

The script's `main()` runs on import in some harnesses. If importing `BACKFILL_STEPS` in the test triggers the DB connection, guard `main()` behind the same `invokedDirectly` check used at the bottom of `demote-cell-pool.ts` — copy that block verbatim.

- [ ] **Step 5: Register the npm scripts**

`packages/db/package.json`, after `"backfill:mastery"`:

```json
    "backfill:demotion-reason": "npx tsx scripts/backfill-demotion-reason.ts",
```

Root `package.json`, after `"backfill:mastery"`:

```json
    "backfill:demotion-reason": "dotenv -e .env -- pnpm --filter @language-drill/db backfill:demotion-reason",
```

- [ ] **Step 6: Dry-run against the dev database**

Run: `pnpm backfill:demotion-reason`
Expected: three counts printed, no writes, exit 0. The local `.env` points at the Neon **dev** branch — confirm the output says `DRY-RUN` before moving on. Do not pass `--apply` yet; prod is Task 7.

- [ ] **Step 7: Commit**

```bash
git add packages/db/scripts/backfill-demotion-reason.ts \
        packages/db/scripts/backfill-demotion-reason.test.ts \
        packages/db/package.json package.json
git commit -m "feat(db): classify pre-existing demotions by intent"
```

---

### Task 5: Apply the filter to stored mastery and the read paths

**Files:**
- Modify: `packages/db/scripts/backfill-mastery.ts:7-11,17-19,33-41,111-114`
- Modify: `infra/lambda/src/routes/progress.ts:97-107`
- Modify: `infra/lambda/src/routes/insights.ts:93-126`
- Modify: `infra/lambda/src/routes/sessions.ts:1113-1123`
- Modify: `infra/lambda/src/email/gather.ts:29-38`

**Interfaces:**
- Consumes: `scoringEvidenceFilter` (Task 2), `exercises.demotionReason` (Task 1).
- Produces: nothing new. Turns Task 2's Step-7 guard test green.

- [ ] **Step 1: Filter the mastery replay**

In `packages/db/scripts/backfill-mastery.ts`:

Add to the imports:

```ts
import { scoringEvidenceFilter } from '../src/lib/evidence';
```

Add below the existing `const languageFilter = arg('language');`:

```ts
// Attempts on exercises later demoted for a defect are excluded by default —
// the learner was marked down for the item's fault. `--include-demoted`
// restores the pre-2026-08 behaviour and is the rollback path: re-running with
// it rewrites mastery back to the unfiltered values.
const includeDemoted = process.argv.includes('--include-demoted');
```

Add to the `where` array (after the four `isNotNull` entries):

```ts
  if (!includeDemoted) where.push(scoringEvidenceFilter(exercises));
```

Extend the closing log so a run states which rule produced it:

```ts
  console.log(
    `${apply ? 'Wrote' : '[dry-run] Would write'} ${upserts} mastery rows ` +
      `across ${byUserLang.size} (user,language) groups from ${rows.length} history rows ` +
      `(${includeDemoted ? 'including' : 'excluding'} attempts on defect-demoted exercises).`,
  );
```

Update the file's header usage comment to list `[--include-demoted]`.

- [ ] **Step 2: Filter the radar**

In `infra/lambda/src/routes/progress.ts`, add `scoringEvidenceFilter` to the existing import from `../lib/exercise-filters`, then add it as the final entry of the `and(...)` in the `rawRows` query (after `isNotNull(exercises.difficulty),`):

```ts
        scoringEvidenceFilter(exercises),
```

- [ ] **Step 3: Filter the coach inputs**

In `infra/lambda/src/routes/insights.ts`, add `scoringEvidenceFilter` to the `../lib/exercise-filters` import.

The `errorRows` query selects from `errorObservations` with no join, so it needs one — `error_observations.exercise_id` is `NOT NULL` and references `exercises.id`, so an inner join drops no rows on its own. Change its `.from(...)` / `.where(...)` to:

```ts
    .from(errorObservations)
    .innerJoin(exercises, eq(errorObservations.exerciseId, exercises.id))
    .where(
      and(
        eq(errorObservations.userId, userId),
        eq(errorObservations.language, language),
        gte(errorObservations.occurredAt, since),
        scoringEvidenceFilter(exercises),
      ),
    );
```

Verify `exercises` is already imported in this file (the `attemptRows` query uses it) — it is; do not add a duplicate import.

Then add `scoringEvidenceFilter(exercises),` as the final entry of the `attemptRows` `and(...)`, after `isNotNull(exercises.grammarPointKey),`.

- [ ] **Step 4: Filter the debrief skill movements**

In `infra/lambda/src/routes/sessions.ts`, add `scoringEvidenceFilter` to the `../lib/exercise-filters` import, then add to the `histRows` `and(...)`, after `isNotNull(exercisesTable.difficulty),`:

```ts
          scoringEvidenceFilter(exercisesTable),
```

This query is the debrief's *skill-movement* replay only. Leave the debrief's manifest-hydration queries alone — they render the list of what you practised, which stays complete.

- [ ] **Step 5: Filter the weekly summary**

In `infra/lambda/src/email/gather.ts`, add to the imports:

```ts
import { scoringEvidenceFilter } from '@language-drill/db';
```

(this module is outside `routes/`, so it takes the predicate from the barrel directly)

and add to the `rawHistory` `and(...)`, after `isNotNull(userExerciseHistory.evaluatedAt),`:

```ts
        scoringEvidenceFilter(exercises),
```

`rawMastery` needs no change — it reads `user_grammar_mastery`, which the backfill has already corrected.

- [ ] **Step 6: Add the call-site guard test**

Append to `infra/lambda/src/lib/exercise-filters.test.ts` (add the two `node:` imports at the top of the file, beside the existing imports):

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The route tests mock the db module, so a mocked query returns its canned rows
// no matter what the WHERE clause says — a behavioural test cannot prove the
// predicate is applied. This guards the next-best thing: that each scoring
// surface still references it, so deleting the filter fails a test rather than
// silently regressing every learner's scores.
const SCORING_SURFACES = [
  '../routes/progress.ts',
  '../routes/insights.ts',
  '../routes/sessions.ts',
  '../email/gather.ts',
];

describe('scoringEvidenceFilter call sites', () => {
  it.each(SCORING_SURFACES)('%s filters broken-exercise evidence', (rel) => {
    const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
    expect(src).toContain('scoringEvidenceFilter');
  });
});
```

Run: `pnpm build && pnpm --filter @language-drill/lambda exec vitest run src/lib/exercise-filters.test.ts`
Expected: PASS — all four cases green, because Steps 2-5 wired the surfaces. If a case fails, that surface was missed; wire it rather than removing the case.

- [ ] **Step 7: Run the full gate**

Run from the worktree root: `pnpm lint && pnpm typecheck && pnpm test`
Expected: zero failures. If `infra/lambda` throws phantom failures from compiled test files, `rm -rf infra/lambda/dist` and re-run.

Report the actual counts (X passed, Y failed). Do not proceed with failures.

- [ ] **Step 8: Commit**

```bash
git add packages/db/scripts/backfill-mastery.ts infra/lambda/src/lib/exercise-filters.test.ts infra/lambda/src/routes/progress.ts \
        infra/lambda/src/routes/insights.ts infra/lambda/src/routes/sessions.ts \
        infra/lambda/src/email/gather.ts
git commit -m "feat: exclude defect-demoted attempts from mastery and progress surfaces"
```

---

### Task 6: Documentation

**Files:**
- Modify: `docs/runbooks/prompt-update-and-revalidate.md`
- Modify: `CLAUDE.md` (the "Running Locally" command table)

**Interfaces:**
- Consumes: the CLIs from Tasks 3 and 4.

- [ ] **Step 1: Close the drift loop in the runbook**

Read `docs/runbooks/prompt-update-and-revalidate.md`, note the number of its last step, and append one more section matching its existing heading style and numbering. The section's content, verbatim:

- Heading: `Rebuild learner mastery` (numbered to follow the last existing step).
- Body paragraph: "A quality demotion revokes the learner's credit for attempts on the demoted rows, but `user_grammar_mastery` is stored state — it keeps the old values until it is replayed. The read-time surfaces (radar, coach, debrief, weekly email) re-derive per request and need no action."
- A `bash` code block containing exactly these two lines:
  - `pnpm backfill:mastery              # dry-run: prints how many rows would change`
  - `pnpm backfill:mastery --apply`
- Closing paragraph: "Run it against every environment whose pool you demoted in. Skip only if the demotion used `--reason duplicate` or `--reason pool-hygiene` — those keep counting as evidence, so mastery is unaffected."

- [ ] **Step 2: Document the CLIs**

In `CLAUDE.md`, add two rows to the "Running Locally" command table, after the `pnpm revalidate:cloze` row:

```markdown
| `pnpm demote:pool` | Demote a single cell's approved exercises back out of the pool. **Requires `--reason quality\|learner-flag\|duplicate\|pool-hygiene`** — `quality`/`learner-flag` also revoke learners' credit for attempts on those rows (and print a reminder to re-run `backfill:mastery`), the other two leave scores untouched. Dry-run by default; pass `--apply`. |
| `pnpm backfill:demotion-reason` | One-off classifier that fills `exercises.demotion_reason` for rows demoted before the column existed: validator reasons → `quality`, upheld learner flags → `learner-flag`, everything else → `pool-hygiene`. Dry-run by default; idempotent. |
```

- [ ] **Step 3: Verify the docs match the code**

Run: `pnpm demote:pool 2>&1 | head -5`
Expected: the `--reason is required and must be one of: quality | learner-flag | duplicate | pool-hygiene` error, wording matching what CLAUDE.md now claims.

- [ ] **Step 4: Commit**

```bash
git add docs/runbooks/prompt-update-and-revalidate.md CLAUDE.md
git commit -m "docs: document demotion-reason CLIs and the mastery-rebuild step"
```

---

### Task 7: Verify against real data, then apply to prod

**Files:** none (operational).

**Interfaces:**
- Consumes: everything above.

**This task writes to production.** Every write step is gated on a dry-run whose output must be reported before applying. Stop and report rather than improvising if any number disagrees with the expectation.

- [ ] **Step 1: Migrate and classify the dev branch**

```bash
pnpm db:migrate
pnpm backfill:demotion-reason            # dry-run
pnpm backfill:demotion-reason --apply
```

Expected: the final line reports `0 rejected rows still unclassified`.

- [ ] **Step 2: Measure the dev-branch mastery delta**

```bash
pnpm backfill:mastery --include-demoted   # dry-run, old rule
pnpm backfill:mastery                     # dry-run, new rule
```

Expected: both print a row/group count; the new-rule run reads fewer history rows. Record both numbers.

- [ ] **Step 3: Capture the prod baseline**

Against prod (project `twilight-smoke-01114337`, branch `br-green-waterfall-ancrvpr5`), read-only:

```sql
SELECT grammar_point_key, mastery_score, confidence, evidence_count
  FROM user_grammar_mastery
 WHERE grammar_point_key IN (
   'tr-a1-vowel-harmony','tr-a1-locative','tr-a1-personal-suffixes',
   'tr-a1-plural-suffix','tr-a1-ablative-dative','tr-a1-imperative',
   'tr-a1-present-continuous','es-b1-passive-se',
   'es-b1-influence-verbs-infinitive','tr-a1-vocab-family-people')
 ORDER BY grammar_point_key;
```

Save the output — it is the before-half of the verification and the rollback reference.

- [ ] **Step 4: Merge, deploy, migrate prod**

Open the PR, land it (squash-merge; rewrite the squash message to the PR summary rather than the commit bullets), and let `deploy.yml` run Drizzle migrate → CDK → Vercel. Confirm the workflow is green before continuing — the read-path filters ship with the Lambda deploy, and running the backfill against a prod DB whose column does not exist yet fails.

- [ ] **Step 5: Classify prod demotions**

With prod `DATABASE_URL`:

```bash
pnpm backfill:demotion-reason            # dry-run
```

Expected, from the 2026-08-08 measurement: roughly `quality` ≈ 230 rows, `learner-flag` ≈ 10, `pool-hygiene` ≈ 2200 — the exact split will differ, but `pool-hygiene` should be the largest bucket and no bucket should be zero. If `learner-flag` is 0, the `resolved_rejected` literal is wrong — stop.

Then apply, and confirm `0 rejected rows still unclassified`.

- [ ] **Step 6: Rebuild prod mastery**

```bash
pnpm backfill:mastery                    # dry-run
pnpm backfill:mastery --apply
```

Expected: the dry-run reports ~43 fewer history rows than the pre-change baseline (1177 → ~1134 scored rows across all users).

- [ ] **Step 7: Confirm the outcome**

Re-run the Step-3 query and diff against the saved baseline. Expected:

- `tr-a1-ablative-dative` and `tr-a1-plural-suffix` rise — they shed attempts averaging 0.08 and 0.60 against ~0.88 kept.
- `tr-a1-present-continuous` and `es-b1-passive-se` each shed one 0.00.
- No point's `evidence_count` reaches 0, and `tr-a1-questions`, `tr-a1-gore-bence` and `tr-a1-comparative-superlative` are **unchanged** — they are 100% pool-hygiene-sourced and must keep every row.
- Points not in the affected list are untouched.

Then load `/progress` and `/home` in the browser and confirm the radar renders with no empty axes.

If any expectation fails, roll back with `pnpm backfill:mastery --apply --include-demoted`, which restores the prior values, and report before changing anything else.

- [ ] **Step 8: Report**

Report the before/after table for the ten points, the row counts from Steps 5 and 6, and anything that diverged from the expectations above.

---

## Rollback

The column is additive, the predicate is one function, and no data is destroyed at any point.

- **Scores only:** `pnpm backfill:mastery --apply --include-demoted` restores the previous mastery values.
- **Everything:** revert the branch and redeploy; the read paths return to unfiltered immediately. `demotion_reason` can stay — it is inert without the predicate.
