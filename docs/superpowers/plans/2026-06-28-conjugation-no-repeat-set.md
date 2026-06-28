# Conjugation No-Repeat Distinct Set — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** Stop the conjugation drill from repeating exercises within a sitting by serving a pre-composed, distinct-by-content set instead of independent single-row random draws.

**Root cause (investigated):** (1) `GET /exercises` draws one row per `next` with `freshFirstOrderBy(userId), random() LIMIT 1` — no session-scoped exclusion. (2) The pool holds ~50–60% exact-duplicate content rows in TR conjugation (e.g. `öğrenci→öğrencisin (sen)` × 5 distinct UUIDs), so id-level de-duping can't stop content repeats. Fix de-dupes by **content signature** at serve time.

**Architecture:** New `GET /exercises/set` returns N distinct-by-content exercises (freshness-ordered). The conjugation page fetches the set once and iterates it client-side (no per-item refetch). Submissions stay sessionless; the existing finish-session review is the natural end. Pool data is NOT migrated here — duplicates are reported separately.

## Global Constraints

- Generation/scheduler/route code is package `@language-drill/lambda` (`infra/lambda`), NOT `@language-drill/infra`.
- Full lambda test suite can surface stale compiled `infra/lambda/dist/**/*.test.js` — `rm -rf infra/lambda/dist` if phantom failures appear.
- Mock-db tests drain an ordered queue; adding queries reorders it (see admin/sessions test memories) — re-derive push order when editing route tests.
- Pre-push gate from repo root: `pnpm lint && pnpm typecheck && pnpm test`.
- Don't change shared base UI components.

---

### Task 1: Distinct-set composer (pure, lambda)

**Files:**
- Create: `infra/lambda/src/lib/exercise-set.ts`
- Test: `infra/lambda/src/lib/exercise-set.test.ts`

**Interfaces — Produces:**
- `conjugationSignature(contentJson: unknown): string` — `"<lemma>|<targetForm>|<pronoun>"` from conjugation content (missing fields → empty segments).
- `dedupeBySignature<T>(items: readonly T[], count: number, signatureOf: (item: T) => string): T[]` — preserves input order (the SQL provides freshness ordering), keeps first occurrence per signature, slices `count`.
- `CONJUGATION_SET_DEFAULT = 10`, `CONJUGATION_SET_MAX = 20`, `CONJUGATION_SET_FETCH_CAP = 300`.

- [ ] **Step 1: Failing test** (mirror `fluency-session.test.ts` style)

```ts
import { describe, it, expect } from 'vitest';
import { conjugationSignature, dedupeBySignature } from './exercise-set';

describe('conjugationSignature', () => {
  it('builds a lemma|target|pronoun signature', () => {
    expect(
      conjugationSignature({ lemma: 'öğrenci', targetForm: 'öğrencisin', subject: { pronoun: 'sen' } }),
    ).toBe('öğrenci|öğrencisin|sen');
  });
  it('tolerates missing fields', () => {
    expect(conjugationSignature({})).toBe('||');
    expect(conjugationSignature(null)).toBe('||');
  });
});

describe('dedupeBySignature', () => {
  const sig = (x: { s: string }) => x.s;
  it('keeps first occurrence per signature, preserving order', () => {
    const items = [{ s: 'a' }, { s: 'b' }, { s: 'a' }, { s: 'c' }];
    expect(dedupeBySignature(items, 10, sig).map((x) => x.s)).toEqual(['a', 'b', 'c']);
  });
  it('slices to count after de-duping', () => {
    const items = [{ s: 'a' }, { s: 'b' }, { s: 'a' }, { s: 'c' }, { s: 'd' }];
    expect(dedupeBySignature(items, 2, sig).map((x) => x.s)).toEqual(['a', 'b']);
  });
  it('returns [] for empty input', () => {
    expect(dedupeBySignature([], 5, sig)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run → fail** — `pnpm --filter @language-drill/lambda test -- exercise-set` (module not found).

- [ ] **Step 3: Implement**

```ts
// Distinct-by-content composition for GET /exercises/set. Pure + unit-tested.
export const CONJUGATION_SET_DEFAULT = 10;
export const CONJUGATION_SET_MAX = 20;
// Over-fetch window: the conjugation pools are small (≤~220 rows/level) and
// duplicate-heavy, so pull a generous slice and let de-dup pick distinct items.
export const CONJUGATION_SET_FETCH_CAP = 300;

export function conjugationSignature(contentJson: unknown): string {
  const c = (contentJson ?? {}) as {
    lemma?: unknown;
    targetForm?: unknown;
    subject?: { pronoun?: unknown } | null;
  };
  const lemma = typeof c.lemma === 'string' ? c.lemma : '';
  const target = typeof c.targetForm === 'string' ? c.targetForm : '';
  const pronoun =
    c.subject && typeof c.subject.pronoun === 'string' ? c.subject.pronoun : '';
  return `${lemma}|${target}|${pronoun}`;
}

export function dedupeBySignature<T>(
  items: readonly T[],
  count: number,
  signatureOf: (item: T) => string,
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (out.length >= count) break;
    const sig = signatureOf(item);
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(item);
  }
  return out;
}
```

- [ ] **Step 4: Run → pass.** **Step 5: Commit** (`feat(lambda): distinct-by-content set composer`).

---

### Task 2: `GET /exercises/set` route

**Files:**
- Modify: `infra/lambda/src/routes/exercises.ts`
- Test: `infra/lambda/src/routes/exercises.test.ts`

**Interfaces — Consumes** Task 1. **Produces** `GET /exercises/set?language&difficulty&type&grammarPoint&count` → `200 { exercises: ExerciseResponse[], available: number }`. Approved + audio-ready filters; freshness order; de-dup by `grammarPointKey + conjugationSignature`; slice `count` (default 10, max 20).

- [ ] **Step 1: Failing route test** — add a `describe('GET /exercises/set', …)` mirroring the `GET /exercises` block: mock `db.select().from().where().orderBy().limit()` to resolve to candidate rows (include duplicate-content rows), assert the response de-dupes by content and caps at `count`. Reuse the file's `mockOrderBy`/`mockLimit` shape; the set handler uses the same `select→from→where→orderBy→limit` chain, so resolve `mockLimit` with the duplicate-laden rows.

- [ ] **Step 2: Run → fail** (404, route absent).

- [ ] **Step 3: Implement** — add after the `GET /exercises` handler:

```ts
const ExerciseSetQuerySchema = z.object({
  language: z.nativeEnum(Language),
  difficulty: z.nativeEnum(CefrLevel),
  type: z.nativeEnum(ExerciseType).optional(),
  grammarPoint: z.string().min(1).optional(),
  count: z.coerce.number().int().min(1).max(CONJUGATION_SET_MAX).optional(),
});

exercises.get('/exercises/set', async (c) => {
  const parsed = ExerciseSetQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json(
      { error: 'Invalid query parameters', code: 'VALIDATION_ERROR', details: parsed.error.flatten() },
      400,
    );
  }
  const { language, difficulty, type, grammarPoint: grammarPointKey, count } = parsed.data;
  const userId = c.get('userId');
  const target = count ?? CONJUGATION_SET_DEFAULT;

  const conditions = [
    eq(exercisesTable.language, language),
    eq(exercisesTable.difficulty, difficulty),
    approvedStatusFilter(exercisesTable),
    audioReadyFilter(exercisesTable),
  ];
  if (type) conditions.push(eq(exercisesTable.type, type));
  if (grammarPointKey) conditions.push(eq(exercisesTable.grammarPointKey, grammarPointKey));

  // Freshest-first window, then de-dupe by content signature and slice — no
  // in-session content repeats even though the pool holds duplicate rows.
  const rows = await db
    .select()
    .from(exercisesTable)
    .where(and(...conditions))
    .orderBy(freshFirstOrderBy(userId))
    .limit(CONJUGATION_SET_FETCH_CAP);

  const chosen = dedupeBySignature(
    rows,
    target,
    (row) => `${row.grammarPointKey ?? ''}|${conjugationSignature(row.contentJson)}`,
  );

  const exercisesOut = await Promise.all(
    chosen.map(async (row) => {
      const audioUrl = await presignAudioUrl(row.audioS3Key);
      return {
        id: row.id,
        type: row.type,
        language: row.language,
        difficulty: row.difficulty,
        grammarPointKey: row.grammarPointKey,
        contentJson: withAudioUrl(row.contentJson, audioUrl),
      };
    }),
  );

  return c.json({ exercises: exercisesOut, available: exercisesOut.length });
});
```

Add to the imports at the top: `import { conjugationSignature, dedupeBySignature, CONJUGATION_SET_DEFAULT, CONJUGATION_SET_MAX, CONJUGATION_SET_FETCH_CAP } from '../lib/exercise-set';`

- [ ] **Step 4: Run → pass.** **Step 5: Commit** (`feat(lambda): GET /exercises/set returns distinct-by-content set`).

---

### Task 3: `useExerciseSet` hook + schema (api-client)

**Files:**
- Modify: `packages/api-client/src/schemas/exercise.ts` (add `ExerciseSetResponseSchema` + type)
- Modify: `packages/api-client/src/hooks/useExercise.ts` (add `useExerciseSet`)
- Modify: `packages/api-client/src/index.ts` (export both)
- Test: `packages/api-client/src/hooks/useExercise.test.ts`

**Interfaces — Produces** `useExerciseSet({ language, difficulty, type?, grammarPointKey?, count?, fetchFn, enabled? })` → query of `{ exercises: ExerciseResponse[]; available: number }`.

- [ ] **Step 1: Failing test** mirroring `useExercise.test.ts`: mock `fetchFn` to return `{ exercises: [ex], available: 1 }`, assert the hook parses it and calls `/exercises/set?...&count=10`.

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement**

Schema (in `schemas/exercise.ts`, after `ExerciseResponseSchema`):
```ts
export const ExerciseSetResponseSchema = z.object({
  exercises: z.array(ExerciseResponseSchema),
  available: z.number().int().nonnegative(),
});
export type ExerciseSetResponse = z.infer<typeof ExerciseSetResponseSchema>;
```

Hook (in `hooks/useExercise.ts`):
```ts
export type UseExerciseSetParams = {
  language: Language;
  difficulty: CefrLevel;
  type?: ExerciseType;
  grammarPointKey?: string;
  count?: number;
  fetchFn: AuthenticatedFetch;
  enabled?: boolean;
};

export function useExerciseSet({
  language,
  difficulty,
  type,
  grammarPointKey,
  count,
  fetchFn,
  enabled = true,
}: UseExerciseSetParams) {
  return useQuery<ExerciseSetResponse, Error>({
    queryKey: ['exercise-set', language, difficulty, type, grammarPointKey, count],
    queryFn: async () => {
      const params = new URLSearchParams({ language, difficulty });
      if (type) params.set('type', type);
      if (grammarPointKey) params.set('grammarPoint', grammarPointKey);
      if (count) params.set('count', String(count));
      const response = await fetchFn(`/exercises/set?${params.toString()}`);
      const json: unknown = await response.json();
      return ExerciseSetResponseSchema.parse(json);
    },
    enabled,
    // The set is composed server-side per call; hold it stable for the sitting.
    // A fresh set ("practice more") is an explicit refetch().
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
```
Add `ExerciseSetResponseSchema`, `type ExerciseSetResponse` to the import block at the top of `useExercise.ts`, and export `useExerciseSet` + the schema/type from `index.ts`.

- [ ] **Step 4: Run → pass.** **Step 5: Commit** (`feat(api-client): useExerciseSet hook + schema`).

---

### Task 4: Conjugation page — iterate a fetched set

**Files:**
- Modify: `apps/web/app/(dashboard)/drill/conjugation/page.tsx`
- Test: `apps/web/app/(dashboard)/drill/conjugation/page.test.tsx`

**Change:** replace `useExercise` + `refetch()`-on-next with one `useExerciseSet({ ..., count: 10 })` iterated by a `currentIndex`. `next` advances the index (resetting `submission` to idle); the last item's button reads "see results" → `onFinish` (the existing review). `practice more` calls the set's `refetch()` (fresh distinct set) + resets index/review. Empty set → the existing "no conjugation exercises yet" message. Level/grammarPoint changes re-key the set and reset the index. Submissions, accumulation, finish-session, theory, flag, header, chips all unchanged.

- [ ] **Step 1: Refactor the page test** — swap the `useExercise` mock for `useExerciseSet` returning `{ exercises: [CONJUGATION_EXERCISE, SECOND_EXERCISE], available: 2 }` with a `refetch` spy. Update: the "advances on next" test now asserts item 2's prompt appears after `next` (no `refetch`); grammarPoint tests assert `useExerciseSet` called with `grammarPointKey`; empty-pool test uses `{ exercises: [], available: 0 }`; loading test uses `data: undefined`. Drop the three obsolete refetch-flash tests ("advances via refetch", "keeps feedback pinned", "swaps to clean idle prompt") — the flash they guarded can't occur with a pre-loaded array. Keep all finish-session/review/theory/flag/level tests.

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement** the page rewrite (exact code authored during execution against the read-back of the current page).

- [ ] **Step 4: Run page tests → pass; typecheck; web lint.**

- [ ] **Step 5: Commit** (`feat(conjugation): iterate a distinct pre-composed set (no in-session repeats)`).

---

### Task 5: Verify + report the pool-duplicate finding

**Files:**
- Create: `docs/findings/2026-06-28-conjugation-pool-duplicates.md`

- [ ] **Step 1:** Write the findings doc: the duplicate counts per pool (TR A1 144→56 distinct, 88 redundant; TR B1 218→105, 113; TR A2 77→62, 15; ES B1 110→99, 11), the example (`öğrencisin` ×5), root cause (generation produced duplicate content without a content-signature guard; low lemma diversity), blast radius (quick drill + fluency serve the same pool), and recommended remediation (content-signature de-dup of the pool + a generation-side uniqueness guard; separately, raise lemma diversity in the curriculum/coverage spec). Note the serve-time fix (this PR) already neutralizes in-session repeats.

- [ ] **Step 2:** Full gate — `pnpm lint && pnpm typecheck && pnpm test` (web in isolation if the all-package run flakes under parallel load).

- [ ] **Step 3: Commit** (`docs: report conjugation pool content-duplication`).

## Self-Review

- No-repeat (draw): Tasks 1–4 — distinct-by-content set, iterated client-side. ✓
- Robust to duplicates: de-dup at compose time (signature), no data migration. ✓
- Bounded length: `count` default 10. ✓
- Reuses finish-session review: last item → "see results" → existing recap. ✓
- Pool duplicates reported, not migrated (per decision). Task 5. ✓
- Types: `useExerciseSet` returns `{ exercises: ExerciseResponse[]; available }`; page indexes it; composer is generic. ✓
