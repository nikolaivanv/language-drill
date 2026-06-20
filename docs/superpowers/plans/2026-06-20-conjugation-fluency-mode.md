# Conjugation in Fluency Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make mastered conjugation items appear in fluency mode — in the mixed per-language pool and in a dedicated conjugation-only session reachable from an in-place toggle and a deep-link.

**Architecture:** The feature is already wired frontend-side and in shared code (`FLUENCY_ELIGIBLE_TYPES`, `gradeFluencyAnswer`, `FluencyItem`'s conjugation branch, `promptLabelFor`). This plan closes two backend gaps in `infra/lambda/src/routes/fluency.ts` (the session eligibility SQL hardcodes cloze/vocab; the attempt `correctAnswer` doesn't resolve conjugation), adds a request-time `types` filter for conjugation-only sessions (no DB schema change), threads it through the api-client schema, and adds the two web entry points.

**Tech Stack:** Hono + Drizzle (raw `db.execute(sql\`…\`)`) on AWS Lambda; Zod schemas in `@language-drill/api-client`; Next.js App Router (`'use client'`) + TanStack Query on the web; Vitest + Testing Library for tests.

## Global Constraints

- Fluency is a **separate signal** — never feed the mastery radar. `routes/fluency.ts` must not import `userExerciseHistory`, `usageEvents`, or `@language-drill/ai`. A regression test asserts `db.insert` is called exactly once per attempt; do not break it.
- Conjugation fluency is **not** added to adaptive rotation (`today-plan`). Entry is opt-in only (toggle + deep-link).
- No new DB schema or migration — the `types` filter is request-time only.
- The eligible-type allowlist has a **single source of truth**: `FLUENCY_ELIGIBLE_TYPES` in `packages/shared/src/fluency.ts`. Derive the SQL list, the route Zod enum, and the api-client Zod enum from it — never re-hardcode `cloze, vocab_recall, conjugation`.
- `types` values are validated against the eligible enum **before** reaching raw SQL. Never interpolate unvalidated strings into the `IN (...)` list.
- Run the pre-push suite from the repo root before finishing: `pnpm lint && pnpm typecheck && pnpm test` (zero failures).

---

### Task 1: `resolveFluencyTypes` helper (pure, unit-testable)

The session route mocks `db.execute`, so the SQL filter itself can't be asserted through route tests. Extract the type-resolution decision into a pure function so it has a real test boundary. This is the only place that maps an optional request filter to the concrete eligible-type list the SQL queries.

**Files:**
- Modify: `infra/lambda/src/lib/fluency-session.ts`
- Test: `infra/lambda/src/lib/fluency-session.test.ts`

**Interfaces:**
- Consumes: `FLUENCY_ELIGIBLE_TYPES`, `ExerciseType` from `@language-drill/shared`.
- Produces: `resolveFluencyTypes(requested?: readonly ExerciseType[]): ExerciseType[]` — returns a non-empty list (all eligible when nothing requested or every requested type is non-eligible; otherwise the eligible subset, in `FLUENCY_ELIGIBLE_TYPES` order). Used by Task 2.

- [ ] **Step 1: Write the failing tests**

Append to `infra/lambda/src/lib/fluency-session.test.ts`. Add the import for `resolveFluencyTypes` to the existing import from `./fluency-session`, and `FLUENCY_ELIGIBLE_TYPES` to the existing `@language-drill/shared` import (the file already imports `ExerciseType` for fixtures — if not, add it).

```ts
import { resolveFluencyTypes } from './fluency-session';
import { ExerciseType, FLUENCY_ELIGIBLE_TYPES } from '@language-drill/shared';

describe('resolveFluencyTypes', () => {
  it('returns all eligible types when nothing is requested', () => {
    expect(resolveFluencyTypes()).toEqual([...FLUENCY_ELIGIBLE_TYPES]);
    expect(resolveFluencyTypes([])).toEqual([...FLUENCY_ELIGIBLE_TYPES]);
  });

  it('includes conjugation among the defaults', () => {
    expect(resolveFluencyTypes()).toContain(ExerciseType.CONJUGATION);
  });

  it('filters to the requested eligible subset', () => {
    expect(resolveFluencyTypes([ExerciseType.CONJUGATION])).toEqual([ExerciseType.CONJUGATION]);
  });

  it('drops non-eligible requested types', () => {
    expect(
      resolveFluencyTypes([ExerciseType.CONJUGATION, ExerciseType.TRANSLATION]),
    ).toEqual([ExerciseType.CONJUGATION]);
  });

  it('falls back to all eligible when every requested type is non-eligible', () => {
    expect(resolveFluencyTypes([ExerciseType.TRANSLATION])).toEqual([...FLUENCY_ELIGIBLE_TYPES]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @language-drill/lambda test fluency-session`
Expected: FAIL — `resolveFluencyTypes is not a function` (not yet exported).

- [ ] **Step 3: Write the implementation**

Add to `infra/lambda/src/lib/fluency-session.ts`. Extend the existing top import from `@language-drill/shared` to also bring in `FLUENCY_ELIGIBLE_TYPES` and the `ExerciseType` type:

```ts
import { MIN_FLUENCY_POOL, FLUENCY_ELIGIBLE_TYPES, type ExerciseType } from '@language-drill/shared';
```

Append this exported function (below `composeFluencySession`):

```ts
/**
 * Resolve which exercise types a fluency session should query.
 * - No requested types → all eligible types (the mixed-pool default).
 * - Requested types → the intersection with FLUENCY_ELIGIBLE_TYPES, preserving
 *   the eligible-list order. Non-eligible requests are dropped (the route's Zod
 *   schema already rejects unknown enum values; this is defense in depth).
 * Always returns a non-empty list: an all-dropped request falls back to all
 * eligible types so the SQL `IN (...)` can never be empty.
 */
export function resolveFluencyTypes(
  requested?: readonly ExerciseType[],
): ExerciseType[] {
  if (!requested || requested.length === 0) {
    return [...FLUENCY_ELIGIBLE_TYPES];
  }
  const requestedSet = new Set(requested);
  const filtered = FLUENCY_ELIGIBLE_TYPES.filter((t) => requestedSet.has(t));
  return filtered.length > 0 ? filtered : [...FLUENCY_ELIGIBLE_TYPES];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @language-drill/lambda test fluency-session`
Expected: PASS (existing `composeFluencySession` tests + 5 new `resolveFluencyTypes` tests).

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/lib/fluency-session.ts infra/lambda/src/lib/fluency-session.test.ts
git commit -m "feat(fluency): resolveFluencyTypes helper for session type filtering"
```

---

### Task 2: Session route — accept `types`, drive the SQL from the eligible list

Add an optional `types` filter to `POST /fluency/session`, validated to a non-empty subset of the eligible types, and build the SQL `IN (...)` list from `resolveFluencyTypes`. With no filter, conjugation now joins the default mixed pool; with `types: ['conjugation']`, the session is conjugation-only.

**Files:**
- Modify: `infra/lambda/src/routes/fluency.ts` (imports, `SessionBodySchema`, the `db.execute` query)
- Test: `infra/lambda/src/routes/fluency.test.ts`

**Interfaces:**
- Consumes: `resolveFluencyTypes` (Task 1); `FLUENCY_ELIGIBLE_TYPES`, `ExerciseType` from `@language-drill/shared`; `sql` from `drizzle-orm` (already imported).
- Produces: `POST /fluency/session` accepts `{ language, count?, types? }`. `types` is a non-empty array of eligible type strings; invalid/empty/non-eligible → `400 VALIDATION_ERROR`.

- [ ] **Step 1: Write the failing tests**

Add these cases inside the existing `describe('POST /fluency/session', …)` block in `infra/lambda/src/routes/fluency.test.ts`. First add a conjugation-row helper near `makePoolRow` (top of file):

```ts
function makeConjugationRow(id: string) {
  return makePoolRow({
    id,
    type: ExerciseType.CONJUGATION,
    grammar_point_key: 'es-b1-conditional',
    content_json: {
      type: ExerciseType.CONJUGATION,
      instructions: 'Write the correct form.',
      lemma: 'ir',
      lemmaGloss: 'to go',
      featureBundle: 'condicional · 1ª persona del plural',
      targetForm: 'iríamos',
      breakdown: 'ir + íamos',
      exampleSentences: ['Iríamos al cine.'],
    },
  });
}
```

Then the new test cases:

```ts
it('accepts a conjugation-only types filter and returns 200', async () => {
  const rows = Array.from({ length: 5 }, (_, i) => makeConjugationRow(`conj-${i + 1}`));
  mockExecute.mockResolvedValueOnce({ rows });

  const res = await app.request(
    '/fluency/session',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: 'ES', types: ['conjugation'] }),
    },
    authEnv,
  );

  expect(res.status).toBe(200);
  const body = (await res.json()) as AnyJson;
  expect(body.exercises.length).toBeGreaterThanOrEqual(4);
  expect(body.exercises.every((e: AnyJson) => e.type === 'conjugation')).toBe(true);
});

it('returns 400 VALIDATION_ERROR for a non-eligible type', async () => {
  const res = await app.request(
    '/fluency/session',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: 'ES', types: ['translation'] }),
    },
    authEnv,
  );

  expect(res.status).toBe(400);
  const body = (await res.json()) as AnyJson;
  expect(body.code).toBe('VALIDATION_ERROR');
});

it('returns 400 VALIDATION_ERROR for an empty types array', async () => {
  const res = await app.request(
    '/fluency/session',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: 'ES', types: [] }),
    },
    authEnv,
  );

  expect(res.status).toBe(400);
  const body = (await res.json()) as AnyJson;
  expect(body.code).toBe('VALIDATION_ERROR');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @language-drill/lambda test routes/fluency`
Expected: FAIL — `types: []` and `types: ['translation']` currently pass schema validation (no `types` field yet) so they return 409/200 instead of 400; the conjugation-only test returns rows but the assertion on a real filter may pass vacuously — the two 400 cases are the load-bearing failures.

- [ ] **Step 3: Implement the route changes**

In `infra/lambda/src/routes/fluency.ts`:

1. Extend the `@language-drill/shared` import to add `FLUENCY_ELIGIBLE_TYPES` (it already imports `ExerciseType`, `DEFAULT_FLUENCY_SESSION_SIZE`, `MIN_FLUENCY_POOL`, etc.):

```ts
  FLUENCY_ELIGIBLE_TYPES,
```

2. Import the helper from the session lib (the file already imports `composeFluencySession` from there):

```ts
import { composeFluencySession, resolveFluencyTypes, type EligibleExercise } from '../lib/fluency-session';
```

3. Replace `SessionBodySchema` (currently `language` + `count`) with one that adds `types`, deriving the enum from the eligible list:

```ts
// Eligible-type enum for the optional `types` filter. Derived from the single
// source of truth so it can never drift from gradeFluencyAnswer's support.
const FluencyTypeEnum = z.enum(
  FLUENCY_ELIGIBLE_TYPES as unknown as [string, ...string[]],
);

const SessionBodySchema = z.object({
  language: LearningLanguageEnum,
  count: z.number().int().min(1).max(20).optional(),
  types: z.array(FluencyTypeEnum).nonempty().optional(),
});
```

4. Inside the `/fluency/session` handler, after `const { language, count = DEFAULT_FLUENCY_SESSION_SIZE } = parsed.data;`, resolve the type list and build a parameterized `IN` fragment:

```ts
  const typeList = resolveFluencyTypes(parsed.data.types as ExerciseType[] | undefined);
  const typesInList = sql.join(typeList.map((t) => sql`${t}`), sql`, `);
```

5. In the `db.execute(sql\`…\`)` query, replace the hardcoded line:

```ts
      AND e.type IN (${ExerciseType.CLOZE}, ${ExerciseType.VOCAB_RECALL})
```

with:

```ts
      AND e.type IN (${typesInList})
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @language-drill/lambda test routes/fluency`
Expected: PASS — including the existing 409/200/attempt/stats/regression cases and the 3 new session cases.

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/routes/fluency.ts infra/lambda/src/routes/fluency.test.ts
git commit -m "feat(fluency): conjugation in session pool + optional types filter"
```

---

### Task 3: Attempt route — resolve `correctAnswer` for conjugation

Close the second backend gap: a conjugation "not quite" verdict currently shows a blank correct answer because the resolver only handles cloze/vocab.

**Files:**
- Modify: `infra/lambda/src/routes/fluency.ts` (the `correctAnswer` block in `POST /fluency/attempts`)
- Test: `infra/lambda/src/routes/fluency.test.ts`

**Interfaces:**
- Consumes: `ConjugationContent.targetForm` (discriminated on `content.type === ExerciseType.CONJUGATION`).
- Produces: `POST /fluency/attempts` returns `correctAnswer === targetForm` for conjugation exercises.

- [ ] **Step 1: Write the failing test**

Add inside the existing `describe('POST /fluency/attempts', …)` block:

```ts
it('resolves correctAnswer to targetForm for a conjugation attempt', async () => {
  mockLimit.mockResolvedValueOnce([
    {
      id: EXERCISE_UUID,
      type: ExerciseType.CONJUGATION,
      language: 'ES',
      difficulty: 'B1',
      grammarPointKey: 'es-b1-conditional',
      contentJson: {
        type: ExerciseType.CONJUGATION,
        instructions: 'Write the correct form.',
        lemma: 'ir',
        lemmaGloss: 'to go',
        featureBundle: 'condicional · 1ª persona del plural',
        targetForm: 'iríamos',
        breakdown: 'ir + íamos',
        exampleSentences: ['Iríamos al cine.'],
      },
    },
  ]);

  const res = await app.request(
    '/fluency/attempts',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        exerciseId: EXERCISE_UUID,
        answer: 'irian', // wrong on purpose
        latencyMs: 1500,
      }),
    },
    authEnv,
  );

  expect(res.status).toBe(200);
  const body = (await res.json()) as AnyJson;
  expect(body.correct).toBe(false);
  expect(body.correctAnswer).toBe('iríamos');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/lambda test routes/fluency`
Expected: FAIL — `expected '' to be 'iríamos'` (current resolver returns `''` for conjugation).

- [ ] **Step 3: Implement the resolver branch**

In `infra/lambda/src/routes/fluency.ts`, replace the `correctAnswer` block:

```ts
  const correctAnswer =
    content.type === ExerciseType.CLOZE
      ? content.correctAnswer
      : content.type === ExerciseType.VOCAB_RECALL
        ? content.expectedWord
        : ''; // unreachable: isFluencyEligibleType guard above ensures only cloze/vocab_recall reach here
```

with:

```ts
  const correctAnswer =
    content.type === ExerciseType.CLOZE
      ? content.correctAnswer
      : content.type === ExerciseType.VOCAB_RECALL
        ? content.expectedWord
        : content.type === ExerciseType.CONJUGATION
          ? content.targetForm
          : ''; // defensive default; isFluencyEligibleType guard keeps only eligible types here
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/lambda test routes/fluency`
Expected: PASS (all session + attempt + stats + regression cases).

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/routes/fluency.ts infra/lambda/src/routes/fluency.test.ts
git commit -m "feat(fluency): resolve conjugation correctAnswer in attempt verdict"
```

---

### Task 4: api-client — add `types` to the session request schema

Thread the optional `types` field through the shared request schema so the web hook can send it. The `useFluencySession` hook forwards the request body verbatim, so no hook change is needed.

**Files:**
- Modify: `packages/api-client/src/schemas/fluency.ts`
- Test: `packages/api-client/src/schemas/fluency.test.ts`

**Interfaces:**
- Consumes: `FLUENCY_ELIGIBLE_TYPES` from `@language-drill/shared`.
- Produces: `FluencySessionRequestSchema` now accepts optional `types: ExerciseType[]` (non-empty, eligible subset). `FluencySessionRequest` type gains `types?`.

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block to `packages/api-client/src/schemas/fluency.test.ts`, importing the request schema (currently only response schemas are imported):

```ts
import { FluencySessionRequestSchema } from './fluency';

describe('FluencySessionRequestSchema', () => {
  it('accepts a request with no types (mixed pool)', () => {
    expect(FluencySessionRequestSchema.safeParse({ language: 'ES' }).success).toBe(true);
  });

  it('accepts a conjugation-only types filter', () => {
    expect(
      FluencySessionRequestSchema.safeParse({ language: 'ES', types: ['conjugation'] }).success,
    ).toBe(true);
  });

  it('rejects an empty types array', () => {
    expect(FluencySessionRequestSchema.safeParse({ language: 'ES', types: [] }).success).toBe(false);
  });

  it('rejects a non-eligible type', () => {
    expect(
      FluencySessionRequestSchema.safeParse({ language: 'ES', types: ['translation'] }).success,
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @language-drill/api-client test schemas/fluency`
Expected: FAIL — empty array and `'translation'` currently parse successfully (schema has no `types` field), so `.success` is `true` where the test expects `false`.

- [ ] **Step 3: Implement the schema change**

In `packages/api-client/src/schemas/fluency.ts`, add the import at the top:

```ts
import { FLUENCY_ELIGIBLE_TYPES } from '@language-drill/shared';
```

Add the enum and extend the request schema:

```ts
// Eligible-type enum for the optional fluency `types` filter — derived from the
// shared single source of truth so it stays in lockstep with the backend.
export const FluencySessionTypeEnum = z.enum(
  FLUENCY_ELIGIBLE_TYPES as unknown as [string, ...string[]],
);

// Request body for POST /fluency/session
export const FluencySessionRequestSchema = z.object({
  language: LearningLanguageEnum,
  count: z.number().int().min(1).max(20).optional(),
  types: z.array(FluencySessionTypeEnum).nonempty().optional(),
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @language-drill/api-client test schemas/fluency`
Expected: PASS (existing response-schema tests + 4 new request-schema tests).

- [ ] **Step 5: Commit**

```bash
git add packages/api-client/src/schemas/fluency.ts packages/api-client/src/schemas/fluency.test.ts
git commit -m "feat(fluency): add optional types filter to session request schema"
```

---

### Task 5: Web — fluency page mode toggle + `?type=conjugation` wiring

Add an in-place `all · conjugation` toggle to `/fluency`, read/write the mode via the URL (`?type=conjugation`), and send `types: ['conjugation']` when in conjugation mode. Reuses the established `?param` + `router.replace` pattern from the progress tabs.

**Files:**
- Create: `apps/web/app/(dashboard)/fluency/_components/fluency-mode-toggle.tsx`
- Create: `apps/web/app/(dashboard)/fluency/_components/use-fluency-mode-url-state.ts`
- Modify: `apps/web/app/(dashboard)/fluency/page.tsx`
- Test: `apps/web/app/(dashboard)/fluency/_components/__tests__/fluency-mode-toggle.test.tsx`

**Interfaces:**
- Consumes: `useRouter`, `useSearchParams` from `next/navigation`; `useFluencySession` (sends `{ language, types? }`).
- Produces: `FLUENCY_MODES = ['all', 'conjugation'] as const`, `FluencyMode`; `FluencyModeToggle({ mode, onSelect })`; `useFluencyModeUrlState(): { mode: FluencyMode; setMode: (m: FluencyMode) => void }`.

- [ ] **Step 1: Write the failing test (toggle component)**

Create `apps/web/app/(dashboard)/fluency/_components/__tests__/fluency-mode-toggle.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FluencyModeToggle } from '../fluency-mode-toggle';

describe('FluencyModeToggle', () => {
  it('renders both modes and marks the active one selected', () => {
    render(<FluencyModeToggle mode="conjugation" onSelect={() => {}} />);
    const all = screen.getByRole('tab', { name: 'all' });
    const conj = screen.getByRole('tab', { name: 'conjugation' });
    expect(all).toHaveAttribute('aria-selected', 'false');
    expect(conj).toHaveAttribute('aria-selected', 'true');
  });

  it('calls onSelect with the clicked mode', () => {
    const onSelect = vi.fn();
    render(<FluencyModeToggle mode="all" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('tab', { name: 'conjugation' }));
    expect(onSelect).toHaveBeenCalledWith('conjugation');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/web test fluency-mode-toggle`
Expected: FAIL — cannot resolve `../fluency-mode-toggle` (not created yet).

- [ ] **Step 3: Implement the toggle component**

Create `apps/web/app/(dashboard)/fluency/_components/fluency-mode-toggle.tsx`:

```tsx
'use client';

export const FLUENCY_MODES = ['all', 'conjugation'] as const;
export type FluencyMode = (typeof FLUENCY_MODES)[number];

const LABELS: Record<FluencyMode, string> = {
  all: 'all',
  conjugation: 'conjugation',
};

/**
 * In-place mode selector for fluency mode. `all` runs the mixed per-language
 * pool; `conjugation` filters the session to conjugation items only. The page
 * owns URL sync + session restart (see use-fluency-mode-url-state).
 */
export function FluencyModeToggle({
  mode,
  onSelect,
}: {
  mode: FluencyMode;
  onSelect: (mode: FluencyMode) => void;
}) {
  return (
    <div role="tablist" aria-label="fluency mode" className="flex gap-s-2">
      {FLUENCY_MODES.map((m) => (
        <button
          key={m}
          type="button"
          role="tab"
          aria-selected={m === mode}
          onClick={() => onSelect(m)}
          className={`t-small rounded-r-md border px-s-3 py-s-1 ${
            m === mode ? 'border-accent-2 text-accent-2' : 'border-rule text-ink-2'
          }`}
        >
          {LABELS[m]}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/web test fluency-mode-toggle`
Expected: PASS.

- [ ] **Step 5: Implement the URL-state hook**

Create `apps/web/app/(dashboard)/fluency/_components/use-fluency-mode-url-state.ts`:

```ts
'use client';

import { useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { FluencyMode } from './fluency-mode-toggle';

// ---------------------------------------------------------------------------
// useFluencyModeUrlState — reload-safe, shareable fluency mode via `?type=`.
// Only `?type=conjugation` selects conjugation mode; anything else (including
// absent) is the mixed-pool default. Mirrors progress/_lib/use-tab-url-state.
// ---------------------------------------------------------------------------

export type UseFluencyModeUrlState = {
  mode: FluencyMode;
  setMode: (mode: FluencyMode) => void;
};

export function useFluencyModeUrlState(): UseFluencyModeUrlState {
  const router = useRouter();
  const searchParams = useSearchParams();

  const raw = searchParams?.get('type') ?? null;
  const mode: FluencyMode = raw === 'conjugation' ? 'conjugation' : 'all';

  const setMode = useCallback(
    (next: FluencyMode) => {
      router.replace(next === 'conjugation' ? '/fluency?type=conjugation' : '/fluency', {
        scroll: false,
      });
    },
    [router],
  );

  return { mode, setMode };
}
```

- [ ] **Step 6: Rewrite the fluency page to use the toggle**

Replace `apps/web/app/(dashboard)/fluency/page.tsx` entirely with:

```tsx
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { ExerciseType } from '@language-drill/shared';
import {
  createAuthenticatedFetch,
  useFluencySession,
  useSubmitFluencyAttempt,
} from '@language-drill/api-client';
import { useActiveLanguage } from '../../../components/shell';
import { FluencyRunner, type FluencyExercise } from './_components/fluency-runner';
import { FluencyDebrief } from './_components/fluency-debrief';
import type { FluencyItemResult } from './_components/fluency-metrics';
import { FluencyModeToggle } from './_components/fluency-mode-toggle';
import { useFluencyModeUrlState } from './_components/use-fluency-mode-url-state';

export default function FluencyPage() {
  const { activeLanguage } = useActiveLanguage();
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);

  const { mode, setMode } = useFluencyModeUrlState();
  const session = useFluencySession({ fetchFn });
  const submitAttempt = useSubmitFluencyAttempt({ fetchFn });
  const [results, setResults] = useState<FluencyItemResult[] | null>(null);

  // Start (or restart) a session for the active language + mode. `session.mutate`
  // is stable across renders (TanStack Query guarantee). Depend on `mode` (a
  // stable string), NOT a freshly-built `types` array, to avoid re-running every
  // render. Conjugation mode sends a single-type filter; `all` omits it.
  const sessionMutate = session.mutate;
  const startSession = useCallback(() => {
    setResults(null);
    sessionMutate({
      language: activeLanguage,
      ...(mode === 'conjugation' ? { types: [ExerciseType.CONJUGATION] } : {}),
    });
  }, [activeLanguage, sessionMutate, mode]);

  useEffect(() => {
    startSession();
  }, [startSession]);

  const insufficientCopy =
    mode === 'conjugation'
      ? 'Master a few more conjugations first — fluency mode re-serves forms you already know, fast. Keep drilling conjugation in normal mode and come back.'
      : 'Master a few more items first — fluency mode re-serves things you already know, fast. Keep drilling in normal mode and come back.';

  const header = (
    <div className="flex flex-col gap-s-3">
      <h1 className="t-display-s">fluency mode</h1>
      <FluencyModeToggle mode={mode} onSelect={setMode} />
    </div>
  );

  if (session.isPending || session.isIdle) {
    return (
      <div className="flex flex-col gap-s-4">
        {header}
        <p className="t-body">loading fluency drill…</p>
      </div>
    );
  }

  // 409 INSUFFICIENT_FLUENCY_POOL surfaces here as a mutation error.
  if (session.isError) {
    return (
      <div className="flex flex-col gap-s-4">
        {header}
        <p className="t-body text-ink-mute">{insufficientCopy}</p>
      </div>
    );
  }

  if (results) {
    return (
      <div className="flex flex-col gap-s-4">
        {header}
        <FluencyDebrief results={results} onRestart={startSession} />
      </div>
    );
  }

  const exercises = (session.data?.exercises ?? []) as FluencyExercise[];

  return (
    <div className="flex flex-col gap-s-4">
      {header}
      <FluencyRunner
        exercises={exercises}
        onSubmitAttempt={(input) => submitAttempt.mutateAsync(input)}
        onDone={(r) => setResults(r)}
      />
    </div>
  );
}
```

Note: the `all`-mode insufficient copy keeps the exact phrase "Master a few more items first" so the existing e2e `fluency.spec.ts` (which loads `/fluency` with no `?type`) still matches `/master a few more items first/i`.

- [ ] **Step 7: Write the page-level test (toggle drives session filter + URL)**

Create `apps/web/app/(dashboard)/fluency/__tests__/page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Language } from '@language-drill/shared';
import { ActiveLanguageProvider } from '../../../../components/shell';
import FluencyPage from '../page';

const mockGetToken = vi.fn().mockResolvedValue('test-token');
vi.mock('@clerk/nextjs', () => ({ useAuth: () => ({ getToken: mockGetToken }) }));

const mockReplace = vi.fn();
let searchType: string | null = null;
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => ({ get: (k: string) => (k === 'type' ? searchType : null) }),
}));

const mockSessionMutate = vi.fn();
const mockSubmitMutateAsync = vi.fn();
vi.mock('@language-drill/api-client', () => ({
  createAuthenticatedFetch: vi.fn(() => vi.fn()),
  useFluencySession: () => ({
    mutate: mockSessionMutate,
    isPending: false,
    isIdle: false,
    isError: true, // render the insufficient branch — no runner internals needed
    data: undefined,
  }),
  useSubmitFluencyAttempt: () => ({ mutateAsync: mockSubmitMutateAsync }),
}));

function renderPage() {
  return render(
    <ActiveLanguageProvider initialLanguage={Language.ES}>
      <FluencyPage />
    </ActiveLanguageProvider>,
  );
}

describe('FluencyPage mode toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchType = null;
  });

  it('starts an unfiltered session in the default (all) mode', async () => {
    renderPage();
    await waitFor(() => expect(mockSessionMutate).toHaveBeenCalled());
    const arg = mockSessionMutate.mock.calls[0][0];
    expect(arg.language).toBe('ES');
    expect(arg.types).toBeUndefined();
  });

  it('starts a conjugation-only session when ?type=conjugation', async () => {
    searchType = 'conjugation';
    renderPage();
    await waitFor(() => expect(mockSessionMutate).toHaveBeenCalled());
    const arg = mockSessionMutate.mock.calls[0][0];
    expect(arg.types).toEqual(['conjugation']);
    expect(screen.getByText(/master a few more conjugations first/i)).toBeInTheDocument();
  });

  it('navigates to ?type=conjugation when the conjugation chip is clicked', () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'conjugation' }));
    expect(mockReplace).toHaveBeenCalledWith('/fluency?type=conjugation', { scroll: false });
  });
});
```

Verify `ActiveLanguageProvider` accepts an `initialLanguage` prop (the conjugation `page.test.tsx` wraps with `<ActiveLanguageProvider>` — match its exact usage; if it takes no prop, drop `initialLanguage` and rely on the provider default, adjusting the `language` assertion to the default).

- [ ] **Step 8: Run the page + component tests**

Run: `pnpm --filter @language-drill/web test fluency`
Expected: PASS — toggle component test + page test (3 cases).

- [ ] **Step 9: Commit**

```bash
git add "apps/web/app/(dashboard)/fluency/"
git commit -m "feat(fluency): in-place all/conjugation mode toggle on /fluency"
```

---

### Task 6: Web — deep-link from the conjugation drill page

Add a "drill these fast →" link from `/drill/conjugation` to `/fluency?type=conjugation`, styled like the existing `FluencyPromo` cross-sell.

**Files:**
- Modify: `apps/web/app/(dashboard)/drill/conjugation/page.tsx`
- Test: `apps/web/app/(dashboard)/drill/conjugation/page.test.tsx`

**Interfaces:**
- Consumes: nothing new (static `next/link`).
- Produces: a link with accessible name "drill these fast" and `href="/fluency?type=conjugation"` on the loaded conjugation page.

- [ ] **Step 1: Write the failing test**

Add a case to `apps/web/app/(dashboard)/drill/conjugation/page.test.tsx`. Use the file's existing render harness/fixtures (it already mocks `useExercise`/`useSubmitAnswer`/`useLanguageProfiles` and renders a loaded `CONJUGATION_EXERCISE`). Mirror an existing "renders the loaded exercise" test's arrange block, then assert:

```ts
it('shows a deep-link to conjugation fluency mode', () => {
  mockUseLanguageProfiles.mockReturnValue({ data: { profiles: [{ language: Language.ES, proficiencyLevel: CefrLevel.B1 }] } });
  mockUseSubmitAnswer.mockReturnValue({ mutateAsync: vi.fn() });
  mockUseExercise.mockReturnValue({ data: CONJUGATION_EXERCISE, isError: false, error: null, refetch: vi.fn() });

  renderPage(); // use the file's existing render helper; if none, render <ConjugationPage/> inside the providers the other tests use

  const link = screen.getByRole('link', { name: /drill these fast/i });
  expect(link).toHaveAttribute('href', '/fluency?type=conjugation');
});
```

If the file has no shared `renderPage` helper, copy the exact provider-wrapping render used by a neighboring passing test in the same file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/web test conjugation/page`
Expected: FAIL — no link with name "drill these fast" exists yet.

- [ ] **Step 3: Implement the deep-link**

In `apps/web/app/(dashboard)/drill/conjugation/page.tsx`:

Add the import near the top:

```tsx
import Link from 'next/link';
```

Replace the final return's heading block:

```tsx
  return (
    <div className="p-s-6">
      <h1 className="t-display-l mb-s-6">conjugation warm-up</h1>
      <ExercisePane
```

with a heading row that carries the link:

```tsx
  return (
    <div className="p-s-6">
      <div className="mb-s-6 flex items-baseline justify-between gap-s-4">
        <h1 className="t-display-l">conjugation warm-up</h1>
        <Link
          href="/fluency?type=conjugation"
          className="t-small text-ink-2 no-underline hover:text-accent-2"
        >
          drill these fast →
        </Link>
      </div>
      <ExercisePane
```

(The closing `</div>` of the outer `p-s-6` wrapper is unchanged.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/web test conjugation/page`
Expected: PASS (existing conjugation page cases + the new deep-link case).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(dashboard)/drill/conjugation/page.tsx" "apps/web/app/(dashboard)/drill/conjugation/page.test.tsx"
git commit -m "feat(fluency): deep-link from conjugation drill to conjugation fluency"
```

---

### Task 7: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Build dependency graph + run the pre-push suite**

Run from the repo root:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

Expected: zero failures across all three. (Per CLAUDE.md these are the pre-push gate.) If `typecheck` reports `Cannot find module '@language-drill/ai'`/`@language-drill/shared` in `packages/db`, run `pnpm build` once first to populate dist — that is a build-ordering artifact, not a code error.

- [ ] **Step 2: Manual smoke (optional but recommended)**

If a dev DB with mastered conjugation items is available: `pnpm dev`, visit `/fluency` (mixed pool now includes conjugation), toggle to `conjugation`, and follow the `/drill/conjugation` → "drill these fast" link. Confirm a wrong conjugation answer shows the correct `targetForm` in the verdict.

- [ ] **Step 3: Final commit (only if Step 1 required fixes)**

```bash
git add -A
git commit -m "chore(fluency): lint/typecheck/test fixups"
```

---

## Self-Review

**Spec coverage:**
- Backend gap #1 (session SQL) → Task 2. ✓
- Backend gap #2 (attempt correctAnswer) → Task 3. ✓
- Optional `types` filter (backend) → Task 2; (api-client) → Task 4. ✓
- Conjugation-only sessions → Tasks 2/4/5 (`types: ['conjugation']`). ✓
- In-place toggle entry point → Task 5. ✓
- Deep-link entry point → Task 6. ✓
- `?type=conjugation` URL, refresh/restart preserve it → Task 5 (`useFluencyModeUrlState` reads URL; `startSession` keyed on `mode`). ✓
- Tests across lambda route, helper, api-client schema, web toggle/page, conjugation page → Tasks 1–6. ✓
- Not added to adaptive rotation → no `today-plan` change anywhere. ✓
- Single source of truth for eligible types → Tasks 1/2/4 all derive from `FLUENCY_ELIGIBLE_TYPES`. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. The two "use the file's existing render harness" notes (Tasks 5/6) point at concrete neighboring patterns rather than leaving logic unspecified.

**Type consistency:** `resolveFluencyTypes(requested?: readonly ExerciseType[]): ExerciseType[]` — same signature in Task 1 (def) and Task 2 (call, with `as ExerciseType[] | undefined`). `FluencyMode`/`FLUENCY_MODES`/`FluencyModeToggle`/`useFluencyModeUrlState` names consistent across Task 5 files. `types` field name consistent across route schema (Task 2), api-client schema (Task 4), hook payload (Task 5). `correctAnswer`/`targetForm` consistent (Task 3). `?type=conjugation` deep-link target consistent across Tasks 5 and 6.
