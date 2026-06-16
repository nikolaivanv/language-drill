# Debrief Skill-Movements Panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a banded, per-grammar-point "skills you moved" panel on the session debrief — directional arrows + confidence, no raw mastery numbers.

**Architecture:** A pure helper replays the user's `userExerciseHistory` for the grammar points the session touched, twice (excluding vs including this session's rows), through the existing mastery model (`replayHistory`/`updateMastery`), and bands the `from → to` difference. The `GET /sessions/:id/debrief` route attaches the result as `skillMovements` on the response; a web panel renders it. No new DB table, no migration.

**Tech Stack:** TypeScript, pnpm + Turborepo, Drizzle (Neon Postgres), Hono (Lambda), Zod (api-client schemas), Next.js + Tailwind (web), Vitest.

**Reference spec:** `docs/superpowers/specs/2026-06-16-debrief-skill-movements-design.md`

---

## Background the engineer needs

- **Mastery model** (`packages/db/src/mastery/update.ts`): `replayHistory(rows: HistoryRow[]) → Map<grammarPointKey, MasteryState>`, where `HistoryRow = { grammarPointKey, score, difficulty, evaluatedAt }` and `MasteryState = { masteryScore, confidence, evidenceCount, lastPracticedAt }`. `updateMastery(null, obs)` handles first-ever practice (so a grammar point absent from the "before" replay = New). Exported from the `@language-drill/db` barrel.
- **History table** (`packages/db/src/schema/progress.ts`): `userExerciseHistory` has `id, userId, exerciseId, sessionId, score, responseJson, evaluatedAt`. It does NOT carry `grammarPointKey`/`difficulty` — join `exercises` for those (pattern: `infra/lambda/src/routes/progress.ts:75`).
- **Session linkage:** `userExerciseHistory.sessionId` FKs `practiceSessions.id`. The debrief route (`infra/lambda/src/routes/sessions.ts:585`, handler for `GET /sessions/:id/debrief`) already builds `items[]` carrying `grammarPointKey` + `status` per exercise, and has `userId`, `session.language`, `session.id` in scope.
- **Sibling precedent:** vocabulary review returns `masteryDeltas: { grammarPoint, from, to }[]` (`MasteryDeltaSchema` in `packages/shared/src/review.ts:123`) via `computeMasteryDeltas` (`infra/lambda/src/lib/review/evidence.ts:186`). We mirror the *exclude-the-session-rows* idea but band server-side and expose **no numbers**.
- **Debrief UI:** `apps/web/app/(dashboard)/drill/debrief/_components/debrief-tab.tsx` has `// No skill-delta section in v1 (Req 4.5).` at line 12 — the reserved slot. It receives `debrief: DebriefResponse`. Cards use `<Card padding="md">` (`apps/web/components/ui/card.tsx`); text tokens `t-micro`/`t-body`; colors `text-ink`/`text-ink-soft`. The api-client hook `useSessionDebrief` validates against `DebriefResponseSchema`, so extending the schema flows the new field through automatically.
- **Gotchas (from project memory):** after editing `packages/shared` or `packages/db` source, run `pnpm --filter <pkg> build` before a dependent single-package vitest run. The real test gate is `pnpm turbo run test --concurrency=1` (parallel `pnpm test` flakes on infra). Work from the worktree `/Users/seal/dev/language-drill/.claude/worktrees/feat-debrief-skill-movements` (branch `feat-debrief-skill-movements`); run all commands from there.

## File Structure

**New:**
- `packages/shared/src/skill-movement.ts` — `SkillMovementBand`, `SkillMovementSchema`, `SkillMovement` (zod, mirrors `review.ts`).
- `infra/lambda/src/lib/debrief/skill-movements.ts` — pure `computeSkillMovements` + `masteryBand` + `confidenceBand` + threshold constants.
- `infra/lambda/src/lib/debrief/skill-movements.test.ts`
- `apps/web/app/(dashboard)/drill/debrief/_components/skill-movements-panel.tsx` (+ `.test.tsx`)

**Modified:**
- `packages/shared/src/index.ts` — export the new module.
- `packages/api-client/src/schemas/debrief.ts` — add `skillMovements` to `DebriefResponseSchema`.
- `infra/lambda/src/routes/sessions.ts` — compute + attach `skillMovements` in the debrief handler.
- `apps/web/app/(dashboard)/drill/debrief/_components/debrief-tab.tsx` — render the panel at the reserved slot.

---

## Task 1: Shared `SkillMovement` schema

**Files:**
- Create: `packages/shared/src/skill-movement.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/skill-movement.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/skill-movement.test.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import { SkillMovementSchema, SKILL_MOVEMENT_BANDS } from './skill-movement.js';

describe('SkillMovementSchema', () => {
  it('accepts a valid banded movement with no numeric score fields', () => {
    const m = { grammarPointKey: 'es-b2-present-subjunctive', label: 'Presente de subjuntivo', band: 'strong-gain', confidence: 'high' };
    expect(SkillMovementSchema.parse(m)).toEqual(m);
  });

  it('rejects an unknown band', () => {
    expect(() =>
      SkillMovementSchema.parse({ grammarPointKey: 'x', label: 'X', band: 'mega-gain', confidence: 'high' }),
    ).toThrow();
  });

  it('enumerates exactly the five bands', () => {
    expect([...SKILL_MOVEMENT_BANDS]).toEqual(['new', 'strong-gain', 'gain', 'steady', 'slip']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @language-drill/shared test -- skill-movement`
Expected: FAIL — `Cannot find module './skill-movement.js'`.

- [ ] **Step 3: Write the module**

Create `packages/shared/src/skill-movement.ts`:
```typescript
import { z } from 'zod';

/**
 * Per-grammar-point mastery movement for the session debrief "skills you moved"
 * panel. Sibling of MasteryDelta (review.ts), but deliberately carries NO raw
 * from/to scores — only a band + confidence — so the client cannot render mastery
 * numbers (the trust-presentation decision; see the design spec).
 */
export const SKILL_MOVEMENT_BANDS = ['new', 'strong-gain', 'gain', 'steady', 'slip'] as const;

export const SkillMovementBandSchema = z.enum(SKILL_MOVEMENT_BANDS);
export type SkillMovementBand = z.infer<typeof SkillMovementBandSchema>;

export const SkillMovementSchema = z.object({
  grammarPointKey: z.string().min(1),
  label: z.string().min(1),
  band: SkillMovementBandSchema,
  confidence: z.enum(['high', 'low']),
});
export type SkillMovement = z.infer<typeof SkillMovementSchema>;
```

- [ ] **Step 4: Export from the shared barrel**

In `packages/shared/src/index.ts`, add an export line alongside the other re-exports (mirror how `review.js` is exported — search the file for `review`):
```typescript
export * from './skill-movement.js';
```

- [ ] **Step 5: Build + run the test**

Run: `pnpm --filter @language-drill/shared build && pnpm --filter @language-drill/shared test -- skill-movement`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/skill-movement.ts packages/shared/src/skill-movement.test.ts packages/shared/src/index.ts
git commit -m "feat(debrief): shared SkillMovement schema (banded, no raw scores)"
```

---

## Task 2: Pure `computeSkillMovements` helper

**Files:**
- Create: `infra/lambda/src/lib/debrief/skill-movements.ts`
- Test: `infra/lambda/src/lib/debrief/skill-movements.test.ts`

- [ ] **Step 1: Write the failing test**

Create `infra/lambda/src/lib/debrief/skill-movements.test.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import { CefrLevel } from '@language-drill/shared';
import {
  masteryBand,
  confidenceBand,
  computeSkillMovements,
  type SkillHistoryRow,
} from './skill-movements.js';

describe('masteryBand', () => {
  it('is "new" when there is no prior evidence', () => {
    expect(masteryBand(null, 0.4)).toBe('new');
  });
  it('bands gains by magnitude', () => {
    expect(masteryBand(0.6, 0.61)).toBe('steady');   // < 0.02
    expect(masteryBand(0.6, 0.64)).toBe('gain');      // >= 0.02
    expect(masteryBand(0.6, 0.70)).toBe('strong-gain'); // >= 0.08
  });
  it('bands a drop as a slip', () => {
    expect(masteryBand(0.6, 0.55)).toBe('slip');      // <= -0.02
    expect(masteryBand(0.6, 0.59)).toBe('steady');    // within epsilon
  });
});

describe('confidenceBand', () => {
  it('is high at/above the cutoff, low below', () => {
    expect(confidenceBand(0.6)).toBe('high');
    expect(confidenceBand(0.59)).toBe('low');
  });
});

describe('computeSkillMovements', () => {
  const at = (iso: string) => new Date(iso);
  const labels = new Map([['gp-a', 'Point A'], ['gp-b', 'Point B']]);

  it('returns [] when there are no affected points', () => {
    expect(computeSkillMovements({ rows: [], sessionRowIds: new Set(), labels: new Map() })).toEqual([]);
  });

  it('marks a first-ever-practiced point as "new"', () => {
    const rows: SkillHistoryRow[] = [
      { id: 's1', grammarPointKey: 'gp-a', score: 0.4, difficulty: CefrLevel.B2, evaluatedAt: at('2026-06-16T04:00:00Z') },
    ];
    const out = computeSkillMovements({ rows, sessionRowIds: new Set(['s1']), labels: new Map([['gp-a', 'Point A']]) });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ grammarPointKey: 'gp-a', label: 'Point A', band: 'new' });
    expect(out[0].confidence === 'high' || out[0].confidence === 'low').toBe(true);
  });

  it('excludes the session rows when computing the "from" baseline (a prior point gains)', () => {
    const rows: SkillHistoryRow[] = [
      { id: 'p1', grammarPointKey: 'gp-a', score: 0.6, difficulty: CefrLevel.B2, evaluatedAt: at('2026-06-10T04:00:00Z') },
      { id: 's1', grammarPointKey: 'gp-a', score: 0.95, difficulty: CefrLevel.B2, evaluatedAt: at('2026-06-16T04:00:00Z') },
    ];
    const out = computeSkillMovements({ rows, sessionRowIds: new Set(['s1']), labels: new Map([['gp-a', 'Point A']]) });
    // before = replay([p1]) = 0.6; after = replay([p1,s1]) > 0.6 → a gain band, not "new".
    expect(out[0].band === 'gain' || out[0].band === 'strong-gain').toBe(true);
  });

  it('aggregates multiple session rows on one point into a single movement', () => {
    const rows: SkillHistoryRow[] = [
      { id: 's1', grammarPointKey: 'gp-b', score: 0.5, difficulty: CefrLevel.B1, evaluatedAt: at('2026-06-16T04:00:00Z') },
      { id: 's2', grammarPointKey: 'gp-b', score: 0.9, difficulty: CefrLevel.B1, evaluatedAt: at('2026-06-16T04:05:00Z') },
    ];
    const out = computeSkillMovements({ rows, sessionRowIds: new Set(['s1', 's2']), labels: new Map([['gp-b', 'Point B']]) });
    expect(out).toHaveLength(1);
    expect(out[0].grammarPointKey).toBe('gp-b');
  });

  it('orders movers before steady, deterministically', () => {
    const rows: SkillHistoryRow[] = [
      { id: 'p1', grammarPointKey: 'gp-a', score: 0.6, difficulty: CefrLevel.B2, evaluatedAt: at('2026-06-10T00:00:00Z') },
      { id: 's1', grammarPointKey: 'gp-a', score: 0.6, difficulty: CefrLevel.B2, evaluatedAt: at('2026-06-16T00:00:00Z') }, // ~steady
      { id: 'p2', grammarPointKey: 'gp-b', score: 0.5, difficulty: CefrLevel.B2, evaluatedAt: at('2026-06-10T00:00:00Z') },
      { id: 's2', grammarPointKey: 'gp-b', score: 0.99, difficulty: CefrLevel.B2, evaluatedAt: at('2026-06-16T00:00:00Z') }, // gain
    ];
    const out = computeSkillMovements({ rows, sessionRowIds: new Set(['s1', 's2']), labels });
    expect(out.map((m) => m.grammarPointKey)).toEqual(['gp-b', 'gp-a']); // gain before steady
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @language-drill/lambda test -- skill-movements`
Expected: FAIL — module not found. (Build `db`/`shared` first if the import can't resolve: `pnpm --filter @language-drill/shared build && pnpm --filter @language-drill/db build`.)

- [ ] **Step 3: Write the helper**

Create `infra/lambda/src/lib/debrief/skill-movements.ts`:
```typescript
/**
 * Pure computation of the debrief "skills you moved" panel. Replays the user's
 * exercise history for the grammar points a session touched, twice — excluding
 * vs including this session's rows — and bands the resulting from → to per point.
 * No raw scores leak out: only a band + confidence (see the design spec).
 */
import { replayHistory, type HistoryRow } from '@language-drill/db';
import { CefrLevel, type SkillMovement, type SkillMovementBand } from '@language-drill/shared';

/** A history row plus its primary-key id, so session rows can be excluded. */
export type SkillHistoryRow = {
  id: string;
  grammarPointKey: string;
  score: number;
  difficulty: CefrLevel;
  evaluatedAt: Date;
};

// Tunable banding constants (design spec §2).
export const STEADY_EPS = 0.02;        // |Δ| below this → steady
export const STRONG_GAIN_DELTA = 0.08; // Δ at/above this → strong gain
export const CONFIDENCE_HIGH_CUTOFF = 0.6;

const BAND_ORDER: Record<SkillMovementBand, number> = {
  'strong-gain': 0,
  gain: 1,
  new: 2,
  slip: 3,
  steady: 4,
};

export function masteryBand(from: number | null, to: number): SkillMovementBand {
  if (from === null) return 'new';
  const delta = to - from;
  if (delta >= STRONG_GAIN_DELTA) return 'strong-gain';
  if (delta >= STEADY_EPS) return 'gain';
  if (delta <= -STEADY_EPS) return 'slip';
  return 'steady';
}

export function confidenceBand(confidence: number): 'high' | 'low' {
  return confidence >= CONFIDENCE_HIGH_CUTOFF ? 'high' : 'low';
}

function toHistoryRow(r: SkillHistoryRow): HistoryRow {
  return { grammarPointKey: r.grammarPointKey, score: r.score, difficulty: r.difficulty, evaluatedAt: r.evaluatedAt };
}

/**
 * @param rows  ALL history rows (this session's + prior) for the affected points.
 * @param sessionRowIds  ids of the rows belonging to THIS session (excluded for "from").
 * @param labels  affected grammarPointKey → human label; its keys define which points to emit.
 */
export function computeSkillMovements(params: {
  rows: readonly SkillHistoryRow[];
  sessionRowIds: ReadonlySet<string>;
  labels: ReadonlyMap<string, string>;
}): SkillMovement[] {
  const { rows, sessionRowIds, labels } = params;
  const afterMap = replayHistory(rows.map(toHistoryRow));
  const beforeMap = replayHistory(rows.filter((r) => !sessionRowIds.has(r.id)).map(toHistoryRow));

  const out: SkillMovement[] = [];
  for (const [key, label] of labels) {
    const after = afterMap.get(key);
    if (!after) continue; // defensive: an affected point always has ≥1 row
    const before = beforeMap.get(key);
    out.push({
      grammarPointKey: key,
      label,
      band: masteryBand(before ? before.masteryScore : null, after.masteryScore),
      confidence: confidenceBand(after.confidence),
    });
  }
  out.sort((a, b) => BAND_ORDER[a.band] - BAND_ORDER[b.band] || a.label.localeCompare(b.label));
  return out;
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @language-drill/shared build && pnpm --filter @language-drill/db build && pnpm --filter @language-drill/lambda test -- skill-movements`
Expected: PASS (all blocks).

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/lib/debrief/skill-movements.ts infra/lambda/src/lib/debrief/skill-movements.test.ts
git commit -m "feat(debrief): pure computeSkillMovements helper (replay + banding)"
```

---

## Task 3: Extend `DebriefResponseSchema`

**Files:**
- Modify: `packages/api-client/src/schemas/debrief.ts`
- Test: `packages/api-client/src/schemas/debrief.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

Create or append to `packages/api-client/src/schemas/debrief.test.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import { DebriefResponseSchema } from './debrief.js';

const base = {
  id: '00000000-0000-0000-0000-000000000000',
  language: 'ES',
  difficulty: 'B2',
  startedAt: '2026-06-16T04:00:00.000Z',
  completedAt: '2026-06-16T04:10:00.000Z',
  durationSeconds: 600,
  exerciseCount: 3,
  correctCount: 2,
  attemptedCount: 3,
  skippedCount: 0,
  items: [],
};

describe('DebriefResponseSchema skillMovements', () => {
  it('accepts a response carrying banded skillMovements', () => {
    const parsed = DebriefResponseSchema.parse({
      ...base,
      skillMovements: [
        { grammarPointKey: 'es-b2-x', label: 'X', band: 'gain', confidence: 'high' },
      ],
    });
    expect(parsed.skillMovements).toHaveLength(1);
  });

  it('defaults skillMovements to [] when omitted (back-compat)', () => {
    expect(DebriefResponseSchema.parse(base).skillMovements).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @language-drill/shared build && pnpm --filter @language-drill/api-client test -- debrief`
Expected: FAIL — `skillMovements` is not on the schema (second test: property is `undefined`, not `[]`).

- [ ] **Step 3: Add the field**

In `packages/api-client/src/schemas/debrief.ts`, add the import at the top (next to the other `@language-drill/shared` import on line 2):
```typescript
import { SkillMovementSchema } from '@language-drill/shared';
```
Then add this field to the `DebriefResponseSchema` object (after `items: z.array(DebriefItemSchema),`):
```typescript
  // Banded per-grammar-point mastery movement for the points practiced this
  // session (design spec 2026-06-16). `.default([])` keeps older payloads valid.
  skillMovements: z.array(SkillMovementSchema).default([]),
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @language-drill/api-client test -- debrief`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add packages/api-client/src/schemas/debrief.ts packages/api-client/src/schemas/debrief.test.ts
git commit -m "feat(debrief): add skillMovements to DebriefResponseSchema"
```

---

## Task 4: Wire skill movements into the debrief route

**Files:**
- Modify: `infra/lambda/src/routes/sessions.ts` (the `GET /sessions/:id/debrief` handler, ~lines 585–747)
- Test: `infra/lambda/src/routes/sessions.test.ts` (the existing debrief test block)

- [ ] **Step 1: Add the computation in the handler**

Read the handler first (`sessions.ts:585–747`) to confirm variable names (`session`, `userId`, the built `items` array). After `items` is fully built and **before** the `DebriefResponse` object is constructed (~line 720), insert:

```typescript
    // --- Skill movements (design spec 2026-06-16) ---------------------------
    // Affected points = grammar points the session graded (non-skipped, keyed).
    const affectedLabels = new Map<string, string>();
    for (const it of items) {
      if (it.status !== 'skipped' && it.grammarPointKey) {
        affectedLabels.set(it.grammarPointKey, getGrammarPoint(it.grammarPointKey)?.name ?? it.grammarPointKey);
      }
    }
    let skillMovements: SkillMovement[] = [];
    if (affectedLabels.size > 0) {
      const histRows = await db
        .select({
          id: userExerciseHistory.id,
          sessionId: userExerciseHistory.sessionId,
          grammarPointKey: exercises.grammarPointKey,
          difficulty: exercises.difficulty,
          score: userExerciseHistory.score,
          evaluatedAt: userExerciseHistory.evaluatedAt,
        })
        .from(userExerciseHistory)
        .innerJoin(exercises, eq(userExerciseHistory.exerciseId, exercises.id))
        .where(
          and(
            eq(userExerciseHistory.userId, userId),
            eq(exercises.language, session.language),
            inArray(exercises.grammarPointKey, [...affectedLabels.keys()]),
            isNotNull(userExerciseHistory.score),
            isNotNull(userExerciseHistory.evaluatedAt),
            isNotNull(exercises.difficulty),
          ),
        );
      const rows: SkillHistoryRow[] = histRows.map((r) => ({
        id: r.id,
        grammarPointKey: r.grammarPointKey as string,
        score: r.score as number,
        difficulty: r.difficulty as CefrLevel,
        evaluatedAt: r.evaluatedAt as Date,
      }));
      const sessionRowIds = new Set(histRows.filter((r) => r.sessionId === session.id).map((r) => r.id));
      skillMovements = computeSkillMovements({ rows, sessionRowIds, labels: affectedLabels });
    }
```

Then add `skillMovements` to the returned `DebriefResponse` object (alongside `items`):
```typescript
      items,
      skillMovements,
```

- [ ] **Step 2: Add the imports**

At the top of `sessions.ts`, ensure these are imported (add any missing):
- from `drizzle-orm`: `and`, `eq`, `inArray`, `isNotNull` (some are likely already imported — add only the missing ones).
- from `@language-drill/db`: `getGrammarPoint`, and the tables `userExerciseHistory`, `exercises` (check how the handler's existing queries import tables and mirror it).
- from `@language-drill/shared`: `CefrLevel`, `type SkillMovement`.
- from the new helper: `import { computeSkillMovements, type SkillHistoryRow } from '../lib/debrief/skill-movements.js';` (adjust the relative depth to match other `../lib/...` imports in this file).

- [ ] **Step 3: Typecheck the package**

Run: `pnpm --filter @language-drill/shared build && pnpm --filter @language-drill/db build && pnpm --filter @language-drill/lambda typecheck`
Expected: 0 errors. Fix any import-path / type-cast issues.

- [ ] **Step 4: Add a route-level test (no-numbers contract)**

Open `infra/lambda/src/routes/sessions.test.ts` and find the existing `GET /sessions/:id/debrief` test (search `debrief`). Mirroring its db-mock setup, add a test that drives the handler and asserts:
```typescript
it('debrief response includes banded skillMovements and leaks no raw scores', async () => {
  // Arrange: reuse this file's existing debrief-test harness/mock so the handler
  // returns a session with at least one graded, grammar-point-keyed item, and the
  // history query returns ≥1 row for that point. (Mirror the existing debrief test
  // mock exactly — same db stub shape, same request invocation.)
  const res = await app.request(`/sessions/${SESSION_ID}/debrief`, undefined, env);
  expect(res.status).toBe(200);
  const body = (await res.json()) as Record<string, unknown>;
  expect(Array.isArray(body.skillMovements)).toBe(true);
  for (const m of body.skillMovements as Array<Record<string, unknown>>) {
    expect(typeof m.band).toBe('string');
    expect('from' in m).toBe(false);
    expect('to' in m).toBe(false);
    // no numeric mastery field of any name
    for (const v of Object.values(m)) expect(typeof v).not.toBe('number');
  }
});
```
If the existing debrief test's db mock does not return `userExerciseHistory` rows for the new query, extend the mock so the new `select(...).from(userExerciseHistory)...` resolves to a small fixture (e.g. one prior row + one session row for the item's grammar point). Reuse `SESSION_ID`/`env`/`app` exactly as the existing test defines them. The heavy banding logic is already covered by Task 2 — this test only guards the wiring + the no-numbers payload contract.

- [ ] **Step 5: Run the route tests**

Run: `pnpm --filter @language-drill/lambda test -- sessions`
Expected: PASS, including the new test.

- [ ] **Step 6: Commit**

```bash
git add infra/lambda/src/routes/sessions.ts infra/lambda/src/routes/sessions.test.ts
git commit -m "feat(debrief): compute + attach skillMovements in the debrief route"
```

---

## Task 5: Web panel + debrief-tab wiring

**Files:**
- Create: `apps/web/app/(dashboard)/drill/debrief/_components/skill-movements-panel.tsx`
- Create: `apps/web/app/(dashboard)/drill/debrief/_components/skill-movements-panel.test.tsx`
- Modify: `apps/web/app/(dashboard)/drill/debrief/_components/debrief-tab.tsx`

- [ ] **Step 1: Write the failing component test**

Create `apps/web/app/(dashboard)/drill/debrief/_components/skill-movements-panel.test.tsx`:
```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { SkillMovement } from '@language-drill/shared';
import { SkillMovementsPanel } from './skill-movements-panel';

const m = (over: Partial<SkillMovement>): SkillMovement => ({
  grammarPointKey: 'gp', label: 'Point', band: 'gain', confidence: 'high', ...over,
});

describe('SkillMovementsPanel', () => {
  it('renders nothing when there are no movements', () => {
    const { container } = render(<SkillMovementsPanel movements={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders mover rows with band copy and no mastery numbers', () => {
    render(
      <SkillMovementsPanel
        movements={[
          m({ grammarPointKey: 'a', label: 'Subjuntivo', band: 'strong-gain', confidence: 'high' }),
          m({ grammarPointKey: 'b', label: 'Concesivos', band: 'slip', confidence: 'low' }),
        ]}
      />,
    );
    expect(screen.getByText('Subjuntivo')).toBeInTheDocument();
    expect(screen.getByText(/Strong gain/)).toBeInTheDocument();
    expect(screen.getByText(/Slipped/)).toBeInTheDocument();
    // No mastery decimals anywhere in the panel.
    expect(document.body.textContent ?? '').not.toMatch(/\d\.\d/);
  });

  it('summarizes steady points instead of listing them', () => {
    render(
      <SkillMovementsPanel
        movements={[
          m({ grammarPointKey: 'a', label: 'Gained', band: 'gain' }),
          m({ grammarPointKey: 'b', label: 'Flat1', band: 'steady' }),
          m({ grammarPointKey: 'c', label: 'Flat2', band: 'steady' }),
        ]}
      />,
    );
    expect(screen.queryByText('Flat1')).not.toBeInTheDocument();
    expect(screen.getByText(/2 held steady/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @language-drill/web test -- skill-movements-panel`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

Create `apps/web/app/(dashboard)/drill/debrief/_components/skill-movements-panel.tsx`:
```tsx
import type { SkillMovement, SkillMovementBand } from '@language-drill/shared';
import { Card } from '@/components/ui/card';

const MOVER_DISPLAY: Record<Exclude<SkillMovementBand, 'steady'>, { glyph: string; label: string; className: string }> = {
  'strong-gain': { glyph: '▲▲', label: 'Strong gain', className: 'text-emerald-600' },
  gain: { glyph: '▲', label: 'Gain', className: 'text-emerald-600' },
  new: { glyph: '★', label: 'New · first evidence', className: 'text-ink-soft' },
  slip: { glyph: '▼', label: 'Slipped', className: 'text-rose-600' },
};

export interface SkillMovementsPanelProps {
  movements: SkillMovement[];
}

export function SkillMovementsPanel({ movements }: SkillMovementsPanelProps) {
  if (movements.length === 0) return null;
  const movers = movements.filter((m) => m.band !== 'steady');
  const steadyCount = movements.length - movers.length;
  if (movers.length === 0 && steadyCount === 0) return null;

  return (
    <Card padding="md">
      <p className="t-micro text-ink-soft mb-s-3">Skills you moved</p>
      <div className="flex flex-col gap-s-2">
        {movers.map((m) => {
          const d = MOVER_DISPLAY[m.band as Exclude<SkillMovementBand, 'steady'>];
          return (
            <div key={m.grammarPointKey} className="flex items-center justify-between t-body">
              <span className="text-ink">{m.label}</span>
              <span className={`${d.className} font-medium`}>
                {d.glyph} {d.label} · {m.confidence} confidence
              </span>
            </div>
          );
        })}
      </div>
      {steadyCount > 0 && (
        <p className="t-micro text-ink-soft mt-s-3">{steadyCount} held steady</p>
      )}
    </Card>
  );
}
```
(If `@/components/ui/card` is not the import alias used elsewhere in `_components`, match the existing relative/alias import for `Card` used by `debrief-tab.tsx`.)

- [ ] **Step 4: Run the component test**

Run: `pnpm --filter @language-drill/web test -- skill-movements-panel`
Expected: PASS (3 tests).

- [ ] **Step 5: Render it in the debrief tab**

In `apps/web/app/(dashboard)/drill/debrief/_components/debrief-tab.tsx`:
- Add the import near the top: `import { SkillMovementsPanel } from './skill-movements-panel';`
- Replace the `// No skill-delta section in v1 (Req 4.5).` comment with the panel, placed inside the top-level `<div className="fade-in mt-s-6 flex flex-col gap-s-6">` (e.g. right after the coach card, before/after the "what's next" callout — match the existing JSX structure):
```tsx
      <SkillMovementsPanel movements={debrief.skillMovements} />
```
(The panel returns `null` when there are no movements, so no conditional is needed at the call site.)

- [ ] **Step 6: Typecheck + test web**

Run: `pnpm --filter @language-drill/web typecheck && pnpm --filter @language-drill/web test -- debrief`
Expected: 0 type errors; debrief-related tests pass.

- [ ] **Step 7: Commit**

```bash
git add "apps/web/app/(dashboard)/drill/debrief/_components/skill-movements-panel.tsx" "apps/web/app/(dashboard)/drill/debrief/_components/skill-movements-panel.test.tsx" "apps/web/app/(dashboard)/drill/debrief/_components/debrief-tab.tsx"
git commit -m "feat(debrief): render the skills-you-moved panel"
```

---

## Task 6: Full-workspace gate

**Files:** none (verification), plus any fixups surfaced.

- [ ] **Step 1: Typecheck the whole workspace**

Run: `pnpm typecheck`
Expected: 0 errors across all packages.

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: 0 errors.

- [ ] **Step 3: Full serial test suite (the real gate)**

Run: `pnpm turbo run test --concurrency=1`
Expected: all packages green. (Parallel `pnpm test` flakes on infra; `--concurrency=1` is the honest gate.)

- [ ] **Step 4: Final commit (only if Steps 1–2 needed fixups)**

```bash
git add -A
git commit -m "chore(debrief): typecheck/lint fixups for skill-movements"
```

---

## Self-Review notes (for the implementer)

- **Spec coverage:** Task 1 (shared band type) ↔ spec §Type; Task 2 (replay + banding, exclude-set, new/steady/slip, confidence) ↔ spec §3/§2/§Edge cases; Task 3 (payload, no from/to) ↔ spec §3/§API; Task 4 (route wiring, affected-points-only, no-numbers contract test) ↔ spec §3/§Testing; Task 5 (banded panel, movers + "N held steady", hides when empty, no numerals) ↔ spec §1/§Presentation/§Testing. Out-of-scope items (per-exercise cue, history table, /progress map, raw numbers) are not implemented — matches the spec.
- **Name consistency:** `SkillMovement` / `SkillMovementBand` / `SKILL_MOVEMENT_BANDS` (shared) used identically in the helper, route, schema, and component. Helper exports `masteryBand`, `confidenceBand`, `computeSkillMovements`, `SkillHistoryRow`. Band string set `'new'|'strong-gain'|'gain'|'steady'|'slip'` is identical across the zod enum, the helper's `BAND_ORDER`/`masteryBand`, and the component's `MOVER_DISPLAY` (which covers the four non-steady bands).
- **No-numbers contract** is enforced in three places: the payload type carries no score field (Task 1/3), the route test asserts no numeric values (Task 4), and the component test asserts no `\d\.\d` renders (Task 5).
- **Data dependency resolved:** `userExerciseHistory` lacks `grammarPointKey`/`difficulty`, so Task 4 joins `exercises` (mirroring `progress.ts:75`) — no schema migration needed, matching the spec's "verify at plan time" note.
```
