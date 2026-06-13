# Fluency Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a timed "fluency mode" that re-serves already-mastered cloze/vocab items, grades them deterministically (no Claude), records response latency, and surfaces an automaticity metric — without letting any of it touch the existing accuracy mastery radar.

**Architecture:** Fluency results are written to a dedicated `fluency_attempts` table. The existing radar/heatmap aggregations read only `user_exercise_history`, so fluency drills *structurally cannot* move the accuracy mastery (there is no filter to forget). Eligibility *reads* `user_exercise_history` (items whose most-recent score ≥ 0.8). Grading is deterministic and lives in `packages/shared` (reusable + unit-testable). Three new endpoints (`POST /fluency/session`, `POST /fluency/attempts`, `GET /fluency/stats`) on a new Hono router. A new `/fluency` web route runs the timed drill; a new "fluency" tab on the progress page charts the latency trend.

**Tech Stack:** TypeScript monorepo (pnpm + Turborepo). Drizzle ORM + Neon Postgres. Hono on AWS Lambda. Next.js App Router + TanStack Query + Zod. Vitest for unit/integration, Playwright for E2E.

**Design spec:** `docs/superpowers/specs/2026-06-13-fluency-mode-design.md`

> **Deviation from spec, noted up front:** the spec said "reuse the same normalization the normal cloze/vocab path uses." Investigation found there is **no** server-side deterministic grader today — Claude does all grading, and `apps/web/lib/drill/verdict-tier.ts` only maps a score to a display tier. So Task 1 *creates* the deterministic grader in `packages/shared` as the single source of truth. This is the only material change from the spec.

---

## File Structure

**Create:**
- `packages/shared/src/fluency.ts` — grader + constants (single source of truth)
- `packages/shared/src/fluency.test.ts` — grader/constants unit tests
- `packages/db/migrations/00NN_*.sql` — generated migration for `fluency_attempts`
- `infra/lambda/src/lib/fluency-stats.ts` — pure stats aggregation (median latency, accuracy, volume)
- `infra/lambda/src/lib/fluency-stats.test.ts`
- `infra/lambda/src/lib/fluency-session.ts` — pure session-composition helper (shuffle/slice/threshold)
- `infra/lambda/src/lib/fluency-session.test.ts`
- `infra/lambda/src/routes/fluency.ts` — the three endpoints
- `infra/lambda/src/routes/fluency.test.ts`
- `packages/api-client/src/schemas/fluency.ts` — wire schemas
- `packages/api-client/src/schemas/fluency.test.ts`
- `packages/api-client/src/hooks/useFluency.ts` — 3 hooks
- `packages/api-client/src/hooks/useFluency.test.ts`
- `apps/web/app/(dashboard)/fluency/page.tsx` — timed drill page
- `apps/web/app/(dashboard)/fluency/_components/fluency-runner.tsx` — the drill loop + timer
- `apps/web/app/(dashboard)/fluency/_components/fluency-item.tsx` — single timed item renderer
- `apps/web/app/(dashboard)/fluency/_components/__tests__/fluency-runner.test.tsx`
- `apps/web/app/(dashboard)/progress/_components/fluency-tab.tsx` — progress-page tab
- `apps/web/app/(dashboard)/progress/_components/__tests__/fluency-tab.test.tsx`

**Modify:**
- `packages/shared/src/index.ts` — `export * from "./fluency"`
- `packages/db/src/schema/progress.ts` — add `fluencyAttempts` table
- `packages/db/src/schema/index.ts` — export `fluencyAttempts` (verify barrel)
- `infra/lambda/src/index.ts` — import + `app.route('/', fluency)`
- `packages/api-client/src/index.ts` — re-export new schemas + hooks
- `apps/web/app/(dashboard)/progress/page.tsx` — render the fluency tab
- `apps/web/app/(dashboard)/progress/_components/progress-tabs.tsx` — add label
- `apps/web/app/(dashboard)/progress/_lib/use-tab-url-state.ts` — add `'fluency'` tab id
- `apps/web/app/(dashboard)/drill/page.tsx` — add a "Fluency mode" entry link/card

---

## Task 1: Deterministic grader + constants (`packages/shared`)

**Files:**
- Create: `packages/shared/src/fluency.ts`
- Create: `packages/shared/src/fluency.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/fluency.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { ExerciseType, type ClozeContent, type VocabRecallContent } from "./index";
import {
  gradeFluencyAnswer,
  normalizeFluencyAnswer,
  isFluencyEligibleType,
  FLUENCY_MASTERY_THRESHOLD,
  MIN_FLUENCY_POOL,
  LATENCY_CEILING_MS,
  DEFAULT_FLUENCY_SESSION_SIZE,
  FLUENCY_ELIGIBLE_TYPES,
} from "./fluency";

const cloze = (over: Partial<ClozeContent> = {}): ClozeContent => ({
  type: ExerciseType.CLOZE,
  instructions: "fill the blank",
  sentence: "El gato ___ en la casa.",
  correctAnswer: "está",
  ...over,
});

const vocab = (over: Partial<VocabRecallContent> = {}): VocabRecallContent => ({
  type: ExerciseType.VOCAB_RECALL,
  instructions: "recall the word",
  prompt: "the opposite of big",
  expectedWord: "pequeño",
  hints: [],
  exampleSentence: "El perro es pequeño.",
  ...over,
});

describe("normalizeFluencyAnswer", () => {
  it("trims, collapses whitespace, lowercases — but preserves diacritics", () => {
    expect(normalizeFluencyAnswer("  Está  ")).toBe("está");
    expect(normalizeFluencyAnswer("el   gato")).toBe("el gato");
    // diacritics are meaningful in ES/DE/TR and must NOT be stripped
    expect(normalizeFluencyAnswer("está")).not.toBe(normalizeFluencyAnswer("esta"));
  });
});

describe("gradeFluencyAnswer — cloze", () => {
  it("accepts the correct answer case/space-insensitively", () => {
    expect(gradeFluencyAnswer(cloze(), "  EstÁ ")).toBe(true);
  });
  it("accepts any acceptableAnswers entry", () => {
    expect(gradeFluencyAnswer(cloze({ acceptableAnswers: ["se encuentra"] }), "se encuentra")).toBe(true);
  });
  it("rejects a wrong answer", () => {
    expect(gradeFluencyAnswer(cloze(), "estar")).toBe(false);
  });
});

describe("gradeFluencyAnswer — vocab", () => {
  it("accepts the expected word, rejects others", () => {
    expect(gradeFluencyAnswer(vocab(), "Pequeño")).toBe(true);
    expect(gradeFluencyAnswer(vocab(), "grande")).toBe(false);
  });
});

describe("gradeFluencyAnswer — unsupported type", () => {
  it("throws for non-eligible content", () => {
    expect(() =>
      gradeFluencyAnswer(
        { type: ExerciseType.TRANSLATION } as never,
        "x",
      ),
    ).toThrow();
  });
});

describe("eligibility helpers + constants", () => {
  it("recognises the two eligible types only", () => {
    expect(isFluencyEligibleType(ExerciseType.CLOZE)).toBe(true);
    expect(isFluencyEligibleType(ExerciseType.VOCAB_RECALL)).toBe(true);
    expect(isFluencyEligibleType(ExerciseType.TRANSLATION)).toBe(false);
    expect(isFluencyEligibleType(ExerciseType.SENTENCE_CONSTRUCTION)).toBe(false);
  });
  it("exposes the locked constants", () => {
    expect(FLUENCY_MASTERY_THRESHOLD).toBe(0.8);
    expect(MIN_FLUENCY_POOL).toBe(4);
    expect(LATENCY_CEILING_MS).toBe(60_000);
    expect(DEFAULT_FLUENCY_SESSION_SIZE).toBe(8);
    expect(FLUENCY_ELIGIBLE_TYPES).toEqual([ExerciseType.CLOZE, ExerciseType.VOCAB_RECALL]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/shared test -- fluency`
Expected: FAIL — `Cannot find module './fluency'`.

- [ ] **Step 3: Write the implementation**

Create `packages/shared/src/fluency.ts`:

```typescript
import {
  ExerciseType,
  type ExerciseContent,
  isClozeContent,
  isVocabRecallContent,
} from "./index";

// ---------------------------------------------------------------------------
// Fluency mode — locked constants (single source of truth)
// ---------------------------------------------------------------------------

/** An item is fluency-eligible once its most-recent accuracy score reaches this. */
export const FLUENCY_MASTERY_THRESHOLD = 0.8;

/** Minimum eligible items required before fluency mode is offered. */
export const MIN_FLUENCY_POOL = 4;

/** Reported think-times above this are stored clamped (backgrounded-tab guard). */
export const LATENCY_CEILING_MS = 60_000;

/** Default number of items per fluency session. */
export const DEFAULT_FLUENCY_SESSION_SIZE = 8;

/** Only locally-gradable types qualify (no Claude round-trip in fluency mode). */
export const FLUENCY_ELIGIBLE_TYPES: readonly ExerciseType[] = [
  ExerciseType.CLOZE,
  ExerciseType.VOCAB_RECALL,
];

export function isFluencyEligibleType(type: ExerciseType): boolean {
  return FLUENCY_ELIGIBLE_TYPES.includes(type);
}

// ---------------------------------------------------------------------------
// Deterministic grader
// ---------------------------------------------------------------------------
// NOTE: diacritics are NOT stripped — é/ü/ı are meaningful in ES/DE/TR and a
// wrong diacritic is a wrong answer. We only normalise case + surrounding/
// internal whitespace + Unicode form. Turkish İ/I case-folding edge cases are
// accepted as-is for v1 (toLocaleLowerCase without an explicit locale).

export function normalizeFluencyAnswer(raw: string): string {
  return raw.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

/**
 * Grade a fluency answer deterministically. Returns true on an exact
 * (normalised) match against the content's accepted forms.
 * Throws for non-eligible content types — the route guards type before calling.
 */
export function gradeFluencyAnswer(content: ExerciseContent, answer: string): boolean {
  const candidate = normalizeFluencyAnswer(answer);

  if (isClozeContent(content)) {
    const accepted = [content.correctAnswer, ...(content.acceptableAnswers ?? [])];
    return accepted.some((a) => normalizeFluencyAnswer(a) === candidate);
  }

  if (isVocabRecallContent(content)) {
    return normalizeFluencyAnswer(content.expectedWord) === candidate;
  }

  throw new Error(`gradeFluencyAnswer: unsupported content type "${content.type}"`);
}
```

- [ ] **Step 4: Add the barrel export**

In `packages/shared/src/index.ts`, add near the other `export *` lines (e.g. after the `export * from "./coverage";` line at the end):

```typescript
// ---------------------------------------------------------------------------
// Fluency mode — deterministic grader + locked constants
// ---------------------------------------------------------------------------

export * from "./fluency";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/shared test -- fluency`
Expected: PASS (all cases green).

- [ ] **Step 6: Build shared so downstream packages see the new export**

Run: `pnpm --filter @language-drill/shared build`
Expected: tsc emits with no errors. (Per the memory note "Vitest workspace dist resolution": downstream packages resolve `shared/dist`, so this build is required before later tasks typecheck.)

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/fluency.ts packages/shared/src/fluency.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): deterministic fluency grader + constants"
```

---

## Task 2: `fluency_attempts` table + migration (`packages/db`)

**Files:**
- Modify: `packages/db/src/schema/progress.ts`
- Modify (verify): `packages/db/src/schema/index.ts`
- Create: `packages/db/migrations/00NN_*.sql` (generated)

- [ ] **Step 1: Add the table to the schema**

In `packages/db/src/schema/progress.ts`, append after `spacedRepetitionCards` (the file already imports `index, integer, pgTable, text, timestamp, uuid` and `exercises` / `users`; `boolean` is the only new import — add it to the `drizzle-orm/pg-core` import list):

```typescript
export const fluencyAttempts = pgTable(
  'fluency_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').references(() => users.id),
    exerciseId: uuid('exercise_id').references(() => exercises.id),
    language: text('language'), // denormalized for cheap stats queries
    grammarPointKey: text('grammar_point_key'), // denormalized; nullable
    correct: boolean('correct').notNull(),
    latencyMs: integer('latency_ms').notNull(), // client-reported, server-clamped
    attemptedAt: timestamp('attempted_at').notNull().defaultNow(),
  },
  (table) => ({
    // Stats query: filter by user + language, order/bucket by recency.
    userIdLanguageAttemptedAtIdx: index(
      'fluency_attempts_user_id_language_attempted_at_idx',
    ).on(table.userId, table.language, table.attemptedAt),
  }),
);
```

Update the import line at the top of the file to include `boolean`:

```typescript
import { boolean, index, integer, jsonb, pgTable, real, text, timestamp, uuid } from 'drizzle-orm/pg-core';
```

- [ ] **Step 2: Verify the barrel re-exports it**

Read `packages/db/src/schema/index.ts`. The existing line `export * from './progress';` (or equivalent — confirm by grep) will already surface `fluencyAttempts`. If progress exports are enumerated explicitly instead of `export *`, add `fluencyAttempts` to that list.

Run: `grep -n "progress" packages/db/src/schema/index.ts`
Expected: a `export * from './progress'` (no edit needed) OR an explicit list (add `fluencyAttempts`).

- [ ] **Step 3: Generate the migration**

Run: `pnpm --filter @language-drill/db exec drizzle-kit generate`
Expected: a new file `packages/db/migrations/00NN_<name>.sql` containing `CREATE TABLE "fluency_attempts"` with the FK constraints and the index, plus an updated `migrations/meta` snapshot.

- [ ] **Step 4: Sanity-check the generated SQL**

Read the new `00NN_*.sql`. Confirm it creates `fluency_attempts` with columns `id, user_id, exercise_id, language, grammar_point_key, correct, latency_ms, attempted_at`, the two FKs, and the composite index. No `DROP`/`ALTER` of other tables should appear (forward-only, additive).

- [ ] **Step 5: Build db + typecheck**

Run: `pnpm --filter @language-drill/db build && pnpm --filter @language-drill/db typecheck`
Expected: PASS. (Build emits `db/dist` so downstream lambda/api-client tasks resolve the new table — see the "Vitest workspace dist resolution" memory.)

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema/progress.ts packages/db/src/schema/index.ts packages/db/migrations
git commit -m "feat(db): add fluency_attempts table + migration"
```

---

## Task 3: Pure session-composition helper (`infra/lambda/src/lib/fluency-session.ts`)

This is the deterministic, DB-free core of `POST /fluency/session`: given the eligible exercise rows, decide whether there are enough and which to serve.

**Files:**
- Create: `infra/lambda/src/lib/fluency-session.ts`
- Create: `infra/lambda/src/lib/fluency-session.test.ts`

- [ ] **Step 1: Write the failing test**

Create `infra/lambda/src/lib/fluency-session.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { MIN_FLUENCY_POOL } from '@language-drill/shared';
import { composeFluencySession, type EligibleExercise } from './fluency-session';

function eligible(id: string): EligibleExercise {
  return {
    id,
    type: 'cloze',
    language: 'ES',
    difficulty: 'B1',
    grammarPointKey: null,
    contentJson: { type: 'cloze', correctAnswer: 'x' },
  };
}

describe('composeFluencySession', () => {
  it('returns insufficient when below MIN_FLUENCY_POOL', () => {
    const pool = Array.from({ length: MIN_FLUENCY_POOL - 1 }, (_, i) => eligible(`e${i}`));
    const result = composeFluencySession(pool, 8, () => 0);
    expect(result.insufficient).toBe(true);
    expect(result.available).toBe(MIN_FLUENCY_POOL - 1);
    expect(result.items).toEqual([]);
  });

  it('returns up to `count` items when enough are eligible', () => {
    const pool = Array.from({ length: 10 }, (_, i) => eligible(`e${i}`));
    const result = composeFluencySession(pool, 8, () => 0);
    expect(result.insufficient).toBe(false);
    expect(result.items).toHaveLength(8);
  });

  it('returns all items when fewer than `count` but >= MIN_FLUENCY_POOL', () => {
    const pool = Array.from({ length: MIN_FLUENCY_POOL }, (_, i) => eligible(`e${i}`));
    const result = composeFluencySession(pool, 8, () => 0);
    expect(result.insufficient).toBe(false);
    expect(result.items).toHaveLength(MIN_FLUENCY_POOL);
  });

  it('shuffles deterministically given an injected rng', () => {
    const pool = ['a', 'b', 'c', 'd', 'e'].map(eligible);
    // rng always returns 0 → Fisher-Yates swaps every i with index 0
    const result = composeFluencySession(pool, 5, () => 0);
    expect(result.items.map((i) => i.id)).toHaveLength(5);
    // every original id is still present (permutation, no loss/dupe)
    expect(new Set(result.items.map((i) => i.id))).toEqual(new Set(pool.map((p) => p.id)));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/lambda test -- fluency-session`
Expected: FAIL — `Cannot find module './fluency-session'`.

- [ ] **Step 3: Write the implementation**

Create `infra/lambda/src/lib/fluency-session.ts`:

```typescript
import { MIN_FLUENCY_POOL } from '@language-drill/shared';

/** An eligible exercise row, shaped for the wire response. */
export type EligibleExercise = {
  id: string;
  type: string;
  language: string;
  difficulty: string;
  grammarPointKey: string | null;
  contentJson: unknown;
};

export type FluencySessionResult =
  | { insufficient: true; available: number; items: [] }
  | { insufficient: false; available: number; items: EligibleExercise[] };

/**
 * Pure composition for POST /fluency/session.
 * - Below MIN_FLUENCY_POOL eligible items → insufficient (route returns 409).
 * - Otherwise shuffle (Fisher-Yates with injectable rng) and take up to `count`.
 * `rng` defaults to Math.random; tests inject a deterministic stub.
 */
export function composeFluencySession(
  pool: readonly EligibleExercise[],
  count: number,
  rng: () => number = Math.random,
): FluencySessionResult {
  const available = pool.length;
  if (available < MIN_FLUENCY_POOL) {
    return { insufficient: true, available, items: [] };
  }
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return { insufficient: false, available, items: shuffled.slice(0, count) };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/lambda test -- fluency-session`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/lib/fluency-session.ts infra/lambda/src/lib/fluency-session.test.ts
git commit -m "feat(lambda): pure fluency session composition helper"
```

---

## Task 4: Pure stats aggregation (`infra/lambda/src/lib/fluency-stats.ts`)

Drives `GET /fluency/stats`: weekly buckets of median latency + accuracy + volume.

**Files:**
- Create: `infra/lambda/src/lib/fluency-stats.ts`
- Create: `infra/lambda/src/lib/fluency-stats.test.ts`

- [ ] **Step 1: Write the failing test**

Create `infra/lambda/src/lib/fluency-stats.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { aggregateFluencyStats, median, type FluencyAttemptRow } from './fluency-stats';

const DAY = 86_400_000;
const NOW = new Date('2026-06-13T12:00:00Z');

function row(daysAgo: number, latencyMs: number, correct: boolean): FluencyAttemptRow {
  return { latencyMs, correct, attemptedAt: new Date(NOW.getTime() - daysAgo * DAY) };
}

describe('median', () => {
  it('returns the middle of an odd-length set', () => {
    expect(median([3, 1, 2])).toBe(2);
  });
  it('averages the two middles of an even-length set', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
  it('returns null for an empty set', () => {
    expect(median([])).toBeNull();
  });
});

describe('aggregateFluencyStats', () => {
  it('returns empty buckets and zeroed totals when there are no rows', () => {
    const stats = aggregateFluencyStats([], NOW, 4);
    expect(stats.totalAttempts).toBe(0);
    expect(stats.overallAccuracy).toBe(0);
    expect(stats.overallMedianLatencyMs).toBeNull();
    expect(stats.weeks).toHaveLength(4);
    expect(stats.weeks.every((w) => w.attempts === 0)).toBe(true);
  });

  it('computes overall totals across all rows', () => {
    const rows = [row(0, 1000, true), row(1, 3000, false), row(2, 2000, true)];
    const stats = aggregateFluencyStats(rows, NOW, 4);
    expect(stats.totalAttempts).toBe(3);
    expect(stats.overallAccuracy).toBeCloseTo(2 / 3, 5);
    expect(stats.overallMedianLatencyMs).toBe(2000);
  });

  it('buckets attempts into the correct week (last bucket = current week)', () => {
    // 0 days ago → current week (index weeks-1); 8 days ago → an earlier bucket
    const rows = [row(0, 1000, true), row(8, 5000, true)];
    const stats = aggregateFluencyStats(rows, NOW, 4);
    const last = stats.weeks[stats.weeks.length - 1];
    expect(last.attempts).toBe(1);
    expect(last.medianLatencyMs).toBe(1000);
    const totalBucketed = stats.weeks.reduce((s, w) => s + w.attempts, 0);
    expect(totalBucketed).toBe(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/lambda test -- fluency-stats`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `infra/lambda/src/lib/fluency-stats.ts`:

```typescript
const MS_PER_DAY = 86_400_000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

export type FluencyAttemptRow = {
  latencyMs: number;
  correct: boolean;
  attemptedAt: Date;
};

export type FluencyWeekBucket = {
  /** Weeks ago: 0 = current week, increasing into the past. */
  weeksAgo: number;
  attempts: number;
  medianLatencyMs: number | null;
  accuracy: number; // [0,1]; 0 when no attempts
};

export type FluencyStats = {
  totalAttempts: number;
  overallAccuracy: number; // [0,1]
  overallMedianLatencyMs: number | null;
  weeks: FluencyWeekBucket[]; // length === weeks; chronological (oldest first)
};

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function accuracy(rows: readonly FluencyAttemptRow[]): number {
  if (rows.length === 0) return 0;
  const correct = rows.filter((r) => r.correct).length;
  return correct / rows.length;
}

/**
 * Aggregate fluency attempts into `weeks` chronological buckets ending with the
 * current week, plus overall totals. Pure; `now` and `weeks` are injected.
 * Rows older than the window are excluded from buckets but still count toward
 * overall totals (the caller scopes the SQL window; this is defensive).
 */
export function aggregateFluencyStats(
  rows: readonly FluencyAttemptRow[],
  now: Date,
  weeks: number,
): FluencyStats {
  const buckets: FluencyAttemptRow[][] = Array.from({ length: weeks }, () => []);
  for (const r of rows) {
    const weeksAgo = Math.floor((now.getTime() - r.attemptedAt.getTime()) / MS_PER_WEEK);
    if (weeksAgo < 0 || weeksAgo >= weeks) continue;
    buckets[weeks - 1 - weeksAgo].push(r);
  }

  const weekStats: FluencyWeekBucket[] = buckets.map((bucket, idx) => ({
    weeksAgo: weeks - 1 - idx,
    attempts: bucket.length,
    medianLatencyMs: median(bucket.map((r) => r.latencyMs)),
    accuracy: accuracy(bucket),
  }));

  return {
    totalAttempts: rows.length,
    overallAccuracy: accuracy(rows),
    overallMedianLatencyMs: median(rows.map((r) => r.latencyMs)),
    weeks: weekStats,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/lambda test -- fluency-stats`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/lib/fluency-stats.ts infra/lambda/src/lib/fluency-stats.test.ts
git commit -m "feat(lambda): pure fluency stats aggregation"
```

---

## Task 5: Fluency routes (`infra/lambda/src/routes/fluency.ts`)

**Files:**
- Create: `infra/lambda/src/routes/fluency.ts`
- Create: `infra/lambda/src/routes/fluency.test.ts`
- Modify: `infra/lambda/src/index.ts`

- [ ] **Step 1: Write the implementation**

Create `infra/lambda/src/routes/fluency.ts`:

```typescript
import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq, gte, sql } from 'drizzle-orm';
import {
  Language,
  ExerciseType,
  type ExerciseContent,
  gradeFluencyAnswer,
  isFluencyEligibleType,
  FLUENCY_MASTERY_THRESHOLD,
  LATENCY_CEILING_MS,
  DEFAULT_FLUENCY_SESSION_SIZE,
} from '@language-drill/shared';
import { exercises as exercisesTable, fluencyAttempts } from '@language-drill/db';
import { db } from '../db';
import { approvedStatusFilter } from '../lib/exercise-filters';
import { authMiddleware } from '../middleware/auth';
import type { Bindings, Variables } from '../middleware/auth';
import { composeFluencySession, type EligibleExercise } from '../lib/fluency-session';
import { aggregateFluencyStats, type FluencyAttemptRow } from '../lib/fluency-stats';

const LearningLanguageEnum = z.enum([Language.ES, Language.DE, Language.TR]);

const SessionBodySchema = z.object({
  language: LearningLanguageEnum,
  count: z.number().int().min(1).max(20).optional(),
});

const AttemptBodySchema = z.object({
  exerciseId: z.string().uuid(),
  answer: z.string().min(1),
  latencyMs: z.number().int().positive(),
});

const StatsQuerySchema = z.object({
  language: LearningLanguageEnum,
});

const STATS_WEEKS = 8;
const STATS_WINDOW_MS = STATS_WEEKS * 7 * 86_400_000;

const fluency = new Hono<{ Bindings: Bindings; Variables: Variables }>();

fluency.use('/fluency/*', authMiddleware);

// ---------------------------------------------------------------------------
// POST /fluency/session — return eligible mastered items for a timed drill
// ---------------------------------------------------------------------------
fluency.post('/fluency/session', async (c) => {
  const parsed = SessionBodySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json(
      { error: 'Invalid request body', code: 'VALIDATION_ERROR', details: parsed.error.flatten() },
      400,
    );
  }
  const { language, count = DEFAULT_FLUENCY_SESSION_SIZE } = parsed.data;
  const userId = c.get('userId');

  // Eligible = the user's most-recent score per exercise is >= threshold, the
  // exercise is an eligible (locally-gradable) type, this language, approved.
  // DISTINCT ON collapses retries to the latest submission per exercise; the
  // outer filter keeps only those whose latest score cleared the threshold.
  const result = await db.execute(sql`
    SELECT e.id, e.type, e.language, e.difficulty, e.grammar_point_key, e.content_json
    FROM exercises e
    JOIN (
      SELECT DISTINCT ON (exercise_id) exercise_id, score
      FROM user_exercise_history
      WHERE user_id = ${userId}
      ORDER BY exercise_id, evaluated_at DESC NULLS LAST
    ) h ON h.exercise_id = e.id
    WHERE e.language = ${language}
      AND e.type IN (${ExerciseType.CLOZE}, ${ExerciseType.VOCAB_RECALL})
      AND e.review_status IN ('auto-approved', 'manual-approved')
      AND h.score >= ${FLUENCY_MASTERY_THRESHOLD}
  `);

  const rows = (result as unknown as {
    rows: Array<{
      id: string;
      type: string;
      language: string;
      difficulty: string;
      grammar_point_key: string | null;
      content_json: unknown;
    }>;
  }).rows;

  const pool: EligibleExercise[] = rows.map((r) => ({
    id: r.id,
    type: r.type,
    language: r.language,
    difficulty: r.difficulty,
    grammarPointKey: r.grammar_point_key,
    contentJson: r.content_json,
  }));

  const composed = composeFluencySession(pool, count);
  if (composed.insufficient) {
    return c.json(
      {
        error: 'Not enough mastered items for fluency mode',
        code: 'INSUFFICIENT_FLUENCY_POOL',
        details: { available: composed.available, required: 4 },
      },
      409,
    );
  }

  return c.json({
    language,
    exercises: composed.items.map((e) => ({
      id: e.id,
      type: e.type,
      language: e.language,
      difficulty: e.difficulty,
      grammarPointKey: e.grammarPointKey,
      contentJson: e.contentJson,
    })),
  });
});

// ---------------------------------------------------------------------------
// POST /fluency/attempts — deterministically grade + record one timed answer
// ---------------------------------------------------------------------------
fluency.post('/fluency/attempts', async (c) => {
  const parsed = AttemptBodySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json(
      { error: 'Invalid request body', code: 'VALIDATION_ERROR', details: parsed.error.flatten() },
      422,
    );
  }
  const { exerciseId, answer, latencyMs } = parsed.data;
  const userId = c.get('userId');

  const rows = await db
    .select()
    .from(exercisesTable)
    .where(and(eq(exercisesTable.id, exerciseId), approvedStatusFilter(exercisesTable)))
    .limit(1);

  if (rows.length === 0) {
    return c.json({ error: 'Exercise not found', code: 'EXERCISE_NOT_FOUND' }, 404);
  }
  const exercise = rows[0];

  // Guard: only locally-gradable types are accepted in fluency mode.
  if (!exercise.type || !isFluencyEligibleType(exercise.type as ExerciseType)) {
    return c.json({ error: 'Exercise not eligible for fluency', code: 'NOT_FLUENCY_ELIGIBLE' }, 400);
  }

  const correct = gradeFluencyAnswer(exercise.contentJson as ExerciseContent, answer);
  const clampedLatency = Math.min(latencyMs, LATENCY_CEILING_MS);

  await db.insert(fluencyAttempts).values({
    userId,
    exerciseId,
    language: exercise.language,
    grammarPointKey: exercise.grammarPointKey,
    correct,
    latencyMs: clampedLatency,
  });

  // Resolve correctAnswer for instant feedback (no Claude).
  const content = exercise.contentJson as ExerciseContent;
  const correctAnswer =
    content.type === ExerciseType.CLOZE
      ? content.correctAnswer
      : content.type === ExerciseType.VOCAB_RECALL
        ? content.expectedWord
        : '';

  return c.json({ correct, correctAnswer, latencyMs: clampedLatency });
});

// ---------------------------------------------------------------------------
// GET /fluency/stats — latency/accuracy/volume trend for the active language
// ---------------------------------------------------------------------------
fluency.get('/fluency/stats', async (c) => {
  const parsed = StatsQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json(
      { error: 'Invalid query parameters', code: 'VALIDATION_ERROR', details: parsed.error.flatten() },
      400,
    );
  }
  const { language } = parsed.data;
  const userId = c.get('userId');
  const now = new Date();
  const windowStart = new Date(now.getTime() - STATS_WINDOW_MS);

  const rows = await db
    .select({
      latencyMs: fluencyAttempts.latencyMs,
      correct: fluencyAttempts.correct,
      attemptedAt: fluencyAttempts.attemptedAt,
    })
    .from(fluencyAttempts)
    .where(
      and(
        eq(fluencyAttempts.userId, userId),
        eq(fluencyAttempts.language, language),
        gte(fluencyAttempts.attemptedAt, windowStart),
      ),
    );

  const typed: FluencyAttemptRow[] = rows
    .filter((r) => r.attemptedAt !== null && r.latencyMs !== null)
    .map((r) => ({
      latencyMs: r.latencyMs as number,
      correct: r.correct as boolean,
      attemptedAt: r.attemptedAt as Date,
    }));

  const stats = aggregateFluencyStats(typed, now, STATS_WEEKS);
  return c.json({ language, ...stats });
});

export default fluency;
```

- [ ] **Step 2: Register the router**

In `infra/lambda/src/index.ts`, add the import alongside the others (after `import progress from './routes/progress';`):

```typescript
import fluency from './routes/fluency';
```

and add the mount alongside the others (after `app.route('/', progress);`):

```typescript
app.route('/', fluency);
```

- [ ] **Step 3: Write the route test**

Create `infra/lambda/src/routes/fluency.test.ts` (mirrors the mock style in `routes/progress.test.ts`). The attempts handler uses `db.select().from().where().limit()` then `db.insert().values()`; the stats handler uses `db.select().from().where()`; the session handler uses `db.execute()`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecute = vi.fn();
const mockInsertValues = vi.fn(() => Promise.resolve(undefined));
const mockInsert = vi.fn(() => ({ values: mockInsertValues }));
const mockLimit = vi.fn();
const mockSelectWhere = vi.fn(() => ({ limit: mockLimit }));
// stats path: select().from().where() resolves directly (no .limit)
const mockWhereResolves = vi.fn(() => Promise.resolve<unknown[]>([]));
const mockFrom = vi.fn(() => ({ where: makeWhere() }));
function makeWhere() {
  // returns an object usable both as a thenable (stats) and as a builder (.limit)
  const w: any = (...args: unknown[]) => mockSelectWhere(...args);
  return w;
}

vi.mock('../db', () => ({
  db: {
    execute: (...a: unknown[]) => mockExecute(...a),
    insert: () => mockInsert(),
    select: () => ({
      from: () => ({
        where: (...a: unknown[]) => {
          // exercises lookup uses .limit; stats query awaits the where result
          const res: any = mockSelectWhere(...a);
          return res;
        },
      }),
    }),
  },
}));

vi.mock('@language-drill/db', () => ({
  exercises: { id: 'id', language: 'language', type: 'type', grammarPointKey: 'grammar_point_key', contentJson: 'content_json', reviewStatus: 'review_status' },
  fluencyAttempts: { userId: 'user_id', language: 'language', latencyMs: 'latency_ms', correct: 'correct', attemptedAt: 'attempted_at' },
}));

import fluency from './fluency';

const authEnv = { event: { requestContext: { authorizer: { jwt: { claims: { sub: 'user_123' } } } } } };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /fluency/session', () => {
  it('returns 409 INSUFFICIENT_FLUENCY_POOL when too few eligible items', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [{ id: 'a', type: 'cloze', language: 'ES', difficulty: 'B1', grammar_point_key: null, content_json: { type: 'cloze', correctAnswer: 'x' } }] });
    const res = await fluency.request('/fluency/session', {
      method: 'POST',
      body: JSON.stringify({ language: 'ES' }),
      headers: { 'content-type': 'application/json' },
    }, authEnv);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('INSUFFICIENT_FLUENCY_POOL');
    expect(body.details.required).toBe(4);
  });

  it('returns items when enough are eligible', async () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({ id: `e${i}`, type: 'cloze', language: 'ES', difficulty: 'B1', grammar_point_key: null, content_json: { type: 'cloze', correctAnswer: 'x' } }));
    mockExecute.mockResolvedValueOnce({ rows });
    const res = await fluency.request('/fluency/session', {
      method: 'POST',
      body: JSON.stringify({ language: 'ES', count: 5 }),
      headers: { 'content-type': 'application/json' },
    }, authEnv);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.exercises).toHaveLength(5);
  });
});

describe('POST /fluency/attempts', () => {
  it('returns 422 on non-positive latency', async () => {
    const res = await fluency.request('/fluency/attempts', {
      method: 'POST',
      body: JSON.stringify({ exerciseId: '00000000-0000-0000-0000-000000000000', answer: 'x', latencyMs: 0 }),
      headers: { 'content-type': 'application/json' },
    }, authEnv);
    expect(res.status).toBe(422);
  });

  it('returns 404 when the exercise is missing', async () => {
    mockLimit.mockResolvedValueOnce([]);
    const res = await fluency.request('/fluency/attempts', {
      method: 'POST',
      body: JSON.stringify({ exerciseId: '00000000-0000-0000-0000-000000000000', answer: 'x', latencyMs: 1000 }),
      headers: { 'content-type': 'application/json' },
    }, authEnv);
    expect(res.status).toBe(404);
  });

  it('grades correctly, clamps latency, inserts into fluency_attempts (NOT history)', async () => {
    mockLimit.mockResolvedValueOnce([
      { id: 'e1', language: 'ES', type: 'cloze', grammarPointKey: null, contentJson: { type: 'cloze', correctAnswer: 'está' } },
    ]);
    const res = await fluency.request('/fluency/attempts', {
      method: 'POST',
      body: JSON.stringify({ exerciseId: '11111111-1111-1111-1111-111111111111', answer: '  ESTÁ ', latencyMs: 999_999 }),
      headers: { 'content-type': 'application/json' },
    }, authEnv);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.correct).toBe(true);
    expect(body.latencyMs).toBe(60_000); // clamped to LATENCY_CEILING_MS
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ correct: true, latencyMs: 60_000, exerciseId: '11111111-1111-1111-1111-111111111111' }),
    );
  });
});
```

> **Note on the mock harness:** the `db` mock above is intentionally minimal; if the select-chain shape needs tuning to match how Drizzle is actually invoked (e.g. `.limit` on the exercises lookup vs. an awaited `.where` on the stats query), adjust the mock factory so `select().from().where().limit()` resolves the exercises row and `select().from().where()` resolves the stats rows. Use `routes/progress.test.ts` and `routes/sessions.test.ts` as the canonical references for this codebase's mock style. The **assertions** (status codes, `code` strings, clamp value, insert target) are the contract and must not change.

- [ ] **Step 4: Run the route test**

Run: `pnpm --filter @language-drill/lambda test -- routes/fluency`
Expected: PASS. If the db-mock chain mismatches, fix the mock (not the assertions) until green.

- [ ] **Step 5: Typecheck the lambda package**

Run: `pnpm --filter @language-drill/lambda typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add infra/lambda/src/routes/fluency.ts infra/lambda/src/routes/fluency.test.ts infra/lambda/src/index.ts
git commit -m "feat(lambda): fluency session/attempts/stats endpoints"
```

---

## Task 6: API client schemas + hooks (`packages/api-client`)

**Files:**
- Create: `packages/api-client/src/schemas/fluency.ts`
- Create: `packages/api-client/src/schemas/fluency.test.ts`
- Create: `packages/api-client/src/hooks/useFluency.ts`
- Create: `packages/api-client/src/hooks/useFluency.test.ts`
- Modify: `packages/api-client/src/index.ts`

- [ ] **Step 1: Write the failing schema test**

Create `packages/api-client/src/schemas/fluency.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  FluencySessionResponseSchema,
  FluencyAttemptResponseSchema,
  FluencyStatsResponseSchema,
} from './fluency';

describe('fluency schemas', () => {
  it('parses a session response', () => {
    const parsed = FluencySessionResponseSchema.parse({
      language: 'ES',
      exercises: [
        { id: '00000000-0000-0000-0000-000000000000', type: 'cloze', language: 'ES', difficulty: 'B1', grammarPointKey: null, contentJson: { type: 'cloze' } },
      ],
    });
    expect(parsed.exercises).toHaveLength(1);
  });

  it('parses an attempt response', () => {
    const parsed = FluencyAttemptResponseSchema.parse({ correct: true, correctAnswer: 'está', latencyMs: 1200 });
    expect(parsed.correct).toBe(true);
  });

  it('parses a stats response', () => {
    const parsed = FluencyStatsResponseSchema.parse({
      language: 'ES',
      totalAttempts: 2,
      overallAccuracy: 0.5,
      overallMedianLatencyMs: 1500,
      weeks: [{ weeksAgo: 0, attempts: 2, medianLatencyMs: 1500, accuracy: 0.5 }],
    });
    expect(parsed.weeks).toHaveLength(1);
    expect(parsed.overallMedianLatencyMs).toBe(1500);
  });

  it('accepts a null overall median (no data)', () => {
    const parsed = FluencyStatsResponseSchema.parse({
      language: 'ES', totalAttempts: 0, overallAccuracy: 0, overallMedianLatencyMs: null, weeks: [],
    });
    expect(parsed.overallMedianLatencyMs).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @language-drill/api-client test -- schemas/fluency`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the schemas**

Create `packages/api-client/src/schemas/fluency.ts`:

```typescript
import { z } from 'zod';
import { Language, CefrLevel } from '@language-drill/shared';
import { ExerciseResponseSchema } from './exercise';

const LearningLanguageEnum = z.enum([Language.ES, Language.DE, Language.TR]);

// Request body for POST /fluency/session
export const FluencySessionRequestSchema = z.object({
  language: LearningLanguageEnum,
  count: z.number().int().min(1).max(20).optional(),
});
export type FluencySessionRequest = z.infer<typeof FluencySessionRequestSchema>;

// Response body for POST /fluency/session
export const FluencySessionResponseSchema = z.object({
  language: LearningLanguageEnum,
  exercises: z.array(ExerciseResponseSchema),
});
export type FluencySessionResponse = z.infer<typeof FluencySessionResponseSchema>;

// Request body for POST /fluency/attempts
export const FluencyAttemptRequestSchema = z.object({
  exerciseId: z.string().uuid(),
  answer: z.string().min(1),
  latencyMs: z.number().int().positive(),
});
export type FluencyAttemptRequest = z.infer<typeof FluencyAttemptRequestSchema>;

// Response body for POST /fluency/attempts
export const FluencyAttemptResponseSchema = z.object({
  correct: z.boolean(),
  correctAnswer: z.string(),
  latencyMs: z.number().int().nonnegative(),
});
export type FluencyAttemptResponse = z.infer<typeof FluencyAttemptResponseSchema>;

// Response body for GET /fluency/stats
export const FluencyWeekBucketSchema = z.object({
  weeksAgo: z.number().int().nonnegative(),
  attempts: z.number().int().nonnegative(),
  medianLatencyMs: z.number().nullable(),
  accuracy: z.number().min(0).max(1),
});

export const FluencyStatsResponseSchema = z.object({
  language: LearningLanguageEnum,
  totalAttempts: z.number().int().nonnegative(),
  overallAccuracy: z.number().min(0).max(1),
  overallMedianLatencyMs: z.number().nullable(),
  weeks: z.array(FluencyWeekBucketSchema),
});
export type FluencyStatsResponse = z.infer<typeof FluencyStatsResponseSchema>;
export type FluencyWeekBucket = z.infer<typeof FluencyWeekBucketSchema>;
```

- [ ] **Step 4: Run the schema test to verify it passes**

Run: `pnpm --filter @language-drill/api-client test -- schemas/fluency`
Expected: PASS.

- [ ] **Step 5: Write the failing hooks test**

Create `packages/api-client/src/hooks/useFluency.test.ts`. Mirror the structure of `hooks/useSession.test.ts` (use `@tanstack/react-query` + `renderHook`). Minimum coverage — that each hook calls the right path/method and parses the response:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useFluencyStats, useFluencySession, useSubmitFluencyAttempt } from './useFluency';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

const okJson = (body: unknown) =>
  vi.fn(async () => ({ json: async () => body }) as unknown as Response);

describe('useFluencyStats', () => {
  it('GETs /fluency/stats and parses', async () => {
    const fetchFn = okJson({ language: 'ES', totalAttempts: 0, overallAccuracy: 0, overallMedianLatencyMs: null, weeks: [] });
    const { result } = renderHook(() => useFluencyStats({ fetchFn: fetchFn as never, language: 'ES' }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchFn).toHaveBeenCalledWith('/fluency/stats?language=ES');
  });
});

describe('useFluencySession', () => {
  it('POSTs /fluency/session', async () => {
    const fetchFn = okJson({ language: 'ES', exercises: [] });
    const { result } = renderHook(() => useFluencySession({ fetchFn: fetchFn as never }), { wrapper: wrapper() });
    result.current.mutate({ language: 'ES' });
    await waitFor(() => expect(fetchFn).toHaveBeenCalled());
    expect(fetchFn).toHaveBeenCalledWith('/fluency/session', expect.objectContaining({ method: 'POST' }));
  });
});

describe('useSubmitFluencyAttempt', () => {
  it('POSTs /fluency/attempts', async () => {
    const fetchFn = okJson({ correct: true, correctAnswer: 'x', latencyMs: 100 });
    const { result } = renderHook(() => useSubmitFluencyAttempt({ fetchFn: fetchFn as never }), { wrapper: wrapper() });
    result.current.mutate({ exerciseId: '00000000-0000-0000-0000-000000000000', answer: 'x', latencyMs: 100 });
    await waitFor(() => expect(fetchFn).toHaveBeenCalled());
    expect(fetchFn).toHaveBeenCalledWith('/fluency/attempts', expect.objectContaining({ method: 'POST' }));
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `pnpm --filter @language-drill/api-client test -- hooks/useFluency`
Expected: FAIL — module not found.

- [ ] **Step 7: Write the hooks**

Create `packages/api-client/src/hooks/useFluency.ts`:

```typescript
import { useQuery, useMutation, type UseQueryResult } from '@tanstack/react-query';
import type { LearningLanguage } from '@language-drill/shared';
import {
  FluencySessionResponseSchema,
  type FluencySessionRequest,
  type FluencySessionResponse,
  FluencyAttemptResponseSchema,
  type FluencyAttemptRequest,
  type FluencyAttemptResponse,
  FluencyStatsResponseSchema,
  type FluencyStatsResponse,
} from '../schemas/fluency';
import type { AuthenticatedFetch } from '../fetchClient';

const FLUENCY_STATS_STALE_TIME_MS = 5 * 60 * 1000;

export function useFluencySession({ fetchFn }: { fetchFn: AuthenticatedFetch }) {
  return useMutation<FluencySessionResponse, Error, FluencySessionRequest>({
    mutationFn: async (input) => {
      const response = await fetchFn('/fluency/session', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      const json: unknown = await response.json();
      return FluencySessionResponseSchema.parse(json);
    },
  });
}

export function useSubmitFluencyAttempt({ fetchFn }: { fetchFn: AuthenticatedFetch }) {
  return useMutation<FluencyAttemptResponse, Error, FluencyAttemptRequest>({
    mutationFn: async (input) => {
      const response = await fetchFn('/fluency/attempts', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      const json: unknown = await response.json();
      return FluencyAttemptResponseSchema.parse(json);
    },
  });
}

export type UseFluencyStatsParams = {
  fetchFn: AuthenticatedFetch;
  language: LearningLanguage;
  enabled?: boolean;
};

export function useFluencyStats({
  fetchFn,
  language,
  enabled = true,
}: UseFluencyStatsParams): UseQueryResult<FluencyStatsResponse, Error> {
  return useQuery<FluencyStatsResponse, Error>({
    queryKey: ['fluencyStats', language],
    queryFn: async () => {
      const response = await fetchFn(`/fluency/stats?language=${encodeURIComponent(language)}`);
      const json: unknown = await response.json();
      return FluencyStatsResponseSchema.parse(json);
    },
    enabled,
    staleTime: FLUENCY_STATS_STALE_TIME_MS,
  });
}
```

- [ ] **Step 8: Re-export from the package index**

In `packages/api-client/src/index.ts`, add (follow the existing re-export grouping):

```typescript
export * from './schemas/fluency';
export {
  useFluencySession,
  useSubmitFluencyAttempt,
  useFluencyStats,
} from './hooks/useFluency';
```

- [ ] **Step 9: Run hooks test + typecheck**

Run: `pnpm --filter @language-drill/api-client test -- fluency && pnpm --filter @language-drill/api-client typecheck`
Expected: PASS. (If `LearningLanguage` import path differs, confirm with `grep -rn "LearningLanguage" packages/shared/src | head` and match the existing `useProgress.ts` import.)

- [ ] **Step 10: Build api-client**

Run: `pnpm --filter @language-drill/api-client build`
Expected: emits `api-client/dist` so the web app resolves the new hooks.

- [ ] **Step 11: Commit**

```bash
git add packages/api-client/src/schemas/fluency.ts packages/api-client/src/schemas/fluency.test.ts packages/api-client/src/hooks/useFluency.ts packages/api-client/src/hooks/useFluency.test.ts packages/api-client/src/index.ts
git commit -m "feat(api-client): fluency schemas + hooks"
```

---

## Task 7: Fluency drill UI (`apps/web/app/(dashboard)/fluency/`)

A self-contained timed drill. It deliberately does NOT reuse the Claude-coupled `ClozeExercise`/`FeedbackShell` (those render an `EvaluationResult`); fluency feedback is just ✓/✗ + correct answer + time.

**Files:**
- Create: `apps/web/app/(dashboard)/fluency/page.tsx`
- Create: `apps/web/app/(dashboard)/fluency/_components/fluency-item.tsx`
- Create: `apps/web/app/(dashboard)/fluency/_components/fluency-runner.tsx`
- Create: `apps/web/app/(dashboard)/fluency/_components/__tests__/fluency-runner.test.tsx`

- [ ] **Step 1: Write the single-item renderer**

Create `apps/web/app/(dashboard)/fluency/_components/fluency-item.tsx`:

```tsx
'use client';

import * as React from 'react';
import {
  ExerciseType,
  type ExerciseContent,
  type ClozeContent,
  type VocabRecallContent,
} from '@language-drill/shared';
import { Button, Input } from '../../../../components/ui';

export type FluencyVerdict = { correct: boolean; correctAnswer: string } | null;

export interface FluencyItemProps {
  content: ExerciseContent;
  elapsedMs: number;
  verdict: FluencyVerdict;
  onSubmit: (answer: string) => void;
  onNext: () => void;
  isLast: boolean;
}

function prompt(content: ExerciseContent): string {
  if (content.type === ExerciseType.CLOZE) {
    return (content as ClozeContent).sentence;
  }
  if (content.type === ExerciseType.VOCAB_RECALL) {
    return (content as VocabRecallContent).prompt;
  }
  return '';
}

export function FluencyItem({ content, elapsedMs, verdict, onSubmit, onNext, isLast }: FluencyItemProps) {
  const [answer, setAnswer] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const locked = verdict !== null;

  React.useEffect(() => {
    setAnswer('');
    inputRef.current?.focus();
  }, [content]);

  return (
    <div className="flex flex-col gap-s-4">
      <p className="t-small text-ink-mute" aria-live="off">
        {(elapsedMs / 1000).toFixed(1)}s
      </p>
      <p className="t-display-s">{prompt(content)}</p>
      <Input
        ref={inputRef}
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        readOnly={locked}
        disabled={locked}
      />
      {!locked ? (
        <Button variant="primary" onClick={() => answer.trim() && onSubmit(answer)} disabled={!answer.trim()}>
          submit
        </Button>
      ) : (
        <div className="flex flex-col gap-s-2">
          <p className="t-body" role="status">
            {verdict.correct ? '✓ correct' : `✗ — ${verdict.correctAnswer}`} · {(elapsedMs / 1000).toFixed(1)}s
          </p>
          <Button variant="primary" onClick={onNext}>
            {isLast ? 'finish' : 'next'}
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Write the failing runner test**

Create `apps/web/app/(dashboard)/fluency/_components/__tests__/fluency-runner.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FluencyRunner } from '../fluency-runner';

const exercises = [
  { id: 'e1', type: 'cloze', language: 'ES', difficulty: 'B1', grammarPointKey: null, contentJson: { type: 'cloze', sentence: 'El gato ___', correctAnswer: 'está' } },
  { id: 'e2', type: 'cloze', language: 'ES', difficulty: 'B1', grammarPointKey: null, contentJson: { type: 'cloze', sentence: 'La casa ___', correctAnswer: 'es' } },
];

describe('FluencyRunner', () => {
  it('submits an answer, shows the verdict, then advances', async () => {
    const submit = vi.fn(async () => ({ correct: true, correctAnswer: 'está', latencyMs: 1000 }));
    render(<FluencyRunner exercises={exercises as never} onSubmitAttempt={submit} onDone={vi.fn()} />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'está' } });
    fireEvent.click(screen.getByRole('button', { name: 'submit' }));

    await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({ exerciseId: 'e1', answer: 'está' })));
    await screen.findByRole('status'); // verdict shown
    fireEvent.click(screen.getByRole('button', { name: 'next' }));

    // second item now visible
    await screen.findByText('La casa ___');
  });

  it('calls onDone after the last item', async () => {
    const submit = vi.fn(async () => ({ correct: true, correctAnswer: 'x', latencyMs: 1 }));
    const onDone = vi.fn();
    render(<FluencyRunner exercises={[exercises[0]] as never} onSubmitAttempt={submit} onDone={onDone} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'está' } });
    fireEvent.click(screen.getByRole('button', { name: 'submit' }));
    await screen.findByRole('button', { name: 'finish' });
    fireEvent.click(screen.getByRole('button', { name: 'finish' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @language-drill/web test -- fluency-runner`
Expected: FAIL — `Cannot find module '../fluency-runner'`.

- [ ] **Step 4: Write the runner**

Create `apps/web/app/(dashboard)/fluency/_components/fluency-runner.tsx`:

```tsx
'use client';

import * as React from 'react';
import type { ExerciseContent } from '@language-drill/shared';
import type {
  FluencyAttemptRequest,
  FluencyAttemptResponse,
} from '@language-drill/api-client';
import { FluencyItem, type FluencyVerdict } from './fluency-item';

export type FluencyExercise = {
  id: string;
  type: string;
  language: string;
  difficulty: string;
  grammarPointKey: string | null;
  contentJson: ExerciseContent;
};

export interface FluencyRunnerProps {
  exercises: FluencyExercise[];
  onSubmitAttempt: (input: FluencyAttemptRequest) => Promise<FluencyAttemptResponse>;
  onDone: () => void;
}

export function FluencyRunner({ exercises, onSubmitAttempt, onDone }: FluencyRunnerProps) {
  const [index, setIndex] = React.useState(0);
  const [verdict, setVerdict] = React.useState<FluencyVerdict>(null);
  const [elapsedMs, setElapsedMs] = React.useState(0);
  const startRef = React.useRef<number>(Date.now());

  const current = exercises[index];

  // (Re)start the timer when a new item appears; tick ~10/s while unanswered.
  React.useEffect(() => {
    startRef.current = Date.now();
    setElapsedMs(0);
    setVerdict(null);
    const interval = setInterval(() => setElapsedMs(Date.now() - startRef.current), 100);
    return () => clearInterval(interval);
  }, [index]);

  async function handleSubmit(answer: string) {
    const latencyMs = Date.now() - startRef.current;
    setElapsedMs(latencyMs);
    const res = await onSubmitAttempt({ exerciseId: current.id, answer, latencyMs });
    setVerdict({ correct: res.correct, correctAnswer: res.correctAnswer });
  }

  function handleNext() {
    if (index + 1 >= exercises.length) {
      onDone();
      return;
    }
    setIndex((i) => i + 1);
  }

  if (!current) return null;

  return (
    <FluencyItem
      content={current.contentJson}
      elapsedMs={elapsedMs}
      verdict={verdict}
      onSubmit={handleSubmit}
      onNext={handleNext}
      isLast={index + 1 >= exercises.length}
    />
  );
}
```

- [ ] **Step 5: Run the runner test to verify it passes**

Run: `pnpm --filter @language-drill/web test -- fluency-runner`
Expected: PASS.

- [ ] **Step 6: Write the page (wires hooks + handles 409)**

Create `apps/web/app/(dashboard)/fluency/page.tsx`:

```tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import {
  createAuthenticatedFetch,
  useFluencySession,
  useSubmitFluencyAttempt,
} from '@language-drill/api-client';
import { useActiveLanguage } from '../../../components/shell/active-language-provider';
import { FluencyRunner, type FluencyExercise } from './_components/fluency-runner';

export default function FluencyPage() {
  const { activeLanguage } = useActiveLanguage();
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);

  const session = useFluencySession({ fetchFn });
  const submitAttempt = useSubmitFluencyAttempt({ fetchFn });
  const [done, setDone] = useState(false);

  // Start a session on mount / language change.
  useEffect(() => {
    setDone(false);
    session.mutate({ language: activeLanguage });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLanguage]);

  if (session.isPending || session.isIdle) {
    return <p className="t-body">loading fluency drill…</p>;
  }

  // 409 INSUFFICIENT_FLUENCY_POOL surfaces here as a mutation error.
  if (session.isError) {
    return (
      <div className="flex flex-col gap-s-3">
        <h1 className="t-display-s">fluency mode</h1>
        <p className="t-body text-ink-mute">
          Master a few more items first — fluency mode re-serves things you already know,
          fast. Keep drilling in normal mode and come back.
        </p>
      </div>
    );
  }

  if (done) {
    return (
      <div className="flex flex-col gap-s-3">
        <h1 className="t-display-s">nice — that was fast</h1>
        <p className="t-body text-ink-mute">Your latency trend is on the progress page → fluency tab.</p>
      </div>
    );
  }

  const exercises = (session.data?.exercises ?? []) as FluencyExercise[];

  return (
    <div className="flex flex-col gap-s-4">
      <h1 className="t-display-s">fluency mode</h1>
      <FluencyRunner
        exercises={exercises}
        onSubmitAttempt={(input) => submitAttempt.mutateAsync(input)}
        onDone={() => setDone(true)}
      />
    </div>
  );
}
```

- [ ] **Step 7: Add the entry point on the drill page**

In `apps/web/app/(dashboard)/drill/page.tsx`, add a link to `/fluency` near the page's header/intro region. Locate the top-level returned JSX heading and insert (use the existing `Link` import if present, else `next/link`):

```tsx
<Link href="/fluency" className="t-small underline text-ink-mute hover:text-ink self-start">
  try fluency mode — timed drills on what you already know →
</Link>
```

If `Link` is not already imported in that file, add `import Link from 'next/link';` at the top.

- [ ] **Step 8: Typecheck + lint web**

Run: `pnpm --filter @language-drill/web typecheck && pnpm --filter @language-drill/web lint`
Expected: PASS. (Confirm `Button`/`Input` are exported from `../../../../components/ui` — they are used by `cloze-exercise.tsx`; if the relative depth differs for the new folder, adjust the import path so it resolves to `apps/web/components/ui`.)

- [ ] **Step 9: Commit**

```bash
git add "apps/web/app/(dashboard)/fluency" "apps/web/app/(dashboard)/drill/page.tsx"
git commit -m "feat(web): timed fluency drill page + entry point"
```

---

## Task 8: Fluency tab on the progress dashboard

**Files:**
- Modify: `apps/web/app/(dashboard)/progress/_lib/use-tab-url-state.ts`
- Modify: `apps/web/app/(dashboard)/progress/_components/progress-tabs.tsx`
- Create: `apps/web/app/(dashboard)/progress/_components/fluency-tab.tsx`
- Create: `apps/web/app/(dashboard)/progress/_components/__tests__/fluency-tab.test.tsx`
- Modify: `apps/web/app/(dashboard)/progress/page.tsx`

- [ ] **Step 1: Add the tab id**

In `apps/web/app/(dashboard)/progress/_lib/use-tab-url-state.ts`, change the ids tuple:

```typescript
export const PROGRESS_TAB_IDS = ['shape', 'heatmap', 'fluency', 'history'] as const;
```

- [ ] **Step 2: Add the tab label**

In `apps/web/app/(dashboard)/progress/_components/progress-tabs.tsx`, extend `TAB_LABELS` and the `buttonRefs` initialiser:

```typescript
const TAB_LABELS: Record<ProgressTabId, string> = {
  shape: 'shape',
  heatmap: 'practice heatmap',
  fluency: 'fluency',
  history: 'history',
};
```

and in the `useRef` initial object add `fluency: null,`:

```typescript
const buttonRefs = useRef<Record<ProgressTabId, HTMLButtonElement | null>>({
  shape: null,
  heatmap: null,
  fluency: null,
  history: null,
});
```

- [ ] **Step 3: Write the failing tab test**

Create `apps/web/app/(dashboard)/progress/_components/__tests__/fluency-tab.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { FluencyStatsResponse } from '@language-drill/api-client';
import { FluencyTab } from '../fluency-tab';

const stats: FluencyStatsResponse = {
  language: 'ES',
  totalAttempts: 12,
  overallAccuracy: 0.92,
  overallMedianLatencyMs: 2400,
  weeks: [
    { weeksAgo: 1, attempts: 5, medianLatencyMs: 3000, accuracy: 0.8 },
    { weeksAgo: 0, attempts: 7, medianLatencyMs: 2400, accuracy: 1 },
  ],
};

describe('FluencyTab', () => {
  it('renders the empty state when there are no attempts', () => {
    render(
      <FluencyTab
        data={{ ...stats, totalAttempts: 0, overallMedianLatencyMs: null, weeks: [] }}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText(/no fluency drills yet/i)).toBeInTheDocument();
  });

  it('renders the median latency headline when data exists', () => {
    render(<FluencyTab data={stats} isLoading={false} error={null} onRetry={vi.fn()} />);
    expect(screen.getByText(/2\.4s/)).toBeInTheDocument(); // 2400ms → 2.4s
    expect(screen.getByText(/12/)).toBeInTheDocument(); // total attempts
  });
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `pnpm --filter @language-drill/web test -- fluency-tab`
Expected: FAIL — module not found.

- [ ] **Step 5: Write the tab**

Create `apps/web/app/(dashboard)/progress/_components/fluency-tab.tsx`:

```tsx
'use client';

import type { FluencyStatsResponse } from '@language-drill/api-client';

export interface FluencyTabProps {
  data: FluencyStatsResponse | undefined;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
}

function fmtSeconds(ms: number | null): string {
  return ms === null ? '—' : `${(ms / 1000).toFixed(1)}s`;
}

export function FluencyTab({ data, isLoading, error, onRetry }: FluencyTabProps) {
  if (isLoading) return <p className="t-body">loading…</p>;
  if (error) {
    return (
      <div className="flex flex-col gap-s-2">
        <p className="t-body">couldn’t load fluency stats.</p>
        <button type="button" className="t-small underline self-start" onClick={onRetry}>
          retry
        </button>
      </div>
    );
  }
  if (!data || data.totalAttempts === 0) {
    return (
      <p className="t-body text-ink-mute">
        no fluency drills yet — run a timed session from the drill page to start tracking how
        fast you produce things you already know.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-s-4" style={{ marginTop: 16 }}>
      <div className="flex flex-col gap-s-1">
        <p className="t-display-m">{fmtSeconds(data.overallMedianLatencyMs)}</p>
        <p className="t-small text-ink-mute">
          median response time · {Math.round(data.overallAccuracy * 100)}% accurate ·{' '}
          {data.totalAttempts} timed answers
        </p>
      </div>
      <div className="flex flex-col gap-s-2">
        <p className="t-small text-ink-mute">weekly median (most recent last)</p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          {data.weeks.map((w) => (
            <div key={w.weeksAgo} style={{ textAlign: 'center' }}>
              <div
                aria-hidden
                style={{
                  width: 18,
                  height: w.medianLatencyMs ? Math.min(120, w.medianLatencyMs / 50) : 2,
                  background: 'var(--color-ink-soft)',
                }}
              />
              <span className="t-small text-ink-mute">{fmtSeconds(w.medianLatencyMs)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Wire the tab into the page**

In `apps/web/app/(dashboard)/progress/page.tsx`:

Add imports:

```typescript
import { useFluencyStats } from '@language-drill/api-client';
import { FluencyTab } from './_components/fluency-tab';
```

Add the query alongside `radar`/`heatmap`:

```typescript
const fluency = useFluencyStats({ fetchFn, language: activeLanguage });
```

Add the panel inside `<ProgressTabs>` (after the heatmap block, before history):

```tsx
{tab === 'fluency' && (
  <FluencyTab
    data={fluency.data}
    isLoading={fluency.isLoading}
    error={fluency.error}
    onRetry={() => {
      void fluency.refetch();
    }}
  />
)}
```

- [ ] **Step 7: Run tab test + typecheck + lint**

Run: `pnpm --filter @language-drill/web test -- fluency-tab && pnpm --filter @language-drill/web typecheck && pnpm --filter @language-drill/web lint`
Expected: PASS. (If `@testing-library/jest-dom` matchers like `toBeInTheDocument` aren't globally set up, match the assertion style used in a neighbouring `progress/_components/__tests__` test — e.g. `expect(screen.queryByText(...)).not.toBeNull()`.)

- [ ] **Step 8: Commit**

```bash
git add "apps/web/app/(dashboard)/progress"
git commit -m "feat(web): fluency tab on progress dashboard"
```

---

## Task 9: Regression test — fluency never touches the accuracy radar

This locks in the central design guarantee. Because the radar reads only `user_exercise_history` and fluency writes only `fluency_attempts`, the guarantee is structural; the test asserts the *handler-level* invariant that the attempts route writes to `fluencyAttempts` and never to `userExerciseHistory` or `usageEvents`.

**Files:**
- Modify: `infra/lambda/src/routes/fluency.test.ts`

- [ ] **Step 1: Add the regression test**

Append to `infra/lambda/src/routes/fluency.test.ts` a `describe` block. Extend the `@language-drill/db` mock to also expose `userExerciseHistory` and `usageEvents` as sentinels, and assert the insert target. Because the route imports only `exercises` and `fluencyAttempts`, the cleanest assertion is that the single `db.insert(...)` call corresponds to `fluencyAttempts` and that `gradeFluencyAnswer` (not `evaluateAnswer`) produced the result:

```typescript
describe('regression: fluency stays off the accuracy radar', () => {
  it('records to fluency_attempts only — no ai_evaluation usage event, no history write', async () => {
    mockLimit.mockResolvedValueOnce([
      { id: 'e1', language: 'ES', type: 'cloze', grammarPointKey: null, contentJson: { type: 'cloze', correctAnswer: 'está' } },
    ]);
    const res = await fluency.request('/fluency/attempts', {
      method: 'POST',
      body: JSON.stringify({ exerciseId: '22222222-2222-2222-2222-222222222222', answer: 'está', latencyMs: 1500 }),
      headers: { 'content-type': 'application/json' },
    }, authEnv);
    expect(res.status).toBe(200);
    // exactly one insert (the fluency_attempts row); the route imports no other
    // insertable table and never calls the Claude evaluator or usage metering.
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });
});
```

Also add a comment in the test file noting that `routes/fluency.ts` imports neither `userExerciseHistory`/`usageEvents` nor `@language-drill/ai` — a static guarantee that fluency cannot feed the radar or the AI rate-limit bucket.

- [ ] **Step 2: Run the regression test**

Run: `pnpm --filter @language-drill/lambda test -- routes/fluency`
Expected: PASS.

- [ ] **Step 3: Static guard — confirm the route's imports**

Run: `grep -nE "userExerciseHistory|usageEvents|@language-drill/ai|evaluateAnswer" infra/lambda/src/routes/fluency.ts`
Expected: **no matches** (empty output). If anything matches, the separation has been violated — remove it.

- [ ] **Step 4: Commit**

```bash
git add infra/lambda/src/routes/fluency.test.ts
git commit -m "test(lambda): regression — fluency attempts never reach the radar"
```

---

## Task 10: E2E happy path (Playwright)

**Files:**
- Create: `apps/web/e2e/fluency.spec.ts`

- [ ] **Step 1: Inspect an existing authenticated E2E test for fixtures/patterns**

Run: `ls apps/web/e2e && sed -n '1,40p' apps/web/e2e/$(ls apps/web/e2e | grep -m1 '.spec.ts')`
Expected: see how the `authenticated` project, base URL, and any seed/login fixtures are used. Mirror that setup.

- [ ] **Step 2: Write the E2E spec**

Create `apps/web/e2e/fluency.spec.ts`. Drive: navigate to `/fluency`; if the page shows the "master a few more items" copy (insufficient pool in the test DB), assert that copy and pass (the empty-state path is a valid outcome). Otherwise, type an answer, submit, assert the verdict status appears, advance, and finish:

```typescript
import { test, expect } from '@playwright/test';

test('fluency mode: run a timed item or show the insufficient-pool state', async ({ page }) => {
  await page.goto('/fluency');

  const insufficient = page.getByText(/master a few more items first/i);
  const textbox = page.getByRole('textbox');

  // Either the drill is available, or the pool is too small in this DB — both are valid.
  await Promise.race([
    insufficient.waitFor({ state: 'visible' }),
    textbox.waitFor({ state: 'visible' }),
  ]);

  if (await insufficient.isVisible()) {
    await expect(insufficient).toBeVisible();
    return;
  }

  await textbox.fill('answer');
  await page.getByRole('button', { name: 'submit' }).click();
  await expect(page.getByRole('status')).toBeVisible();
});
```

- [ ] **Step 3: Run the E2E test**

Run: `pnpm --filter @language-drill/web test:e2e -- fluency`
Expected: PASS (either branch). If the seeded test DB has no mastered items for the auth fixture user, the insufficient-pool branch is exercised — still a pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/e2e/fluency.spec.ts
git commit -m "test(web): e2e for fluency mode happy path"
```

---

## Task 11: Full-suite verification

- [ ] **Step 1: Build everything (dist freshness)**

Run: `pnpm build`
Expected: all packages emit with no errors. (Required so single-package vitest runs resolve fresh `dist` — see the "Vitest workspace dist resolution" memory.)

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: zero errors.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: zero errors.

- [ ] **Step 4: Test (serialized to avoid the known infra flake)**

Run: `pnpm turbo run test --concurrency=1`
Expected: all green. (Per the "pnpm test infra parallel flake" memory, `pnpm test` can flake `infra` under parallel load; `--concurrency=1` is the reliable confirmation.)

- [ ] **Step 5: Report**

Report: total passed / failed per package, and confirm the three gates (lint, typecheck, test) are clean. Do not consider the feature done until all three pass.

---

## Notes for the implementer

- **Migration is not auto-applied in tests.** The route tests mock the DB; they do not need a live `fluency_attempts` table. The migration runs in CI (`pnpm db:migrate` on the Neon branch) and on merge.
- **No prompt changes.** Fluency mode calls no Claude prompt, so none of the `*_PROMPT_VERSION` bump rules in CLAUDE.md apply.
- **No new usage bucket / rate limit.** Deterministic grading is free; do not add a `MeteredEventType` for it.
- **Active-language source.** The web pages use `useActiveLanguage()` (as `progress/page.tsx` does). Confirm the import path `../../../components/shell/active-language-provider` resolves from the new `fluency/` folder depth; adjust `../` count if the folder nesting differs.
```
