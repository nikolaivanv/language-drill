# Personalized Drill Plan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the daily drill plan personalized — exclude already-attempted exercises from pool draws, put sentence construction in the plan, track per-grammar-point mastery, and bias selection toward weak/unblocked grammar points.

**Architecture:** Three pure, TDD'd cores hold all logic — `updateMastery`/`replayHistory` (the Bayesian mastery rule, in `@language-drill/db`), `rankPlanCandidates` (selection priority, in the Lambda), and a `freshFirstOrderBy` SQL fragment (exposure ordering). The three pool-draw SQL sites and the submit handler are thin wirings over these cores. The radar aggregation is untouched; `user_grammar_mastery` is a new additive table.

**Tech Stack:** TypeScript, Hono (Lambda API), Drizzle ORM + Neon Postgres, Vitest, pnpm workspaces + Turborepo.

---

## Background the implementer must know

- **Monorepo build gotcha (IMPORTANT):** `infra/lambda` imports `@language-drill/db` from its **built `dist/`**, not `src/`. After editing any `packages/db/src/**` file, run `pnpm --filter @language-drill/db build` before running Lambda typecheck/tests, or you'll test against stale code. (This is a known repo footgun.)
- **Test flake:** the full `pnpm test` flakily fails `infra` under parallel load. Verify green with `pnpm turbo run test --concurrency=1`.
- **Exposure ordering seam:** instead of the LEFT JOIN sketched in the spec, we use an equivalent **correlated subquery in `ORDER BY`** — `(select max(evaluated_at) ... where exercise_id = exercises.id and user_id = $u) asc nulls first, random()`. Same semantics (never-seen first via `NULLS FIRST`, then least-recently-seen, then random tiebreak), but a single reusable `sql` fragment with no change to any SELECT shape. Backed by the existing `user_exercise_history_exercise_id_idx` on `(exercise_id, evaluated_at)`.
- **Curriculum access:** `getGrammarPoint(key)` (from `@language-drill/db`) returns a `GrammarPoint` whose `prerequisiteKeys?: readonly string[]` is the prerequisite graph. `rankPlanCandidates` takes prerequisite lookup via dependency injection so it stays pure and unit-testable.
- **Difficulty weights** mirror `infra/lambda/src/lib/progress-aggregation.ts` (A1=0.5, A2=0.7, B1=0.9, B2=1.1, C1=1.3, C2=1.5; recency half-life 30 days). The mastery module re-declares them (clean dependency direction; comment notes they must match).

Spec: `docs/superpowers/specs/2026-06-13-personalized-drill-plan-design.md`.

---

## File map

**Create:**
- `packages/db/src/mastery/update.ts` — `updateMastery`, `replayHistory`, types, constants (pure).
- `packages/db/src/mastery/update.test.ts` — unit tests.
- `packages/db/scripts/backfill-mastery.ts` — one-off CLI replaying history.
- `infra/lambda/src/lib/mastery/rank.ts` — `rankPlanCandidates` (pure).
- `infra/lambda/src/lib/mastery/rank.test.ts` — unit tests.

**Modify:**
- `infra/lambda/src/lib/exercise-filters.ts` — add `freshFirstOrderBy`.
- `infra/lambda/src/lib/exercise-filters.test.ts` — add fragment test (create if absent).
- `infra/lambda/src/routes/exercises.ts` — exposure ordering on `GET /exercises`; mastery upsert on submit.
- `infra/lambda/src/routes/sessions.ts` — exposure ordering on `POST /sessions` + `sampleFreshPool`; mastery-aware ranking in Path B.
- `infra/lambda/src/lib/today-plan.ts` — SC in `V1_PLAN_SHAPE` + backfill; `PoolDraw.grammarPointKey`; drop `_radarSnapshot`.
- `infra/lambda/src/lib/today-plan.test.ts` — update shape tests.
- `packages/db/src/schema/progress.ts` — `userGrammarMastery` table.
- `packages/db/src/schema/index.ts` — export the new table.
- `packages/db/src/index.ts` — barrel-export mastery functions/types.
- `packages/db/package.json` + root `package.json` — `backfill:mastery` script.
- `packages/db/migrations/00XX_*.sql` — generated migration (committed).

---

## Task 1: Exposure ordering SQL fragment

**Files:**
- Modify: `infra/lambda/src/lib/exercise-filters.ts`
- Test: `infra/lambda/src/lib/exercise-filters.test.ts`

- [ ] **Step 1: Read the current file** to see existing exports (`approvedStatusFilter`, `APPROVED_STATUSES`) and match style.

Run: `sed -n '1,60p' infra/lambda/src/lib/exercise-filters.ts`

- [ ] **Step 2: Write the failing test**

Append to (or create) `infra/lambda/src/lib/exercise-filters.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { freshFirstOrderBy } from './exercise-filters';

describe('freshFirstOrderBy', () => {
  it('orders never-seen first (nulls first), then oldest-seen, then random, binding the userId', () => {
    const { sql, params } = new PgDialect().sqlToQuery(freshFirstOrderBy('user_abc'));
    const lower = sql.toLowerCase();
    expect(lower).toContain('max');
    expect(lower).toContain('nulls first');
    expect(lower).toContain('random()');
    expect(params).toContain('user_abc');
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @language-drill/infra-lambda exec vitest run src/lib/exercise-filters.test.ts`
Expected: FAIL — `freshFirstOrderBy is not a function` / not exported.

(If the workspace filter name differs, run from `infra/lambda`: `pnpm exec vitest run src/lib/exercise-filters.test.ts`.)

- [ ] **Step 4: Implement the fragment**

Add to `infra/lambda/src/lib/exercise-filters.ts` (add imports as needed):

```typescript
import { sql } from 'drizzle-orm';
import { exercises as exercisesTable, userExerciseHistory } from '@language-drill/db';

/**
 * ORDER BY fragment implementing per-user exposure control for a pool draw over
 * the `exercises` table. Never-attempted exercises sort first (NULLS FIRST);
 * among attempted ones the least-recently-seen come first; `random()` breaks
 * ties within a group. Correlated on `exercises.id`, so it only works on a query
 * whose FROM is the `exercises` table. Backed by
 * `user_exercise_history_exercise_id_idx (exercise_id, evaluated_at)`.
 */
export function freshFirstOrderBy(userId: string) {
  return sql`(
    select max(${userExerciseHistory.evaluatedAt})
    from ${userExerciseHistory}
    where ${userExerciseHistory.exerciseId} = ${exercisesTable.id}
      and ${userExerciseHistory.userId} = ${userId}
  ) asc nulls first, random()`;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm exec vitest run src/lib/exercise-filters.test.ts` (from `infra/lambda`)
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add infra/lambda/src/lib/exercise-filters.ts infra/lambda/src/lib/exercise-filters.test.ts
git commit -m "feat(serving): add freshFirstOrderBy exposure-control SQL fragment"
```

---

## Task 2: Apply exposure ordering to GET /exercises

**Files:**
- Modify: `infra/lambda/src/routes/exercises.ts:82-87` (the random draw)
- Test: `infra/lambda/src/routes/exercises.test.ts`

- [ ] **Step 1: Read the GET /exercises handler and its test** to learn the existing mock chain (`.orderBy().limit()`).

Run: `sed -n '60,102p' infra/lambda/src/routes/exercises.ts` and `sed -n '1,80p' infra/lambda/src/routes/exercises.test.ts`

- [ ] **Step 2: Update the handler**

In `infra/lambda/src/routes/exercises.ts`, add the import and resolve `userId` before the draw, then swap the order clause:

```typescript
import { freshFirstOrderBy } from '../lib/exercise-filters';
// ...
  const { language, difficulty, type } = parsed.data;
  const userId = c.get('userId');

  const conditions = [
    eq(exercisesTable.language, language),
    eq(exercisesTable.difficulty, difficulty),
    approvedStatusFilter(exercisesTable),
  ];
  if (type) {
    conditions.push(eq(exercisesTable.type, type));
  }

  const rows = await db
    .select()
    .from(exercisesTable)
    .where(and(...conditions))
    .orderBy(freshFirstOrderBy(userId))
    .limit(1);
```

- [ ] **Step 3: Verify the existing route test still passes**

Run: `pnpm exec vitest run src/routes/exercises.test.ts` (from `infra/lambda`)
Expected: PASS — the mock `.orderBy()` accepts any argument; behavior (returns the row / 404) is unchanged. If a test asserted the literal `random()` order expression, update it to accept the new fragment.

- [ ] **Step 4: Commit**

```bash
git add infra/lambda/src/routes/exercises.ts infra/lambda/src/routes/exercises.test.ts
git commit -m "feat(serving): exposure control on GET /exercises"
```

---

## Task 3: Apply exposure ordering to POST /sessions

**Files:**
- Modify: `infra/lambda/src/routes/sessions.ts:80-91`
- Test: `infra/lambda/src/routes/sessions.test.ts`

- [ ] **Step 1: Update the manifest draw**

In `POST /sessions` (`infra/lambda/src/routes/sessions.ts`), import `freshFirstOrderBy` and swap the order clause (the handler already has `userId` in scope):

```typescript
import { freshFirstOrderBy } from '../lib/exercise-filters';
// ...
  const rows = await db
    .select()
    .from(exercisesTable)
    .where(
      and(
        eq(exercisesTable.language, language),
        eq(exercisesTable.difficulty, difficulty),
        approvedStatusFilter(exercisesTable),
      ),
    )
    .orderBy(freshFirstOrderBy(userId))
    .limit(exerciseCount);
```

- [ ] **Step 2: Verify existing tests pass**

Run: `pnpm exec vitest run src/routes/sessions.test.ts` (from `infra/lambda`)
Expected: PASS — the mock `.where().orderBy().limit()` chain is unchanged.

- [ ] **Step 3: Commit**

```bash
git add infra/lambda/src/routes/sessions.ts
git commit -m "feat(serving): exposure control on POST /sessions manifest"
```

---

## Task 4: Apply exposure ordering to today-plan Path B (sampleFreshPool)

**Files:**
- Modify: `infra/lambda/src/routes/sessions.ts:381-420` (`sampleFreshPool`) and its call site (~line 341)
- Test: `infra/lambda/src/routes/sessions.test.ts`

- [ ] **Step 1: Read `sampleFreshPool` and the Path B test** to see the UNION-ALL SQL and how `mockExecute` is asserted.

Run: `sed -n '336,425p' infra/lambda/src/routes/sessions.ts` and `grep -n "mockExecute\|sampleFreshPool\|UNION\|random()" infra/lambda/src/routes/sessions.test.ts`

- [ ] **Step 2: Add `userId` param and exposure ordering, select grammar_point_key, raise over-fetch**

Replace the `sampleFreshPool` signature and per-type subquery. Note the new `grammar_point_key` column and the `freshFirstOrderBy` fragment interpolated into the raw SQL:

```typescript
import { freshFirstOrderBy } from '../lib/exercise-filters';

const OVERFETCH_PER_TYPE = 20; // give ranking real choice per type

async function sampleFreshPool(params: {
  language: string;
  difficulty: CefrLevel;
  userId: string;
}): Promise<PoolDraw[]> {
  const { language, difficulty, userId } = params;
  const planTypes = [...new Set(V1_PLAN_SHAPE.map((slot) => slot.type))];
  const typeQueries = planTypes.map(
    (type) => sql`
      (SELECT id, type, content_json->>'topicHint' AS topic_hint, difficulty, grammar_point_key
       FROM exercises
       WHERE language = ${language}
         AND difficulty = ${difficulty}
         AND type = ${type}
         AND review_status IN ('auto-approved', 'manual-approved')
       ORDER BY ${freshFirstOrderBy(userId)}
       LIMIT ${OVERFETCH_PER_TYPE})
    `,
  );
  const unionSql = sql.join(typeQueries, sql` UNION ALL `);

  const result = await db.execute(unionSql);
  const rows = (result as unknown as {
    rows: Array<{
      id: string;
      type: string;
      topic_hint: string | null;
      difficulty: string;
      grammar_point_key: string | null;
    }>;
  }).rows;

  const draws: PoolDraw[] = [];
  for (const row of rows) {
    if (!isExerciseType(row.type)) continue;
    if (!isCefrLevel(row.difficulty)) continue;
    draws.push({
      id: row.id,
      type: row.type,
      topicHint: row.topic_hint,
      difficulty: row.difficulty,
      grammarPointKey: row.grammar_point_key,
    });
  }
  return draws;
}
```

- [ ] **Step 3: Update the Path B call site** (around line 341):

```typescript
  const draws = await sampleFreshPool({ language, difficulty: proficiencyLevel, userId });
```

(`PoolDraw.grammarPointKey` is added in Task 8 — until then TypeScript will flag the new field. If implementing strictly in order, temporarily add `grammarPointKey: row.grammar_point_key` after Task 8's `PoolDraw` change; or do Task 8 step 1 (the `PoolDraw` field) first. Recommended: apply the `PoolDraw` field edit from Task 8 Step 4 now, then return here.)

- [ ] **Step 4: Update the Path B test**

In `sessions.test.ts`, if a test asserts the UNION-ALL SQL contains `ORDER BY random()`, change it to assert it contains `nulls first` (the new ordering) and `grammar_point_key`. Ensure `mockExecute` returns rows including a `grammar_point_key` field.

- [ ] **Step 5: Run the tests**

Run: `pnpm exec vitest run src/routes/sessions.test.ts` (from `infra/lambda`)
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add infra/lambda/src/routes/sessions.ts infra/lambda/src/routes/sessions.test.ts
git commit -m "feat(serving): exposure control + grammar key in today-plan pool sample"
```

---

## Task 5: Swap plan slot 2 to sentence construction

**Files:**
- Modify: `infra/lambda/src/lib/today-plan.ts:71-77` (shape) and `:146-150` (backfill)
- Test: `infra/lambda/src/lib/today-plan.test.ts`

- [ ] **Step 1: Write/adjust the failing test**

In `infra/lambda/src/lib/today-plan.test.ts`, add (and update any existing shape assertion):

```typescript
import { V1_PLAN_SHAPE } from './today-plan';

it('places sentence construction in the core slot 2', () => {
  expect(V1_PLAN_SHAPE.map((s) => s.type)).toEqual([
    ExerciseType.CLOZE,
    ExerciseType.SENTENCE_CONSTRUCTION,
    ExerciseType.TRANSLATION,
    ExerciseType.VOCAB_RECALL,
    ExerciseType.CLOZE,
  ]);
});

it('backfills an SC slot from other types when the SC pool is empty', () => {
  // Only cloze candidates available → slot 2 backfills, plan stays 5 items.
  const cloze = Array.from({ length: 5 }, (_, i) =>
    draw(ExerciseType.CLOZE, { id: `c${i}` }),
  );
  const { items, insufficient } = composeFreshPlan(cloze);
  expect(insufficient).toBe(false);
  expect(items).toHaveLength(5);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run src/lib/today-plan.test.ts` (from `infra/lambda`)
Expected: FAIL — slot 2 is still `CLOZE`.

- [ ] **Step 3: Update the shape and backfill priority**

In `infra/lambda/src/lib/today-plan.ts`:

```typescript
export const V1_PLAN_SHAPE: readonly PlanCompositionSlot[] = [
  { index: 1, prefix: 'warm-up', type: ExerciseType.CLOZE },
  { index: 2, prefix: 'core', type: ExerciseType.SENTENCE_CONSTRUCTION },
  { index: 3, prefix: 'production', type: ExerciseType.TRANSLATION },
  { index: 4, prefix: 'core', type: ExerciseType.VOCAB_RECALL },
  { index: 5, prefix: 'cool-down', type: ExerciseType.CLOZE },
] as const;
```

And append SC to the backfill priority so a missing slot can borrow it:

```typescript
const BACKFILL_TYPE_PRIORITY: readonly ExerciseType[] = [
  ExerciseType.CLOZE,
  ExerciseType.TRANSLATION,
  ExerciseType.VOCAB_RECALL,
  ExerciseType.SENTENCE_CONSTRUCTION,
];
```

Also update the `V1_PLAN_SHAPE` doc comment to read "warm-up cloze + core sentence construction + production translation + core vocab + cool-down cloze."

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run src/lib/today-plan.test.ts` (from `infra/lambda`)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/lib/today-plan.ts infra/lambda/src/lib/today-plan.test.ts
git commit -m "feat(plan): put sentence construction in daily plan slot 2"
```

---

## Task 6: Mastery update rule + history replay (pure)

**Files:**
- Create: `packages/db/src/mastery/update.ts`
- Test: `packages/db/src/mastery/update.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/db/src/mastery/update.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { CefrLevel } from '@language-drill/shared';
import { updateMastery, replayHistory, type MasteryState } from './update';

const d = (s: string) => new Date(s);

describe('updateMastery', () => {
  it('initializes from the first observation', () => {
    const next = updateMastery(null, { score: 0.8, difficulty: CefrLevel.B1, at: d('2026-01-01') });
    expect(next.masteryScore).toBeCloseTo(0.8, 5);
    expect(next.evidenceCount).toBe(1);
    expect(next.confidence).toBeCloseTo(1 - Math.exp(-1 / 5), 5);
    expect(next.lastPracticedAt).toEqual(d('2026-01-01'));
  });

  it('rewards a correct answer on a hard item more than on an easy item', () => {
    const prior: MasteryState = {
      masteryScore: 0.5, confidence: 0.5, evidenceCount: 4, lastPracticedAt: d('2026-01-01'),
    };
    const at = d('2026-01-01'); // same day → no decay
    const hard = updateMastery(prior, { score: 1, difficulty: CefrLevel.C2, at });
    const easy = updateMastery(prior, { score: 1, difficulty: CefrLevel.A1, at });
    expect(hard.masteryScore).toBeGreaterThan(easy.masteryScore);
  });

  it('punishes an error on an easy item more than on a hard item', () => {
    const prior: MasteryState = {
      masteryScore: 0.5, confidence: 0.5, evidenceCount: 4, lastPracticedAt: d('2026-01-01'),
    };
    const at = d('2026-01-01');
    const easy = updateMastery(prior, { score: 0, difficulty: CefrLevel.A1, at });
    const hard = updateMastery(prior, { score: 0, difficulty: CefrLevel.C2, at });
    expect(easy.masteryScore).toBeLessThan(hard.masteryScore);
  });

  it('lets new evidence dominate a stale prior (recency decay)', () => {
    const prior: MasteryState = {
      masteryScore: 0.9, confidence: 0.9, evidenceCount: 10, lastPracticedAt: d('2026-01-01'),
    };
    const recent = updateMastery(prior, { score: 0, difficulty: CefrLevel.B1, at: d('2026-01-01') });
    const stale = updateMastery(prior, { score: 0, difficulty: CefrLevel.B1, at: d('2026-03-02') }); // ~60d
    expect(stale.masteryScore).toBeLessThan(recent.masteryScore);
  });

  it('grows confidence with evidence and clamps mastery to [0,1]', () => {
    let s = updateMastery(null, { score: 1, difficulty: CefrLevel.C2, at: d('2026-01-01') });
    const c1 = s.confidence;
    s = updateMastery(s, { score: 1, difficulty: CefrLevel.C2, at: d('2026-01-02') });
    expect(s.confidence).toBeGreaterThan(c1);
    expect(s.masteryScore).toBeLessThanOrEqual(1);
    expect(s.masteryScore).toBeGreaterThanOrEqual(0);
  });
});

describe('replayHistory', () => {
  it('folds rows per grammar point in chronological order', () => {
    const map = replayHistory([
      { grammarPointKey: 'es-b1-x', score: 1, difficulty: CefrLevel.B1, evaluatedAt: d('2026-01-02') },
      { grammarPointKey: 'es-b1-x', score: 0, difficulty: CefrLevel.B1, evaluatedAt: d('2026-01-01') },
      { grammarPointKey: 'es-b2-y', score: 1, difficulty: CefrLevel.B2, evaluatedAt: d('2026-01-03') },
    ]);
    expect(map.get('es-b1-x')!.evidenceCount).toBe(2);
    expect(map.get('es-b2-y')!.evidenceCount).toBe(1);
  });

  it('is order-independent on input (sorts by evaluatedAt internally)', () => {
    const rows = [
      { grammarPointKey: 'k', score: 0.2, difficulty: CefrLevel.B1, evaluatedAt: d('2026-01-01') },
      { grammarPointKey: 'k', score: 0.9, difficulty: CefrLevel.B1, evaluatedAt: d('2026-01-05') },
    ];
    const a = replayHistory(rows);
    const b = replayHistory([...rows].reverse());
    expect(a.get('k')!.masteryScore).toBeCloseTo(b.get('k')!.masteryScore, 10);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @language-drill/db exec vitest run src/mastery/update.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

Create `packages/db/src/mastery/update.ts`:

```typescript
// Per-grammar-point mastery update rule. Pure; shared by the submit handler
// (via the @language-drill/db barrel) and the backfill CLI.
//
// Model: an asymmetric, difficulty-weighted, recency-decayed Bayesian average.
// See docs/superpowers/specs/2026-06-13-personalized-drill-plan-design.md §3.
import { CefrLevel } from '@language-drill/shared';

export type MasteryState = {
  masteryScore: number; // 0..1
  confidence: number; // 0..1
  evidenceCount: number;
  lastPracticedAt: Date;
};

export type MasteryObservation = {
  score: number; // 0..1
  difficulty: CefrLevel;
  at: Date;
};

export type HistoryRow = {
  grammarPointKey: string;
  score: number;
  difficulty: CefrLevel;
  evaluatedAt: Date;
};

// Mirrors progress-aggregation.ts DIFFICULTY_WEIGHTS — keep in sync.
const DIFFICULTY_WEIGHTS: Record<CefrLevel, number> = {
  [CefrLevel.A1]: 0.5,
  [CefrLevel.A2]: 0.7,
  [CefrLevel.B1]: 0.9,
  [CefrLevel.B2]: 1.1,
  [CefrLevel.C1]: 1.3,
  [CefrLevel.C2]: 1.5,
};
const DW_PIVOT = 2.0; // DW_MAX + DW_MIN (1.5 + 0.5); inverse weight = pivot - dw
const MS_PER_DAY = 86_400_000;
const HALFLIFE_DAYS = 30;
const PRIOR_BASE = 1.0;
const K_EVIDENCE = 5; // confidence = 1 - exp(-n / K_EVIDENCE)

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const confidenceFor = (n: number) => 1 - Math.exp(-n / K_EVIDENCE);

export function updateMastery(
  prev: MasteryState | null,
  obs: MasteryObservation,
): MasteryState {
  const dw = DIFFICULTY_WEIGHTS[obs.difficulty];

  if (prev === null) {
    return {
      masteryScore: clamp01(obs.score),
      confidence: confidenceFor(1),
      evidenceCount: 1,
      lastPracticedAt: obs.at,
    };
  }

  const days = Math.max(
    0,
    (obs.at.getTime() - prev.lastPracticedAt.getTime()) / MS_PER_DAY,
  );
  const decay = Math.exp(-days / HALFLIFE_DAYS);
  const priorW = PRIOR_BASE * prev.evidenceCount * decay;

  // Asymmetric observation weight: gains scale with difficulty (reward hard
  // correct), losses scale with INVERSE difficulty (punish easy errors).
  const obsW = obs.score >= prev.masteryScore ? dw : DW_PIVOT - dw;

  const masteryScore = clamp01(
    (priorW * prev.masteryScore + obsW * obs.score) / (priorW + obsW),
  );
  const evidenceCount = prev.evidenceCount + 1;

  return {
    masteryScore,
    confidence: confidenceFor(evidenceCount),
    evidenceCount,
    lastPracticedAt: obs.at,
  };
}

/** Folds raw history rows into a final mastery state per grammar point. */
export function replayHistory(
  rows: readonly HistoryRow[],
): Map<string, MasteryState> {
  const sorted = [...rows].sort(
    (a, b) => a.evaluatedAt.getTime() - b.evaluatedAt.getTime(),
  );
  const out = new Map<string, MasteryState>();
  for (const r of sorted) {
    const prev = out.get(r.grammarPointKey) ?? null;
    out.set(
      r.grammarPointKey,
      updateMastery(prev, { score: r.score, difficulty: r.difficulty, at: r.evaluatedAt }),
    );
  }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @language-drill/db exec vitest run src/mastery/update.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/mastery/update.ts packages/db/src/mastery/update.test.ts
git commit -m "feat(mastery): asymmetric Bayesian mastery update + history replay"
```

---

## Task 7: Schema table + barrel exports + migration

**Files:**
- Modify: `packages/db/src/schema/progress.ts`
- Modify: `packages/db/src/schema/index.ts`
- Modify: `packages/db/src/index.ts`
- Create: `packages/db/migrations/00XX_*.sql` (generated)

- [ ] **Step 1: Add the table**

In `packages/db/src/schema/progress.ts`, after `userExerciseHistory`, add:

```typescript
export const userGrammarMastery = pgTable(
  'user_grammar_mastery',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    language: text('language').notNull(),
    grammarPointKey: text('grammar_point_key').notNull(),
    masteryScore: real('mastery_score').notNull(), // 0.0–1.0
    confidence: real('confidence').notNull(), // 0.0–1.0
    evidenceCount: integer('evidence_count').notNull(),
    lastPracticedAt: timestamp('last_practiced_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.grammarPointKey] }),
    // Selection reads all of a user's points for one language.
    userLanguageIdx: index('user_grammar_mastery_user_language_idx').on(
      table.userId,
      table.language,
    ),
  }),
);
```

Add `primaryKey` to the `drizzle-orm/pg-core` import at the top of the file:

```typescript
import { index, integer, jsonb, pgTable, primaryKey, real, text, timestamp, uuid } from 'drizzle-orm/pg-core';
```

- [ ] **Step 2: Export from the schema barrel**

In `packages/db/src/schema/index.ts`, extend the progress export:

```typescript
export { userExerciseHistory, spacedRepetitionCards, userGrammarMastery } from './progress';
```

- [ ] **Step 3: Export the mastery functions from the package barrel**

In `packages/db/src/index.ts`, add near the other Phase exports:

```typescript
// Per-grammar-point mastery — the update rule (used by the submit handler) and
// the history-replay fold (used by the backfill CLI).
export { updateMastery, replayHistory } from './mastery/update';
export type {
  MasteryState,
  MasteryObservation,
  HistoryRow,
} from './mastery/update';
```

- [ ] **Step 4: Generate the migration**

Run: `pnpm --filter @language-drill/db db:generate`
Expected: a new file `packages/db/migrations/00XX_<random_name>.sql` containing `CREATE TABLE "user_grammar_mastery"` with the composite PK and the index. Open it and confirm.

Run: `cat packages/db/migrations/$(ls packages/db/migrations | grep -E '^00[0-9][0-9]_' | tail -1)`

- [ ] **Step 5: Build the db package and typecheck**

Run: `pnpm --filter @language-drill/db build && pnpm --filter @language-drill/db exec tsc --noEmit`
Expected: no errors. (The build refreshes `dist/` so the Lambda can import the new exports.)

- [ ] **Step 6: Apply the migration to the local (dev) database**

Run: `pnpm db:migrate`
Expected: migration applies cleanly. (Local `.env` points at the Neon **dev** branch — that is correct for development.)

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/schema/progress.ts packages/db/src/schema/index.ts packages/db/src/index.ts packages/db/migrations/
git commit -m "feat(mastery): user_grammar_mastery table + barrel exports + migration"
```

---

## Task 8: Add grammarPointKey to PoolDraw

**Files:**
- Modify: `infra/lambda/src/lib/today-plan.ts:128-133`
- Test: `infra/lambda/src/lib/today-plan.test.ts`

- [ ] **Step 1: Add the field**

In `infra/lambda/src/lib/today-plan.ts`, extend `PoolDraw`:

```typescript
export type PoolDraw = {
  id: string;
  type: ExerciseType;
  topicHint: string | null;
  difficulty: CefrLevel;
  /** Curriculum grammar point this exercise targets; null for unmapped items. */
  grammarPointKey: string | null;
};
```

- [ ] **Step 2: Update the test helper**

In `today-plan.test.ts`, the `draw()` helper builds a `PoolDraw`. Add a default `grammarPointKey: null` so existing tests still typecheck:

```typescript
function draw(type: ExerciseType, overrides: Partial<PoolDraw> = {}): PoolDraw {
  return {
    id: 'x',
    type,
    topicHint: null,
    difficulty: CefrLevel.B1,
    grammarPointKey: null,
    ...overrides,
  };
}
```

(Adapt to the helper's actual current body — only add the `grammarPointKey: null` default.)

- [ ] **Step 3: Run the lib tests**

Run: `pnpm exec vitest run src/lib/today-plan.test.ts` (from `infra/lambda`)
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add infra/lambda/src/lib/today-plan.ts infra/lambda/src/lib/today-plan.test.ts
git commit -m "feat(plan): carry grammarPointKey on PoolDraw"
```

---

## Task 9: Mastery upsert on submit

**Files:**
- Modify: `infra/lambda/src/routes/exercises.ts` (submit handler, after the history insert ~line 288)
- Test: `infra/lambda/src/routes/exercises.test.ts`

- [ ] **Step 1: Read the submit handler and its test mocks** to see the db mock (`mockInsert`, `mockValues`, `mockSelect`, etc.) used for `POST /exercises/:id/submit`.

Run: `sed -n '278,307p' infra/lambda/src/routes/exercises.ts` and `grep -n "mockInsert\|mockValues\|mockSelect\|onConflict\|submit" infra/lambda/src/routes/exercises.test.ts`

- [ ] **Step 2: Add the best-effort upsert**

In `infra/lambda/src/routes/exercises.ts`, add imports:

```typescript
import { userGrammarMastery, updateMastery } from '@language-drill/db';
```

After the `userExerciseHistory` insert and the `usageEvents` insert (inside the success path, before `return c.json(result)`), add:

```typescript
    // Best-effort per-grammar-point mastery update. A failure here must never
    // fail the submission — the authoritative signal is the history row above.
    if (exercise.grammarPointKey) {
      try {
        const at = new Date();
        const existing = await db
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
              eq(userGrammarMastery.grammarPointKey, exercise.grammarPointKey),
            ),
          )
          .limit(1);

        const next = updateMastery(existing[0] ?? null, {
          score: result.score,
          difficulty: exercise.difficulty as CefrLevel,
          at,
        });

        await db
          .insert(userGrammarMastery)
          .values({
            userId,
            language: exercise.language as Language,
            grammarPointKey: exercise.grammarPointKey,
            masteryScore: next.masteryScore,
            confidence: next.confidence,
            evidenceCount: next.evidenceCount,
            lastPracticedAt: next.lastPracticedAt,
            updatedAt: at,
          })
          .onConflictDoUpdate({
            target: [userGrammarMastery.userId, userGrammarMastery.grammarPointKey],
            set: {
              masteryScore: next.masteryScore,
              confidence: next.confidence,
              evidenceCount: next.evidenceCount,
              lastPracticedAt: next.lastPracticedAt,
              updatedAt: at,
              language: exercise.language as Language,
            },
          });
      } catch (masteryErr) {
        console.error('[submit] mastery update failed (non-fatal):', masteryErr);
      }
    }
```

- [ ] **Step 3: Update the submit test mock**

In `exercises.test.ts`, the submit success test must tolerate the extra `select` (mastery read) and `insert(...).onConflictDoUpdate(...)`. Extend the mocks:
- Ensure the mocked `db.select().from().where().limit()` used here can return `[]` for the mastery read (first-observation path).
- Ensure the mocked `db.insert().values()` returns an object exposing `onConflictDoUpdate: vi.fn(() => Promise.resolve())` (mirror the existing `onConflictDoNothing` shape).

Add an assertion that a 200 with the eval result is still returned when the exercise has a `grammarPointKey`, and that `db.insert` was called for `user_grammar_mastery`.

- [ ] **Step 4: Build db (for the new exports) and run the test**

Run: `pnpm --filter @language-drill/db build && pnpm exec vitest run src/routes/exercises.test.ts` (the second command from `infra/lambda`)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/routes/exercises.ts infra/lambda/src/routes/exercises.test.ts
git commit -m "feat(mastery): update user_grammar_mastery on answer submit"
```

---

## Task 10: rankPlanCandidates (pure selection)

**Files:**
- Create: `infra/lambda/src/lib/mastery/rank.ts`
- Test: `infra/lambda/src/lib/mastery/rank.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `infra/lambda/src/lib/mastery/rank.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { CefrLevel, ExerciseType } from '@language-drill/shared';
import { rankPlanCandidates, type RankContext } from './rank';
import type { PoolDraw } from '../today-plan';

const draw = (id: string, grammarPointKey: string | null): PoolDraw => ({
  id,
  type: ExerciseType.CLOZE,
  topicHint: null,
  difficulty: CefrLevel.B1,
  grammarPointKey,
});

const ctx = (over: Partial<RankContext> = {}): RankContext => ({
  masteryByPoint: new Map(),
  prereqsOf: () => [],
  now: new Date('2026-06-13'),
  ...over,
});

describe('rankPlanCandidates', () => {
  it('ranks missing-evidence points above well-mastered ones', () => {
    const masteryByPoint = new Map([
      ['mastered', { masteryScore: 0.95, lastPracticedAt: new Date('2026-06-12') }],
    ]);
    const out = rankPlanCandidates(
      [draw('a', 'mastered'), draw('b', 'fresh')],
      ctx({ masteryByPoint }),
    );
    expect(out[0].id).toBe('b');
  });

  it('soft-deprioritizes (never drops) a point whose prerequisite lacks evidence', () => {
    const masteryByPoint = new Map([
      ['p-blocked', { masteryScore: 0.5, lastPracticedAt: new Date('2026-06-12') }],
      ['p-open', { masteryScore: 0.5, lastPracticedAt: new Date('2026-06-12') }],
    ]);
    const prereqsOf = (k: string) => (k === 'p-blocked' ? ['missing-prereq'] : []);
    const out = rankPlanCandidates(
      [draw('blocked', 'p-blocked'), draw('open', 'p-open')],
      ctx({ masteryByPoint, prereqsOf }),
    );
    expect(out.map((c) => c.id)).toEqual(['open', 'blocked']); // open first
    expect(out).toHaveLength(2); // blocked still present — soft, not excluded
  });

  it('cold start: surfaces a no-prereq point above a prereq-gated one and keeps all', () => {
    const prereqsOf = (k: string) => (k === 'advanced' ? ['foundation'] : []);
    const out = rankPlanCandidates(
      [draw('adv', 'advanced'), draw('found', 'foundation')],
      ctx({ prereqsOf }),
    );
    expect(out[0].id).toBe('found');
    expect(out).toHaveLength(2);
  });

  it('treats null / unknown grammar keys neutrally (not bottom-pinned)', () => {
    const masteryByPoint = new Map([
      ['mastered', { masteryScore: 0.95, lastPracticedAt: new Date('2026-06-12') }],
    ]);
    const out = rankPlanCandidates(
      [draw('m', 'mastered'), draw('n', null)],
      ctx({ masteryByPoint }),
    );
    expect(out[0].id).toBe('n'); // neutral (0.5) beats mastered low-gap
  });

  it('boosts the 0.3–0.7 growth zone', () => {
    const masteryByPoint = new Map([
      ['growth', { masteryScore: 0.5, lastPracticedAt: new Date('2026-06-13') }],
      ['near', { masteryScore: 0.72, lastPracticedAt: new Date('2026-06-13') }],
    ]);
    const out = rankPlanCandidates(
      [draw('near', 'near'), draw('growth', 'growth')],
      ctx({ masteryByPoint }),
    );
    expect(out[0].id).toBe('growth');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run src/lib/mastery/rank.test.ts` (from `infra/lambda`)
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `infra/lambda/src/lib/mastery/rank.ts`:

```typescript
// Mastery-aware ordering of today-plan pool candidates. Pure: prerequisite
// lookup is injected so this needs no curriculum/DB import. The route passes a
// `prereqsOf` backed by getGrammarPoint. See spec §4.
import type { PoolDraw } from '../today-plan';

export type PointMastery = {
  masteryScore: number;
  lastPracticedAt: Date;
};

export type RankContext = {
  masteryByPoint: ReadonlyMap<string, PointMastery>;
  /** Prerequisite keys for a grammar point (empty if none/unknown). */
  prereqsOf: (grammarPointKey: string) => readonly string[];
  now: Date;
};

const MS_PER_DAY = 86_400_000;
const HALFLIFE_DAYS = 30;
const NEUTRAL_PRIORITY = 0.5; // unmapped/unknown grammar key
const GROWTH_LO = 0.3;
const GROWTH_HI = 0.7;
const GROWTH_BOOST = 0.15;
const PREREQ_THRESHOLD = 0.3; // mastery at/above this counts as positive evidence
const PREREQ_PENALTY = 0.5; // multiplicative, per unmet prerequisite

function hasPositiveEvidence(
  key: string,
  masteryByPoint: ReadonlyMap<string, PointMastery>,
): boolean {
  const m = masteryByPoint.get(key);
  return m != null && m.masteryScore >= PREREQ_THRESHOLD;
}

function priorityOf(c: PoolDraw, ctx: RankContext): number {
  if (!c.grammarPointKey) return NEUTRAL_PRIORITY;

  const m = ctx.masteryByPoint.get(c.grammarPointKey);
  let gap: number;
  if (m == null) {
    gap = 1.0; // missing evidence → maximal gap
  } else {
    const days = Math.max(
      0,
      (ctx.now.getTime() - m.lastPracticedAt.getTime()) / MS_PER_DAY,
    );
    const idle = Math.exp(-days / HALFLIFE_DAYS);
    const effMastery = m.masteryScore * idle; // stale evidence → larger effective gap
    gap = 1 - effMastery;
    if (effMastery >= GROWTH_LO && effMastery <= GROWTH_HI) gap += GROWTH_BOOST;
  }

  let penalty = 1.0;
  for (const pk of ctx.prereqsOf(c.grammarPointKey)) {
    if (!hasPositiveEvidence(pk, ctx.masteryByPoint)) penalty *= PREREQ_PENALTY;
  }

  return gap * penalty;
}

/**
 * Returns the candidates ordered by descending selection priority. Input order
 * (the exposure-controlled pool order) is the stable tiebreak, so freshness is
 * preserved among equal-priority points. Soft by construction: prerequisite
 * gaps only *lower* priority, never remove a candidate — so the plan is never
 * starved, including at cold start.
 */
export function rankPlanCandidates(
  candidates: readonly PoolDraw[],
  ctx: RankContext,
): PoolDraw[] {
  return candidates
    .map((c, i) => ({ c, i, p: priorityOf(c, ctx) }))
    .sort((a, b) => (b.p - a.p) || (a.i - b.i))
    .map((x) => x.c);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run src/lib/mastery/rank.test.ts` (from `infra/lambda`)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/lib/mastery/rank.ts infra/lambda/src/lib/mastery/rank.test.ts
git commit -m "feat(mastery): rankPlanCandidates selection priority"
```

---

## Task 11: Wire mastery-aware ranking into today-plan Path B

**Files:**
- Modify: `infra/lambda/src/routes/sessions.ts` (Path B, ~line 336-342) and `composeFreshPlan` call
- Modify: `infra/lambda/src/lib/today-plan.ts` (drop `_radarSnapshot`)
- Test: `infra/lambda/src/routes/sessions.test.ts`

- [ ] **Step 1: Drop the dead adaptive param**

In `infra/lambda/src/lib/today-plan.ts`, change `composeFreshPlan(candidates, _radarSnapshot?)` to `composeFreshPlan(candidates)` and remove the `_radarSnapshot` mention from its doc comment (replace with: "Candidates are consumed in the order given — the caller pre-ranks them (exposure + mastery) so slot assignment picks the highest-priority item per type.").

- [ ] **Step 2: Fetch mastery and rank in Path B**

In `infra/lambda/src/routes/sessions.ts`, add imports:

```typescript
import { getGrammarPoint, userGrammarMastery } from '@language-drill/db';
import { rankPlanCandidates, type PointMastery } from '../lib/mastery/rank';
```

Replace the Path B body (the `sampleFreshPool` + `composeFreshPlan(draws)` lines) with a parallel fetch of the pool sample and the user's mastery, then rank:

```typescript
  // Path B — compose a fresh 5-item plan from the pool.
  const [draws, masteryRows] = await Promise.all([
    sampleFreshPool({ language, difficulty: proficiencyLevel, userId }),
    db
      .select({
        grammarPointKey: userGrammarMastery.grammarPointKey,
        masteryScore: userGrammarMastery.masteryScore,
        lastPracticedAt: userGrammarMastery.lastPracticedAt,
      })
      .from(userGrammarMastery)
      .where(
        and(
          eq(userGrammarMastery.userId, userId),
          eq(userGrammarMastery.language, language),
        ),
      ),
  ]);

  const masteryByPoint = new Map<string, PointMastery>(
    masteryRows.map((r) => [
      r.grammarPointKey,
      { masteryScore: r.masteryScore, lastPracticedAt: new Date(r.lastPracticedAt) },
    ]),
  );

  const ranked = rankPlanCandidates(draws, {
    masteryByPoint,
    prereqsOf: (key) => getGrammarPoint(key)?.prerequisiteKeys ?? [],
    now: new Date(),
  });

  const { items, insufficient } = composeFreshPlan(ranked);
```

Confirm `and`, `eq` are already imported in `sessions.ts` (they are — used elsewhere).

- [ ] **Step 3: Update the Path B test**

In `sessions.test.ts`, the Path B test now issues two queries (the `db.execute` UNION-ALL **and** a `db.select(...)` for mastery) inside `Promise.all`. Ensure the mocked `db.select().from().where()` resolves to `[]` (no mastery rows) for this path, so ranking is a no-op pass-through and the existing plan-shape assertions still hold. Add a focused test: given mastery rows that mark one grammar point as mastered and another as fresh (both cloze), the fresh one appears in the plan ahead of the mastered one.

- [ ] **Step 4: Build db, then run the route + lib tests**

Run: `pnpm --filter @language-drill/db build` (no db src change here, but keeps dist current) then `pnpm exec vitest run src/routes/sessions.test.ts src/lib/today-plan.test.ts` (from `infra/lambda`)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/routes/sessions.ts infra/lambda/src/lib/today-plan.ts infra/lambda/src/routes/sessions.test.ts
git commit -m "feat(plan): mastery-aware grammar-point selection in today-plan"
```

---

## Task 12: Backfill CLI

**Files:**
- Create: `packages/db/scripts/backfill-mastery.ts`
- Modify: `packages/db/package.json` (script) and root `package.json` (script)

- [ ] **Step 1: Read an existing script for the connection/CLI pattern**

Run: `sed -n '1,60p' packages/db/scripts/revalidate-cloze-pool.ts`
Note how it obtains the Drizzle client, parses `--apply`/`--dry-run`/filters, and logs.

- [ ] **Step 2: Write the script**

Create `packages/db/scripts/backfill-mastery.ts`. The core fold is the already-tested `replayHistory`; this script only does IO:

```typescript
// One-off: rebuild user_grammar_mastery from existing user_exercise_history by
// replaying each user's attempts (per grammar point) through the same update
// rule the live submit path uses. Idempotent — recomputes each row from
// scratch. Dry-run by default; pass --apply to write.
//
//   pnpm backfill:mastery [--apply] [--user=<id>] [--language=ES|DE|TR|EN]
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { CefrLevel } from '@language-drill/shared';
import { db } from '../src/client';
import { exercises, userExerciseHistory, userGrammarMastery } from '../src/schema';
import { replayHistory, type HistoryRow } from '../src/mastery/update';

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : undefined;
}
const apply = process.argv.includes('--apply');
const userFilter = arg('user');
const languageFilter = arg('language');

const isCefr = (v: string | null): v is CefrLevel =>
  v != null && (Object.values(CefrLevel) as string[]).includes(v);

async function main() {
  const where = [
    isNotNull(exercises.grammarPointKey),
    isNotNull(userExerciseHistory.score),
    isNotNull(userExerciseHistory.evaluatedAt),
    isNotNull(userExerciseHistory.userId),
  ];
  if (userFilter) where.push(eq(userExerciseHistory.userId, userFilter));
  if (languageFilter) where.push(eq(exercises.language, languageFilter));

  const rows = await db
    .select({
      userId: userExerciseHistory.userId,
      language: exercises.language,
      grammarPointKey: exercises.grammarPointKey,
      score: userExerciseHistory.score,
      difficulty: exercises.difficulty,
      evaluatedAt: userExerciseHistory.evaluatedAt,
    })
    .from(userExerciseHistory)
    .innerJoin(exercises, eq(userExerciseHistory.exerciseId, exercises.id))
    .where(and(...where))
    .orderBy(asc(userExerciseHistory.evaluatedAt));

  // Group rows per (user, language); replayHistory folds per grammar point.
  type Key = string; // `${userId} ${language}`
  const byUserLang = new Map<Key, HistoryRow[]>();
  const langOf = new Map<Key, string>();
  for (const r of rows) {
    if (!r.userId || !r.language || !r.grammarPointKey) continue;
    if (!isCefr(r.difficulty)) continue;
    const k = `${r.userId} ${r.language}`;
    langOf.set(k, r.language);
    const list = byUserLang.get(k) ?? [];
    list.push({
      grammarPointKey: r.grammarPointKey,
      score: r.score as number,
      difficulty: r.difficulty,
      evaluatedAt: new Date(r.evaluatedAt as Date),
    });
    byUserLang.set(k, list);
  }

  let upserts = 0;
  for (const [k, history] of byUserLang) {
    const [userId] = k.split(' ');
    const language = langOf.get(k)!;
    const finalStates = replayHistory(history);
    for (const [grammarPointKey, s] of finalStates) {
      upserts += 1;
      if (!apply) continue;
      await db
        .insert(userGrammarMastery)
        .values({
          userId,
          language,
          grammarPointKey,
          masteryScore: s.masteryScore,
          confidence: s.confidence,
          evidenceCount: s.evidenceCount,
          lastPracticedAt: s.lastPracticedAt,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [userGrammarMastery.userId, userGrammarMastery.grammarPointKey],
          set: {
            language,
            masteryScore: s.masteryScore,
            confidence: s.confidence,
            evidenceCount: s.evidenceCount,
            lastPracticedAt: s.lastPracticedAt,
            updatedAt: new Date(),
          },
        });
    }
  }

  console.log(
    `${apply ? 'Wrote' : '[dry-run] Would write'} ${upserts} mastery rows ` +
      `across ${byUserLang.size} (user,language) groups from ${rows.length} history rows.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

(Confirm `db` is exported from `../src/client`; if the script pattern in `revalidate-cloze-pool.ts` constructs the client differently, mirror that exactly.)

- [ ] **Step 3: Add the package script**

In `packages/db/package.json` scripts:

```json
"backfill:mastery": "npx tsx scripts/backfill-mastery.ts",
```

In root `package.json` scripts (mirrors the `revalidate:cloze` wiring so `.env` is loaded):

```json
"backfill:mastery": "dotenv -e .env -- pnpm --filter @language-drill/db backfill:mastery",
```

- [ ] **Step 4: Typecheck and dry-run**

Run: `pnpm --filter @language-drill/db exec tsc --noEmit`
Expected: no errors.

Run: `pnpm backfill:mastery`
Expected: `[dry-run] Would write N mastery rows ...` and no DB writes. (Requires a working `.env` DATABASE_URL — the dev branch.)

- [ ] **Step 5: Apply against the dev DB and spot-check**

Run: `pnpm backfill:mastery --apply`
Then verify a row exists (Drizzle Studio `pnpm db:studio`, or a quick count). Expected: `user_grammar_mastery` populated for the dev user's history.

- [ ] **Step 6: Commit**

```bash
git add packages/db/scripts/backfill-mastery.ts packages/db/package.json package.json
git commit -m "feat(mastery): backfill CLI replaying history into user_grammar_mastery"
```

---

## Task 13: Full verification

- [ ] **Step 1: Build everything**

Run: `pnpm build`
Expected: all packages build (refreshes `db/dist` consumed by the Lambda).

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: zero errors.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: zero errors.

- [ ] **Step 4: Test (serialized to avoid the known infra flake)**

Run: `pnpm turbo run test --concurrency=1`
Expected: all suites pass. If `infra` flakes under load, re-run; it must be green serialized.

- [ ] **Step 5: Update the assessment doc's scorecard (optional but tidy)**

In `docs/generation-pipeline-pedagogical-assessment.md`, the "Exposure control" and "Adaptive selection" rows can move from **Missing** to **Implemented (v1)** with a one-line note pointing at this work. Commit separately if done.

- [ ] **Step 6: Final commit (if any uncommitted doc/cleanup)**

```bash
git add -A
git commit -m "chore: personalized drill plan — verification + doc update"
```

---

## Self-review notes (for the implementer)

- **Spec coverage:** §1 exposure → Tasks 1–4; §2 SC slot → Task 5; §3 table+rule+wiring+backfill → Tasks 6,7,9,12; §4 selection → Tasks 8,10,11. All sections mapped.
- **Type consistency:** `MasteryState`/`MasteryObservation`/`HistoryRow` (Task 6) are reused verbatim in Tasks 7/9/12; `PointMastery`/`RankContext` (Task 10) reused in Task 11; `PoolDraw.grammarPointKey` (Task 8) is produced in Task 4 and consumed in Tasks 10/11.
- **Ordering caveat:** Task 4 returns `grammarPointKey` on a `PoolDraw` that doesn't gain the field until Task 8 — do Task 8's `PoolDraw` edit first if you hit a type error (noted inline in Task 4 Step 3).
- **Best-effort writes:** the submit mastery upsert (Task 9) is wrapped in try/catch by design — never fail a submission for a mastery write.
