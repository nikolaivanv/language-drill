# Drill Launcher Hub + Dictation-Only Run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/drill` from a page that auto-starts a quick drill into an on-demand **launcher hub** (today-status strip + Quick drill / Dictation / Free writing launchers), while preserving every existing one-click "start →" flow via a `?start=quick` deep-link, and add a **dictation-only run**.

**Architecture:** `/drill` reads a `?start=` intent. With `start=quick|dictation` it skips the hub and auto-launches that session immediately (the existing session runner, unchanged); with no intent it renders the hub. A dictation-only run is just the existing session machinery with `POST /sessions` given an optional `exerciseType` filter (+ the dictation audio-ready gate). Spine CTAs (timeline next-up, mobile next-up card, all-done, progress/skill CTAs, debrief "another session") switch to `/drill?start=quick` so they keep launching in one tap; the nav "drill" tab and debrief error fallbacks land on the bare hub.

**Tech Stack:** Hono (Lambda API), Drizzle ORM, Zod (api-client), Next.js App Router + React, Vitest + Testing Library.

**Scope note:** This is **Plan 2 of 3** of the multi-type-drill entry-points design. Plan 1 (free-writing block) is merged. Plan 3 (debrief "practice more → hub" rework) follows. This plan ships working software on its own.

**Reference spec:** `docs/superpowers/specs/2026-06-16-multi-type-drill-entry-points-design.md`

---

## Background the engineer needs

- **`/drill` currently auto-starts.** `apps/web/app/(dashboard)/drill/page.tsx` has a kickoff `useEffect` (lines ~145-163) that fires `createSession.mutate(...)` the moment the page mounts and `state.kind === 'idle'`. The reducer (`_components/session-reducer.ts`) drives `idle → creating → inSession → completing`, then the page navigates to `/drill/debrief/:id`.
- **`POST /sessions`** (`infra/lambda/src/routes/sessions.ts`) pulls exercises by `language + difficulty + approvedStatusFilter`, ordered `freshFirstOrderBy`, **no type filter** and **no audio-ready gate**. Request schema is `CreateSessionRequestSchema` (a copy lives in `sessions.ts`; the api-client copy is `packages/api-client/src/schemas/session.ts`).
- **Dictation** is a normal `ExerciseType`; the runner already renders it via `ExercisePane`. Dictation rows must only be served once audio is synthesized — the filter is `audioReadyFilter` in `infra/lambda/src/lib/exercise-filters.ts` (`(type <> 'dictation' OR audio_s3_key IS NOT NULL)`).
- **`useSearchParams` needs a Suspense boundary** (App Router prerender bailout). The established pattern is `apps/web/app/onboarding/page.tsx`: the default export is a thin `<Suspense>` wrapper around the real content component. Plan 2's page follows it.
- **13 call sites link to `/drill`** (mostly `/drill?language=…`, which the page currently ignores). The spine CTAs move to `/drill?start=quick`; nav tab + debrief error fallbacks stay bare `/drill`.

---

## File Structure

**Wire contract (`packages/api-client`):**
- Modify `packages/api-client/src/schemas/session.ts` — add optional `exerciseType` to `CreateSessionRequestSchema`.
- Add/modify `packages/api-client/src/schemas/session.test.ts` — schema tests.

**Backend (`infra/lambda`):**
- Modify `infra/lambda/src/routes/sessions.ts` — `CreateSessionRequestSchema` (local copy) gains `exerciseType`; `POST /sessions` applies the type filter + `audioReadyFilter`.
- Modify `infra/lambda/src/routes/sessions.test.ts` — route + schema tests.

**Web (`apps/web`):**
- Modify `apps/web/lib/drill/session-config.ts` — add `DICTATION_RUN_COUNT`.
- Create `apps/web/app/(dashboard)/drill/_components/drill-today-status.tsx` — thin today-status strip (uses `useTodayPlan`).
- Create `apps/web/app/(dashboard)/drill/_components/drill-hub.tsx` — the hub (status strip + 3 launchers + difficulty selector).
- Create their tests under `apps/web/app/(dashboard)/drill/_components/__tests__/`.
- Modify `apps/web/app/(dashboard)/drill/page.tsx` — `?start=` intent gating + Suspense wrapper + dictation config.
- Modify `apps/web/app/(dashboard)/drill/page.test.tsx` — supply `start=quick` for existing tests; add hub tests.
- Modify the spine CTA links + their tests (Task 6, enumerated there).

---

### Task 1: api-client — optional `exerciseType` on `CreateSessionRequest`

**Files:**
- Modify: `packages/api-client/src/schemas/session.ts:6-10`
- Test: `packages/api-client/src/schemas/session.test.ts`

- [ ] **Step 1: Write the failing test**

If `packages/api-client/src/schemas/session.test.ts` does not exist, create it with this content; if it exists, append the `describe` block (and reuse its existing imports):

```ts
import { describe, it, expect } from 'vitest';
import { ExerciseType, Language, CefrLevel } from '@language-drill/shared';
import { CreateSessionRequestSchema } from './session';

describe('CreateSessionRequestSchema — exerciseType', () => {
  const base = {
    language: Language.ES,
    difficulty: CefrLevel.B1,
    exerciseCount: 4,
  };

  it('accepts a request without exerciseType (omitted → undefined)', () => {
    const r = CreateSessionRequestSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.exerciseType).toBeUndefined();
  });

  it('accepts a request with a valid exerciseType', () => {
    const r = CreateSessionRequestSchema.safeParse({
      ...base,
      exerciseType: ExerciseType.DICTATION,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.exerciseType).toBe(ExerciseType.DICTATION);
  });

  it('rejects an invalid exerciseType', () => {
    const r = CreateSessionRequestSchema.safeParse({
      ...base,
      exerciseType: 'not_a_type',
    });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/api-client test -- session`
Expected: FAIL — the valid-`exerciseType` case keeps `exerciseType` undefined (field not in schema) and the invalid case is accepted (unknown keys stripped), so the assertions fail.

- [ ] **Step 3: Implement the schema change**

In `packages/api-client/src/schemas/session.ts`, add `ExerciseType` to the shared import and the optional field:

```ts
import { z } from 'zod';
import { Language, CefrLevel, ExerciseType } from '@language-drill/shared';
import { ExerciseResponseSchema } from './exercise';

// Request body for POST /sessions
export const CreateSessionRequestSchema = z.object({
  language: z.nativeEnum(Language),
  difficulty: z.nativeEnum(CefrLevel),
  exerciseCount: z.number().int().min(1).max(20),
  // Optional single-type filter. Omitted → a mixed pull (quick drill); set to a
  // type (e.g. dictation) → a single-type run (dictation-only launcher).
  exerciseType: z.nativeEnum(ExerciseType).optional(),
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/api-client test -- session`
Expected: PASS — all three cases green.

- [ ] **Step 5: Commit**

```bash
git add packages/api-client/src/schemas/session.ts packages/api-client/src/schemas/session.test.ts
git commit -m "feat(api-client): optional exerciseType on CreateSessionRequest"
```

---

### Task 2: backend — `POST /sessions` honors `exerciseType` (type filter + audio-ready gate)

**Files:**
- Modify: `infra/lambda/src/routes/sessions.ts` (import block, `CreateSessionRequestSchema` at lines ~47-51, the pool query at lines ~86-97)
- Test: `infra/lambda/src/routes/sessions.test.ts` (the `describe('CreateSessionRequestSchema')` block ~line 121 and `describe('POST /sessions')` ~line 198)

- [ ] **Step 1: Write the failing tests**

(a) In `infra/lambda/src/routes/sessions.test.ts`, append to the existing `describe('CreateSessionRequestSchema', ...)` block:

```ts
  it('accepts an optional exerciseType', () => {
    const result = CreateSessionRequestSchema.safeParse({
      language: 'ES',
      difficulty: 'B1',
      exerciseCount: 4,
      exerciseType: 'dictation',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid exerciseType', () => {
    const result = CreateSessionRequestSchema.safeParse({
      language: 'ES',
      difficulty: 'B1',
      exerciseCount: 4,
      exerciseType: 'bogus',
    });
    expect(result.success).toBe(false);
  });
```

(b) Append a new test to the `describe('POST /sessions', ...)` block (it reuses `authEnv`, `mockLimit`, `mockReturning`, `mockValues`, `AnyJson` already defined there). This asserts the dictation-only request is accepted and its manifest is passed through:

```ts
  it('dictation-only request: returns a manifest of the dictation rows the pool yields', async () => {
    const dictationRows = [
      {
        id: 'd-1',
        type: 'dictation',
        language: 'ES',
        difficulty: 'B1',
        contentJson: { title: 'clip 1' },
        audioS3Key: 'audio/d-1.mp3',
        createdAt: new Date(),
      },
      {
        id: 'd-2',
        type: 'dictation',
        language: 'ES',
        difficulty: 'B1',
        contentJson: { title: 'clip 2' },
        audioS3Key: 'audio/d-2.mp3',
        createdAt: new Date(),
      },
    ];
    mockLimit.mockResolvedValueOnce(dictationRows);
    mockReturning.mockResolvedValueOnce([{ id: 'session-dictation-1' }]);

    const res = await app.request(
      '/sessions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          language: 'ES',
          difficulty: 'B1',
          exerciseCount: 2,
          exerciseType: 'dictation',
        }),
      },
      authEnv,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.id).toBe('session-dictation-1');
    expect(body.exercises.map((e: AnyJson) => e.type)).toEqual([
      'dictation',
      'dictation',
    ]);
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        exerciseCount: 2,
        exerciseIds: ['d-1', 'd-2'],
      }),
    );
  });
```

Note: the db mock does not evaluate the Drizzle `where` predicate, so this test verifies the request contract + manifest passthrough (consistent with how the existing `POST /sessions` and the Path-B review_status tests in this file cover the route). The SQL type/audio filtering itself is exercised in integration.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @language-drill/lambda test -- sessions`
Expected: FAIL — the two schema cases fail (field not in the schema yet; invalid value currently stripped → accepted), and the dictation route test 500s or mis-handles because `exerciseType` isn't read (it will actually pass passthrough but the schema cases fail). If the route test passes already, that's fine — the schema cases must fail.

- [ ] **Step 3: Implement the route change**

In `infra/lambda/src/routes/sessions.ts`:

(a) Add `audioReadyFilter` to the existing exercise-filters import (currently `import { approvedStatusFilter, freshFirstOrderBy } from '../lib/exercise-filters';`):

```ts
import { approvedStatusFilter, audioReadyFilter, freshFirstOrderBy } from '../lib/exercise-filters';
```

(b) Add the optional field to the local `CreateSessionRequestSchema` (lines ~47-51). `ExerciseType` is already imported at the top of the file:

```ts
/** Request body for POST /sessions (mirrors api-client CreateSessionRequest) */
export const CreateSessionRequestSchema = z.object({
  language: z.nativeEnum(Language),
  difficulty: z.nativeEnum(CefrLevel),
  exerciseCount: z.number().int().min(1).max(20),
  exerciseType: z.nativeEnum(ExerciseType).optional(),
});
```

(c) In the `POST /sessions` handler, destructure `exerciseType` and apply the filters. Replace the destructure + query (lines ~80-97):

```ts
  const { language, difficulty, exerciseCount, exerciseType } = bodyResult.data;
  const userId = c.get('userId');

  // Pull a manifest of N exercises for this (language, difficulty), ordered so
  // never-attempted exercises come first (exposure control); falls through to
  // INSUFFICIENT_EXERCISES if the pool is too small. `audioReadyFilter` keeps
  // un-synthesized dictation rows out of every pull (no-op for non-dictation
  // rows); `exerciseType`, when set, restricts to a single type (e.g. the
  // dictation-only launcher).
  const rows = await db
    .select()
    .from(exercisesTable)
    .where(
      and(
        eq(exercisesTable.language, language),
        eq(exercisesTable.difficulty, difficulty),
        approvedStatusFilter(exercisesTable),
        audioReadyFilter(exercisesTable),
        ...(exerciseType ? [eq(exercisesTable.type, exerciseType)] : []),
      ),
    )
    .orderBy(freshFirstOrderBy(userId))
    .limit(exerciseCount);
```

(Drizzle's `and(...)` ignores `undefined`/falsy spread entries; spreading an empty array adds nothing when `exerciseType` is absent.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @language-drill/lambda test -- sessions`
Expected: PASS — new schema + route tests green, all pre-existing `POST /sessions` and today tests green (the added predicates don't change the db-mock behavior).

Also typecheck: `pnpm --filter @language-drill/lambda typecheck` — zero errors.

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/routes/sessions.ts infra/lambda/src/routes/sessions.test.ts
git commit -m "feat(sessions): POST /sessions honors optional exerciseType + audio-ready gate"
```

---

### Task 3: web — `DrillTodayStatus` strip

**Files:**
- Modify: `apps/web/lib/drill/session-config.ts`
- Create: `apps/web/app/(dashboard)/drill/_components/drill-today-status.tsx`
- Test: `apps/web/app/(dashboard)/drill/_components/__tests__/drill-today-status.test.tsx`

- [ ] **Step 1: Add the run-length constant**

In `apps/web/lib/drill/session-config.ts`, append:

```ts
// A dictation-only run is short — a handful of clips, not a full 5-item drill.
export const DICTATION_RUN_COUNT = 4;
```

- [ ] **Step 2: Write the failing test**

Create `apps/web/app/(dashboard)/drill/_components/__tests__/drill-today-status.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Language } from '@language-drill/shared';

const mockUseTodayPlan = vi.fn();
vi.mock('@language-drill/api-client', () => ({
  useTodayPlan: (...args: unknown[]) => mockUseTodayPlan(...args),
  createAuthenticatedFetch: vi.fn(() => vi.fn()),
}));
vi.mock('@clerk/nextjs', () => ({ useAuth: () => ({ getToken: vi.fn() }) }));
vi.mock('../../../../../components/shell', () => ({
  useActiveLanguage: () => ({ activeLanguage: Language.ES }),
}));

import { DrillTodayStatus } from '../drill-today-status';

function setPlan(data: unknown) {
  mockUseTodayPlan.mockReturnValue({ data, isLoading: false, error: null });
}

describe('DrillTodayStatus', () => {
  it('shows the quick drill as done when today summary is present, linking to today', () => {
    setPlan({
      language: 'ES',
      generatedAt: '2026-05-04T10:00:00.000Z',
      totalEstimatedMinutes: 12,
      items: [],
      summary: { itemCount: 5, correctCount: 4, durationMinutes: 18 },
      code: null,
      freeWriting: null,
    });
    render(<DrillTodayStatus />);
    expect(screen.getByText(/today/i)).toBeInTheDocument();
    expect(screen.getByText(/done/i)).toBeInTheDocument();
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/home');
  });

  it('shows the quick drill as not finished when there is no summary', () => {
    setPlan({
      language: 'ES',
      generatedAt: '2026-05-04T10:00:00.000Z',
      totalEstimatedMinutes: 12,
      items: [],
      summary: null,
      code: null,
      freeWriting: null,
    });
    render(<DrillTodayStatus />);
    expect(screen.getByText(/not finished/i)).toBeInTheDocument();
  });

  it('renders nothing while the plan is loading', () => {
    mockUseTodayPlan.mockReturnValue({ data: undefined, isLoading: true, error: null });
    const { container } = render(<DrillTodayStatus />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/web test -- drill-today-status`
Expected: FAIL — module `../drill-today-status` does not exist.

- [ ] **Step 4: Implement the component**

Create `apps/web/app/(dashboard)/drill/_components/drill-today-status.tsx`:

```tsx
'use client';

// ---------------------------------------------------------------------------
// DrillTodayStatus — the hub's thin "today" status strip (Plan 2)
// ---------------------------------------------------------------------------
// The /drill hub is the on-demand surface; the plan lives on /home. This strip
// reminds the user where today's quick drill stands and links back to the
// plan. Read-only: it reuses GET /sessions/today (summary present ⇒ today's
// quick drill is finished).
// ---------------------------------------------------------------------------

import { useMemo } from 'react';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { createAuthenticatedFetch, useTodayPlan } from '@language-drill/api-client';
import { useActiveLanguage } from '../../../../components/shell';

export function DrillTodayStatus() {
  const { getToken } = useAuth();
  const { activeLanguage } = useActiveLanguage();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  const todayPlan = useTodayPlan({ fetchFn, language: activeLanguage });

  if (todayPlan.isLoading || !todayPlan.data) return null;

  const done = todayPlan.data.summary !== null;

  return (
    <div className="mb-s-5 flex items-center justify-between gap-s-4 text-ink-mute">
      <span className="t-small">
        today&apos;s quick drill: {done ? 'done ✓' : 'not finished'}
      </span>
      <Link href="/home" className="t-small underline hover:text-ink">
        today&apos;s plan →
      </Link>
    </div>
  );
}
```

Note the import depth: this file sits at `(dashboard)/drill/_components/`, so the shell is `../../../../components/shell` (four `../`). Confirm against a sibling that imports the shell.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/web test -- drill-today-status`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/drill/session-config.ts "apps/web/app/(dashboard)/drill/_components/drill-today-status.tsx" "apps/web/app/(dashboard)/drill/_components/__tests__/drill-today-status.test.tsx"
git commit -m "feat(web): DrillTodayStatus hub strip + DICTATION_RUN_COUNT"
```

---

### Task 4: web — `DrillHub` (status strip + launchers + difficulty)

**Files:**
- Create: `apps/web/app/(dashboard)/drill/_components/drill-hub.tsx`
- Test: `apps/web/app/(dashboard)/drill/_components/__tests__/drill-hub.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/(dashboard)/drill/_components/__tests__/drill-hub.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CefrLevel } from '@language-drill/shared';

// DrillTodayStatus pulls today data; stub it so the hub renders in isolation.
vi.mock('../drill-today-status', () => ({
  DrillTodayStatus: () => <div data-testid="today-status" />,
}));

import { DrillHub } from '../drill-hub';

function setup(overrides: Partial<React.ComponentProps<typeof DrillHub>> = {}) {
  const onStartQuick = vi.fn();
  const onStartDictation = vi.fn();
  const onDifficultyChange = vi.fn();
  render(
    <DrillHub
      difficulty={CefrLevel.B1}
      onDifficultyChange={onDifficultyChange}
      onStartQuick={onStartQuick}
      onStartDictation={onStartDictation}
      {...overrides}
    />,
  );
  return { onStartQuick, onStartDictation, onDifficultyChange };
}

describe('DrillHub', () => {
  it('renders the today-status strip and three launchers', () => {
    setup();
    expect(screen.getByTestId('today-status')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /quick drill/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /dictation/i })).toBeInTheDocument();
    // Free writing is a link to the standalone flow.
    const fw = screen.getByRole('link', { name: /free writing/i });
    expect(fw).toHaveAttribute('href', '/drill/free-writing');
  });

  it('fires onStartQuick / onStartDictation when the launchers are clicked', () => {
    const { onStartQuick, onStartDictation } = setup();
    fireEvent.click(screen.getByRole('button', { name: /quick drill/i }));
    fireEvent.click(screen.getByRole('button', { name: /dictation/i }));
    expect(onStartQuick).toHaveBeenCalledTimes(1);
    expect(onStartDictation).toHaveBeenCalledTimes(1);
  });

  it('fires onDifficultyChange when the difficulty select changes', () => {
    const { onDifficultyChange } = setup();
    fireEvent.change(screen.getByLabelText(/difficulty/i), {
      target: { value: 'A2' },
    });
    expect(onDifficultyChange).toHaveBeenCalledWith('A2');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/web test -- drill-hub`
Expected: FAIL — module `../drill-hub` does not exist.

- [ ] **Step 3: Implement the component**

Create `apps/web/app/(dashboard)/drill/_components/drill-hub.tsx`:

```tsx
'use client';

// ---------------------------------------------------------------------------
// DrillHub — the /drill landing (Plan 2)
// ---------------------------------------------------------------------------
// On-demand launcher surface shown when /drill is opened with no `?start=`
// intent. A thin today-status strip up top, then a row of launchers:
//   - Quick drill   → onStartQuick (5-item mixed session)
//   - Dictation     → onStartDictation (dictation-only run)
//   - Free writing  → the existing standalone flow at /drill/free-writing
// Presentational: the page owns difficulty + start intent and passes callbacks.
// ---------------------------------------------------------------------------

import Link from 'next/link';
import { CefrLevel } from '@language-drill/shared';
import { Button } from '../../../../components/ui';
import { DrillTodayStatus } from './drill-today-status';

type Props = {
  difficulty: CefrLevel;
  onDifficultyChange: (level: CefrLevel) => void;
  onStartQuick: () => void;
  onStartDictation: () => void;
};

export function DrillHub({
  difficulty,
  onDifficultyChange,
  onStartQuick,
  onStartDictation,
}: Props) {
  return (
    <div className="p-s-6">
      <h1 className="t-display-l mb-s-6">drill</h1>

      <DrillTodayStatus />

      <label className="mb-s-6 flex w-fit flex-col gap-1 text-sm font-medium text-gray-700">
        Difficulty
        <select
          value={difficulty}
          onChange={(e) => onDifficultyChange(e.target.value as CefrLevel)}
          className="rounded border border-gray-300 bg-white px-3 py-2"
        >
          {Object.values(CefrLevel).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>

      <div className="flex flex-col gap-s-4">
        <button
          type="button"
          onClick={onStartQuick}
          className="flex items-center justify-between gap-s-4 rounded-r-lg border border-rule bg-card p-s-5 text-left hover:border-accent"
        >
          <span className="min-w-0">
            <span className="t-display-s block">quick drill</span>
            <span className="t-body block text-ink-2">
              a 5-item mix — cloze, sentence building, translation, vocab.
            </span>
          </span>
          <span className="t-mono flex-shrink-0 text-accent-2">start →</span>
        </button>

        <button
          type="button"
          onClick={onStartDictation}
          className="flex items-center justify-between gap-s-4 rounded-r-lg border border-rule bg-card p-s-5 text-left hover:border-accent"
        >
          <span className="min-w-0">
            <span className="t-display-s block">dictation</span>
            <span className="t-body block text-ink-2">
              listen and transcribe — a short audio-only run.
            </span>
          </span>
          <span className="t-mono flex-shrink-0 text-accent-2">start →</span>
        </button>

        <Link
          href="/drill/free-writing"
          className="flex items-center justify-between gap-s-4 rounded-r-lg border border-accent bg-card p-s-5 no-underline"
        >
          <span className="min-w-0">
            <span className="t-display-s block">free writing</span>
            <span className="t-body block text-ink-2">
              write a paragraph to a prompt, then get IELTS-style feedback.
            </span>
          </span>
          <span className="t-mono flex-shrink-0 text-accent-2">start →</span>
        </Link>
      </div>
    </div>
  );
}
```

Confirm the `Button` import path (`../../../../components/ui`) — this file is one level shallower than `drill-today-status.tsx`? No: both are in `_components/`, so the path matches `drill-today-status.tsx`'s shell import depth pattern. The `Button` import is shown for parity with siblings; if unused after final markup, remove it (the launchers above use plain `<button>`/`<Link>`, so `Button` may be unused — drop the import if so to keep lint clean).

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/web test -- drill-hub`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(dashboard)/drill/_components/drill-hub.tsx" "apps/web/app/(dashboard)/drill/_components/__tests__/drill-hub.test.tsx"
git commit -m "feat(web): DrillHub launcher landing"
```

---

### Task 5: web — `/drill` page `?start=` intent gating + Suspense wrapper

**Files:**
- Modify: `apps/web/app/(dashboard)/drill/page.tsx`
- Test: `apps/web/app/(dashboard)/drill/page.test.tsx`

- [ ] **Step 1: Update the test mock + write the failing hub tests**

In `apps/web/app/(dashboard)/drill/page.test.tsx`:

(a) Extend the `next/navigation` mock (currently only `useRouter`) so `useSearchParams` is controllable. Replace the mock block (lines ~18-21) with:

```tsx
const mockPush = vi.fn();
let mockSearchParamsString = 'start=quick'; // existing tests run in auto-start mode
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => new URLSearchParams(mockSearchParamsString),
}));
```

(b) The page's hub branch renders `DrillHub` → `DrillTodayStatus`, which calls `useTodayPlan`. Add it to the `@language-drill/api-client` mock (lines ~35-41) so the hub renders without crashing:

```tsx
vi.mock('@language-drill/api-client', () => ({
  useCreateSession: (...args: unknown[]) => mockUseCreateSession(...args),
  useCompleteSession: (...args: unknown[]) => mockUseCompleteSession(...args),
  useSubmitAnswer: (...args: unknown[]) => mockUseSubmitAnswer(...args),
  useLanguageProfiles: (...args: unknown[]) => mockUseLanguageProfiles(...args),
  useTodayPlan: () => ({ data: undefined, isLoading: false, error: null }),
  createAuthenticatedFetch: vi.fn(() => vi.fn()),
}));
```

(c) Reset `mockSearchParamsString` to the auto-start default in the top-level `beforeEach` (the one at line ~141, after `vi.clearAllMocks()`), so each test starts in auto-start mode unless it opts into the hub:

```tsx
  mockSearchParamsString = 'start=quick';
```

(d) Append a new describe block for the hub (no `start` intent → hub renders; launchers create the right session):

```tsx
describe('PracticePage — hub (no start intent)', () => {
  it('renders the launcher hub instead of auto-starting when there is no ?start', () => {
    mockSearchParamsString = '';
    renderWithProviders(<PracticePage />);

    // No session auto-starts.
    expect(createMutate).not.toHaveBeenCalled();
    // Hub launchers are present.
    expect(
      screen.getByRole('button', { name: /quick drill/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /dictation/i }),
    ).toBeInTheDocument();
  });

  it('tapping "quick drill" starts a 5-item mixed session', () => {
    mockSearchParamsString = '';
    renderWithProviders(<PracticePage />);
    fireEvent.click(screen.getByRole('button', { name: /quick drill/i }));
    expect(createMutate).toHaveBeenCalledWith(
      { language: 'ES', difficulty: 'B1', exerciseCount: 5 },
      expect.any(Object),
    );
  });

  it('tapping "dictation" starts a dictation-only run', () => {
    mockSearchParamsString = '';
    renderWithProviders(<PracticePage />);
    fireEvent.click(screen.getByRole('button', { name: /dictation/i }));
    expect(createMutate).toHaveBeenCalledWith(
      {
        language: 'ES',
        difficulty: 'B1',
        exerciseCount: 4,
        exerciseType: ExerciseType.DICTATION,
      },
      expect.any(Object),
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @language-drill/web test -- "drill/page"`
Expected: FAIL — the hub tests fail (page still auto-starts and renders no launchers). The pre-existing tests should still PASS (they run with `start=quick` → auto-start, unchanged behavior). If a pre-existing test fails, the mock wiring in Step 1 is wrong — fix before continuing.

- [ ] **Step 3: Implement the page change**

In `apps/web/app/(dashboard)/drill/page.tsx`:

(a) Update imports — add `Suspense` and `useSearchParams`, the new constant, and `DrillHub`:

```tsx
import { Suspense, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useRouter, useSearchParams } from 'next/navigation';
```

Add near the other local imports:

```tsx
import { DEFAULT_EXERCISE_COUNT, DICTATION_RUN_COUNT } from '../../../lib/drill/session-config';
import { DrillHub } from './_components/drill-hub';
```

(Replace the existing `import { DEFAULT_EXERCISE_COUNT } from '../../../lib/drill/session-config';` line with the combined import above.)

(b) Rename the current default export. Change `export default function PracticePage() {` to:

```tsx
type StartIntent = 'quick' | 'dictation';

function PracticePageContent() {
```

(c) Inside `PracticePageContent`, read the start intent from the URL (place near the other `useState` calls, after `const router = useRouter();`):

```tsx
  const searchParams = useSearchParams();
  const [startIntent, setStartIntent] = useState<StartIntent | null>(() => {
    const s = searchParams.get('start');
    return s === 'quick' || s === 'dictation' ? s : null;
  });
```

(d) Gate the kickoff effect on `startIntent` and pick the session config from it. Replace the kickoff effect (lines ~145-163) with:

```tsx
  const sessionKickoffRef = useRef(false);
  useEffect(() => {
    if (!initialized) return;
    if (startIntent === null) return; // no intent → show the hub, don't auto-start
    if (state.kind !== 'idle') {
      sessionKickoffRef.current = false;
      return;
    }
    if (sessionKickoffRef.current) return;
    sessionKickoffRef.current = true;

    dispatch({ type: 'CREATE_REQUESTED' });
    const config =
      startIntent === 'dictation'
        ? {
            language: activeLanguage,
            difficulty,
            exerciseCount: DICTATION_RUN_COUNT,
            exerciseType: ExerciseType.DICTATION,
          }
        : {
            language: activeLanguage,
            difficulty,
            exerciseCount: DEFAULT_EXERCISE_COUNT,
          };
    createSession.mutate(config, {
      onSuccess: (data) => dispatch({ type: 'CREATE_SUCCEEDED', session: data }),
      onError: (err) => dispatch({ type: 'CREATE_FAILED', error: err as Error }),
    });
  }, [initialized, startIntent, state.kind, activeLanguage, difficulty, createSession]);
```

(e) Render the hub when idle with no intent. Add this branch immediately AFTER the zero-profiles guard (the `if (profiles.length === 0) { ... }` block, ~lines 266-273) and BEFORE the `insufficient` computation:

```tsx
  if (state.kind === 'idle' && startIntent === null) {
    return (
      <DrillHub
        difficulty={difficulty}
        onDifficultyChange={setDifficulty}
        onStartQuick={() => setStartIntent('quick')}
        onStartDictation={() => setStartIntent('dictation')}
      />
    );
  }
```

(f) At the very end of the file, add the Suspense wrapper as the new default export (mirrors `app/onboarding/page.tsx`):

```tsx
// `useSearchParams()` forces this client page out of static prerendering;
// Next.js requires the bailout to sit under a Suspense boundary. The default
// export is a thin wrapper; PracticePageContent holds the real page.
export default function PracticePage() {
  return (
    <Suspense fallback={<div className="p-s-6" />}>
      <PracticePageContent />
    </Suspense>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @language-drill/web test -- "drill/page"`
Expected: PASS — the three hub tests green and all pre-existing PracticePage tests green (they run with `start=quick`).

Also typecheck the web package: `pnpm --filter @language-drill/web typecheck` — zero errors.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(dashboard)/drill/page.tsx" "apps/web/app/(dashboard)/drill/page.test.tsx"
git commit -m "feat(web): /drill renders launcher hub unless ?start= intent is set"
```

---

### Task 6: web — route the spine CTAs to `?start=quick`

Switch every "start practicing now" CTA from `/drill` / `/drill?language=…` / `/drill?focus=…` to `/drill?start=quick`, so they keep launching in one tap now that bare `/drill` is the hub. Leave the nav "drill" tab and the debrief **error fallbacks** on bare `/drill` (they should land on the hub). Update the asserting tests in the same task.

**Files (source):**
- `apps/web/app/(dashboard)/_components/today-timeline.tsx` (`drillHref`, ~line 63)
- `apps/web/app/(dashboard)/_components/next-up-card.tsx` (`drillHref`, ~line 29)
- `apps/web/app/(dashboard)/_components/skill-snapshot-grid.tsx` (~line 81)
- `apps/web/app/(dashboard)/progress/_components/shape-side-cards.tsx` (~lines 141, 165)
- `apps/web/app/(dashboard)/progress/_components/heatmap-tab.tsx` (~line 72)
- `apps/web/app/(dashboard)/progress/_components/progress-empty-state.tsx` (~line 28)
- `apps/web/app/(dashboard)/drill/debrief/_components/debrief-footer.tsx` ("another session", ~line 45)

**Files (tests to update):** any test asserting the old hrefs (notably `home/page.test.tsx` asserts `/drill?language=ES` for the next-up card; `today-timeline` / `next-up-card` / `state-cards` / `skill-snapshot-grid` / progress component tests).

- [ ] **Step 1: Change the source links**

In `today-timeline.tsx`, change:

```tsx
  const drillHref = `/drill?language=${language}`;
```

to:

```tsx
  // Spine CTA: keep one-tap launch now that bare /drill is the hub.
  const drillHref = `/drill?start=quick`;
```

In `next-up-card.tsx`, change `const drillHref = \`/drill?language=${language}\`;` to `const drillHref = \`/drill?start=quick\`;`.

In `skill-snapshot-grid.tsx`, change `href={\`/drill?language=${language}\`}` to `href="/drill?start=quick"`.

In `shape-side-cards.tsx`, change BOTH `href={\`/drill?focus=${weakest.key}\`}` (~141) and `href="/drill"` (~165) to `href="/drill?start=quick"`.

In `heatmap-tab.tsx` (~72) and `progress-empty-state.tsx` (~28), change `href="/drill"` to `href="/drill?start=quick"`.

In `debrief-footer.tsx`, change the "another session" button `onClick={() => router.push('/drill')}` to `onClick={() => router.push('/drill?start=quick')}`. **Leave** the `debrief-load-error.tsx` and `debrief-not-found.tsx` fallbacks on `router.push('/drill')` (they should recover to the hub).

If any of these source files now have an unused `language` prop/variable after the change, leave the prop in place (it may be used elsewhere); only remove a variable that becomes entirely unused and trips lint.

- [ ] **Step 2: Update the asserting tests**

Find every test asserting the old hrefs and update them to `/drill?start=quick`:

Run: `grep -rn "/drill?language=\|/drill?focus=\|'/drill'\|\"/drill\"" apps/web --include=*.test.tsx`

For each hit that asserts a **spine CTA** href (timeline next-up, next-up-card, all-done, skill-snapshot, progress "start practicing", debrief "another session"), change the expected value to `'/drill?start=quick'`. For example, in `home/page.test.tsx` the next-up assertion:

```tsx
    expect(cta).toHaveAttribute('href', '/drill?start=quick');
```

Do NOT change assertions for the debrief **error-fallback** navigations (`debrief-load-error`, `debrief-not-found`) — those stay `'/drill'`.

- [ ] **Step 3: Run the affected web tests**

Run: `pnpm --filter @language-drill/web test -- today-timeline next-up-card state-cards skill-snapshot "home/page" shape-side-cards heatmap-tab progress-empty-state debrief-footer`
Expected: PASS. (If a test file name doesn't match, run `pnpm --filter @language-drill/web test` once to catch stragglers.)

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @language-drill/web typecheck`
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(web): route spine CTAs to /drill?start=quick (hub-aware)"
```

---

### Task 7: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Lint**

Run: `pnpm lint`
Expected: zero errors.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: zero errors (11/11 packages).

- [ ] **Step 3: Remove any stale lambda build artifact, then run the full suite single-threaded**

Stale compiled tests under `infra/lambda/dist/**/*.test.js` can produce phantom failures in a full run. Remove the untracked build artifact first, then run:

Run: `rm -rf infra/lambda/dist && pnpm turbo run test --concurrency=1`
Expected: all packages green.

- [ ] **Step 4: Final commit (if any lint/format fixups were needed)**

```bash
git add -A
git commit -m "chore(drill-hub): lint/typecheck fixups" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage:**
- Spec "`/drill` = on-demand launcher hub (status strip + launcher row: Quick drill / Dictation / Free writing)" → Tasks 3 (status strip), 4 (hub), 5 (page renders hub). ✓
- Spec "thin 'Today: …' status strip linking back to home" → Task 3 (`DrillTodayStatus`, links `/home`). ✓
- Spec "Dictation launcher → a short dictation-only run" → Tasks 1–2 (`exerciseType` filter + audio gate), 5 (dictation config, `DICTATION_RUN_COUNT`). ✓
- Spec "no new nav tabs" → nav untouched; the drill tab stays bare `/drill` (the hub). ✓
- User decision "auto-start via `?start=quick`; spine CTAs keep one-click; nav tab + error fallbacks → bare hub" → Tasks 5 (intent gating) + 6 (CTA rewiring). ✓
- Spec "free writing reachable from the hub" → Task 4 (Free writing launcher → `/drill/free-writing`). ✓

**Out of scope (correctly deferred):** the debrief "another session" → "practice more → hub" rework is Plan 3; Task 6 only preserves its one-tap launch (`?start=quick`). The dictation pool must actually contain audio-ready dictation rows for the dictation launcher to yield a session — seeding/generation is owned elsewhere; if the pool is empty the run surfaces the existing `INSUFFICIENT_EXERCISES` card (no new handling needed).

**Placeholder scan:** no TBD/TODO; every code step has full code. The one conditional ("drop the `Button` import if unused") is a concrete lint instruction, not a placeholder.

**Type consistency:** `exerciseType` is `z.nativeEnum(ExerciseType).optional()` in both the api-client (Task 1) and lambda (Task 2) `CreateSessionRequestSchema`. `StartIntent = 'quick' | 'dictation'` and the `?start=` values match across page gating (Task 5) and CTA links (Task 6, `start=quick`). `DICTATION_RUN_COUNT` (Task 3) is consumed in Task 5. `DrillHub` prop names (`onStartQuick`/`onStartDictation`/`onDifficultyChange`/`difficulty`) match between its definition (Task 4) and the page (Task 5).
