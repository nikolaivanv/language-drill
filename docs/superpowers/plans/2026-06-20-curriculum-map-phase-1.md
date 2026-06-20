# Curriculum Map — Phase 1 (read-only map + endpoint) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Phase 1 of the Curriculum Map (design:
`docs/superpowers/specs/2026-06-20-curriculum-map-and-adaptive-plan-design.md`) —
a read-only, curriculum-ordered grammar-point map as the new default tab of
`/progress`, surfacing per-point mastery + error state + a per-level readiness
rollup, plus reusing the existing "work on these" block. No on-demand drilling,
plan changes, or readiness *action* yet (Phases 2–4).

**Architecture:** A new `GET /progress/curriculum` endpoint resolves the user's
active CEFR level, fetches `user_grammar_mastery` + recent `error_observations`
counts, and feeds a **pure classifier** (`buildCurriculumMap`) that joins them
with the curriculum (active level in full + a compact next-level preview),
classifying each point as `not-started | learning | solid` with an `errorProne`
overlay and a per-level `readyToAdvance` rollup. A new api-client schema + hook
deliver it; the `/progress` page gains a **map** tab (default) rendering the
prototype's **spine** cell design (`cmap/`), with the reviewed refinements
(mastery bar in-row, collapsed solid runs, error-prone rows visually hottest).
The macro-skill radar is demoted to a secondary **shape** tab.

**Tech Stack:** TypeScript, Hono (AWS Lambda), Drizzle, Zod, TanStack Query,
Next.js (App Router) + React, Vitest + Testing Library.

## Global Constraints

- **The web/api-client must NOT import `@language-drill/db` or the curriculum.**
  All curriculum facts (names, order, prereq names, level membership) are
  resolved server-side in the endpoint and delivered as plain
  strings/numbers in the response (same rule as the rest of the app).
- **State classification (initial, tunable — keep as named constants):**
  `solid` ⇔ `masteryScore ≥ 0.80` **and** `confidence ≥ 0.60`; `learning` ⇔
  has a mastery row with `evidenceCount ≥ 1` but not solid; `not-started` ⇔ no
  mastery row (or `evidenceCount === 0`). `errorProne` overlay ⇔ `≥ 2`
  attributed errors in the trailing `30 days`. `readyToAdvance` ⇔
  `solidCount / total ≥ 0.80` of a level's grammar points.
- **Phase 1 is read-only.** Map cells are **display-only** (no tap-to-drill /
  detail sheet — Phase 2). The readiness strip shows the rollup + bar + an
  honest "you've made A1 solid" line, but the **"add A2" action button is NOT
  wired** (Phase 4) — do not render a functional advance button.
- **Active level** = `user_language_profiles.proficiencyLevel` (default
  `CefrLevel.B1` when absent/invalid), resolved exactly as `sessions.ts` does.
- **Effective error point** = `errorGrammarPointKey ?? hostGrammarPointKey`
  (matches the rest of the error-observation consumers).
- **Languages uppercase** (`TR`/`ES`/`DE`); `LearningLanguage` excludes EN.
- **Visual reference:** the Claude Design prototype project
  `d676e7c3-d8fe-495f-a250-94c38e174fbd`, files `cmap/map.jsx` (the **spine**
  variant + readiness strip + legend + A2 preview), `cmap/cmap.css`. Port the
  spine variant; remap its prototype tokens (`--accent`, `--ink`, `--paper-2`,
  `--rule`, `--r-md`, `t-micro`, `t-mono`, `chip`, `card`, etc.) to the app's
  existing CSS tokens/classes (see the "Free-writing prototype CSS port" pattern
  — the app's `globals.css` already defines these tokens).
- **Build/test ordering:** after editing `packages/*` run `pnpm build` (turbo)
  before dependent typecheck/tests. Before the Lambda suite, `rm -rf
  infra/lambda/dist`. The FULL gate is the real check: `pnpm lint && pnpm
  typecheck && pnpm test` from repo root with real exit codes (do NOT pipe
  through `tail`/`head`).
- **Do NOT run `pnpm db:migrate`** (local `.env` → shared dev branch). **No
  schema/migration change** is needed — every table/column already exists.
- **Git commit trailer (every commit):**
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## File Structure

- **Create** `infra/lambda/src/lib/curriculum-map.ts` — pure `buildCurriculumMap`
  + `nextCefrLevel` + state/readiness helpers + types. No DB/network.
- **Create** `infra/lambda/src/lib/curriculum-map.test.ts` — its tests.
- **Modify** `infra/lambda/src/routes/progress.ts` — add `GET /progress/curriculum`.
- **Modify** `infra/lambda/src/routes/progress.test.ts` — endpoint test.
- **Create** `packages/api-client/src/schemas/curriculum.ts` — response schema + types.
- **Create** `packages/api-client/src/schemas/curriculum.test.ts` — schema tests.
- **Create** `packages/api-client/src/hooks/useCurriculumMap.ts` — the hook.
- **Modify** `packages/api-client/src/index.ts` — export schema + hook.
- **Modify** `apps/web/app/(dashboard)/progress/_lib/use-tab-url-state.ts` — add
  `map` tab id, make it default.
- **Modify** `apps/web/app/(dashboard)/progress/_components/progress-tabs.tsx` —
  add the `map` label + ref slot.
- **Modify** `apps/web/app/(dashboard)/progress/page.tsx` — fetch
  `useCurriculumMap` + `useInsightsErrors`; render `MapTab`.
- **Create** `apps/web/app/(dashboard)/progress/_components/map-tab.tsx` — the
  Map view (readiness strip, legend, spine list, next-level preview, work-on-these).
- **Create** `apps/web/app/(dashboard)/progress/_lib/collapse-solid-runs.ts` —
  pure helper that collapses consecutive `solid` points.
- **Create** `apps/web/app/(dashboard)/progress/_lib/__tests__/collapse-solid-runs.test.ts`.
- **Create** `apps/web/app/(dashboard)/progress/_components/__tests__/map-tab.test.tsx`.

---

### Task 1: Pure curriculum-map classifier (lambda lib)

**Files:**
- Create: `infra/lambda/src/lib/curriculum-map.ts`
- Test: `infra/lambda/src/lib/curriculum-map.test.ts`

**Interfaces:**
- Consumes: per-point inputs the route supplies (curriculum facts + a mastery
  map + an error-count map).
- Produces:
  - `type PointState = 'not-started' | 'learning' | 'solid'`
  - `type MapPoint = { key; name; cefrLevel; order; state; errorProne; mastery: number|null; confidence: number|null; evidenceCount: number; lastPracticedAt: string|null; recentErrorCount: number; prereqKeys: string[]; prereqNames: string[]; prereqUnmet: boolean }`
  - `type MapLevel = { level: string; solidCount: number; total: number; readyToAdvance: boolean; isPreview: boolean; points: MapPoint[] }`
  - `nextCefrLevel(level: string): string | null`
  - `buildCurriculumMap(input: BuildInput): { activeLevel: string; levels: MapLevel[] }`
  - `BuildInput = { activeLevel: string; activePoints: CurriculumFact[]; previewPoints: CurriculumFact[]; masteryByKey: ReadonlyMap<string, MasteryRow>; errorCountByKey: ReadonlyMap<string, number>; now: Date }`
  - `CurriculumFact = { key; name; cefrLevel; order; prereqKeys: string[]; prereqNames: string[] }`
  - `MasteryRow = { masteryScore: number; confidence: number; evidenceCount: number; lastPracticedAt: Date }`

- [ ] **Step 1: Write the failing tests**

Create `infra/lambda/src/lib/curriculum-map.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildCurriculumMap, nextCefrLevel } from './curriculum-map';

const fact = (over: Partial<{ key: string; name: string; cefrLevel: string; order: number; prereqKeys: string[]; prereqNames: string[] }> = {}) => ({
  key: 'tr-a1-x',
  name: 'X',
  cefrLevel: 'A1',
  order: 1,
  prereqKeys: [],
  prereqNames: [],
  ...over,
});
const mastery = (over: Partial<{ masteryScore: number; confidence: number; evidenceCount: number; lastPracticedAt: Date }> = {}) => ({
  masteryScore: 0.9,
  confidence: 0.8,
  evidenceCount: 5,
  lastPracticedAt: new Date('2026-06-10T00:00:00Z'),
  ...over,
});
const now = new Date('2026-06-20T00:00:00Z');

describe('nextCefrLevel', () => {
  it('walks A1→A2→B1→B2→null', () => {
    expect(nextCefrLevel('A1')).toBe('A2');
    expect(nextCefrLevel('A2')).toBe('B1');
    expect(nextCefrLevel('B2')).toBeNull();
    expect(nextCefrLevel('C1')).toBeNull();
  });
});

describe('buildCurriculumMap — state classification', () => {
  const base = {
    activeLevel: 'A1',
    previewPoints: [],
    errorCountByKey: new Map<string, number>(),
    now,
  };

  it('classifies not-started (no mastery row) / learning / solid', () => {
    const points = [
      fact({ key: 'a', order: 1 }),
      fact({ key: 'b', order: 2 }),
      fact({ key: 'c', order: 3 }),
    ];
    const masteryByKey = new Map([
      ['b', mastery({ masteryScore: 0.5, confidence: 0.4, evidenceCount: 2 })], // learning
      ['c', mastery({ masteryScore: 0.85, confidence: 0.7, evidenceCount: 4 })], // solid
    ]);
    const out = buildCurriculumMap({ ...base, activePoints: points, masteryByKey });
    const byKey = Object.fromEntries(out.levels[0].points.map((p) => [p.key, p.state]));
    expect(byKey).toEqual({ a: 'not-started', b: 'learning', c: 'solid' });
  });

  it('treats evidenceCount 0 as not-started even with a mastery row', () => {
    const out = buildCurriculumMap({
      ...base,
      activePoints: [fact({ key: 'a' })],
      masteryByKey: new Map([['a', mastery({ evidenceCount: 0 })]]),
    });
    expect(out.levels[0].points[0].state).toBe('not-started');
  });

  it('requires BOTH mastery>=0.80 and confidence>=0.60 for solid', () => {
    const out = buildCurriculumMap({
      ...base,
      activePoints: [fact({ key: 'a' }), fact({ key: 'b', order: 2 })],
      masteryByKey: new Map([
        ['a', mastery({ masteryScore: 0.85, confidence: 0.5 })], // conf too low → learning
        ['b', mastery({ masteryScore: 0.7, confidence: 0.9 })], // mastery too low → learning
      ]),
    });
    expect(out.levels[0].points.map((p) => p.state)).toEqual(['learning', 'learning']);
  });

  it('flags errorProne at >=2 recent errors (overlay co-exists with solid)', () => {
    const out = buildCurriculumMap({
      ...base,
      activePoints: [fact({ key: 'a' })],
      masteryByKey: new Map([['a', mastery()]]), // solid
      errorCountByKey: new Map([['a', 3]]),
    });
    expect(out.levels[0].points[0]).toMatchObject({ state: 'solid', errorProne: true, recentErrorCount: 3 });
  });

  it('marks prereqUnmet when a prereq is not solid, resolving its name', () => {
    const out = buildCurriculumMap({
      ...base,
      activePoints: [
        fact({ key: 'vh', name: 'Vowel harmony', order: 1 }),
        fact({ key: 'loc', name: 'Locative', order: 2, prereqKeys: ['vh'], prereqNames: ['Vowel harmony'] }),
      ],
      masteryByKey: new Map(), // vh not solid
    });
    const loc = out.levels[0].points.find((p) => p.key === 'loc')!;
    expect(loc.prereqUnmet).toBe(true);
  });

  it('computes the per-level solid rollup + readyToAdvance at >=80%', () => {
    const pts = Array.from({ length: 5 }, (_, i) => fact({ key: `k${i}`, order: i + 1 }));
    const m = new Map(pts.slice(0, 4).map((p) => [p.key, mastery()])); // 4/5 solid = 80%
    const out = buildCurriculumMap({ ...base, activePoints: pts, masteryByKey: m });
    expect(out.levels[0]).toMatchObject({ solidCount: 4, total: 5, readyToAdvance: true });
  });

  it('appends the next level as a preview (isPreview true)', () => {
    const out = buildCurriculumMap({
      ...base,
      activePoints: [fact({ key: 'a' })],
      previewPoints: [fact({ key: 'a2', name: 'Aorist', cefrLevel: 'A2', order: 1 })],
      masteryByKey: new Map(),
    });
    expect(out.levels.map((l) => [l.level, l.isPreview])).toEqual([['A1', false], ['A2', true]]);
  });

  it('serializes lastPracticedAt as an ISO string and nulls it when absent', () => {
    const out = buildCurriculumMap({
      ...base,
      activePoints: [fact({ key: 'a' }), fact({ key: 'b', order: 2 })],
      masteryByKey: new Map([['a', mastery({ lastPracticedAt: new Date('2026-06-10T00:00:00Z') })]]),
    });
    const byKey = Object.fromEntries(out.levels[0].points.map((p) => [p.key, p.lastPracticedAt]));
    expect(byKey).toEqual({ a: '2026-06-10T00:00:00.000Z', b: null });
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `rm -rf infra/lambda/dist && pnpm --filter @language-drill/lambda test -- curriculum-map.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `infra/lambda/src/lib/curriculum-map.ts`:

```typescript
// Pure classifier for GET /progress/curriculum. Joins curriculum facts (supplied
// by the route — keeps this lib free of any DB/curriculum import) with mastery +
// recent-error maps into level-grouped, state-classified points + a readiness
// rollup. No I/O. Initial thresholds are named constants (design spec §Tunable).

export const SOLID_MASTERY = 0.8;
export const SOLID_CONFIDENCE = 0.6;
export const ERROR_PRONE_MIN = 2;
export const READINESS_RATIO = 0.8;

const CEFR_ORDER = ['A1', 'A2', 'B1', 'B2'] as const;

export function nextCefrLevel(level: string): string | null {
  const i = CEFR_ORDER.indexOf(level as (typeof CEFR_ORDER)[number]);
  if (i < 0 || i >= CEFR_ORDER.length - 1) return null;
  return CEFR_ORDER[i + 1];
}

export type PointState = 'not-started' | 'learning' | 'solid';

export type CurriculumFact = {
  key: string;
  name: string;
  cefrLevel: string;
  order: number;
  prereqKeys: string[];
  prereqNames: string[];
};

export type MasteryRow = {
  masteryScore: number;
  confidence: number;
  evidenceCount: number;
  lastPracticedAt: Date;
};

export type MapPoint = {
  key: string;
  name: string;
  cefrLevel: string;
  order: number;
  state: PointState;
  errorProne: boolean;
  mastery: number | null;
  confidence: number | null;
  evidenceCount: number;
  lastPracticedAt: string | null;
  recentErrorCount: number;
  prereqKeys: string[];
  prereqNames: string[];
  prereqUnmet: boolean;
};

export type MapLevel = {
  level: string;
  solidCount: number;
  total: number;
  readyToAdvance: boolean;
  isPreview: boolean;
  points: MapPoint[];
};

export type BuildInput = {
  activeLevel: string;
  activePoints: readonly CurriculumFact[];
  previewPoints: readonly CurriculumFact[];
  masteryByKey: ReadonlyMap<string, MasteryRow>;
  errorCountByKey: ReadonlyMap<string, number>;
  now: Date;
};

function classify(m: MasteryRow | undefined): PointState {
  if (!m || m.evidenceCount === 0) return 'not-started';
  if (m.masteryScore >= SOLID_MASTERY && m.confidence >= SOLID_CONFIDENCE) return 'solid';
  return 'learning';
}

function isSolid(key: string, masteryByKey: ReadonlyMap<string, MasteryRow>): boolean {
  return classify(masteryByKey.get(key)) === 'solid';
}

function toPoint(
  f: CurriculumFact,
  masteryByKey: ReadonlyMap<string, MasteryRow>,
  errorCountByKey: ReadonlyMap<string, number>,
): MapPoint {
  const m = masteryByKey.get(f.key);
  const state = classify(m);
  const recentErrorCount = errorCountByKey.get(f.key) ?? 0;
  return {
    key: f.key,
    name: f.name,
    cefrLevel: f.cefrLevel,
    order: f.order,
    state,
    errorProne: recentErrorCount >= ERROR_PRONE_MIN,
    mastery: m ? m.masteryScore : null,
    confidence: m ? m.confidence : null,
    evidenceCount: m ? m.evidenceCount : 0,
    lastPracticedAt: m ? m.lastPracticedAt.toISOString() : null,
    recentErrorCount,
    prereqKeys: f.prereqKeys,
    prereqNames: f.prereqNames,
    prereqUnmet: f.prereqKeys.some((pk) => !isSolid(pk, masteryByKey)),
  };
}

function buildLevel(
  level: string,
  facts: readonly CurriculumFact[],
  masteryByKey: ReadonlyMap<string, MasteryRow>,
  errorCountByKey: ReadonlyMap<string, number>,
  isPreview: boolean,
): MapLevel {
  const points = [...facts]
    .sort((a, b) => a.order - b.order)
    .map((f) => toPoint(f, masteryByKey, errorCountByKey));
  const solidCount = points.filter((p) => p.state === 'solid').length;
  const total = points.length;
  return {
    level,
    solidCount,
    total,
    readyToAdvance: total > 0 && solidCount / total >= READINESS_RATIO,
    isPreview,
    points,
  };
}

export function buildCurriculumMap(input: BuildInput): { activeLevel: string; levels: MapLevel[] } {
  const { activeLevel, activePoints, previewPoints, masteryByKey, errorCountByKey } = input;
  const levels: MapLevel[] = [
    buildLevel(activeLevel, activePoints, masteryByKey, errorCountByKey, false),
  ];
  if (previewPoints.length > 0) {
    const previewLevel = previewPoints[0].cefrLevel;
    levels.push(buildLevel(previewLevel, previewPoints, masteryByKey, errorCountByKey, true));
  }
  return { activeLevel, levels };
}
```

- [ ] **Step 4: Run, verify pass**

Run: `rm -rf infra/lambda/dist && pnpm --filter @language-drill/lambda test -- curriculum-map.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/lib/curriculum-map.ts infra/lambda/src/lib/curriculum-map.test.ts
git commit -m "feat(lambda): pure curriculum-map classifier (state + readiness rollup)"
```

---

### Task 2: `GET /progress/curriculum` endpoint (lambda)

**Files:**
- Modify: `infra/lambda/src/routes/progress.ts`
- Test: `infra/lambda/src/routes/progress.test.ts`

**Interfaces:**
- Consumes: `buildCurriculumMap`, `nextCefrLevel` (Task 1); `grammarPointsAtOrBelow`,
  `getGrammarPoint` (from `@language-drill/db`); `curriculumOrderOf` (from
  `@language-drill/db`); `userGrammarMastery`, `errorObservations`,
  `userLanguageProfiles` (schema).
- Produces: `GET /progress/curriculum?language=<TR|ES|DE>` → `{ language,
  activeLevel, levels: MapLevel[] }` (JSON; the classifier output + `language`).

- [ ] **Step 1: Write the failing test**

Add to `infra/lambda/src/routes/progress.test.ts` an integration test modeled on
the existing `/progress/radar` tests in that file (reuse the same app/mock-DB
harness — grep the file for how it builds the Hono app + stubs `db.select`).
Seed: a TR profile at A1; a `user_grammar_mastery` row for `tr-a1-vowel-harmony`
(solid) and a recent `error_observations` row attributed to
`tr-a1-accusative-definite-object`. Assert the response has `activeLevel: 'A1'`,
the A1 level present with a `points` array, the vowel-harmony point `state:
'solid'`, the accusative point `errorProne: true`, and an A2 preview level with
`isPreview: true`.

```typescript
it('GET /progress/curriculum returns level-grouped classified points', async () => {
  // ...seed profile A1 + mastery(vowel-harmony solid) + error(accusative)...
  const res = await app.request('/progress/curriculum?language=TR', { headers: authHeaders });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.activeLevel).toBe('A1');
  const a1 = body.levels.find((l: any) => l.level === 'A1');
  expect(a1.points.find((p: any) => p.key === 'tr-a1-vowel-harmony').state).toBe('solid');
  expect(a1.points.find((p: any) => p.key === 'tr-a1-accusative-definite-object').errorProne).toBe(true);
  expect(body.levels.some((l: any) => l.isPreview)).toBe(true);
});
```

- [ ] **Step 2: Run, verify fail**

Run: `rm -rf infra/lambda/dist && pnpm --filter @language-drill/lambda test -- progress.test.ts`
Expected: FAIL — route 404 / not defined.

- [ ] **Step 3: Add imports**

In `infra/lambda/src/routes/progress.ts`, extend the `@language-drill/db` import
to add `userGrammarMastery, errorObservations, userLanguageProfiles,
grammarPointsAtOrBelow, getGrammarPoint, curriculumOrderOf` (the radar handler
currently imports only `exercises, userExerciseHistory`). Add
`import { buildCurriculumMap, nextCefrLevel, type CurriculumFact, type MasteryRow } from '../lib/curriculum-map';`
and `import { sql } from 'drizzle-orm';` (for the COUNT group-by). `CefrLevel`,
`Language`, `isCefrLevel`, `db`, `and`, `eq`, `gte` are already imported.

- [ ] **Step 4: Add the handler**

Add a sibling route after the `/progress/radar` handler (reuse `RadarQuerySchema`
— same `{ language }` shape; or define `const CurriculumQuerySchema =
RadarQuerySchema`). Constants near the top: `const ERROR_WINDOW_DAYS = 30;`,
`const DEFAULT_PROFICIENCY_LEVEL = CefrLevel.B1;`.

```typescript
progress.get('/progress/curriculum', async (c) => {
  const parsed = RadarQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'Invalid query parameters', code: 'VALIDATION_ERROR', details: parsed.error.flatten() }, 400);
  }
  const { language } = parsed.data;
  const userId = c.get('userId');
  const now = new Date();
  const errorSince = new Date(now.getTime() - ERROR_WINDOW_DAYS * 86_400_000);

  // Active level
  const profileRows = await db
    .select({ proficiencyLevel: userLanguageProfiles.proficiencyLevel })
    .from(userLanguageProfiles)
    .where(and(eq(userLanguageProfiles.userId, userId), eq(userLanguageProfiles.language, language)))
    .limit(1);
  const activeLevel = isCefrLevel(profileRows[0]?.proficiencyLevel) ? profileRows[0].proficiencyLevel : DEFAULT_PROFICIENCY_LEVEL;

  // Mastery rows + recent-error counts (effective point) in parallel
  const [masteryRows, errorRows] = await Promise.all([
    db
      .select({
        grammarPointKey: userGrammarMastery.grammarPointKey,
        masteryScore: userGrammarMastery.masteryScore,
        confidence: userGrammarMastery.confidence,
        evidenceCount: userGrammarMastery.evidenceCount,
        lastPracticedAt: userGrammarMastery.lastPracticedAt,
      })
      .from(userGrammarMastery)
      .where(and(eq(userGrammarMastery.userId, userId), eq(userGrammarMastery.language, language))),
    db
      .select({
        key: sql<string>`COALESCE(${errorObservations.errorGrammarPointKey}, ${errorObservations.hostGrammarPointKey})`,
        n: sql<number>`COUNT(*)::int`,
      })
      .from(errorObservations)
      .where(and(eq(errorObservations.userId, userId), eq(errorObservations.language, language), gte(errorObservations.occurredAt, errorSince)))
      .groupBy(sql`COALESCE(${errorObservations.errorGrammarPointKey}, ${errorObservations.hostGrammarPointKey})`),
  ]);

  const masteryByKey = new Map<string, MasteryRow>();
  for (const r of masteryRows) {
    if (r.lastPracticedAt === null) continue;
    masteryByKey.set(r.grammarPointKey, {
      masteryScore: r.masteryScore,
      confidence: r.confidence,
      evidenceCount: r.evidenceCount,
      lastPracticedAt: r.lastPracticedAt,
    });
  }
  const errorCountByKey = new Map<string, number>();
  for (const r of errorRows) if (r.key) errorCountByKey.set(r.key, r.n);

  // Curriculum facts: active level (exactly) + next level preview (first 5)
  const all = grammarPointsAtOrBelow(language, CefrLevel.B2); // grammar-kind, this language
  const toFact = (p: (typeof all)[number]): CurriculumFact => ({
    key: p.key,
    name: p.name,
    cefrLevel: p.cefrLevel,
    order: curriculumOrderOf(p.key) ?? 0,
    prereqKeys: [...(p.prerequisiteKeys ?? [])],
    prereqNames: (p.prerequisiteKeys ?? []).map((pk) => getGrammarPoint(pk)?.name ?? pk),
  });
  const activePoints = all.filter((p) => p.cefrLevel === activeLevel).map(toFact);
  const nl = nextCefrLevel(activeLevel);
  const previewPoints = nl
    ? all.filter((p) => p.cefrLevel === nl).map(toFact).sort((a, b) => a.order - b.order).slice(0, 5)
    : [];

  const result = buildCurriculumMap({ activeLevel, activePoints, previewPoints, masteryByKey, errorCountByKey, now });
  return c.json({ language, ...result });
});
```

- [ ] **Step 5: Run, verify pass**

Run: `rm -rf infra/lambda/dist && pnpm --filter @language-drill/lambda test -- progress.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add infra/lambda/src/routes/progress.ts infra/lambda/src/routes/progress.test.ts
git commit -m "feat(lambda): GET /progress/curriculum — per-point map + readiness rollup"
```

---

### Task 3: api-client schema + hook

**Files:**
- Create: `packages/api-client/src/schemas/curriculum.ts`
- Create: `packages/api-client/src/schemas/curriculum.test.ts`
- Create: `packages/api-client/src/hooks/useCurriculumMap.ts`
- Modify: `packages/api-client/src/index.ts`

**Interfaces:**
- Produces: `CurriculumMapResponseSchema`, `type CurriculumMapResponse`,
  `type CurriculumMapPoint`, `type CurriculumMapLevel`; `useCurriculumMap(params)`.

- [ ] **Step 1: Write the failing schema test**

Create `packages/api-client/src/schemas/curriculum.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { CurriculumMapResponseSchema } from './curriculum';

const point = (over = {}) => ({
  key: 'tr-a1-vowel-harmony', name: 'Vowel harmony', cefrLevel: 'A1', order: 1,
  state: 'solid', errorProne: false, mastery: 0.9, confidence: 0.8, evidenceCount: 5,
  lastPracticedAt: '2026-06-10T00:00:00.000Z', recentErrorCount: 0,
  prereqKeys: [], prereqNames: [], prereqUnmet: false, ...over,
});

describe('CurriculumMapResponseSchema', () => {
  it('parses a valid payload', () => {
    const r = CurriculumMapResponseSchema.safeParse({
      language: 'TR', activeLevel: 'A1',
      levels: [{ level: 'A1', solidCount: 1, total: 1, readyToAdvance: true, isPreview: false, points: [point()] }],
    });
    expect(r.success).toBe(true);
  });
  it('accepts null mastery/lastPracticedAt for not-started points', () => {
    const r = CurriculumMapResponseSchema.safeParse({
      language: 'TR', activeLevel: 'A1',
      levels: [{ level: 'A1', solidCount: 0, total: 1, readyToAdvance: false, isPreview: false,
        points: [point({ state: 'not-started', mastery: null, confidence: null, evidenceCount: 0, lastPracticedAt: null })] }],
    });
    expect(r.success).toBe(true);
  });
  it('rejects an unknown state', () => {
    const r = CurriculumMapResponseSchema.safeParse({
      language: 'TR', activeLevel: 'A1',
      levels: [{ level: 'A1', solidCount: 0, total: 1, readyToAdvance: false, isPreview: false, points: [point({ state: 'mastered' })] }],
    });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter @language-drill/api-client test -- curriculum.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the schema**

Create `packages/api-client/src/schemas/curriculum.ts`:

```typescript
import { z } from 'zod';
import { LearningLanguageEnum } from './preferences';

export const PointStateEnum = z.enum(['not-started', 'learning', 'solid']);
export type PointState = z.infer<typeof PointStateEnum>;

export const CurriculumMapPointSchema = z.object({
  key: z.string(),
  name: z.string(),
  cefrLevel: z.string(),
  order: z.number().int(),
  state: PointStateEnum,
  errorProne: z.boolean(),
  mastery: z.number().min(0).max(1).nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  evidenceCount: z.number().int().min(0),
  lastPracticedAt: z.string().datetime().nullable(),
  recentErrorCount: z.number().int().min(0),
  prereqKeys: z.array(z.string()),
  prereqNames: z.array(z.string()),
  prereqUnmet: z.boolean(),
});
export type CurriculumMapPoint = z.infer<typeof CurriculumMapPointSchema>;

export const CurriculumMapLevelSchema = z.object({
  level: z.string(),
  solidCount: z.number().int().min(0),
  total: z.number().int().min(0),
  readyToAdvance: z.boolean(),
  isPreview: z.boolean(),
  points: z.array(CurriculumMapPointSchema),
});
export type CurriculumMapLevel = z.infer<typeof CurriculumMapLevelSchema>;

export const CurriculumMapResponseSchema = z.object({
  language: LearningLanguageEnum,
  activeLevel: z.string(),
  levels: z.array(CurriculumMapLevelSchema),
});
export type CurriculumMapResponse = z.infer<typeof CurriculumMapResponseSchema>;
```

- [ ] **Step 4: Implement the hook**

Create `packages/api-client/src/hooks/useCurriculumMap.ts` (mirror
`useProgressRadar`):

```typescript
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { LearningLanguage } from '@language-drill/shared';
import { CurriculumMapResponseSchema, type CurriculumMapResponse } from '../schemas/curriculum';
import type { AuthenticatedFetch } from '../fetchClient';

const STALE_TIME_MS = 5 * 60 * 1000;

export type UseCurriculumMapParams = {
  fetchFn: AuthenticatedFetch;
  language: LearningLanguage;
  enabled?: boolean;
};

export function useCurriculumMap({ fetchFn, language, enabled = true }: UseCurriculumMapParams): UseQueryResult<CurriculumMapResponse, Error> {
  return useQuery<CurriculumMapResponse, Error>({
    queryKey: ['curriculumMap', language],
    queryFn: async () => {
      const response = await fetchFn(`/progress/curriculum?language=${encodeURIComponent(language)}`);
      const json: unknown = await response.json();
      return CurriculumMapResponseSchema.parse(json);
    },
    enabled,
    staleTime: STALE_TIME_MS,
  });
}
```

- [ ] **Step 5: Export from index**

In `packages/api-client/src/index.ts`, add beside the progress/insights exports:

```typescript
export {
  PointStateEnum,
  CurriculumMapPointSchema,
  CurriculumMapLevelSchema,
  CurriculumMapResponseSchema,
  type PointState,
  type CurriculumMapPoint,
  type CurriculumMapLevel,
  type CurriculumMapResponse,
} from './schemas/curriculum';
export { useCurriculumMap, type UseCurriculumMapParams } from './hooks/useCurriculumMap';
```

- [ ] **Step 6: Build + run, verify pass**

Run: `pnpm --filter @language-drill/api-client build && pnpm --filter @language-drill/api-client test -- curriculum.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/api-client/src/schemas/curriculum.ts packages/api-client/src/schemas/curriculum.test.ts packages/api-client/src/hooks/useCurriculumMap.ts packages/api-client/src/index.ts
git commit -m "feat(api-client): CurriculumMapResponse schema + useCurriculumMap hook"
```

---

### Task 4: `/progress` tabs — add `map` (default), demote `shape`

**Files:**
- Modify: `apps/web/app/(dashboard)/progress/_lib/use-tab-url-state.ts`
- Modify: `apps/web/app/(dashboard)/progress/_components/progress-tabs.tsx`

**Interfaces:**
- Produces: `PROGRESS_TAB_IDS = ['map','shape','fluency','history']`,
  `DEFAULT_TAB = 'map'`; `TAB_LABELS` gains `map: 'map'`.

- [ ] **Step 1: Update the URL-state helper**

In `use-tab-url-state.ts`, change:

```typescript
export const PROGRESS_TAB_IDS = ['map', 'shape', 'fluency', 'history'] as const;
export type ProgressTabId = (typeof PROGRESS_TAB_IDS)[number];

const DEFAULT_TAB: ProgressTabId = 'map';
```

- [ ] **Step 2: Update the tablist**

In `progress-tabs.tsx`: add `map: 'map'` to `TAB_LABELS`, and add `map: null` to
the `buttonRefs.current` initializer object (it lists every tab id; the
`Record<ProgressTabId, …>` type now requires `map`).

- [ ] **Step 3: Verify the existing tab tests still pass**

Run: `pnpm --filter @language-drill/web test -- progress-tabs`
Expected: PASS (grep for any test asserting the exact tab id list — if one
pins `['shape','fluency','history']`, update it to include `map` first).

- [ ] **Step 4: Commit** (with Task 5 — the page render depends on the new tab;
  commit together after Task 5.)

---

### Task 5: The Map view (`MapTab`) + collapse-solid-runs helper

**Files:**
- Create: `apps/web/app/(dashboard)/progress/_lib/collapse-solid-runs.ts`
- Create: `apps/web/app/(dashboard)/progress/_lib/__tests__/collapse-solid-runs.test.ts`
- Create: `apps/web/app/(dashboard)/progress/_components/map-tab.tsx`
- Create: `apps/web/app/(dashboard)/progress/_components/__tests__/map-tab.test.tsx`
- Modify: `apps/web/app/(dashboard)/progress/page.tsx`

**Interfaces:**
- Consumes: `useCurriculumMap`, `useInsightsErrors`, `WorkOnThese`,
  `CurriculumMapResponse`/`CurriculumMapPoint` (Task 3); the prototype `cmap/map.jsx`
  spine variant as the visual reference.
- Produces: `collapseSolidRuns(points): Array<{kind:'point';point}|{kind:'run';count;points}>`;
  `MapTab` component.

- [ ] **Step 1: Write the failing helper test**

Create `collapse-solid-runs.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { collapseSolidRuns } from '../collapse-solid-runs';
import type { CurriculumMapPoint } from '@language-drill/api-client';

const p = (key: string, state: CurriculumMapPoint['state'], errorProne = false) =>
  ({ key, state, errorProne } as CurriculumMapPoint);

describe('collapseSolidRuns', () => {
  it('collapses a run of >=3 consecutive non-error solids into one run entry', () => {
    const out = collapseSolidRuns([p('a', 'learning'), p('b', 'solid'), p('c', 'solid'), p('d', 'solid'), p('e', 'not-started')]);
    expect(out.map((e) => e.kind)).toEqual(['point', 'run', 'point']);
    const run = out[1] as { kind: 'run'; count: number };
    expect(run.count).toBe(3);
  });
  it('does NOT collapse runs shorter than 3', () => {
    const out = collapseSolidRuns([p('a', 'solid'), p('b', 'solid'), p('c', 'learning')]);
    expect(out.every((e) => e.kind === 'point')).toBe(true);
  });
  it('never collapses an error-prone solid (it must stay visible)', () => {
    const out = collapseSolidRuns([p('a', 'solid'), p('b', 'solid', true), p('c', 'solid'), p('d', 'solid')]);
    // error-prone 'b' breaks the run; remaining are <3 or include the flagged one
    expect(out.some((e) => e.kind === 'point' && (e as any).point.key === 'b')).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify fail** — `pnpm --filter @language-drill/web test -- collapse-solid-runs` → FAIL.

- [ ] **Step 3: Implement the helper**

Create `collapse-solid-runs.ts`:

```typescript
import type { CurriculumMapPoint } from '@language-drill/api-client';

export type MapEntry =
  | { kind: 'point'; point: CurriculumMapPoint }
  | { kind: 'run'; count: number; points: CurriculumMapPoint[] };

const MIN_RUN = 3;

// Collapse runs of >=3 consecutive solid, NON-error-prone points so the eye lands
// on learning / error-prone points. An error-prone point always renders on its own.
export function collapseSolidRuns(points: readonly CurriculumMapPoint[]): MapEntry[] {
  const out: MapEntry[] = [];
  let run: CurriculumMapPoint[] = [];
  const flush = () => {
    if (run.length >= MIN_RUN) out.push({ kind: 'run', count: run.length, points: run });
    else for (const p of run) out.push({ kind: 'point', point: p });
    run = [];
  };
  for (const p of points) {
    if (p.state === 'solid' && !p.errorProne) run.push(p);
    else { flush(); out.push({ kind: 'point', point: p }); }
  }
  flush();
  return out;
}
```

- [ ] **Step 4: Run, verify pass** — same command → PASS.

- [ ] **Step 5: Build the `MapTab` component (port the prototype spine variant)**

Create `map-tab.tsx`. Port the structure of the prototype's `cmap/map.jsx`
`MapTab` + `SpineList` (the **spine** variant), adapting to the app's
tokens/components and the real `CurriculumMapResponse` data. Structural
requirements (the prototype is the visual reference for exact styling — remap its
tokens to the app's `globals.css`):

- **Props:** `{ data: CurriculumMapResponse | undefined; isLoading; error; onRetry; errorThemes }`.
- **Readiness strip** (per active level): "*N of M A1 grammar points solid*" with
  a progress bar at `solidCount/total`. When `readyToAdvance`, an honest line
  "*you've made A1 solid — adding A2 widens your daily plan.*" **No functional
  "add A2" button** (Phase 4) — display only.
- **Legend:** not-started · learning · solid · ⚠ still generating errors.
- **Level head:** the level label + "active level · curriculum order".
- **Spine list:** for the active level, run `collapseSolidRuns(level.points)` and
  render each entry. A `point` entry = a spine row (rail node showing `✓` when
  solid else the 2-digit order; connecting line) + body (name; a **thin mastery
  bar** at `point.mastery` under the name — the locked refinement; the `⚠ N×`
  error flag; the state tag; for `not-started` + `prereqUnmet`, the muted "builds
  on {prereqNames[0]}" cue). A `run` entry = a single collapsed row "*{count}
  solid — show*" (expandable; clicking expands to individual rows — local
  `useState` of expanded run indices).
- **Error-prone rows are the hottest:** give `errorProne` rows a distinctly
  stronger treatment than solid rows (e.g. an accent-tinted left border /背景),
  per the locked refinement — not just the small flag.
- **Cells are display-only** (Phase 1): render rows as non-interactive elements
  (no onClick to a detail sheet; the detail sheet + mode chips are Phase 2).
- **Next-level preview:** if a `level.isPreview` level exists, render its points
  muted under a "next up · A2 preview" header (names + dots only).
- **work-on-these:** render `<WorkOnThese themes={errorThemes} />` below the map.
- **Loading/error:** mirror `ShapeTab`'s loading skeleton + error-card pattern.

- [ ] **Step 6: Write the component test**

Create `__tests__/map-tab.test.tsx`. Build a `CurriculumMapResponse` fixture with
a learning point, a long run of solids, and an error-prone point. Assert: the
readiness rollup text renders ("N of M"); the learning point's name renders; a
collapsed-run control renders for the solid run; the error-prone point's name +
`⚠` flag render (not hidden inside a collapsed run); the "builds on X" cue renders
for a not-started prereq-unmet point. (Mock `WorkOnThese` data as `[]`.)

- [ ] **Step 7: Wire the page**

In `progress/page.tsx`: import `useCurriculumMap`, `useInsightsErrors`, `MapTab`;
fire both queries in parallel with the others; render the `map` panel:

```typescript
const curriculum = useCurriculumMap({ fetchFn, language: activeLanguage });
const insights = useInsightsErrors({ fetchFn, language: activeLanguage });
// ...
{tab === 'map' && (
  <MapTab
    data={curriculum.data}
    isLoading={curriculum.isLoading}
    error={curriculum.error}
    onRetry={() => { void curriculum.refetch(); }}
    errorThemes={insights.data?.themes ?? []}
  />
)}
```

(The page-wide empty state — `totalEvidence === 0` → `ProgressEmptyState` —
stays; a brand-new user with no history sees that rather than an all-untouched
map. Keep it.)

- [ ] **Step 8: Run web tests, verify pass**

Run: `pnpm --filter @language-drill/web test -- map-tab collapse-solid-runs progress`
Expected: PASS.

- [ ] **Step 9: Commit** (Tasks 4 + 5 together)

```bash
git add "apps/web/app/(dashboard)/progress"
git commit -m "feat(web): Curriculum Map tab on /progress (spine, read-only) + work-on-these reuse"
```

---

### Task 6: Full gate

- [ ] **Step 1: Build** — `pnpm build` → exit 0.
- [ ] **Step 2: Full suite** — `rm -rf infra/lambda/dist && pnpm lint && pnpm typecheck && pnpm test` → exit 0, zero failures. Watch for: any test pinning the old `/progress` tab list (`['shape','fluency','history']`); the `buttonRefs` `Record` now requiring `map`.
- [ ] **Step 3: No separate commit** (gate only).

---

## Self-Review

- **Spec coverage (Phase 1 only):**
  - `GET /progress/curriculum` + state/readiness classification → Tasks 1, 2. ✓
  - api-client schema + hook → Task 3. ✓
  - Map surface on `/progress`, radar demoted → Tasks 4, 5. ✓ (radar stays as the
    `shape` tab; `map` is default.)
  - 3 states + error overlay; soft prereq cue (display-only) → Task 1 (data) +
    Task 5 (render). ✓
  - Readiness rollup + bar (action deferred to Phase 4) → Task 1 (data) + Task 5
    (display, no functional advance button). ✓
  - Spine cell design + **mastery bar in-row** + **collapse solid runs** +
    **error-prone hottest** (locked visual direction) → Task 5 + collapse helper. ✓
  - Reuse `work-on-these` on `/progress` → Task 5. ✓
  - Per-point mastery exposed to UI (first time) → Tasks 2/3/5. ✓
  - **Explicitly NOT in Phase 1** (correctly deferred): point-detail sheet + mode
    chips + targeting (Phase 2); ranker/plan/length/reasons (Phase 3); readiness
    *advance action* + `/home` cue (Phase 3/4); `compatibleTypes`/`hasTheory`
    fields (added in Phase 2 when the detail sheet needs them).
- **Placeholder scan:** backend (Tasks 1–3) carries complete code. Task 5's
  component step is a **prototype port** (the Claude Design `cmap/map.jsx` spine
  variant is the authoritative visual spec) with the testable logic
  (`collapseSolidRuns`) given in full and concrete structural requirements +
  tests — not a vague "build the UI". Acceptable per the project's
  prototype-port precedent.
- **Type consistency:** `CurriculumMapPoint.state` (`not-started|learning|solid`)
  is identical in the lambda classifier (`PointState`), the api-client schema
  (`PointStateEnum`), and the web helper/component. `MapLevel`/`CurriculumMapLevel`
  fields (`solidCount/total/readyToAdvance/isPreview/points`) match end to end.
  `lastPracticedAt` is an ISO string (classifier serializes via `toISOString()`;
  schema is `z.string().datetime().nullable()`).
```
