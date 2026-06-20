# History Tab — Error Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/progress` History "coming soon" placeholder with an error-resolution view: for each recurring error theme, show the slip, first-seen → last-seen, a weekly error-count sparkline, and an honest status — `still recurring` / `improving` / `quiet` — derived from error **rate** (errors ÷ attempts on that grammar point) over time, not raw counts.

**Architecture:** A new `GET /insights/error-trends` Lambda endpoint runs two windowed queries — error occurrences (`error_observations`) and attempts (`user_exercise_history` ⋈ `exercises.grammar_point_key`) — and feeds a pure aggregator that groups errors into themes, buckets them weekly, computes a rate-based status, and resolves grammar-point names. A new `useErrorTrends` hook + Zod schema mirror the existing `useInsightsErrors`. The `HistoryTab` is refactored from a static placeholder into a data-driven component (like `FluencyTab`).

**Tech Stack:** TypeScript, Hono (AWS Lambda), Drizzle, Zod, TanStack Query, Next.js (App Router) + React, Vitest + Testing Library.

## Global Constraints

- The web/api-client must NOT import `@language-drill/db`; grammar-point names are resolved server-side (via `getGrammarPoint`) and delivered as strings (the same pattern as `/insights/errors`).
- "Fixed" must mean *practiced-and-stopped-erroring*, not *stopped-practicing* — status is derived from error **rate** (errors ÷ attempts on the grammar point), using the attempts query. Raw error counts drive only the visual sparkline bars.
- Effective grammar point = `errorGrammarPointKey ?? hostGrammarPointKey` (errorGrammarPointKey is currently always null until Phase 3 — so effective == host today, which aligns with `exercises.grammar_point_key` for the attempts join).
- Window: 8 weekly buckets (56 days), oldest→newest. Recent window = last 2 buckets; earlier window = the first 6.
- Only themes with `totalErrors >= 2` are returned; sorted by status priority (`recurring` → `improving` → `quiet`), then `totalErrors` desc; limit 8.
- Status rules (in `resolveErrorTrend`): `quiet` if zero errors in the recent 2 weeks; else `improving` if `recentRate` and `earlierRate` are both defined and `recentRate <= 0.6 * earlierRate`; else `recurring`.
- Languages uppercase (TR/ES/DE). No DB schema/migration change.
- After editing `packages/*` run `pnpm build`; before the Lambda suite `rm -rf infra/lambda/dist`. The FULL gate is the real check: `pnpm lint && pnpm typecheck && pnpm test` from repo root with real exit codes (do NOT pipe through `tail`).
- Git commit trailer (every commit): `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

- **Create** `infra/lambda/src/lib/errors/error-trends.ts` — pure `bucketWeekly`, `resolveErrorTrend`, `buildErrorTrends` + types.
- **Create** `infra/lambda/src/lib/errors/error-trends.test.ts` — its tests.
- **Modify** `infra/lambda/src/routes/insights.ts` — add `GET /insights/error-trends`.
- **Create** `packages/api-client/src/schemas/error-trends.ts` — `ErrorTrendsResponseSchema` + types.
- **Create** `packages/api-client/src/schemas/error-trends.test.ts` — schema tests.
- **Create** `packages/api-client/src/hooks/useErrorTrends.ts` — the hook.
- **Modify** `packages/api-client/src/index.ts` — export the schema + hook.
- **Modify** `apps/web/app/(dashboard)/progress/_components/history-tab.tsx` — data-driven error-resolution UI.
- **Create** `apps/web/app/(dashboard)/progress/_components/__tests__/history-tab.test.tsx` — its tests (the placeholder had none).
- **Modify** `apps/web/app/(dashboard)/progress/page.tsx` — call `useErrorTrends`, pass props to `HistoryTab`.

---

### Task 1: Backend — pure error-trend aggregation

**Files:**
- Create: `infra/lambda/src/lib/errors/error-trends.ts`
- Create: `infra/lambda/src/lib/errors/error-trends.test.ts`

**Interfaces:**
- Produces:
  - `ErrorRow = { grammarPointKey: string | null; errorType: string; severity: string; wrongText: string; correction: string; occurredAt: Date }` (grammarPointKey is already the EFFECTIVE point — the route resolves `errorGrammarPointKey ?? hostGrammarPointKey` before calling).
  - `AttemptRow = { grammarPointKey: string; attemptedAt: Date }`.
  - `ErrorTrendStatus = 'recurring' | 'improving' | 'quiet'`.
  - `ErrorTrendTheme = { grammarPointKey: string | null; grammarPointName: string | null; errorType: string; sample: { wrongText: string; correction: string }; firstSeen: Date; lastSeen: Date; totalErrors: number; weeklyErrors: number[]; status: ErrorTrendStatus; lastSeenDaysAgo: number; fromRatePct: number | null; toRatePct: number | null; quietWeeks: number | null }`.
  - `bucketWeekly(timestamps: readonly Date[], now: Date, weeks: number): number[]` — counts per week, oldest→newest, length `weeks`.
  - `resolveErrorTrend(weeklyErrors: readonly number[], weeklyAttempts: readonly number[], lastSeen: Date, now: Date): { status; lastSeenDaysAgo; fromRatePct; toRatePct; quietWeeks }`.
  - `buildErrorTrends(errors: readonly ErrorRow[], attempts: readonly AttemptRow[], now: Date, opts?: { weeks?: number; limit?: number }): Omit<ErrorTrendTheme, 'grammarPointName'>[]` (name attached by the route). Groups by `(grammarPointKey ?? '∅') + '::' + errorType`; only `totalErrors >= 2`; sorted by status priority then totalErrors desc; limited.

- [ ] **Step 1: Write the failing tests**

Create `infra/lambda/src/lib/errors/error-trends.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { bucketWeekly, resolveErrorTrend, buildErrorTrends, type ErrorRow, type AttemptRow } from './error-trends';

const NOW = new Date('2026-06-20T00:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe('bucketWeekly', () => {
  it('counts timestamps into oldest→newest weekly buckets', () => {
    const out = bucketWeekly([daysAgo(1), daysAgo(1), daysAgo(9)], NOW, 4);
    // 4 buckets: [21-28d, 14-21d, 7-14d, 0-7d]; one at 9d (bucket idx 2), two at 1d (idx 3)
    expect(out).toEqual([0, 0, 1, 2]);
  });
  it('drops timestamps outside the window', () => {
    expect(bucketWeekly([daysAgo(40)], NOW, 4)).toEqual([0, 0, 0, 0]);
  });
});

describe('resolveErrorTrend', () => {
  it('quiet when no errors in the recent 2 weeks', () => {
    const r = resolveErrorTrend([3, 2, 0, 0], [10, 10, 10, 10], daysAgo(16), NOW);
    expect(r.status).toBe('quiet');
    expect(r.quietWeeks).toBeGreaterThanOrEqual(2);
  });
  it('improving when recent rate <= 60% of earlier rate', () => {
    // earlier (first 6 of 8): high rate; recent (last 2): low rate
    const r = resolveErrorTrend([5, 5, 5, 5, 5, 5, 1, 0], [10, 10, 10, 10, 10, 10, 10, 10], daysAgo(6), NOW);
    expect(r.status).toBe('improving');
    expect(r.toRatePct).toBeLessThan(r.fromRatePct as number);
  });
  it('recurring when recent rate is not meaningfully lower', () => {
    const r = resolveErrorTrend([2, 2, 2, 2, 2, 2, 3, 3], [10, 10, 10, 10, 10, 10, 10, 10], daysAgo(2), NOW);
    expect(r.status).toBe('recurring');
    expect(r.lastSeenDaysAgo).toBe(2);
  });
});

describe('buildErrorTrends', () => {
  const err = (over: Partial<ErrorRow>): ErrorRow => ({
    grammarPointKey: 'tr-a1-locative', errorType: 'grammar', severity: 'major',
    wrongText: 'pazarda', correction: 'pazara', occurredAt: daysAgo(2), ...over,
  });
  const att = (key: string, d: number): AttemptRow => ({ grammarPointKey: key, attemptedAt: daysAgo(d) });

  it('groups by (grammar point, error type), keeps only >=2 errors, attaches sample/first/last', () => {
    const themes = buildErrorTrends(
      [err({ occurredAt: daysAgo(20) }), err({ occurredAt: daysAgo(2), wrongText: 'recent', correction: 'fix' })],
      [att('tr-a1-locative', 20), att('tr-a1-locative', 2)],
      NOW,
    );
    expect(themes).toHaveLength(1);
    expect(themes[0].grammarPointKey).toBe('tr-a1-locative');
    expect(themes[0].totalErrors).toBe(2);
    expect(themes[0].sample).toEqual({ wrongText: 'recent', correction: 'fix' }); // most recent
    expect(themes[0].weeklyErrors).toHaveLength(8);
  });

  it('drops single-occurrence themes', () => {
    expect(buildErrorTrends([err({})], [att('tr-a1-locative', 2)], NOW)).toEqual([]);
  });

  it('orders recurring before improving before quiet', () => {
    const recurring = [err({ grammarPointKey: 'rec', occurredAt: daysAgo(2) }), err({ grammarPointKey: 'rec', occurredAt: daysAgo(1) })];
    const quiet = [err({ grammarPointKey: 'qui', occurredAt: daysAgo(30) }), err({ grammarPointKey: 'qui', occurredAt: daysAgo(28) })];
    const themes = buildErrorTrends([...quiet, ...recurring], [att('rec', 2), att('rec', 1)], NOW);
    expect(themes[0].grammarPointKey).toBe('rec');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `rm -rf infra/lambda/dist && pnpm --filter @language-drill/lambda test error-trends`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the aggregation**

Create `infra/lambda/src/lib/errors/error-trends.ts`:

```typescript
export interface ErrorRow {
  grammarPointKey: string | null; // effective (errorGrammarPointKey ?? hostGrammarPointKey)
  errorType: string;
  severity: string;
  wrongText: string;
  correction: string;
  occurredAt: Date;
}

export interface AttemptRow {
  grammarPointKey: string;
  attemptedAt: Date;
}

export type ErrorTrendStatus = 'recurring' | 'improving' | 'quiet';

export interface ErrorTrendTheme {
  grammarPointKey: string | null;
  grammarPointName: string | null;
  errorType: string;
  sample: { wrongText: string; correction: string };
  firstSeen: Date;
  lastSeen: Date;
  totalErrors: number;
  weeklyErrors: number[];
  status: ErrorTrendStatus;
  lastSeenDaysAgo: number;
  fromRatePct: number | null;
  toRatePct: number | null;
  quietWeeks: number | null;
}

const WEEKS = 8;
const MS_PER_WEEK = 7 * 86_400_000;
const MS_PER_DAY = 86_400_000;
const RECENT_WEEKS = 2;
const IMPROVING_RATIO = 0.6;

/** Count timestamps into `weeks` oldest→newest weekly buckets (index weeks-1 = most recent). */
export function bucketWeekly(timestamps: readonly Date[], now: Date, weeks: number): number[] {
  const buckets = new Array<number>(weeks).fill(0);
  for (const t of timestamps) {
    const weeksAgo = Math.floor((now.getTime() - t.getTime()) / MS_PER_WEEK);
    if (weeksAgo < 0 || weeksAgo >= weeks) continue;
    buckets[weeks - 1 - weeksAgo] += 1;
  }
  return buckets;
}

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
const rate = (errors: number, attempts: number): number | null => (attempts > 0 ? errors / attempts : null);

export function resolveErrorTrend(
  weeklyErrors: readonly number[],
  weeklyAttempts: readonly number[],
  lastSeen: Date,
  now: Date,
): { status: ErrorTrendStatus; lastSeenDaysAgo: number; fromRatePct: number | null; toRatePct: number | null; quietWeeks: number | null } {
  const lastSeenDaysAgo = Math.floor((now.getTime() - lastSeen.getTime()) / MS_PER_DAY);
  const recentErr = sum(weeklyErrors.slice(-RECENT_WEEKS));
  const earlierErr = sum(weeklyErrors.slice(0, -RECENT_WEEKS));
  const recentRate = rate(recentErr, sum(weeklyAttempts.slice(-RECENT_WEEKS)));
  const earlierRate = rate(earlierErr, sum(weeklyAttempts.slice(0, -RECENT_WEEKS)));

  if (recentErr === 0) {
    // weeks since the last non-zero error bucket
    let quietWeeks = 0;
    for (let i = weeklyErrors.length - 1; i >= 0; i -= 1) {
      if (weeklyErrors[i] > 0) break;
      quietWeeks += 1;
    }
    return { status: 'quiet', lastSeenDaysAgo, fromRatePct: null, toRatePct: null, quietWeeks };
  }
  if (earlierRate !== null && recentRate !== null && recentRate <= IMPROVING_RATIO * earlierRate) {
    return {
      status: 'improving',
      lastSeenDaysAgo,
      fromRatePct: Math.round(earlierRate * 100),
      toRatePct: Math.round(recentRate * 100),
      quietWeeks: null,
    };
  }
  return { status: 'recurring', lastSeenDaysAgo, fromRatePct: null, toRatePct: null, quietWeeks: null };
}

const STATUS_ORDER: Record<ErrorTrendStatus, number> = { recurring: 0, improving: 1, quiet: 2 };

export function buildErrorTrends(
  errors: readonly ErrorRow[],
  attempts: readonly AttemptRow[],
  now: Date,
  opts: { weeks?: number; limit?: number } = {},
): Omit<ErrorTrendTheme, 'grammarPointName'>[] {
  const weeks = opts.weeks ?? WEEKS;
  const limit = opts.limit ?? 8;

  // attempts bucketed per grammar point
  const attemptsByPoint = new Map<string, Date[]>();
  for (const a of attempts) {
    const list = attemptsByPoint.get(a.grammarPointKey) ?? [];
    list.push(a.attemptedAt);
    attemptsByPoint.set(a.grammarPointKey, list);
  }

  const groups = new Map<string, ErrorRow[]>();
  for (const e of errors) {
    const key = `${e.grammarPointKey ?? '∅'}::${e.errorType}`;
    const list = groups.get(key) ?? [];
    list.push(e);
    groups.set(key, list);
  }

  const themes: Omit<ErrorTrendTheme, 'grammarPointName'>[] = [];
  for (const rows of groups.values()) {
    if (rows.length < 2) continue;
    const sorted = [...rows].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const weeklyErrors = bucketWeekly(sorted.map((r) => r.occurredAt), now, weeks);
    const pointAttempts = first.grammarPointKey ? (attemptsByPoint.get(first.grammarPointKey) ?? []) : [];
    const weeklyAttempts = bucketWeekly(pointAttempts, now, weeks);
    const trend = resolveErrorTrend(weeklyErrors, weeklyAttempts, last.occurredAt, now);
    themes.push({
      grammarPointKey: first.grammarPointKey,
      errorType: first.errorType,
      sample: { wrongText: last.wrongText, correction: last.correction },
      firstSeen: first.occurredAt,
      lastSeen: last.occurredAt,
      totalErrors: rows.length,
      weeklyErrors,
      ...trend,
    });
  }

  return themes
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.totalErrors - a.totalErrors)
    .slice(0, limit);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @language-drill/lambda test error-trends`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/lib/errors/error-trends.ts infra/lambda/src/lib/errors/error-trends.test.ts
git commit -m "$(printf 'feat(lambda): pure error-trend aggregation (rate-based status)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 2: Backend — `GET /insights/error-trends` endpoint

**Files:**
- Modify: `infra/lambda/src/routes/insights.ts` (add the route alongside `GET /insights/errors`)

**Interfaces:**
- Consumes: `buildErrorTrends` + types (Task 1); `errorObservations`, `userExerciseHistory`, `exercises`, `getGrammarPoint` from `@language-drill/db`.
- Produces: `GET /insights/error-trends?language=<TR|ES|DE>` → `{ themes: Array<ErrorTrendTheme with Date fields serialized to ISO strings, grammarPointName attached> }`.

- [ ] **Step 1: Add the route**

Read `insights.ts` first (the existing `GET /insights/errors` shows the query + auth + name-resolution pattern). Add imports for `userExerciseHistory`, `exercises`, `buildErrorTrends`, `type ErrorRow`, `type AttemptRow`, and `isNotNull` (drizzle). Add the handler:

```typescript
const TREND_WINDOW_MS = 8 * 7 * 86_400_000; // 8 weeks

insights.get('/insights/error-trends', async (c) => {
  const parsed = QuerySchema.safeParse(c.req.query()); // reuse the existing QuerySchema (ES/DE/TR)
  if (!parsed.success) {
    return c.json({ error: 'Invalid query parameters', code: 'VALIDATION_ERROR', details: parsed.error.flatten() }, 400);
  }
  const { language } = parsed.data;
  const userId = c.get('userId');
  const now = new Date();
  const since = new Date(now.getTime() - TREND_WINDOW_MS);

  const errorRows = await db
    .select({
      hostGrammarPointKey: errorObservations.hostGrammarPointKey,
      errorGrammarPointKey: errorObservations.errorGrammarPointKey,
      errorType: errorObservations.errorType,
      severity: errorObservations.severity,
      wrongText: errorObservations.wrongText,
      correction: errorObservations.correction,
      occurredAt: errorObservations.occurredAt,
    })
    .from(errorObservations)
    .where(and(eq(errorObservations.userId, userId), eq(errorObservations.language, language), gte(errorObservations.occurredAt, since)));

  const attemptRows = await db
    .select({ grammarPointKey: exercises.grammarPointKey, attemptedAt: userExerciseHistory.evaluatedAt })
    .from(userExerciseHistory)
    .innerJoin(exercises, eq(userExerciseHistory.exerciseId, exercises.id))
    .where(and(eq(userExerciseHistory.userId, userId), eq(exercises.language, language), gte(userExerciseHistory.evaluatedAt, since), isNotNull(exercises.grammarPointKey)));

  const errors: ErrorRow[] = errorRows.map((r) => ({
    grammarPointKey: r.errorGrammarPointKey ?? r.hostGrammarPointKey,
    errorType: r.errorType,
    severity: r.severity,
    wrongText: r.wrongText,
    correction: r.correction,
    occurredAt: new Date(r.occurredAt),
  }));
  const attempts: AttemptRow[] = attemptRows
    .filter((r): r is { grammarPointKey: string; attemptedAt: Date } => r.grammarPointKey != null && r.attemptedAt != null)
    .map((r) => ({ grammarPointKey: r.grammarPointKey, attemptedAt: new Date(r.attemptedAt) }));

  const themes = buildErrorTrends(errors, attempts, now).map((t) => ({
    ...t,
    grammarPointName: t.grammarPointKey ? (getGrammarPoint(t.grammarPointKey)?.name ?? null) : null,
    firstSeen: t.firstSeen.toISOString(),
    lastSeen: t.lastSeen.toISOString(),
  }));

  return c.json({ themes });
});
```

> Match the file's real `QuerySchema`, `db`, and import style. If `getGrammarPoint` / `errorObservations` aren't already imported in `insights.ts`, they are imported by `GET /insights/errors` — reuse those imports; add only `userExerciseHistory`, `exercises`, `isNotNull`.

- [ ] **Step 2: Verify typecheck + full Lambda suite**

Run: `pnpm --filter @language-drill/lambda typecheck && rm -rf infra/lambda/dist && pnpm --filter @language-drill/lambda test`
Expected: PASS. (The aggregation is unit-tested in Task 1; this confirms the route compiles + queries are well-formed and nothing else broke.)

- [ ] **Step 3: Commit**

```bash
git add infra/lambda/src/routes/insights.ts
git commit -m "$(printf 'feat(lambda): GET /insights/error-trends endpoint\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 3: api-client — schema + `useErrorTrends` hook

**Files:**
- Create: `packages/api-client/src/schemas/error-trends.ts`
- Create: `packages/api-client/src/schemas/error-trends.test.ts`
- Create: `packages/api-client/src/hooks/useErrorTrends.ts`
- Modify: `packages/api-client/src/index.ts` (export schema + hook)

**Interfaces:**
- Produces:
  - `ErrorTrendTheme` = `{ grammarPointKey: string | null; grammarPointName: string | null; errorType: string; sample: { wrongText: string; correction: string }; firstSeen: string; lastSeen: string; totalErrors: number; weeklyErrors: number[]; status: 'recurring'|'improving'|'quiet'; lastSeenDaysAgo: number; fromRatePct: number | null; toRatePct: number | null; quietWeeks: number | null }`.
  - `ErrorTrendsResponse = { themes: ErrorTrendTheme[] }`.
  - `useErrorTrends({ fetchFn, language, enabled? })` — queryKey `['errorTrends', language]`, GET `/insights/error-trends?language=…`.

- [ ] **Step 1: Write the failing schema test**

Create `packages/api-client/src/schemas/error-trends.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { ErrorTrendsResponseSchema } from './error-trends';

const theme = {
  grammarPointKey: 'tr-a1-locative', grammarPointName: 'Locative case', errorType: 'grammar',
  sample: { wrongText: 'pazarda', correction: 'pazara' },
  firstSeen: '2026-05-20T00:00:00.000Z', lastSeen: '2026-06-18T00:00:00.000Z',
  totalErrors: 6, weeklyErrors: [0, 1, 2, 1, 1, 0, 1, 0],
  status: 'recurring' as const, lastSeenDaysAgo: 2, fromRatePct: null, toRatePct: null, quietWeeks: null,
};

describe('ErrorTrendsResponseSchema', () => {
  it('parses a valid response', () => {
    const parsed = ErrorTrendsResponseSchema.parse({ themes: [theme] });
    expect(parsed.themes[0].status).toBe('recurring');
  });
  it('accepts the improving variant with rate fields', () => {
    const parsed = ErrorTrendsResponseSchema.parse({ themes: [{ ...theme, status: 'improving', fromRatePct: 60, toRatePct: 12 }] });
    expect(parsed.themes[0].toRatePct).toBe(12);
  });
  it('rejects an unknown status', () => {
    expect(() => ErrorTrendsResponseSchema.parse({ themes: [{ ...theme, status: 'nope' }] })).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @language-drill/api-client test error-trends`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the schema**

Create `packages/api-client/src/schemas/error-trends.ts`:

```typescript
import { z } from 'zod';

export const ErrorTrendThemeSchema = z.object({
  grammarPointKey: z.string().nullable(),
  grammarPointName: z.string().nullable(),
  errorType: z.string(),
  sample: z.object({ wrongText: z.string(), correction: z.string() }),
  firstSeen: z.string().datetime(),
  lastSeen: z.string().datetime(),
  totalErrors: z.number().int().min(0),
  weeklyErrors: z.array(z.number().int().min(0)),
  status: z.enum(['recurring', 'improving', 'quiet']),
  lastSeenDaysAgo: z.number().int().min(0),
  fromRatePct: z.number().nullable(),
  toRatePct: z.number().nullable(),
  quietWeeks: z.number().int().nullable(),
});

export const ErrorTrendsResponseSchema = z.object({
  themes: z.array(ErrorTrendThemeSchema),
});

export type ErrorTrendTheme = z.infer<typeof ErrorTrendThemeSchema>;
export type ErrorTrendsResponse = z.infer<typeof ErrorTrendsResponseSchema>;
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @language-drill/api-client test error-trends`
Expected: PASS.

- [ ] **Step 5: Implement the hook**

Create `packages/api-client/src/hooks/useErrorTrends.ts` mirroring `useInsights.ts`:

```typescript
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { LearningLanguage } from '@language-drill/shared';
import type { AuthenticatedFetch } from '../fetchClient';
import { ErrorTrendsResponseSchema, type ErrorTrendsResponse } from '../schemas/error-trends';

const ERROR_TRENDS_STALE_TIME_MS = 5 * 60 * 1000;

export interface UseErrorTrendsParams {
  fetchFn: AuthenticatedFetch;
  language: LearningLanguage;
  enabled?: boolean;
}

export function useErrorTrends({
  fetchFn,
  language,
  enabled = true,
}: UseErrorTrendsParams): UseQueryResult<ErrorTrendsResponse, Error> {
  return useQuery<ErrorTrendsResponse, Error>({
    queryKey: ['errorTrends', language],
    queryFn: async () => {
      const response = await fetchFn(`/insights/error-trends?language=${encodeURIComponent(language)}`);
      const json: unknown = await response.json();
      return ErrorTrendsResponseSchema.parse(json);
    },
    enabled,
    staleTime: ERROR_TRENDS_STALE_TIME_MS,
  });
}
```

> Confirm the `AuthenticatedFetch` import path matches `useInsights.ts` exactly.

- [ ] **Step 6: Export from the barrel**

In `packages/api-client/src/index.ts`, near the insights exports add:

```typescript
export {
  ErrorTrendThemeSchema,
  ErrorTrendsResponseSchema,
  type ErrorTrendTheme,
  type ErrorTrendsResponse,
} from './schemas/error-trends';
export { useErrorTrends, type UseErrorTrendsParams } from './hooks/useErrorTrends';
```

- [ ] **Step 7: Verify + build + commit**

Run: `pnpm --filter @language-drill/api-client test && pnpm --filter @language-drill/api-client typecheck && pnpm build`
Then:

```bash
git add packages/api-client/src/schemas/error-trends.ts packages/api-client/src/schemas/error-trends.test.ts packages/api-client/src/hooks/useErrorTrends.ts packages/api-client/src/index.ts
git commit -m "$(printf 'feat(api-client): error-trends schema + useErrorTrends hook\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 4: Web — the History tab error-resolution UI

**Files:**
- Modify: `apps/web/app/(dashboard)/progress/_components/history-tab.tsx` (replace the placeholder)
- Create: `apps/web/app/(dashboard)/progress/_components/__tests__/history-tab.test.tsx`
- Modify: `apps/web/app/(dashboard)/progress/page.tsx` (wire `useErrorTrends` → `HistoryTab` props)

**Interfaces:**
- Consumes: `useErrorTrends` + `ErrorTrendsResponse` / `ErrorTrendTheme` (Task 3).
- Produces: `HistoryTab` now takes `{ data: ErrorTrendsResponse | undefined; isLoading: boolean; error: Error | null; onRetry: () => void }` (mirroring `FluencyTab`).

- [ ] **Step 1: Write the failing component test**

Read `fluency-tab.tsx` + its test for the loading/error/empty conventions. Create `apps/web/app/(dashboard)/progress/_components/__tests__/history-tab.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ErrorTrendTheme, ErrorTrendsResponse } from '@language-drill/api-client';
import { HistoryTab } from '../history-tab';

const theme = (over: Partial<ErrorTrendTheme> = {}): ErrorTrendTheme => ({
  grammarPointKey: 'tr-a1-locative', grammarPointName: 'Locative case', errorType: 'grammar',
  sample: { wrongText: 'pazarda', correction: 'pazara' },
  firstSeen: '2026-05-20T00:00:00.000Z', lastSeen: '2026-06-18T00:00:00.000Z',
  totalErrors: 6, weeklyErrors: [0, 1, 2, 1, 1, 0, 1, 0],
  status: 'recurring', lastSeenDaysAgo: 2, fromRatePct: null, toRatePct: null, quietWeeks: null,
  ...over,
});
const resp = (themes: ErrorTrendTheme[]): ErrorTrendsResponse => ({ themes });
const noop = () => {};

describe('HistoryTab', () => {
  it('renders a recurring theme with the slip and status', () => {
    render(<HistoryTab data={resp([theme()])} isLoading={false} error={null} onRetry={noop} />);
    expect(screen.getByText('Locative case')).toBeInTheDocument();
    expect(screen.getByText(/pazarda/)).toBeInTheDocument();
    expect(screen.getByText(/pazara/)).toBeInTheDocument();
    expect(screen.getByText(/still recurring/i)).toBeInTheDocument();
  });

  it('renders the improving status with the rate delta', () => {
    render(<HistoryTab data={resp([theme({ status: 'improving', fromRatePct: 60, toRatePct: 12 })])} isLoading={false} error={null} onRetry={noop} />);
    expect(screen.getByText(/improving/i)).toBeInTheDocument();
    expect(screen.getByText(/60%/)).toBeInTheDocument();
    expect(screen.getByText(/12%/)).toBeInTheDocument();
  });

  it('renders the quiet status', () => {
    render(<HistoryTab data={resp([theme({ status: 'quiet', quietWeeks: 3 })])} isLoading={false} error={null} onRetry={noop} />);
    expect(screen.getByText(/quiet/i)).toBeInTheDocument();
  });

  it('shows an empty state when there are no themes', () => {
    render(<HistoryTab data={resp([])} isLoading={false} error={null} onRetry={noop} />);
    expect(screen.getByText(/no recurring errors/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @language-drill/web test history-tab`
Expected: FAIL — `HistoryTab` is the prop-less placeholder.

- [ ] **Step 3: Implement the data-driven HistoryTab**

Replace `history-tab.tsx`. Mirror `FluencyTab`'s loading/error/empty handling. Render each theme: grammar-point name (fallback to `${errorType} errors`), the slip `wrongText → correction`, a small bar sparkline from `weeklyErrors`, and a status line formatted from the fields:

```tsx
import type { ErrorTrendsResponse, ErrorTrendTheme } from '@language-drill/api-client';
import { Card } from '...'; // match fluency-tab's imports

export interface HistoryTabProps {
  data: ErrorTrendsResponse | undefined;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
}

function statusLine(t: ErrorTrendTheme): string {
  if (t.status === 'improving') return `improving · ${t.fromRatePct}% → ${t.toRatePct}% error rate`;
  if (t.status === 'quiet') return `quiet · no slips in ${t.quietWeeks} week${t.quietWeeks === 1 ? '' : 's'}`;
  return `still recurring · last seen ${t.lastSeenDaysAgo}d ago`;
}

function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  return (
    <div aria-hidden style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 18 }}>
      {values.map((v, i) => (
        <div key={i} style={{ width: 4, height: `${Math.max(2, (v / max) * 18)}px`, background: v > 0 ? 'var(--color-accent)' : 'var(--color-rule)' }} />
      ))}
    </div>
  );
}

function label(t: ErrorTrendTheme): string {
  return t.grammarPointName ?? t.grammarPointKey ?? `${t.errorType} errors`;
}

export function HistoryTab({ data, isLoading, error, onRetry }: HistoryTabProps) {
  // mirror FluencyTab: handle isLoading (skeleton), error (retry), then content
  if (isLoading) return /* fluency-tab loading shape */;
  if (error) return /* fluency-tab error shape with onRetry */;
  const themes = data?.themes ?? [];
  if (themes.length === 0) {
    return (
      <div style={{ marginTop: 28 }}>
        <Card padding="lg" className="text-center">
          <div className="t-small" style={{ color: 'var(--color-ink-mute)' }}>
            no recurring errors yet — keep drilling and this fills in.
          </div>
        </Card>
      </div>
    );
  }
  return (
    <div style={{ marginTop: 28, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p className="t-micro">are you fixing these?</p>
      {themes.map((t) => (
        <Card key={`${t.grammarPointKey ?? '∅'}:${t.errorType}`} padding="md">
          <div className="flex items-baseline justify-between gap-s-3">
            <span className="text-[14px] font-medium">{label(t)}</span>
            <span className="t-mono text-[12px] text-ink-soft">{t.sample.wrongText} → {t.sample.correction}</span>
          </div>
          <div className="mt-s-2 flex items-center justify-between gap-s-3">
            <Sparkline values={t.weeklyErrors} />
            <span className="t-micro text-ink-soft">{statusLine(t)}</span>
          </div>
        </Card>
      ))}
    </div>
  );
}
```

> Use the REAL imports/skeleton/error shapes from `fluency-tab.tsx` (read it) so loading + error + retry match the other tabs. The tests assert text content (`still recurring`, `improving`, `60%`, `quiet`, `no recurring errors`), not exact markup.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @language-drill/web test history-tab`
Expected: PASS.

- [ ] **Step 5: Wire the hook into the progress page**

In `progress/page.tsx`: add `const history = useErrorTrends({ fetchFn, language: activeLanguage });` alongside the radar/fluency hooks, and replace `{tab === 'history' && <HistoryTab />}` with the prop-passing form (mirror the `FluencyTab` block):

```tsx
{tab === 'history' && (
  <HistoryTab
    data={history.data}
    isLoading={history.isLoading}
    error={history.error}
    onRetry={() => {
      void history.refetch();
    }}
  />
)}
```

Add the `useErrorTrends` import from `@language-drill/api-client`.

- [ ] **Step 6: Verify typecheck + focused tests**

Run: `pnpm --filter @language-drill/web typecheck && pnpm --filter @language-drill/web test history-tab progress`
Expected: PASS. (If a `progress/page` test renders the page and mocks `@language-drill/api-client`, add `useErrorTrends` to that mock returning `{ data: { themes: [] } }` — the same trap pattern as prior hooks.)

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/\(dashboard\)/progress/_components/history-tab.tsx apps/web/app/\(dashboard\)/progress/_components/__tests__/history-tab.test.tsx apps/web/app/\(dashboard\)/progress/page.tsx
git commit -m "$(printf 'feat(web): History tab error-resolution view\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Final verification (whole plan)

- [ ] From repo root, real exit codes (do NOT pipe through `tail`):
  `pnpm lint; echo "lint=$?"; pnpm typecheck; echo "tc=$?"; rm -rf infra/lambda/dist; pnpm test; echo "test=$?"`
- [ ] Confirm `lint=0 tc=0 test=0`. Report X passed / Y failed.

---

## Self-review notes

- **Spec coverage:** error-resolution view with rate-based status (Task 1 logic, Task 2 wiring) → schema/hook (Task 3) → tab UI (Task 4). The status is rate-based (`resolveErrorTrend` uses attempts), satisfying the "fixed = practiced-and-stopped, not stopped-practicing" honesty constraint. Skill-trend sparklines are out of scope (deferred per the chosen option).
- **Type consistency:** `ErrorTrendTheme` fields match across the lambda aggregator (Date), the API serialization (ISO strings), the Zod schema, and the component. `status` is the same 3-member union everywhere. Effective grammar point (`errorGrammarPointKey ?? hostGrammarPointKey`) resolved in the route before `buildErrorTrends`.
- **No web→db import:** grammar-point names resolved server-side; the tab consumes strings.
- **Known trap pre-empted:** if the progress-page test mocks api-client, `useErrorTrends` must be added to that mock (Task 4 Step 6).
- **Deferred:** skill-trend sparklines + 30/60/90/all window toggle; Phase 3 per-error attribution (when it lands, `errorGrammarPointKey` makes the effective-point grouping sharper, no API change needed).
