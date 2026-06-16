# Free-Writing Block Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a language's cadence day, the dashboard's "today" plan surfaces a distinct **free-writing block** that launches the existing standalone multi-stage free-writing flow.

**Architecture:** Additive, end-to-end vertical slice. A pure cadence helper (`isFreeWritingDay`) decides the nudge; `GET /sessions/today` gates the block on an approved free-writing exercise actually existing for the user's level, then returns a nullable `freeWriting` object on the wire; the web `TodayTimeline` renders a `FreeWritingBlock` card (link to `/drill/free-writing`) when that field is present. We deliberately do **not** build a generic block engine — the existing 5-item rail stays "the quick-drill block" and the free-writing block is one additive field. Dictation is unchanged (it stays an in-mix `ExerciseType`).

**Tech Stack:** Hono (Lambda API), Drizzle ORM, Zod (api-client wire schemas), Next.js App Router + React, Vitest + Testing Library.

**Scope note:** This is Plan 1 of 3. Plan 2 (`/drill` launcher-hub restructure + dictation-only run) and Plan 3 (debrief "practice more → hub") follow as separate plans. This plan ships working software on its own: a free-writing block that appears on cadence days and launches the existing flow.

**Reference spec:** `docs/superpowers/specs/2026-06-16-multi-type-drill-entry-points-design.md`

---

## File Structure

**Backend (`infra/lambda`):**
- Modify `infra/lambda/src/lib/today-plan.ts` — add `isFreeWritingDay` cadence helper + constants (pure).
- Modify `infra/lambda/src/lib/today-plan.test.ts` — unit tests for the helper.
- Modify `infra/lambda/src/routes/sessions.ts` — gate + emit the `freeWriting` block in `GET /sessions/today`.
- Modify `infra/lambda/src/routes/sessions.test.ts` — route tests (with date freezing).

**Wire contract (`packages/api-client`):**
- Modify `packages/api-client/src/schemas/today.ts` — add `FreeWritingPlanBlockSchema` + `freeWriting` field.
- Modify `packages/api-client/src/schemas/today.test.ts` — schema tests.
- Modify `packages/api-client/src/index.ts` — export the new schema + type.

**Web (`apps/web`):**
- Create `apps/web/app/(dashboard)/_components/free-writing-block.tsx` — the block card.
- Create `apps/web/app/(dashboard)/_components/__tests__/free-writing-block.test.tsx` — component test.
- Modify `apps/web/app/(dashboard)/_components/today-timeline.tsx` — render the block.
- Modify `apps/web/app/(dashboard)/_components/__tests__/today-timeline.test.tsx` — timeline tests + fixture update.

---

## Background the engineer needs

- **The cadence property.** Three learning languages (`ES`, `DE`, `TR`) get rotation offsets `0/1/2`. The rule is `(utcDayIndex + offset) % 3 === 0`. Because the offsets cover all residues mod 3, **exactly one** language surfaces a free-writing block on any given UTC day — the nudge is staggered, never zero, never all three. Tests rely on this.
- **Gating on existence.** A cadence day alone isn't enough: the block must only appear if an approved free-writing exercise exists for `(language, level)`, otherwise the user taps through to a page that hangs on "loading…". The route does one extra indexed lookup on cadence days (~1/3 of dashboard loads).
- **Why `.default(null)` on the wire field.** Keeps response payloads that omit `freeWriting` (older API deploys, existing test fixtures) parseable instead of failing the Zod parse in `useTodayPlan`.
- **The route test harness is a chained db mock.** `mockLimit` resolves any query terminating in `.limit(...)`; in `GET /sessions/today` the first two `mockLimit` resolves are the today-session lookup then the proficiency lookup (they run in a `Promise.all`, evaluated left-to-right). The new fw-existence query (`.where(...).limit(1)`) becomes the **third** `mockLimit` resolve on cadence days. `mockExecute` resolves the Path B `UNION ALL` pool sample; `mockSelectAwait` resolves `.where(...)`-terminated queries (Path A items, Path B mastery).
- **Calendar-flake hazard.** Existing `today` tests call the real `new Date()` and request `language=ES`/`language=DE`. On a real ES- or DE-cadence day, the new fw-existence query would run with no mock and crash those tests. Task 2 freezes the `today` describe's clock to a TR-cadence day so ES/DE requests never trigger the gated query.

---

### Task 1: Cadence helper (`isFreeWritingDay`)

**Files:**
- Modify: `infra/lambda/src/lib/today-plan.ts`
- Test: `infra/lambda/src/lib/today-plan.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to the top imports of `infra/lambda/src/lib/today-plan.test.ts` (the file already imports from `./today-plan` and `@language-drill/shared`):

```ts
import { Language } from '@language-drill/shared';
```

Add `isFreeWritingDay` and `FREE_WRITING_CADENCE_DAYS` to the existing `from './today-plan'` import block.

Then append this describe block to the end of the file:

```ts
describe('isFreeWritingDay', () => {
  // Deterministic UTC base so the window walk never depends on the wall clock.
  const base = Date.UTC(2026, 0, 1); // 2026-01-01T00:00:00Z
  const day = (i: number) => new Date(base + i * 86_400_000);

  it('fires once every FREE_WRITING_CADENCE_DAYS days for a given language', () => {
    const window = 30; // divisible by the cadence
    let hits = 0;
    for (let i = 0; i < window; i++) {
      if (isFreeWritingDay(day(i), Language.ES)) hits++;
    }
    expect(hits).toBe(window / FREE_WRITING_CADENCE_DAYS); // 30 / 3 = 10
  });

  it('surfaces free writing for exactly one of ES/DE/TR on any given day', () => {
    for (let i = 0; i < FREE_WRITING_CADENCE_DAYS; i++) {
      const count = [Language.ES, Language.DE, Language.TR].filter((l) =>
        isFreeWritingDay(day(i), l),
      ).length;
      expect(count).toBe(1);
    }
  });

  it('depends only on the UTC day, not the time of day', () => {
    const morning = new Date('2026-03-10T00:00:00Z');
    const night = new Date('2026-03-10T23:59:59Z');
    expect(isFreeWritingDay(morning, Language.ES)).toBe(
      isFreeWritingDay(night, Language.ES),
    );
  });

  it('defaults unknown languages to offset 0 (does not throw)', () => {
    expect(() => isFreeWritingDay(day(0), 'XX')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @language-drill/lambda test -- today-plan`
Expected: FAIL — `isFreeWritingDay`/`FREE_WRITING_CADENCE_DAYS` are not exported.

- [ ] **Step 3: Implement the helper**

In `infra/lambda/src/lib/today-plan.ts`, append after the `startOfUtcDay` function (after line ~123):

```ts
// ---------------------------------------------------------------------------
// Free-writing cadence (Plan 1)
// ---------------------------------------------------------------------------
// A long, single-focus free-writing block is nudged on a fixed rotation rather
// than every day. Deterministic and stateless — purely a function of the UTC
// day and the language's rotation offset. The /drill hub launcher (Plan 2)
// gives anytime access, so this governs only the nudge.
// ---------------------------------------------------------------------------

/** Length of the free-writing rotation, in days. */
export const FREE_WRITING_CADENCE_DAYS = 3;

/**
 * Per-language offset into the rotation. The three learning languages use
 * distinct residues (0,1,2) mod FREE_WRITING_CADENCE_DAYS, so exactly one
 * language surfaces a free-writing block on any given UTC day. Languages absent
 * from this map default to offset 0 (defensive).
 */
const FREE_WRITING_LANGUAGE_OFFSET: Record<string, number> = {
  ES: 0,
  DE: 1,
  TR: 2,
};

/** Whole UTC days since the Unix epoch for the day containing `now`. */
function utcDayIndex(now: Date): number {
  return Math.floor(startOfUtcDay(now).getTime() / 86_400_000);
}

/**
 * True when `language` should surface a free-writing block on the UTC day
 * containing `now`.
 */
export function isFreeWritingDay(now: Date, language: string): boolean {
  const offset = FREE_WRITING_LANGUAGE_OFFSET[language] ?? 0;
  return (utcDayIndex(now) + offset) % FREE_WRITING_CADENCE_DAYS === 0;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @language-drill/lambda test -- today-plan`
Expected: PASS — all `isFreeWritingDay` tests green, existing tests still green.

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/lib/today-plan.ts infra/lambda/src/lib/today-plan.test.ts
git commit -m "feat(today-plan): isFreeWritingDay cadence helper"
```

---

### Task 2: Emit the `freeWriting` block from `GET /sessions/today`

**Files:**
- Modify: `infra/lambda/src/routes/sessions.ts:20-27` (import block), route body, and the three `c.json(...)` returns in `GET /sessions/today`.
- Test: `infra/lambda/src/routes/sessions.test.ts` (the `GET /sessions/today` describe at line ~530).

- [ ] **Step 1: Freeze the clock in the existing `today` describe, then write the failing tests**

First, make the existing tests calendar-deterministic. In `infra/lambda/src/routes/sessions.test.ts`:

Update the vitest import (line 1) to add `afterEach` and `beforeAll`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
```

Add these imports near the other top-of-file imports (the real `today-plan` lib is **not** mocked, so importing the pure helper is safe):

```ts
import { Language } from '@language-drill/shared';
import { isFreeWritingDay, FREE_WRITING_CADENCE_DAYS } from '../lib/today-plan';
```

Inside the `describe('GET /sessions/today', ...)` block, just after `let app: Hono;` (line ~531), add the frozen-date setup:

```ts
  // Freeze "today" to a UTC day on which TR — not ES or DE — is the
  // free-writing day. Exactly one of ES/DE/TR is a free-writing day on any
  // given day, so the pre-existing ES/DE Path A/B tests never trigger the
  // cadence-gated fw-existence query (which they do not mock).
  let frozenNow: Date;
  beforeAll(() => {
    const base = Date.UTC(2026, 0, 1);
    for (let i = 0; i < FREE_WRITING_CADENCE_DAYS; i++) {
      const d = new Date(base + i * 86_400_000);
      if (
        isFreeWritingDay(d, Language.TR) &&
        !isFreeWritingDay(d, Language.ES) &&
        !isFreeWritingDay(d, Language.DE)
      ) {
        frozenNow = d;
        return;
      }
    }
    throw new Error('no TR-only free-writing day found in range');
  });
```

In that describe's existing `beforeEach` (line ~541), add the timer freeze after `vi.clearAllMocks()` (fake only `Date`, leaving real timers intact so `await app.request(...)` is unaffected):

```ts
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(frozenNow);
    const mod = await import('./sessions');
    app = new Hono();
    app.route('/', mod.default);
  });

  afterEach(() => {
    vi.useRealTimers();
  });
```

Now append the new free-writing-block tests inside the same describe (before its closing `});`):

```ts
  // -------------------------------------------------------------------------
  // Free-writing block (Plan 1)
  // -------------------------------------------------------------------------

  it('includes a freeWriting block on the cadence day when a free-writing exercise exists', async () => {
    // Path B (no today-session). mockLimit resolves: today → profile → fw-existence.
    mockLimit
      .mockResolvedValueOnce([]) // today-session lookup
      .mockResolvedValueOnce([{ proficiencyLevel: 'B1' }]) // proficiency
      .mockResolvedValueOnce([{ id: 'fw-1' }]); // fw-existence: one approved row

    mockExecute.mockResolvedValueOnce({
      rows: [
        { id: 'p1', type: 'cloze', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 'p2', type: 'cloze', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 'p3', type: 'translation', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 'p4', type: 'vocab_recall', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 'p5', type: 'cloze', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
      ],
    });
    mockSelectAwait.mockResolvedValueOnce([]); // mastery

    const res = await app.request(
      '/sessions/today?language=TR',
      { method: 'GET' },
      authEnv,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    // ESTIMATED_MINUTES_BY_TYPE[FREE_WRITING] === 8
    expect(body.freeWriting).toEqual({ estimatedMinutes: 8 });
  });

  it('returns freeWriting: null on the cadence day when no free-writing exercise exists', async () => {
    mockLimit
      .mockResolvedValueOnce([]) // today-session
      .mockResolvedValueOnce([{ proficiencyLevel: 'B1' }]) // proficiency
      .mockResolvedValueOnce([]); // fw-existence: pool empty for this cell

    mockExecute.mockResolvedValueOnce({
      rows: [
        { id: 'p1', type: 'cloze', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 'p2', type: 'cloze', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 'p3', type: 'translation', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 'p4', type: 'vocab_recall', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 'p5', type: 'cloze', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
      ],
    });
    mockSelectAwait.mockResolvedValueOnce([]); // mastery

    const res = await app.request(
      '/sessions/today?language=TR',
      { method: 'GET' },
      authEnv,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.freeWriting).toBeNull();
  });

  it('returns freeWriting: null on a non-cadence day (no fw-existence query runs)', async () => {
    // ES is not the free-writing language on the frozen (TR) day, so the
    // cadence gate is false and only the two batch-1 limits resolve.
    mockLimit
      .mockResolvedValueOnce([]) // today-session
      .mockResolvedValueOnce([{ proficiencyLevel: 'B1' }]); // proficiency

    mockExecute.mockResolvedValueOnce({
      rows: [
        { id: 'p1', type: 'cloze', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 'p2', type: 'cloze', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 'p3', type: 'translation', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 'p4', type: 'vocab_recall', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
        { id: 'p5', type: 'cloze', topic_hint: null, difficulty: 'B1', grammar_point_key: null },
      ],
    });
    mockSelectAwait.mockResolvedValueOnce([]); // mastery

    const res = await app.request(
      '/sessions/today?language=ES',
      { method: 'GET' },
      authEnv,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.freeWriting).toBeNull();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @language-drill/lambda test -- sessions`
Expected: FAIL — the new tests fail because `body.freeWriting` is `undefined` (field not yet emitted). Existing Path A/B tests should still PASS (the clock freeze keeps ES/DE off the cadence).

- [ ] **Step 3: Implement the route change**

In `infra/lambda/src/routes/sessions.ts`, extend the `today-plan` import block (lines 20-27) to add `isFreeWritingDay` and `ESTIMATED_MINUTES_BY_TYPE`:

```ts
import {
  V1_PLAN_SHAPE,
  composeFreshPlan,
  hydrateFromSession,
  isFreeWritingDay,
  startOfUtcDay,
  ESTIMATED_MINUTES_BY_TYPE,
  type PlanItem,
  type PoolDraw,
} from '../lib/today-plan';
```

Then, after the `proficiencyLevel` is resolved (immediately after line 264, before the `// Path A` comment on line 266), insert the cadence-gated existence check:

```ts
  // -------------------------------------------------------------------------
  // Free-writing block (Plan 1)
  // -------------------------------------------------------------------------
  // On this language's cadence day, surface a free-writing block — but only if
  // an approved free-writing exercise exists for (language, level), so the
  // block never links to a page with no prompt. Runs on ~1/3 of dashboard
  // loads; one extra indexed lookup, sequential after proficiency since it
  // depends on the resolved level. Independent of Path A/B — the block reflects
  // today's nudge whether or not the quick-drill session has been started.
  let freeWriting: { estimatedMinutes: number } | null = null;
  if (isFreeWritingDay(new Date(), language)) {
    const fwRows = await db
      .select({ id: exercisesTable.id })
      .from(exercisesTable)
      .where(
        and(
          eq(exercisesTable.language, language),
          eq(exercisesTable.difficulty, proficiencyLevel),
          eq(exercisesTable.type, ExerciseType.FREE_WRITING),
          approvedStatusFilter(exercisesTable),
        ),
      )
      .limit(1);
    if (fwRows.length > 0) {
      freeWriting = {
        estimatedMinutes: ESTIMATED_MINUTES_BY_TYPE[ExerciseType.FREE_WRITING],
      };
    }
  }
```

Add `freeWriting` to all three `c.json(...)` response objects in this handler:

1. Path A return (currently ends `code: null,` near line 339):

```ts
    return c.json({
      language,
      generatedAt: new Date().toISOString(),
      totalEstimatedMinutes: items.reduce(
        (sum, it) => sum + it.estimatedMinutes,
        0,
      ),
      items: items.map(toWireItem),
      summary,
      code: null,
      freeWriting,
    });
```

2. Path B insufficient return (currently ends `code: 'INSUFFICIENT_POOL' as const,` near line 392):

```ts
    return c.json({
      language,
      generatedAt,
      totalEstimatedMinutes: 0,
      items: [],
      summary: null,
      code: 'INSUFFICIENT_POOL' as const,
      freeWriting,
    });
```

3. Path B normal return (currently ends `code: null,` near line 405):

```ts
  return c.json({
    language,
    generatedAt,
    totalEstimatedMinutes: items.reduce(
      (sum, it) => sum + it.estimatedMinutes,
      0,
    ),
    items: items.map(toWireItem),
    summary: null,
    code: null,
    freeWriting,
  });
```

Also update the handler's doc comment (lines 196-209) — change the "Performance budget: ≤ 2 SQL round-trips" note to mention the extra cadence-gated lookup:

```ts
// Performance budget: ≤ 2 SQL round-trips on most days. Query 1 (today-session
// lookup) and the proficiency-level fetch share one RTT via Promise.all; Path
// B's pool sample is the second. On a language's free-writing cadence day
// (~1/3 of days) one extra indexed lookup gates the freeWriting block.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @language-drill/lambda test -- sessions`
Expected: PASS — the three new tests green, all existing `today` tests green.

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/routes/sessions.ts infra/lambda/src/routes/sessions.test.ts
git commit -m "feat(today): gate + emit free-writing block in GET /sessions/today"
```

---

### Task 3: Add `freeWriting` to the wire schema

**Files:**
- Modify: `packages/api-client/src/schemas/today.ts`
- Modify: `packages/api-client/src/index.ts:60-67`
- Test: `packages/api-client/src/schemas/today.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to the `describe('TodayPlanResponseSchema', ...)` block in `packages/api-client/src/schemas/today.test.ts`:

```ts
  it('defaults freeWriting to null when the field is omitted', () => {
    const result = TodayPlanResponseSchema.safeParse({
      language: Language.ES,
      generatedAt: '2026-05-04T12:00:00.000Z',
      totalEstimatedMinutes: 12,
      items: queuedItems,
      summary: null,
      code: null,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.freeWriting).toBeNull();
  });

  it('parses a populated freeWriting block', () => {
    const result = TodayPlanResponseSchema.safeParse({
      language: Language.ES,
      generatedAt: '2026-05-04T12:00:00.000Z',
      totalEstimatedMinutes: 12,
      items: queuedItems,
      summary: null,
      code: null,
      freeWriting: { estimatedMinutes: 8 },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.freeWriting).toEqual({ estimatedMinutes: 8 });
    }
  });

  it('rejects a freeWriting block with a non-positive estimatedMinutes', () => {
    const result = TodayPlanResponseSchema.safeParse({
      language: Language.ES,
      generatedAt: '2026-05-04T12:00:00.000Z',
      totalEstimatedMinutes: 12,
      items: queuedItems,
      summary: null,
      code: null,
      freeWriting: { estimatedMinutes: 0 },
    });
    expect(result.success).toBe(false);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @language-drill/api-client test -- today`
Expected: FAIL — `result.data.freeWriting` is `undefined` (the "defaults to null" case fails) and the `{ estimatedMinutes: 0 }` payload is accepted (the rejection case fails).

- [ ] **Step 3: Implement the schema change**

In `packages/api-client/src/schemas/today.ts`, add the block schema just above `TodayPlanResponseSchema` (after the `TodayPlanSummary` type, line ~50):

```ts
// Free-writing block — present on a language's cadence day when an approved
// free-writing exercise exists for the user's level. Drives the dashboard's
// free-writing timeline block. `.default(null)` (below) keeps payloads that
// omit the field (older API deploys) parseable.
export const FreeWritingPlanBlockSchema = z.object({
  estimatedMinutes: z.number().int().min(1),
});

export type FreeWritingPlanBlock = z.infer<typeof FreeWritingPlanBlockSchema>;
```

Add the field to `TodayPlanResponseSchema` (after the `code` field, line ~61):

```ts
  // Present on a language's free-writing cadence day; null otherwise. Defaulted
  // so a response that omits the key still parses.
  freeWriting: FreeWritingPlanBlockSchema.nullable().default(null),
```

In `packages/api-client/src/index.ts`, add to the today re-export block (lines 60-67):

```ts
  FreeWritingPlanBlockSchema,
  type FreeWritingPlanBlock,
```

(Place these alongside the existing `TodayPlanResponseSchema` / `type TodayPlanResponse` exports — confirm they come from the same `./schemas/today` export statement.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @language-drill/api-client test -- today`
Expected: PASS — all three new cases green, existing schema tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/api-client/src/schemas/today.ts packages/api-client/src/schemas/today.test.ts packages/api-client/src/index.ts
git commit -m "feat(api-client): add freeWriting block to TodayPlanResponse schema"
```

---

### Task 4: `FreeWritingBlock` component

**Files:**
- Create: `apps/web/app/(dashboard)/_components/free-writing-block.tsx`
- Test: `apps/web/app/(dashboard)/_components/__tests__/free-writing-block.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/(dashboard)/_components/__tests__/free-writing-block.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FreeWritingBlock } from '../free-writing-block';

describe('FreeWritingBlock', () => {
  it('links to the standalone free-writing flow and shows the estimate', () => {
    render(<FreeWritingBlock estimatedMinutes={8} />);

    const link = screen.getByRole('link', { name: /start/i });
    expect(link).toHaveAttribute('href', '/drill/free-writing');
    expect(screen.getByText('free writing')).toBeInTheDocument();
    expect(screen.getByText('8 min')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/web test -- free-writing-block`
Expected: FAIL — `../free-writing-block` module does not exist.

- [ ] **Step 3: Implement the component**

Create `apps/web/app/(dashboard)/_components/free-writing-block.tsx`:

```tsx
// ---------------------------------------------------------------------------
// FreeWritingBlock — the today plan's free-writing block (Plan 1)
// ---------------------------------------------------------------------------
// A distinct timeline block (not an inline rail item): on a language's cadence
// day the dashboard surfaces this card, which launches the standalone
// multi-stage free-writing flow at /drill/free-writing. The href is static —
// the free-writing page resolves its own prompt for the active language.
// ---------------------------------------------------------------------------

import { Button } from '../../../components/ui';

type Props = {
  estimatedMinutes: number;
};

export function FreeWritingBlock({ estimatedMinutes }: Props) {
  return (
    <section
      aria-label="free writing"
      className="mt-s-4 flex items-start justify-between gap-s-4 rounded-r-lg border border-accent bg-card p-s-5"
    >
      <div className="min-w-0 flex-1">
        <h3 className="t-display-s">free writing</h3>
        <p className="t-body mt-s-1 text-ink-2">
          Write a paragraph to a constrained prompt, then get IELTS-style
          feedback with every error marked in place.
        </p>
      </div>
      <div className="flex flex-shrink-0 items-center gap-s-3">
        <span className="t-mono text-[12px] text-ink-mute">
          {estimatedMinutes} min
        </span>
        <Button variant="primary" size="md" href="/drill/free-writing">
          start →
        </Button>
      </div>
    </section>
  );
}
```

Note: `Button` renders an anchor when `href` is set — this is the same pattern used by `TimelineItem` (`timeline-item.tsx:99-103`), so `getByRole('link')` resolves. Confirm the `Button` import path resolves from `_components/` (sibling `timeline-item.tsx` imports it as `'../../../components/ui'`).

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/web test -- free-writing-block`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(dashboard)/_components/free-writing-block.tsx" "apps/web/app/(dashboard)/_components/__tests__/free-writing-block.test.tsx"
git commit -m "feat(web): FreeWritingBlock timeline-block component"
```

---

### Task 5: Render the block in `TodayTimeline`

**Files:**
- Modify: `apps/web/app/(dashboard)/_components/today-timeline.tsx`
- Test: `apps/web/app/(dashboard)/_components/__tests__/today-timeline.test.tsx`

- [ ] **Step 1: Update the fixture and write the failing tests**

In `apps/web/app/(dashboard)/_components/__tests__/today-timeline.test.tsx`, update `makeResponse`'s defaults (line ~46-57) to include the new field so the `TodayPlanResponse` type is satisfied:

```ts
  return {
    language: Language.ES,
    generatedAt: '2026-05-04T10:00:00.000Z',
    totalEstimatedMinutes: items.reduce(
      (sum, it) => sum + it.estimatedMinutes,
      0,
    ),
    items,
    summary: null,
    code: null,
    freeWriting: null,
    ...overrides,
  };
```

Append a new describe block to the file:

```ts
describe('TodayTimeline — free-writing block', () => {
  it('renders the free-writing block when data.freeWriting is present', () => {
    const data = makeResponse([makeItem(1, 'next-up'), makeItem(2, 'queued')], {
      freeWriting: { estimatedMinutes: 8 },
    });
    render(
      <TodayTimeline
        {...baseProps}
        data={data}
        isLoading={false}
        error={null}
      />,
    );

    expect(screen.getByText('free writing')).toBeInTheDocument();
    const links = screen.getAllByRole('link');
    expect(
      links.some((a) => a.getAttribute('href') === '/drill/free-writing'),
    ).toBe(true);
  });

  it('does not render the free-writing block when data.freeWriting is null', () => {
    const data = makeResponse([makeItem(1, 'next-up')], { freeWriting: null });
    render(
      <TodayTimeline
        {...baseProps}
        data={data}
        isLoading={false}
        error={null}
      />,
    );

    expect(screen.queryByText('free writing')).not.toBeInTheDocument();
  });

  it('renders the free-writing block alongside the all-done card', () => {
    const doneItems = [makeItem(1, 'done'), makeItem(2, 'done')];
    const data = makeResponse(doneItems, {
      summary: { itemCount: 2, correctCount: 2, durationMinutes: 6 },
      freeWriting: { estimatedMinutes: 8 },
    });
    render(
      <TodayTimeline
        {...baseProps}
        data={data}
        isLoading={false}
        error={null}
      />,
    );

    expect(screen.getByText('free writing')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @language-drill/web test -- today-timeline`
Expected: FAIL — `free writing` text is not rendered (block not wired in).

- [ ] **Step 3: Implement the timeline change**

In `apps/web/app/(dashboard)/_components/today-timeline.tsx`:

Add the import near the other component imports (after the `timeline-item` import, line ~28):

```ts
import { FreeWritingBlock } from './free-writing-block';
```

After the `if (!data) { ... }` guard (line ~57), compute the block once and append it to each data-present return branch. Replace the body from line 59 (`if (data.code === 'INSUFFICIENT_POOL') {`) through the end of the component's default `return (...)` with:

```tsx
  // data is present from here on. The free-writing block is independent of the
  // quick-drill rail's state — it renders in every data-present branch.
  const freeWritingBlock = data.freeWriting ? (
    <FreeWritingBlock estimatedMinutes={data.freeWriting.estimatedMinutes} />
  ) : null;

  if (data.code === 'INSUFFICIENT_POOL') {
    return (
      <>
        <PoolNotReadyCard language={language} />
        {freeWritingBlock}
      </>
    );
  }

  const drillHref = `/drill?language=${language}`;
  const allDone =
    data.items.length > 0 && data.items.every((item) => item.status === 'done');

  if (allDone && data.summary) {
    return (
      <>
        <AllDoneCard summary={data.summary} href={drillHref} />
        {freeWritingBlock}
      </>
    );
  }

  // Default render: the vertical rail. The first non-`done` item is the
  // `next-up`; the rest stay `queued`.
  let nextUpAssigned = false;
  const itemsWithStatus = data.items.map((item) => {
    let status: TimelineItemStatus = item.status;
    if (item.status === 'queued' && !nextUpAssigned) {
      status = 'next-up';
      nextUpAssigned = true;
    }
    return { item, status };
  });

  return (
    <>
      <ol className="m-0 list-none p-0">
        {itemsWithStatus.map(({ item, status }, idx) => (
          <TimelineItem
            key={item.index}
            index={item.index}
            type={item.type}
            topicHint={item.topicHint}
            itemCount={item.itemCount}
            estimatedMinutes={item.estimatedMinutes}
            status={status}
            isLast={idx === itemsWithStatus.length - 1}
            href={status === 'next-up' ? drillHref : null}
          />
        ))}
      </ol>

      {/* Screen-reader summary of the whole plan. The visual rail above is
          fully accessible on its own, but a single flat list lets a SR user
          skim the day without navigating into each row. (Req 3.6) */}
      <ol aria-label="today's plan summary" className="sr-only">
        {itemsWithStatus.map(({ item, status }) => (
          <li key={item.index}>
            {item.index}. {composeTitle(item.index, item.type)} —{' '}
            {composeSubtitle(item.topicHint, item.type, item.itemCount)} ·{' '}
            {item.estimatedMinutes} min · {status}
          </li>
        ))}
      </ol>

      {freeWritingBlock}
    </>
  );
```

(This preserves the existing rail/sr-only markup verbatim — the only changes are the `freeWritingBlock` const and its three insertion points.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @language-drill/web test -- today-timeline`
Expected: PASS — all three new tests green, existing timeline tests green.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(dashboard)/_components/today-timeline.tsx" "apps/web/app/(dashboard)/_components/__tests__/today-timeline.test.tsx"
git commit -m "feat(web): render free-writing block in TodayTimeline"
```

---

### Task 6: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Lint**

Run: `pnpm lint`
Expected: zero errors.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: zero errors. (Confirms `makeResponse` and any `TodayPlanResponse` consumers satisfy the new required-in-output `freeWriting` field, and the route's response objects typecheck.)

- [ ] **Step 3: Full test suite (single-threaded to avoid the known infra flake)**

Run: `pnpm turbo run test --concurrency=1`
Expected: all packages green. (Per project memory, the full `pnpm test` flakes under parallel load in `infra`; `--concurrency=1` is the reliable gate.)

- [ ] **Step 4: Final commit (if any lint/format fixups were needed)**

```bash
git add -A
git commit -m "chore(free-writing-block): lint/typecheck fixups" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage:**
- Spec "free-writing block appears as its own block on cadence days" → Tasks 1 (cadence), 2 (emit), 5 (render). ✓
- Spec "deterministic every-3rd-day cadence, per active language" → Task 1 (`isFreeWritingDay`, offset per language). ✓
- Spec "cadence governs the nudge, never access; hub launcher gives anytime access" → out of scope here (Plan 2 builds the hub launcher); Task 4's block links to the existing `/drill/free-writing`, which remains directly reachable. ✓
- Spec "block launches the dedicated multi-stage flow, never inlined as item 3 of 5" → Task 4 links to `/drill/free-writing`; nothing touches the quick-drill rail items. ✓
- Spec "additive, not a generic block engine" → single nullable `freeWriting` wire field; rail unchanged. ✓
- Spec "evidence-driven cadence later (Phase 3+)" → explicitly out of scope. ✓

**Deliberate gap (correctly out of scope):** the free-writing page's infinite-"loading…" empty state is not hardened here. The route's existence gate makes a hang require the pool to empty between dashboard read and tap (seconds). Hardening `free-writing/page.tsx` is a follow-up, not part of this slice.

**Placeholder scan:** no TBD/TODO; every code step shows full code. ✓

**Type consistency:** helper `isFreeWritingDay(now, language)` and `FREE_WRITING_CADENCE_DAYS` are used identically in Tasks 1 and 2. Wire field name `freeWriting` and shape `{ estimatedMinutes: number }` are identical across route (Task 2), schema (Task 3), component prop (Task 4), and timeline (Task 5). Schema/type names `FreeWritingPlanBlockSchema` / `FreeWritingPlanBlock` (api-client) are distinct from the web component `FreeWritingBlock`, avoiding a cross-package name clash. ✓
