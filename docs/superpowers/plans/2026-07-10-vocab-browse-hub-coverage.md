# Vocab Browse Hub + Coverage Read Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the curated ES A1 vocabulary (Plan 1's `vocab_target` rows) as a browsable `/vocab` hub — topics → words with per-word coverage state and a "drill this topic" launcher.

**Architecture:** A read-only Hono API (`/vocab/topics`, `/vocab/topics/:umbrellaKey`) computes per-word coverage by joining `vocab_target` → `exercises` (on `expectedWord`) → `user_exercise_history`, deriving a 3-state (`not-yet` / `untested` / `practiced`) with no new mastery table. The web hub mirrors the existing Theory hub (`/theory`) — client component, TanStack Query hook, grouped list, detail page with a word grid (gloss hidden until tap) and a "drill this topic" button that reuses the existing `/drill?grammarPoint=…&exerciseType=vocab_recall` flow verbatim.

**Tech Stack:** TypeScript, Hono + Drizzle (Lambda API), Zod + TanStack Query (api-client), Next.js App Router + React (web), Vitest, Playwright.

## Global Constraints

- **Coverage is derived, not stored.** No new mastery table; states come from `user_exercise_history` × `exercises.content_json->>'expectedWord'`. Never render an "X/Y done" counter — coverage is a colored word grid (the sanctioned mastery-map pattern), not a completion count. Meanings (`gloss`) are hidden by default, revealed on tap.
- **Drill launch reuses the existing flow verbatim:** `href="/drill?start=quick&grammarPoint=<umbrellaKey>&exerciseType=vocab_recall"`. No new session API param.
- **ES A1 scope only.** Only `status='approved'` `vocab_target` rows are surfaced (flagged rows are pending review).
- **Approved-exercise filter:** reuse `approvedStatusFilter` (`inArray(reviewStatus, ['auto-approved','manual-approved'])`) from `infra/lambda/src/lib/exercise-filters.ts` when joining `exercises`.
- **New routers mount in BOTH `infra/lambda/src/index.ts` and `infra/lambda/src/dev.ts`** or they're unreachable in local dev.
- **api-client:** new Zod schema file + hook file, each re-exported from `packages/api-client/src/index.ts` (schema block + hook line).
- Rebuild before single-package vitest where a compiled dep is involved (`db`/`shared`). The real gate is `pnpm turbo run test --concurrency=1`.
- **Branch:** `feat/vocab-coverage-hub-p2` (already created in the worktree, stacked on Plan 1). Work from the worktree `/Users/seal/dev/language-drill/.claude/worktrees/feat+vocab-coverage-hub`. Assert the branch before every commit. Do NOT stage `.env` or `.claude/**`.

---

### Task 1: coverage state derivation (pure) + tests

**Files:**
- Create: `infra/lambda/src/lib/vocab-coverage.ts`
- Test: `infra/lambda/src/lib/vocab-coverage.test.ts`

**Interfaces:**
- Produces:
  - `type CoverageState = 'not-yet' | 'untested' | 'practiced-weak' | 'practiced-strong'`
  - `type ExerciseWordStat = { attempts: number; bestScore: number | null }` — per-`expectedWord` rollup from the DB (null bestScore = exercise exists but never practiced).
  - `deriveWordCoverage(stat: ExerciseWordStat | undefined): CoverageState` — `undefined` (no exercise exists) → `not-yet`; `attempts === 0` → `untested`; `attempts > 0 && bestScore >= 0.7` → `practiced-strong`; else `practiced-weak`.
  - `normalizeWord(s: string): string` — `s.trim().toLowerCase()`, and for a multi-token display form drop a leading article token (`la manzana` → `manzana`). Used to match `vocab_target.displayForm`/`lemma` against `exercises.expectedWord`.
  - `pickWordStat(target: {displayForm: string; lemma: string}, byWord: Map<string, ExerciseWordStat>): ExerciseWordStat | undefined` — look up by normalized lemma first, then normalized displayForm.
  - `summarizeCoverage(states: CoverageState[]): { total: number; practiced: number; available: number }` — `available` = states that are not `not-yet`; `practiced` = strong+weak. (Used for a topic-card tint, NOT a user-facing counter.)

- [ ] **Step 1: Write the failing test**

Create `infra/lambda/src/lib/vocab-coverage.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  deriveWordCoverage,
  normalizeWord,
  pickWordStat,
  summarizeCoverage,
  type ExerciseWordStat,
} from './vocab-coverage';

describe('deriveWordCoverage', () => {
  it('maps stat presence + score to a state', () => {
    expect(deriveWordCoverage(undefined)).toBe('not-yet');
    expect(deriveWordCoverage({ attempts: 0, bestScore: null })).toBe('untested');
    expect(deriveWordCoverage({ attempts: 3, bestScore: 0.9 })).toBe('practiced-strong');
    expect(deriveWordCoverage({ attempts: 2, bestScore: 0.5 })).toBe('practiced-weak');
    expect(deriveWordCoverage({ attempts: 1, bestScore: 0.7 })).toBe('practiced-strong');
  });
});

describe('normalizeWord', () => {
  it('lowercases, trims, and drops a leading article', () => {
    expect(normalizeWord('  La Manzana ')).toBe('manzana');
    expect(normalizeWord('el pan')).toBe('pan');
    expect(normalizeWord('comer')).toBe('comer');
  });
});

describe('pickWordStat', () => {
  it('matches by lemma, then displayForm', () => {
    const byWord = new Map<string, ExerciseWordStat>([
      ['manzana', { attempts: 1, bestScore: 0.8 }],
    ]);
    expect(pickWordStat({ displayForm: 'la manzana', lemma: 'manzana' }, byWord)).toEqual({
      attempts: 1,
      bestScore: 0.8,
    });
    expect(pickWordStat({ displayForm: 'el pan', lemma: 'pan' }, byWord)).toBeUndefined();
  });
});

describe('summarizeCoverage', () => {
  it('counts available and practiced', () => {
    expect(
      summarizeCoverage(['not-yet', 'untested', 'practiced-weak', 'practiced-strong']),
    ).toEqual({ total: 4, available: 3, practiced: 2 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/lambda test -- vocab-coverage`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `infra/lambda/src/lib/vocab-coverage.ts`:

```ts
/**
 * Pure coverage-state derivation for the vocab browse hub. Coverage is derived
 * from existing history (no per-word mastery table): a curated vocab_target word
 * is `not-yet` if no approved exercise tests it, `untested` if one exists but the
 * user never answered it, and `practiced-*` once answered (strong vs weak by best
 * score). See docs/superpowers/specs/2026-07-09-vocab-coverage-hub-design.md.
 */

export type CoverageState =
  | 'not-yet'
  | 'untested'
  | 'practiced-weak'
  | 'practiced-strong';

export type ExerciseWordStat = { attempts: number; bestScore: number | null };

const STRONG_SCORE = 0.7;

export function deriveWordCoverage(stat: ExerciseWordStat | undefined): CoverageState {
  if (stat === undefined) return 'not-yet';
  if (stat.attempts === 0) return 'untested';
  if (stat.bestScore !== null && stat.bestScore >= STRONG_SCORE) return 'practiced-strong';
  return 'practiced-weak';
}

const ARTICLES = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas']);

export function normalizeWord(s: string): string {
  const lowered = s.trim().toLowerCase();
  const tokens = lowered.split(/\s+/);
  if (tokens.length > 1 && ARTICLES.has(tokens[0])) return tokens.slice(1).join(' ');
  return lowered;
}

export function pickWordStat(
  target: { displayForm: string; lemma: string },
  byWord: Map<string, ExerciseWordStat>,
): ExerciseWordStat | undefined {
  return byWord.get(normalizeWord(target.lemma)) ?? byWord.get(normalizeWord(target.displayForm));
}

export function summarizeCoverage(states: readonly CoverageState[]): {
  total: number;
  available: number;
  practiced: number;
} {
  let available = 0;
  let practiced = 0;
  for (const s of states) {
    if (s !== 'not-yet') available += 1;
    if (s === 'practiced-weak' || s === 'practiced-strong') practiced += 1;
  }
  return { total: states.length, available, practiced };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @language-drill/lambda test -- vocab-coverage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /Users/seal/dev/language-drill/.claude/worktrees/feat+vocab-coverage-hub branch --show-current  # feat/vocab-coverage-hub-p2
git add infra/lambda/src/lib/vocab-coverage.ts infra/lambda/src/lib/vocab-coverage.test.ts
git commit -m "feat(vocab): coverage-state derivation helpers"
```

---

### Task 2: `/vocab` routes (topics list + topic detail) + mount

**Files:**
- Create: `infra/lambda/src/routes/vocab.ts`
- Modify: `infra/lambda/src/index.ts` (mount `app.route('/', vocab)` beside `progress`)
- Modify: `infra/lambda/src/dev.ts` (mount `vocab` beside `progress`)
- Test: `infra/lambda/src/routes/vocab.test.ts`

**Interfaces:**
- Consumes: `deriveWordCoverage`, `pickWordStat`, `summarizeCoverage`, `normalizeWord`, `ExerciseWordStat`, `CoverageState` (Task 1); `vocabTarget`, `exercises`, `userExerciseHistory`, `getGrammarPoint`, `grammarPointsAtOrBelow` (or the curriculum list) from `@language-drill/db`; `approvedStatusFilter` from `../lib/exercise-filters`; `db` from `../db`; `authMiddleware`, `Bindings`, `Variables` from `../middleware/auth`.
- Produces two endpoints (see response shapes below). Router `export default vocab`.

`GET /vocab/topics?language=ES` → `{ topics: Array<{ umbrellaKey: string; name: string; cefrLevel: string; wordCount: number; available: number; practiced: number }> }` — one entry per ES vocab umbrella that has ≥1 approved `vocab_target` row, ordered by curriculum order.

`GET /vocab/topics/:umbrellaKey` → `{ umbrellaKey, name, cefrLevel, words: Array<{ lemma, displayForm, gloss, exampleSentence, freqRank: number|null, tier, state: CoverageState }> }` — words ordered by `freqRank` asc (nulls last). 404 `{ error, code: 'NOT_FOUND' }` if the key is not a `kind:'vocab'` grammar point.

- [ ] **Step 1: Write the failing test**

Create `infra/lambda/src/routes/vocab.test.ts`. Mock `../db` and the auth middleware the same way `progress.test.ts` does (read `infra/lambda/src/routes/progress.test.ts` for the exact `vi.mock('../db', …)` + test-app harness pattern, and mirror it). Assert:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
// Mirror progress.test.ts harness: mock '../db' with a chainable query builder,
// mount `vocab` on a fresh Hono app with a middleware that sets userId.

// Test 1: GET /vocab/topics/:key returns words with derived state
//   - vocab_target query returns two approved words (manzana rank 800 core, pan rank 300 core)
//   - exercises+history rollup returns manzana:{attempts:2,bestScore:0.9}, pan:{attempts:0,bestScore:null}
//   - expect words[0]=pan (rank 300 first), pan.state='untested', manzana.state='practiced-strong'
// Test 2: unknown key -> 404 NOT_FOUND
// Test 3: GET /vocab/topics -> only umbrellas with approved rows, with wordCount/available/practiced
```

(Write concrete assertions against the mocked rows; the mock shapes must match the queries in Step 3. Keep the mock query-queue order identical to the handler's call order — see the `admin.test.ts` execute-vs-select ordering hazard if you add `db.execute`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/lambda test -- routes/vocab`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the router**

Create `infra/lambda/src/routes/vocab.ts`:

```ts
/**
 * Read-only vocab browse hub API. Surfaces curated ES A1 vocab_target rows as
 * topics -> words with derived per-word coverage state (see ../lib/vocab-coverage).
 * Coverage joins vocab_target -> exercises (on expectedWord) -> user_exercise_history.
 */

import { Hono } from 'hono';
import { and, asc, eq, sql } from 'drizzle-orm';
import {
  exercises,
  userExerciseHistory,
  vocabTarget,
  getGrammarPoint,
  curriculumOrderOf,
} from '@language-drill/db';
import type { LearningLanguage } from '@language-drill/shared';

import { db } from '../db';
import { approvedStatusFilter } from '../lib/exercise-filters';
import { authMiddleware } from '../middleware/auth';
import type { Bindings, Variables } from '../middleware/auth';
import {
  deriveWordCoverage,
  normalizeWord,
  pickWordStat,
  summarizeCoverage,
  type CoverageState,
  type ExerciseWordStat,
} from '../lib/vocab-coverage';

const vocab = new Hono<{ Bindings: Bindings; Variables: Variables }>();
vocab.use('/vocab/*', authMiddleware);

/** expectedWord -> {attempts, bestScore} for one (user, language, umbrella). */
async function loadWordStats(
  userId: string,
  language: string,
  umbrellaKey: string,
): Promise<Map<string, ExerciseWordStat>> {
  const rows = await db
    .select({
      word: sql<string>`(${exercises.contentJson} ->> 'expectedWord')`,
      attempts: sql<number>`count(${userExerciseHistory.id})::int`,
      bestScore: sql<number | null>`max(${userExerciseHistory.score})`,
    })
    .from(exercises)
    .leftJoin(
      userExerciseHistory,
      and(
        eq(userExerciseHistory.exerciseId, exercises.id),
        eq(userExerciseHistory.userId, userId),
      ),
    )
    .where(
      and(
        eq(exercises.language, language),
        eq(exercises.grammarPointKey, umbrellaKey),
        approvedStatusFilter(exercises),
        sql`(${exercises.contentJson} ->> 'expectedWord') IS NOT NULL`,
      ),
    )
    .groupBy(sql`(${exercises.contentJson} ->> 'expectedWord')`);

  const byWord = new Map<string, ExerciseWordStat>();
  for (const r of rows) {
    if (r.word == null) continue;
    byWord.set(normalizeWord(r.word), { attempts: r.attempts, bestScore: r.bestScore });
  }
  return byWord;
}

vocab.get('/vocab/topics/:umbrellaKey', async (c) => {
  const umbrellaKey = c.req.param('umbrellaKey');
  const point = getGrammarPoint(umbrellaKey);
  if (!point || point.kind !== 'vocab') {
    return c.json({ error: 'Unknown vocab topic', code: 'NOT_FOUND' }, 404);
  }
  const userId = c.get('userId');

  const [targets, byWord] = await Promise.all([
    db
      .select({
        lemma: vocabTarget.lemma,
        displayForm: vocabTarget.displayForm,
        gloss: vocabTarget.gloss,
        exampleSentence: vocabTarget.exampleSentence,
        freqRank: vocabTarget.freqRank,
        tier: vocabTarget.tier,
      })
      .from(vocabTarget)
      .where(
        and(
          eq(vocabTarget.language, point.language),
          eq(vocabTarget.umbrellaKey, umbrellaKey),
          eq(vocabTarget.status, 'approved'),
        ),
      )
      .orderBy(asc(vocabTarget.freqRank)),
    loadWordStats(userId, point.language, umbrellaKey),
  ]);

  const words = targets.map((t) => ({
    ...t,
    state: deriveWordCoverage(pickWordStat(t, byWord)) satisfies CoverageState,
  }));

  return c.json({
    umbrellaKey,
    name: point.name,
    cefrLevel: point.cefrLevel,
    words,
  });
});

vocab.get('/vocab/topics', async (c) => {
  const language = (c.req.query('language') ?? 'ES') as LearningLanguage;
  const userId = c.get('userId');

  // Approved targets grouped by umbrella (one query), then per-topic coverage.
  const targets = await db
    .select({
      umbrellaKey: vocabTarget.umbrellaKey,
      lemma: vocabTarget.lemma,
      displayForm: vocabTarget.displayForm,
    })
    .from(vocabTarget)
    .where(and(eq(vocabTarget.language, language), eq(vocabTarget.status, 'approved')));

  const byUmbrella = new Map<string, Array<{ lemma: string; displayForm: string }>>();
  for (const t of targets) {
    const arr = byUmbrella.get(t.umbrellaKey) ?? [];
    arr.push({ lemma: t.lemma, displayForm: t.displayForm });
    byUmbrella.set(t.umbrellaKey, arr);
  }

  const topics = [];
  for (const [umbrellaKey, rows] of byUmbrella) {
    const point = getGrammarPoint(umbrellaKey);
    if (!point || point.kind !== 'vocab') continue;
    const byWord = await loadWordStats(userId, language, umbrellaKey);
    const states = rows.map((r) => deriveWordCoverage(pickWordStat(r, byWord)));
    const { total, available, practiced } = summarizeCoverage(states);
    topics.push({
      umbrellaKey,
      name: point.name,
      cefrLevel: point.cefrLevel,
      order: curriculumOrderOf(umbrellaKey) ?? Number.MAX_SAFE_INTEGER,
      wordCount: total,
      available,
      practiced,
    });
  }

  topics.sort((a, b) => a.order - b.order);
  return c.json({ topics: topics.map(({ order: _o, ...rest }) => rest) });
});

export default vocab;
```

> Verify `curriculumOrderOf` is exported from `@language-drill/db` (it's imported by `progress.ts`). If its name differs, use the same helper `progress.ts` uses for curriculum ordering. If `contentJson` is not the Drizzle column name, use the actual export from `exercises` schema (`content_json`).

- [ ] **Step 4: Mount the router**

In `infra/lambda/src/index.ts`, beside `app.route('/', progress);`, add `app.route('/', vocab);` (import `vocab from './routes/vocab'`). Do the same in `infra/lambda/src/dev.ts`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @language-drill/lambda test -- routes/vocab`
Expected: PASS (all three tests). Also `pnpm --filter @language-drill/lambda typecheck`.

- [ ] **Step 6: Commit**

```bash
git -C /Users/seal/dev/language-drill/.claude/worktrees/feat+vocab-coverage-hub branch --show-current
git add infra/lambda/src/routes/vocab.ts infra/lambda/src/routes/vocab.test.ts infra/lambda/src/index.ts infra/lambda/src/dev.ts
git commit -m "feat(vocab): /vocab topics + topic-detail coverage API"
```

---

### Task 3: api-client schemas + hooks

**Files:**
- Create: `packages/api-client/src/schemas/vocab.ts`
- Create: `packages/api-client/src/hooks/useVocabTopics.ts`
- Create: `packages/api-client/src/hooks/useVocabTopicDetail.ts`
- Modify: `packages/api-client/src/index.ts` (re-export schema block + two hook lines)
- Test: `packages/api-client/src/schemas/vocab.test.ts`

**Interfaces:**
- Produces:
  - `CoverageStateSchema = z.enum(['not-yet','untested','practiced-weak','practiced-strong'])`
  - `VocabTopicSummarySchema`, `VocabTopicsResponseSchema = z.object({ topics: z.array(VocabTopicSummarySchema) })`
  - `VocabWordSchema`, `VocabTopicDetailSchema`
  - inferred types `VocabTopicSummary`, `VocabTopicsResponse`, `VocabWord`, `VocabTopicDetail`, `CoverageState`
  - `useVocabTopics({ language, fetchFn }): UseQueryResult<VocabTopicsResponse, Error>` — key `['vocab','topics',language]`, URL `/vocab/topics?language=${language}`, `enabled: fetchFn !== undefined`.
  - `useVocabTopicDetail({ umbrellaKey, fetchFn }): UseQueryResult<VocabTopicDetail, Error>` — key `['vocab','topic',umbrellaKey]`, URL `/vocab/topics/${encodeURIComponent(umbrellaKey)}`, `enabled: fetchFn !== undefined && umbrellaKey.length > 0`.

- [ ] **Step 1: Write the failing test**

Create `packages/api-client/src/schemas/vocab.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  VocabTopicsResponseSchema,
  VocabTopicDetailSchema,
} from './vocab';

describe('vocab schemas', () => {
  it('parses a topics response', () => {
    const parsed = VocabTopicsResponseSchema.parse({
      topics: [
        { umbrellaKey: 'es-a1-vocab-food-drink', name: 'Food and drink (A1)', cefrLevel: 'A1', wordCount: 30, available: 12, practiced: 5 },
      ],
    });
    expect(parsed.topics[0].umbrellaKey).toBe('es-a1-vocab-food-drink');
  });

  it('parses a topic detail with word states', () => {
    const parsed = VocabTopicDetailSchema.parse({
      umbrellaKey: 'es-a1-vocab-food-drink',
      name: 'Food and drink (A1)',
      cefrLevel: 'A1',
      words: [
        { lemma: 'pan', displayForm: 'el pan', gloss: 'bread', exampleSentence: 'Compro pan.', freqRank: 300, tier: 'core', state: 'untested' },
        { lemma: 'zumo', displayForm: 'el zumo', gloss: 'juice', exampleSentence: 'Bebo zumo.', freqRank: null, tier: 'extended', state: 'not-yet' },
      ],
    });
    expect(parsed.words[1].freqRank).toBeNull();
    expect(parsed.words[0].state).toBe('untested');
  });

  it('rejects an invalid coverage state', () => {
    expect(() =>
      VocabTopicDetailSchema.parse({
        umbrellaKey: 'x', name: 'x', cefrLevel: 'A1',
        words: [{ lemma: 'a', displayForm: 'a', gloss: 'a', exampleSentence: 'a', freqRank: 1, tier: 'core', state: 'bogus' }],
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/api-client test -- schemas/vocab`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the schemas**

Create `packages/api-client/src/schemas/vocab.ts`:

```ts
import { z } from 'zod';

export const CoverageStateSchema = z.enum([
  'not-yet',
  'untested',
  'practiced-weak',
  'practiced-strong',
]);
export type CoverageState = z.infer<typeof CoverageStateSchema>;

export const VocabTopicSummarySchema = z.object({
  umbrellaKey: z.string(),
  name: z.string(),
  cefrLevel: z.string(),
  wordCount: z.number().int().min(0),
  available: z.number().int().min(0),
  practiced: z.number().int().min(0),
});
export type VocabTopicSummary = z.infer<typeof VocabTopicSummarySchema>;

export const VocabTopicsResponseSchema = z.object({
  topics: z.array(VocabTopicSummarySchema),
});
export type VocabTopicsResponse = z.infer<typeof VocabTopicsResponseSchema>;

export const VocabWordSchema = z.object({
  lemma: z.string(),
  displayForm: z.string(),
  gloss: z.string(),
  exampleSentence: z.string(),
  freqRank: z.number().int().nullable(),
  tier: z.string(),
  state: CoverageStateSchema,
});
export type VocabWord = z.infer<typeof VocabWordSchema>;

export const VocabTopicDetailSchema = z.object({
  umbrellaKey: z.string(),
  name: z.string(),
  cefrLevel: z.string(),
  words: z.array(VocabWordSchema),
});
export type VocabTopicDetail = z.infer<typeof VocabTopicDetailSchema>;
```

- [ ] **Step 4: Implement the hooks**

Create `packages/api-client/src/hooks/useVocabTopics.ts` (mirror `usePointDrillInfo.ts` exactly for imports/STALE_TIME):

```ts
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../fetchClient';
import {
  VocabTopicsResponseSchema,
  type VocabTopicsResponse,
} from '../schemas/vocab';

const STALE_TIME_MS = 5 * 60 * 1000;

export type UseVocabTopicsParams = {
  language: string;
  fetchFn?: AuthenticatedFetch;
};

export function useVocabTopics({
  language,
  fetchFn,
}: UseVocabTopicsParams): UseQueryResult<VocabTopicsResponse, Error> {
  return useQuery({
    queryKey: ['vocab', 'topics', language],
    queryFn: async () => {
      const response = await fetchFn!(`/vocab/topics?language=${encodeURIComponent(language)}`);
      const json: unknown = await response.json();
      return VocabTopicsResponseSchema.parse(json);
    },
    enabled: fetchFn !== undefined,
    staleTime: STALE_TIME_MS,
  });
}
```

Create `packages/api-client/src/hooks/useVocabTopicDetail.ts`:

```ts
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../fetchClient';
import {
  VocabTopicDetailSchema,
  type VocabTopicDetail,
} from '../schemas/vocab';

const STALE_TIME_MS = 5 * 60 * 1000;

export type UseVocabTopicDetailParams = {
  umbrellaKey: string;
  fetchFn?: AuthenticatedFetch;
};

export function useVocabTopicDetail({
  umbrellaKey,
  fetchFn,
}: UseVocabTopicDetailParams): UseQueryResult<VocabTopicDetail, Error> {
  return useQuery({
    queryKey: ['vocab', 'topic', umbrellaKey],
    queryFn: async () => {
      const response = await fetchFn!(`/vocab/topics/${encodeURIComponent(umbrellaKey)}`);
      const json: unknown = await response.json();
      return VocabTopicDetailSchema.parse(json);
    },
    enabled: fetchFn !== undefined && umbrellaKey.length > 0,
    staleTime: STALE_TIME_MS,
  });
}
```

- [ ] **Step 5: Re-export from the package index**

In `packages/api-client/src/index.ts`, add a schema re-export block (mirroring the theory block) and two hook lines:

```ts
export {
  CoverageStateSchema,
  VocabTopicSummarySchema,
  VocabTopicsResponseSchema,
  VocabWordSchema,
  VocabTopicDetailSchema,
  type CoverageState,
  type VocabTopicSummary,
  type VocabTopicsResponse,
  type VocabWord,
  type VocabTopicDetail,
} from './schemas/vocab';

export { useVocabTopics, type UseVocabTopicsParams } from './hooks/useVocabTopics';
export { useVocabTopicDetail, type UseVocabTopicDetailParams } from './hooks/useVocabTopicDetail';
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @language-drill/api-client test -- schemas/vocab` and `pnpm --filter @language-drill/api-client typecheck`
Expected: PASS + clean.

- [ ] **Step 7: Commit**

```bash
git -C /Users/seal/dev/language-drill/.claude/worktrees/feat+vocab-coverage-hub branch --show-current
git add packages/api-client/src/schemas/vocab.ts packages/api-client/src/schemas/vocab.test.ts packages/api-client/src/hooks/useVocabTopics.ts packages/api-client/src/hooks/useVocabTopicDetail.ts packages/api-client/src/index.ts
git commit -m "feat(vocab): api-client schemas + hooks for vocab hub"
```

---

### Task 4: navigation entry

**Files:**
- Modify: `apps/web/components/shell/nav-items.tsx` (add `/vocab` destination)
- Modify: `apps/web/components/shell/nav-icons.tsx` (add a `VocabIcon`)
- Test: `apps/web/components/shell/__tests__/nav-items.test.tsx` (extend)

**Interfaces:**
- Produces: a `NАV_DESTINATIONS` entry `{ href: '/vocab', label: 'vocab coverage', mobileLabel: 'coverage', icon: <VocabIcon /> }` placed after the `/theory` entry.

- [ ] **Step 1: Write the failing test**

In `apps/web/components/shell/__tests__/nav-items.test.tsx`, add (mirror the existing assertion style — read the file first for how it imports `NAV_DESTINATIONS`):

```ts
it('includes a distinct /vocab coverage destination', () => {
  const vocab = NAV_DESTINATIONS.find((d) => d.href === '/vocab');
  expect(vocab).toBeDefined();
  expect(vocab?.label).toBe('vocab coverage');
  // must not collide with the existing /review "my vocabulary" label
  expect(NAV_DESTINATIONS.filter((d) => d.label === 'my vocabulary').length).toBe(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/web test -- nav-items`
Expected: FAIL — no `/vocab` destination.

- [ ] **Step 3: Implement**

In `apps/web/components/shell/nav-icons.tsx`, add a `VocabIcon` following the existing icon component style (a simple inline `<svg>` — copy the shape/props of an existing icon like `TheoryIcon` and change the path; a grid/book-open glyph is fine). Export it.

In `apps/web/components/shell/nav-items.tsx`, import `VocabIcon` and add after the `/theory` entry:

```tsx
  { href: '/vocab', label: 'vocab coverage', mobileLabel: 'coverage', icon: <VocabIcon /> },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @language-drill/web test -- nav-items`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /Users/seal/dev/language-drill/.claude/worktrees/feat+vocab-coverage-hub branch --show-current
git add apps/web/components/shell/nav-items.tsx apps/web/components/shell/nav-icons.tsx apps/web/components/shell/__tests__/nav-items.test.tsx
git commit -m "feat(vocab): add /vocab to dashboard navigation"
```

---

### Task 5: `/vocab` topic-list page

**Files:**
- Create: `apps/web/app/(dashboard)/vocab/page.tsx`
- Create: `apps/web/app/(dashboard)/vocab/_components/vocab-topic-card.tsx`
- Create: `apps/web/app/(dashboard)/vocab/_components/vocab-list-states.tsx`
- Test: `apps/web/app/(dashboard)/vocab/page.test.tsx`

**Interfaces:**
- Consumes: `useVocabTopics` (Task 3); `useActiveLanguage`, `createAuthenticatedFetch`, `useAuth` (same imports as `theory/page.tsx`).
- Produces: a client page listing `VocabTopicSummary` cards, each linking to `/vocab/${umbrellaKey}`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/(dashboard)/vocab/page.test.tsx`, mirroring `theory/page.test.tsx`'s mock strategy (mock `@clerk/nextjs`, the active-language provider, `@language-drill/api-client` `createAuthenticatedFetch`, `next/link`, and the `useVocabTopics` hook). Assert the topic name renders and the card links to `/vocab/es-a1-vocab-food-drink`:

```tsx
// vi.mock('@language-drill/api-client', () => ({
//   createAuthenticatedFetch: vi.fn(() => vi.fn()),
//   useVocabTopics: vi.fn(),
// }));
// ...set useVocabTopics mock -> { data: { topics: [{ umbrellaKey:'es-a1-vocab-food-drink', name:'Food and drink (A1)', cefrLevel:'A1', wordCount:30, available:12, practiced:5 }] }, isLoading:false, isError:false }
it('renders topic cards linking to detail', () => {
  render(<VocabPage />);
  const link = screen.getByRole('link', { name: /food and drink/i });
  expect(link).toHaveAttribute('href', '/vocab/es-a1-vocab-food-drink');
});
it('shows loading and error states', () => { /* toggle the mock, assert states */ });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/web test -- vocab/page`
Expected: FAIL — page not found.

- [ ] **Step 3: Implement the page + components**

Create `apps/web/app/(dashboard)/vocab/_components/vocab-list-states.tsx` — export `VocabListLoading`, `VocabListError({ onRetry })`, `VocabEmpty` (small presentational components mirroring `theory-list-states.tsx`; a spinner/skeleton, an error with a retry button, and an "no vocab topics for this language yet" message).

Create `apps/web/app/(dashboard)/vocab/_components/vocab-topic-card.tsx`:

```tsx
import Link from 'next/link';
import type { VocabTopicSummary } from '@language-drill/api-client';

export function VocabTopicCard({ topic }: { topic: VocabTopicSummary }) {
  return (
    <Link href={`/vocab/${topic.umbrellaKey}`} className="card block">
      <div className="flex items-baseline justify-between gap-2">
        <span className="rv-h">{topic.name}</span>
        <span className="chip">{topic.cefrLevel}</span>
      </div>
      <p className="text-sm opacity-70">
        {topic.wordCount} words · {topic.available} drillable
      </p>
    </Link>
  );
}
```

> Class names (`card`, `rv-h`, `chip`) follow the app's design tokens — check `theory-topic-row.tsx` for the exact classes in use and match them.

Create `apps/web/app/(dashboard)/vocab/page.tsx` (client component, mirroring the structure of `theory/page.tsx` but simpler — no group/sort/search for the pilot):

```tsx
'use client';

import { useMemo } from 'react';
import { useAuth } from '@clerk/nextjs';
import { createAuthenticatedFetch, useVocabTopics } from '@language-drill/api-client';
import { useActiveLanguage } from '../../../components/shell/active-language-provider';
import { VocabTopicCard } from './_components/vocab-topic-card';
import {
  VocabListLoading,
  VocabListError,
  VocabEmpty,
} from './_components/vocab-list-states';

export default function VocabPage() {
  const { getToken } = useAuth();
  const { activeLanguage } = useActiveLanguage();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  const { data, isLoading, isError, refetch } = useVocabTopics({
    language: activeLanguage,
    fetchFn,
  });

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <header className="mb-6">
        <h1 className="rv-h text-2xl">vocabulary coverage</h1>
        <p className="text-sm opacity-70">
          Browse the words each topic covers and drill them.
        </p>
      </header>
      {isLoading ? (
        <VocabListLoading />
      ) : isError ? (
        <VocabListError onRetry={() => void refetch()} />
      ) : !data || data.topics.length === 0 ? (
        <VocabEmpty />
      ) : (
        <div className="grid gap-3">
          {data.topics.map((t) => (
            <VocabTopicCard key={t.umbrellaKey} topic={t} />
          ))}
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @language-drill/web test -- vocab/page`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /Users/seal/dev/language-drill/.claude/worktrees/feat+vocab-coverage-hub branch --show-current
git add "apps/web/app/(dashboard)/vocab/page.tsx" "apps/web/app/(dashboard)/vocab/page.test.tsx" "apps/web/app/(dashboard)/vocab/_components/vocab-topic-card.tsx" "apps/web/app/(dashboard)/vocab/_components/vocab-list-states.tsx"
git commit -m "feat(vocab): /vocab topic-list page"
```

---

### Task 6: `/vocab/[umbrellaKey]` detail page — word grid + gloss reveal + drill launch

**Files:**
- Create: `apps/web/app/(dashboard)/vocab/[umbrellaKey]/page.tsx`
- Create: `apps/web/app/(dashboard)/vocab/_components/vocab-word-cell.tsx`
- Create: `apps/web/app/(dashboard)/vocab/_components/drill-this-topic.tsx`
- Test: `apps/web/app/(dashboard)/vocab/[umbrellaKey]/page.test.tsx`
- Test: `apps/web/app/(dashboard)/vocab/_components/__tests__/vocab-word-cell.test.tsx`

**Interfaces:**
- Consumes: `useVocabTopicDetail` (Task 3); `VocabWord`, `CoverageState` types; `useAuth`.
- Produces: detail page rendering the word grid (colored by `state`, gloss hidden until tap) + a "Drill this topic" button with `href="/drill?start=quick&grammarPoint=<key>&exerciseType=vocab_recall"`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/app/(dashboard)/vocab/_components/__tests__/vocab-word-cell.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VocabWordCell } from '../vocab-word-cell';

const word = {
  lemma: 'manzana', displayForm: 'la manzana', gloss: 'apple',
  exampleSentence: 'Como una manzana.', freqRank: 800, tier: 'core', state: 'untested' as const,
};

describe('VocabWordCell', () => {
  it('hides the gloss until tapped', () => {
    render(<VocabWordCell word={word} />);
    expect(screen.getByText('la manzana')).toBeInTheDocument();
    expect(screen.queryByText('apple')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /la manzana/i }));
    expect(screen.getByText('apple')).toBeInTheDocument();
  });

  it('exposes the coverage state for styling', () => {
    render(<VocabWordCell word={{ ...word, state: 'practiced-strong' }} />);
    expect(screen.getByRole('button', { name: /la manzana/i })).toHaveAttribute(
      'data-state',
      'practiced-strong',
    );
  });
});
```

Create `apps/web/app/(dashboard)/vocab/[umbrellaKey]/page.test.tsx` mirroring `theory/[topicId]/page.test.tsx` mocks (mock `useVocabTopicDetail`, `next/link`, clerk, active-language). Assert the word renders, the gloss is hidden initially, and the "Drill this topic" link has the correct href:

```tsx
it('renders words and a drill-this-topic link', () => {
  // useVocabTopicDetail mock -> { data: { umbrellaKey:'es-a1-vocab-food-drink', name:'Food and drink (A1)', cefrLevel:'A1', words:[word] }, isLoading:false, isError:false }
  render(<VocabDetailPage params={Promise.resolve({ umbrellaKey: 'es-a1-vocab-food-drink' })} />);
  const drill = screen.getByRole('link', { name: /drill this topic/i });
  expect(drill).toHaveAttribute(
    'href',
    '/drill?start=quick&grammarPoint=es-a1-vocab-food-drink&exerciseType=vocab_recall',
  );
});
```

> Note the App-Router `params` is a Promise (React `use()`); mirror how `theory/[topicId]/page.tsx` unwraps it and how its test passes the param.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @language-drill/web test -- vocab-word-cell "vocab/\[umbrellaKey\]/page"`
Expected: FAIL — components not found.

- [ ] **Step 3: Implement the components + page**

Create `apps/web/app/(dashboard)/vocab/_components/vocab-word-cell.tsx`:

```tsx
'use client';

import { useState } from 'react';
import type { VocabWord } from '@language-drill/api-client';

export function VocabWordCell({ word }: { word: VocabWord }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <button
      type="button"
      data-state={word.state}
      onClick={() => setRevealed((r) => !r)}
      className="vocab-cell text-left"
      aria-expanded={revealed}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium">{word.displayForm}</span>
        {word.freqRank !== null ? (
          <span className="chip text-xs">#{word.freqRank}</span>
        ) : null}
      </div>
      {revealed ? (
        <div className="mt-1 text-sm">
          <div className="opacity-80">{word.gloss}</div>
          <div className="opacity-60 italic">{word.exampleSentence}</div>
        </div>
      ) : null}
    </button>
  );
}
```

Create `apps/web/app/(dashboard)/vocab/_components/drill-this-topic.tsx`:

```tsx
import Link from 'next/link';

export function DrillThisTopic({
  umbrellaKey,
  drillable,
}: {
  umbrellaKey: string;
  drillable: boolean;
}) {
  if (!drillable) return null;
  const href = `/drill?start=quick&grammarPoint=${encodeURIComponent(umbrellaKey)}&exerciseType=vocab_recall`;
  return (
    <Link href={href} className="btn btn-primary">
      Drill this topic
    </Link>
  );
}
```

> `drillable` = at least one word has state other than `not-yet` (an approved vocab_recall exercise exists). The page computes it from the words list; if none are drillable the button hides so the launch can't dead-end (parallels `usePointDrillInfo` gating in the theory hub).

Create `apps/web/app/(dashboard)/vocab/[umbrellaKey]/page.tsx`:

```tsx
'use client';

import { use, useMemo } from 'react';
import { useAuth } from '@clerk/nextjs';
import { createAuthenticatedFetch, useVocabTopicDetail } from '@language-drill/api-client';
import { VocabWordCell } from '../_components/vocab-word-cell';
import { DrillThisTopic } from '../_components/drill-this-topic';
import {
  VocabListLoading,
  VocabListError,
} from '../_components/vocab-list-states';

export default function VocabDetailPage({
  params,
}: {
  params: Promise<{ umbrellaKey: string }>;
}) {
  const { umbrellaKey } = use(params);
  const key = decodeURIComponent(umbrellaKey);
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  const { data, isLoading, isError, refetch } = useVocabTopicDetail({
    umbrellaKey: key,
    fetchFn,
  });

  const drillable = useMemo(
    () => (data?.words ?? []).some((w) => w.state !== 'not-yet'),
    [data],
  );

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      {isLoading ? (
        <VocabListLoading />
      ) : isError || !data ? (
        <VocabListError onRetry={() => void refetch()} />
      ) : (
        <>
          <header className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h1 className="rv-h text-2xl">{data.name}</h1>
              <span className="chip">{data.cefrLevel}</span>
            </div>
            <DrillThisTopic umbrellaKey={data.umbrellaKey} drillable={drillable} />
          </header>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {data.words.map((w) => (
              <VocabWordCell key={w.lemma} word={w} />
            ))}
          </div>
        </>
      )}
    </main>
  );
}
```

Add minimal styling for `.vocab-cell` coverage states to the web global stylesheet (find where `.card`/`.chip` are defined — likely `apps/web/app/globals.css` or a `hifi/styles.css`; add a `.vocab-cell` block with a base style and `[data-state="not-yet"]`/`["untested"]`/`["practiced-weak"]`/`["practiced-strong"]` background tints using existing color tokens — grey / neutral / amber / green respectively). Keep it token-based; don't introduce a directional `--radius-*` token (known hazard).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @language-drill/web test -- vocab-word-cell "vocab/\[umbrellaKey\]/page"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /Users/seal/dev/language-drill/.claude/worktrees/feat+vocab-coverage-hub branch --show-current
git add "apps/web/app/(dashboard)/vocab/[umbrellaKey]/page.tsx" "apps/web/app/(dashboard)/vocab/[umbrellaKey]/page.test.tsx" "apps/web/app/(dashboard)/vocab/_components/vocab-word-cell.tsx" "apps/web/app/(dashboard)/vocab/_components/drill-this-topic.tsx" "apps/web/app/(dashboard)/vocab/_components/__tests__/vocab-word-cell.test.tsx" apps/web/app/globals.css
git commit -m "feat(vocab): topic detail — word grid, gloss reveal, drill launch"
```

---

### Task 7: full-suite gate + browser verification

**Files:** none (verification)

- [ ] **Step 1: Full gate**

From the worktree root:
```bash
pnpm lint && pnpm typecheck && pnpm turbo run test --concurrency=1
```
Expected: zero failures. Report `X passed, Y failed`; fix before proceeding.

- [ ] **Step 2: Browser screenshot (evidence)**

The `/vocab` page needs a seed mock (the hub calls `/vocab/topics`). Add a vocab seed to `apps/web/e2e/helpers/seed-mocks.ts` (`seedAll` and/or a `seedVocab(page)` that `page.route('**/vocab/topics**', …)` and `**/vocab/topics/*`), then:
```bash
pnpm --filter @language-drill/web shoot --route /vocab
pnpm --filter @language-drill/web shoot --route /vocab/es-a1-vocab-food-drink
```
Confirm the shots in `apps/web/e2e/.shots/` render the topic list and the word grid (gloss hidden). Attach/commit the seed-mock change.

- [ ] **Step 3: Commit any gate fixes + the seed mock**

```bash
git -C /Users/seal/dev/language-drill/.claude/worktrees/feat+vocab-coverage-hub branch --show-current
git add -A && git commit -m "test(vocab): e2e seed mock for /vocab; gate fixes" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage (design Components B/C/D — the browse half):**
- Coverage read model (3-state, derived from history) → Tasks 1–2. ✅
- Browse hub UI: topic list + detail word grid, gloss hidden by default → Tasks 5–6. ✅
- "Drill this topic" reusing the existing flow → Task 6 (`DrillThisTopic`). ✅
- Navigation entry → Task 4. ✅
- Positioning guardrails: colored word grid (not a counter), gloss-on-tap → Task 6. ✅
- api-client plumbing → Task 3. ✅

**Placeholder scan:** Task 2's test body and the `.vocab-cell` CSS are described rather than shown verbatim because they depend on existing harness/token specifics the implementer must read first (`progress.test.ts`, `theory-topic-row.tsx`, the globals stylesheet) — each names the exact file to mirror and the exact assertions/states required. No TBDs in logic.

**Type consistency:** `CoverageState` is defined identically in the lambda helper (Task 1) and the api-client Zod enum (Task 3); the route (Task 2) returns the shape the api-client schema (Task 3) parses; `VocabTopicSummary`/`VocabWord`/`VocabTopicDetail` flow from schema → hooks → pages (Tasks 5–6). `useVocabTopics`/`useVocabTopicDetail` signatures match their page call sites.

**Cross-plan dependency:** requires Plan 1's `vocabTarget` table + `@language-drill/db` exports (`getGrammarPoint`, `curriculumOrderOf`) — present on this stacked branch.
