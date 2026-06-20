# Coach Rebuild — Recurring-Error Headlines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the drill coach surface the user's recurring errors — a within-session repeat first, falling back to a cross-session theme from `/insights/errors` — instead of only canned per-type/score strings. The recurring headline overrides the canned message ONLY when a real pattern exists.

**Architecture:** The drill session reducer accumulates a per-session error log (the `errors[]` from each evaluation, tagged with the host item's `grammarPointKey`), persisting across item advances and resetting per session. A pure `coachHeadline` selector turns that log (plus the cross-session `/insights/errors` themes already available via `useInsightsErrors`) into a headline string, or `null` when no pattern qualifies. The drill page computes `coachHeadline(...) ?? coachMessage(ctx)` and passes the result to the existing `CoachRail`/`CoachCard` (whose `message: string` contract is unchanged).

**Tech Stack:** TypeScript, Next.js (App Router) + React, TanStack Query, Vitest + Testing Library.

## Global Constraints

- The web app must NOT import `@language-drill/db`. The cross-session source is the `useInsightsErrors` hook + `InsightsErrorTheme` type from `@language-drill/api-client` (already built and exported).
- The recurring headline OVERRIDES the canned `coachMessage()` string only when a pattern qualifies; otherwise the existing canned idle/evaluated string shows unchanged. `coachMessage()` itself is NOT modified.
- Pattern thresholds: a within-session group needs ≥2 errors; a cross-session theme needs `count ≥ 2` and a `sample`. (`MIN_REPEATS = 2`.)
- `CoachRail`/`CoachCard` keep their `message: string` prop contract — no component signature change.
- The per-session error log resets when a new session is created and persists across item advances (next/skip) within a session.
- Exact headline copy (pinned, tested verbatim):
  - within-session: `watch · {wrongText} → {correction} · slipped {n}× this session`
  - cross-session (named): `lately · {grammarPointName}: {wrongText} → {correction} ({count}×)`
  - cross-session (null name): `lately · {wrongText} → {correction} ({count}×)`
- Test runner: `pnpm --filter @language-drill/web test <pattern>`. The FULL gate is the real check (a page/hook change can pass focused vitest while `tsc`/full suite fails): before finishing run `pnpm lint && pnpm typecheck && pnpm test` from the repo root and confirm real exit 0 (do NOT pipe through `tail` — it masks the exit code). After any `packages/*` edit run `pnpm build`; none is expected in this plan (web-only).
- The drill page renders a NEW hook (`useInsightsErrors`); any drill-page TEST that mocks `@language-drill/api-client` must add this hook to its mock or the page render throws (this exact trap hit a prior PR — mock it returning `{ data: { themes: [] } }`).
- Git commit trailer (every commit): `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

- **Create** `apps/web/lib/drill/coach-headline.ts` — `SessionError` type + pure `withinSessionHeadline` / `crossSessionHeadline` / `coachHeadline`.
- **Create** `apps/web/lib/drill/__tests__/coach-headline.test.ts` — its tests.
- **Modify** `apps/web/app/(dashboard)/drill/_components/session-reducer.ts` — add a `sessionErrors` log (accumulate on evaluate, reset per session, persist on advance).
- **Modify** `apps/web/app/(dashboard)/drill/_components/session-reducer.test.ts` — accumulation/reset tests.
- **Modify** `apps/web/app/(dashboard)/drill/page.tsx` — call `useInsightsErrors`, compute `coachHeadline(...) ?? coachMessage(ctx)`.
- **Modify** the drill page test — mock `useInsightsErrors`; assert the headline overrides the canned string when a pattern exists.

---

### Task 1: Session reducer — accumulate a per-session error log

**Files:**
- Create: `apps/web/lib/drill/coach-headline.ts` (the `SessionError` type only in this task — the selector functions are Task 2; define the type here now so the reducer can import it)
- Modify: `apps/web/app/(dashboard)/drill/_components/session-reducer.ts`
- Modify: `apps/web/app/(dashboard)/drill/_components/session-reducer.test.ts`

**Interfaces:**
- Produces: `SessionError = { grammarPointKey: string | null; errorType: string; severity: string; text: string; correction: string }` (exported from `apps/web/lib/drill/coach-headline.ts`). The reducer's in-session state gains `sessionErrors: SessionError[]`.

- [ ] **Step 1: Define the `SessionError` type**

Create `apps/web/lib/drill/coach-headline.ts` with just the type for now (Task 2 fills in the selectors):

```typescript
export interface SessionError {
  grammarPointKey: string | null;
  errorType: string;
  severity: string;
  text: string;
  correction: string;
}
```

- [ ] **Step 2: Write the failing reducer tests**

Read `session-reducer.ts` and `session-reducer.test.ts` first to mirror the real action names + state-construction (the action that starts a session, e.g. `CREATE_SUCCEEDED`, and `ITEM_EVALUATED`/`ITEM_NEXT`). Add tests asserting:

```typescript
// (mirror the file's existing helpers for building a started session + an
// ITEM_EVALUATED action with an EvaluationResult carrying errors[])

it('accumulates evaluation errors into sessionErrors, tagged with the item grammar point', () => {
  let s = reducer(idle, startAction);          // session with items[0].grammarPointKey = 'tr-a1-locative'
  s = reducer(s, evaluatedAction([{ type: 'grammar', severity: 'major', text: 'pazarda', correction: 'pazara', explanation: 'x' }]));
  expect(s.kind).toBe('inSession');
  expect(s.sessionErrors).toEqual([
    { grammarPointKey: 'tr-a1-locative', errorType: 'grammar', severity: 'major', text: 'pazarda', correction: 'pazara' },
  ]);
});

it('keeps sessionErrors across item advance', () => {
  let s = reducer(reducer(idle, startAction), evaluatedAction([oneError]));
  s = reducer(s, { type: 'ITEM_NEXT' });       // use the real advance action name
  expect(s.sessionErrors).toHaveLength(1);
});

it('resets sessionErrors when a new session starts', () => {
  let s = reducer(reducer(idle, startAction), evaluatedAction([oneError]));
  s = reducer(s, startAction);                 // a fresh CREATE_SUCCEEDED
  expect(s.sessionErrors).toEqual([]);
});

it('ignores results without an errors array (e.g. dictation)', () => {
  let s = reducer(idle, startAction);
  s = reducer(s, evaluatedActionRaw(dictationResult));  // a SubmissionResult with no errors[]
  expect(s.sessionErrors).toEqual([]);
});
```

> Use the file's REAL action creators/shapes. If the start action's item fixtures don't set `grammarPointKey`, set it in the test fixture so the tag assertion is meaningful.

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @language-drill/web test session-reducer`
Expected: FAIL — `sessionErrors` doesn't exist on the state.

- [ ] **Step 4: Implement accumulation in the reducer**

In `session-reducer.ts`:
1. Import the type: `import type { SessionError } from '../../../../lib/drill/coach-headline';` (adjust the relative depth to reach `apps/web/lib/drill/coach-headline.ts`).
2. Add `sessionErrors: SessionError[];` to the `SessionInProgress` interface.
3. In the session-start handler (`CREATE_SUCCEEDED` or the real name), initialize `sessionErrors: []` in the new in-session state.
4. In the `ITEM_EVALUATED` handler, append the evaluation's errors tagged with the current item's grammar point. The current item is `state.items[state.index]`; guard for results without an `errors` array (dictation):

```typescript
case 'ITEM_EVALUATED': {
  const result = action.result;
  const rawErrors =
    result && typeof result === 'object' && 'errors' in result && Array.isArray((result as { errors?: unknown }).errors)
      ? ((result as { errors: Array<{ type: string; severity: string; text: string; correction: string }> }).errors)
      : [];
  const grammarPointKey = state.items[state.index]?.grammarPointKey ?? null;
  const newErrors: SessionError[] = rawErrors.map((e) => ({
    grammarPointKey,
    errorType: e.type,
    severity: e.severity,
    text: e.text,
    correction: e.correction,
  }));
  return {
    ...state,
    perItemSubmission: { kind: 'evaluated', result: action.result, meta: action.meta, submissionId: action.submissionId },
    sessionErrors: [...state.sessionErrors, ...newErrors],
  };
}
```

> Keep the rest of the existing `ITEM_EVALUATED` payload exactly as it was — only add `sessionErrors`. Confirm `ITEM_NEXT`/`ITEM_SKIP` spread `...state` (so `sessionErrors` carries); if they reconstruct the state object explicitly, add `sessionErrors: state.sessionErrors` to them.

- [ ] **Step 5: Run to verify pass**

Run: `pnpm --filter @language-drill/web test session-reducer`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm --filter @language-drill/web typecheck`
Then:

```bash
git add apps/web/lib/drill/coach-headline.ts apps/web/app/\(dashboard\)/drill/_components/session-reducer.ts apps/web/app/\(dashboard\)/drill/_components/session-reducer.test.ts
git commit -m "$(printf 'feat(web): accumulate a per-session error log in the drill reducer\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 2: Pure `coachHeadline` selector

**Files:**
- Modify: `apps/web/lib/drill/coach-headline.ts` (add the selectors below the `SessionError` type)
- Create: `apps/web/lib/drill/__tests__/coach-headline.test.ts`

**Interfaces:**
- Consumes: `SessionError` (Task 1); `InsightsErrorTheme` from `@language-drill/api-client`.
- Produces:
  - `withinSessionHeadline(errors: readonly SessionError[]): string | null`
  - `crossSessionHeadline(themes: readonly InsightsErrorTheme[]): string | null`
  - `coachHeadline(args: { sessionErrors: readonly SessionError[]; themes: readonly InsightsErrorTheme[] }): string | null`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/lib/drill/__tests__/coach-headline.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type { InsightsErrorTheme } from '@language-drill/api-client';
import {
  withinSessionHeadline,
  crossSessionHeadline,
  coachHeadline,
  type SessionError,
} from '../coach-headline';

const err = (over: Partial<SessionError> = {}): SessionError => ({
  grammarPointKey: 'tr-a1-locative',
  errorType: 'grammar',
  severity: 'major',
  text: 'pazarda',
  correction: 'pazara',
  ...over,
});

const theme = (over: Partial<InsightsErrorTheme> = {}): InsightsErrorTheme => ({
  grammarPointKey: 'tr-a1-locative',
  grammarPointName: 'Locative case',
  errorType: 'grammar',
  count: 6,
  majorCount: 4,
  lastOccurredAt: '2026-06-19T00:00:00.000Z',
  sample: { wrongText: 'pazarda', correction: 'pazara' },
  score: 4.2,
  ...over,
});

describe('withinSessionHeadline', () => {
  it('returns null below the repeat threshold', () => {
    expect(withinSessionHeadline([])).toBeNull();
    expect(withinSessionHeadline([err()])).toBeNull();
  });

  it('surfaces a repeated group using the most recent slip', () => {
    expect(
      withinSessionHeadline([err({ text: 'old', correction: 'OLD' }), err({ text: 'pazarda', correction: 'pazara' })]),
    ).toBe('watch · pazarda → pazara · slipped 2× this session');
  });

  it('groups null-grammar-point errors by error type', () => {
    const e = err({ grammarPointKey: null, errorType: 'spelling', text: 'mursdur', correction: 'müdür' });
    expect(withinSessionHeadline([e, e])).toBe('watch · mursdur → müdür · slipped 2× this session');
  });

  it('prefers the larger repeated group', () => {
    const locative = err({ grammarPointKey: 'loc' });
    const accus = err({ grammarPointKey: 'acc', text: 'çantası', correction: 'çantan' });
    const out = withinSessionHeadline([locative, locative, locative, accus, accus]);
    expect(out).toContain('pazarda → pazara');
    expect(out).toContain('3×');
  });
});

describe('crossSessionHeadline', () => {
  it('formats the top theme with its grammar point name', () => {
    expect(crossSessionHeadline([theme()])).toBe('lately · Locative case: pazarda → pazara (6×)');
  });

  it('omits the name when null', () => {
    expect(crossSessionHeadline([theme({ grammarPointName: null })])).toBe('lately · pazarda → pazara (6×)');
  });

  it('returns null when no theme meets the repeat threshold', () => {
    expect(crossSessionHeadline([theme({ count: 1 })])).toBeNull();
    expect(crossSessionHeadline([])).toBeNull();
  });
});

describe('coachHeadline', () => {
  it('prefers a within-session pattern over cross-session', () => {
    expect(coachHeadline({ sessionErrors: [err(), err()], themes: [theme()] })).toContain('this session');
  });

  it('falls back to cross-session when no within-session pattern', () => {
    expect(coachHeadline({ sessionErrors: [err()], themes: [theme()] })).toContain('lately');
  });

  it('returns null when neither qualifies', () => {
    expect(coachHeadline({ sessionErrors: [err()], themes: [theme({ count: 1 })] })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @language-drill/web test coach-headline`
Expected: FAIL — selectors not exported.

- [ ] **Step 3: Implement the selectors**

Append to `apps/web/lib/drill/coach-headline.ts` (below the `SessionError` interface):

```typescript
import type { InsightsErrorTheme } from '@language-drill/api-client';

const MIN_REPEATS = 2;

/** Top within-session repeated error group (≥2), phrased from its most recent slip. */
export function withinSessionHeadline(errors: readonly SessionError[]): string | null {
  if (errors.length === 0) return null;
  const groups = new Map<string, { items: SessionError[]; major: number }>();
  for (const e of errors) {
    const key = e.grammarPointKey ?? e.errorType;
    const g = groups.get(key) ?? { items: [], major: 0 };
    g.items.push(e);
    if (e.severity === 'major') g.major += 1;
    groups.set(key, g);
  }
  let best: { items: SessionError[]; major: number } | null = null;
  for (const g of groups.values()) {
    if (g.items.length < MIN_REPEATS) continue;
    if (
      best === null ||
      g.items.length > best.items.length ||
      (g.items.length === best.items.length && g.major > best.major)
    ) {
      best = g;
    }
  }
  if (best === null) return null;
  const last = best.items[best.items.length - 1];
  return `watch · ${last.text} → ${last.correction} · slipped ${best.items.length}× this session`;
}

/** Top cross-session theme (count ≥2). `themes` are assumed ranked (the endpoint sorts them). */
export function crossSessionHeadline(themes: readonly InsightsErrorTheme[]): string | null {
  const top = themes.find((t) => t.count >= MIN_REPEATS);
  if (!top) return null;
  const pair = `${top.sample.wrongText} → ${top.sample.correction}`;
  return top.grammarPointName
    ? `lately · ${top.grammarPointName}: ${pair} (${top.count}×)`
    : `lately · ${pair} (${top.count}×)`;
}

/** Within-session pattern first, else the top cross-session theme, else null. */
export function coachHeadline(args: {
  sessionErrors: readonly SessionError[];
  themes: readonly InsightsErrorTheme[];
}): string | null {
  return withinSessionHeadline(args.sessionErrors) ?? crossSessionHeadline(args.themes);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @language-drill/web test coach-headline`
Expected: PASS (all groups).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @language-drill/web typecheck`
Then:

```bash
git add apps/web/lib/drill/coach-headline.ts apps/web/lib/drill/__tests__/coach-headline.test.ts
git commit -m "$(printf 'feat(web): coachHeadline selector — within-session then cross-session\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 3: Wire the headline into the drill page

**Files:**
- Modify: `apps/web/app/(dashboard)/drill/page.tsx` (coach message computation ~lines 330–337; `CoachRail`/`CoachCard` call sites)
- Modify: the drill page test (search `apps/web/app/(dashboard)/drill` for `page.test.tsx`)

**Interfaces:**
- Consumes: `coachHeadline` (Task 2), `state.sessionErrors` (Task 1), `useInsightsErrors` + `InsightsErrorsResponse` from `@language-drill/api-client`.
- Produces: the coach `message` passed to `CoachRail`/`CoachCard` is `coachHeadline({ sessionErrors, themes }) ?? coachMessage(ctx)`.

- [ ] **Step 1: Add a failing page test**

Read the real drill `page.test.tsx` first — note how it mocks `@language-drill/api-client` (it will need `useInsightsErrors` added to that mock or the new hook call throws). Add a test: with an in-session state that has ≥2 errors for the same grammar point (drive it through the same submit flow the existing tests use, or seed the reducer state the way the test harness allows), the coach renders the within-session headline (`/slipped 2× this session/`) instead of the canned string. If the harness can't easily reach an in-session-with-errors state, add at minimum a test that with NO session errors and a mocked `useInsightsErrors` returning a theme (count ≥2), the coach shows the `lately ·` headline.

```typescript
// In the api-client mock factory, add:
//   useInsightsErrors: (...args: unknown[]) => mockUseInsightsErrors(...args),
// and in beforeEach:
//   mockUseInsightsErrors.mockReturnValue({ data: { themes: [] } });

it('shows the cross-session recurring headline when insights has a repeated theme', () => {
  mockUseInsightsErrors.mockReturnValue({
    data: { themes: [{ grammarPointKey: 'tr-a1-locative', grammarPointName: 'Locative case', errorType: 'grammar', count: 6, majorCount: 4, lastOccurredAt: '2026-06-19T00:00:00.000Z', sample: { wrongText: 'pazarda', correction: 'pazara' }, score: 4 }] },
  });
  // render the page in an in-session state with empty sessionErrors (mirror the
  // existing in-session render setup)
  // ...
  expect(screen.getByText(/lately · Locative case: pazarda → pazara \(6×\)/)).toBeInTheDocument();
});
```

> Mirror the file's real render harness. If the page test renders via the reducer/hook mocks, set them the way the existing in-session tests do.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @language-drill/web test "drill/page"`
Expected: FAIL — coach shows the canned string, not the headline (and/or the unmocked hook errors until you add the mock).

- [ ] **Step 3: Wire the hook + headline into the page**

In `page.tsx`:
1. Import `useInsightsErrors` from `@language-drill/api-client` and `coachHeadline` from `../../../lib/drill/coach-headline` (match the real relative depth).
2. Call the hook near the other data hooks: `const insights = useInsightsErrors({ fetchFn, language: activeLanguage });` (use the same `fetchFn`/`activeLanguage` already in scope for the other hooks).
3. Replace the `coachMsg` computation (~lines 330–337) so the headline wins when present:

```typescript
const cannedMsg =
  submission.kind === 'evaluated'
    ? coachMessage({ kind: 'evaluated', type: exerciseTypeForRail, score: submission.result.score })
    : coachMessage({ kind: 'idle', type: exerciseTypeForRail });
const sessionErrors = state.kind === 'inSession' ? state.sessionErrors : [];
const coachMsg =
  coachHeadline({ sessionErrors, themes: insights.data?.themes ?? [] }) ?? cannedMsg;
```

Leave the `CoachRail`/`CoachCard` call sites passing `message={coachMsg}` (no prop change). Keep `exerciseTypeForRail`, `sessionPosition`, etc. exactly as they were.

> `submission.result.score` is only valid in the `evaluated` branch — keep the existing guard that produced the canned `evaluated` vs `idle` message; only the final `coachMsg` assignment changes.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @language-drill/web test "drill/page"`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @language-drill/web typecheck`
Then:

```bash
git add apps/web/app/\(dashboard\)/drill/page.tsx apps/web/app/\(dashboard\)/drill/page.test.tsx
git commit -m "$(printf 'feat(web): drill coach surfaces recurring-error headlines\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Final verification (whole plan)

- [ ] From repo root, real exit codes (do NOT pipe through `tail`):
  `pnpm lint; echo "lint=$?"; pnpm typecheck; echo "tc=$?"; pnpm test; echo "test=$?"`
- [ ] Confirm `lint=0 tc=0 test=0`. Report X passed / Y failed.
- [ ] Sanity-grep that the coach contract is intact: `grep -rn "message=" apps/web/app/\(dashboard\)/drill/page.tsx` still passes a string; `CoachRail`/`CoachCard` props unchanged.

---

## Self-review notes

- **Spec coverage:** per-session error log (Task 1); pure within→cross selection with pinned copy + thresholds (Task 2); page glue with `coachHeadline(...) ?? coachMessage(ctx)` and the `useInsightsErrors` mock in the page test (Task 3). Override-only-when-pattern-exists and within-then-cross are encoded in `coachHeadline` returning `null` when nothing qualifies.
- **Type consistency:** `SessionError` is defined once in `coach-headline.ts` and imported by the reducer; `InsightsErrorTheme` comes from the api-client barrel; the page passes a `string` to the unchanged components. `MIN_REPEATS = 2` governs both within- and cross-session thresholds.
- **No web→db import:** cross-session names are pre-resolved server-side and delivered via `useInsightsErrors`.
- **Known trap pre-empted:** the drill page test must mock `useInsightsErrors` (new hook) — called out in Task 3 and the Global Constraints.
- **Deferred (unchanged):** LLM-narrated coach phrasing (the headline is rule-based copy); per-error grammar-point attribution (Phase 3); styling the headline differently from canned copy (kept a plain string to preserve the component contract).
