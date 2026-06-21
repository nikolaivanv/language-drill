# Drill Hub — surface weak spots (connect /drill to the diagnostic loop) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `/drill` hub part of the personalized loop: surface the user's
top recurring-error grammar points as **one-tap targeted drills**, above the
existing untargeted mode launchers, plus a link to the full map at `/progress`.

**Architecture (approved design).** `/drill`, `/home`, and `/progress` each own a
different decision: /home = *prescribed* (the daily plan), /progress = *deep
self-directed* (the map → detail sheet → mode choice), /drill = the *fast lane*.
Today the `DrillHub` is weakness-blind — only mode launchers. We surface the
SAME recurring-error signal already shown by "work on these" on /home & /progress
(`useInsightsErrors`, already fetched on the drill page) as tappable **start**
buttons in the hub. A tap launches a **targeted mixed drill** on that grammar
point (consistent with "work on these" elsewhere; mode choice stays on the
/progress sheet). Reuse: extend `WorkOnThese` with an optional `onSelect` so the
same component renders as in-page start buttons in the hub (a plain `<Link>` to
`/drill?...&grammarPoint=K` would NOT re-trigger a session when already on /drill).

**Tech Stack:** Next.js (App Router) + React, TanStack Query, TypeScript, Vitest + Testing Library.

## Global Constraints

- **Source of weak spots:** `useInsightsErrors` only (the canonical recurring-error
  themes already behind "work on these"). Do NOT blend in plan/curriculum-map
  points — the plan lives on /home. The drill page ALREADY calls
  `useInsightsErrors` (`insights`, drill/page.tsx:107) — reuse it, no new fetch.
- **Tap behavior:** one-tap = **targeted mixed drill** on the point —
  `setGrammarPointKey(key)` + `setStartIntent('quick')`, driving the EXISTING
  create-session effect (which already spreads `grammarPointKey` into the config).
  No mode picker in the hub (that's the /progress detail sheet's job).
- **Only items that carry a `grammarPointKey` are tappable** (a theme without one
  can't be targeted) — preserve `WorkOnThese`'s current behavior for keyless items.
- **`WorkOnThese` on /home and /progress is unchanged** when `onSelect` is absent
  (still renders `<Link href="/drill?start=quick&grammarPoint=…">`).
- **New-user empty state:** no recurring errors → the weak-spot section (and the
  map link) does not render; the hub shows just the today-status strip + mode
  launchers. `WorkOnThese` already returns `null` for an empty list.
- App idiom: shared `Button`/`Card`, `--color-*` tokens, `t-*` classes. No DB/API
  change, no new endpoint, no migration. Languages uppercase.
- **Build/test ordering:** fresh worktree → `pnpm build` (turbo) before web tests.
  Gate: `pnpm lint && pnpm typecheck && pnpm test` from repo root, real exit codes.
- **Git commit trailer (every commit):**
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## File Structure

- **Modify** `apps/web/app/(dashboard)/_components/work-on-these.tsx` — add optional
  `onSelect?: (grammarPointKey: string) => void`; render a `<button>` when present.
- **Modify** `apps/web/app/(dashboard)/_components/__tests__/work-on-these.test.tsx`
  (or create if absent) — cover the `onSelect` button variant + Link fallback.
- **Modify** `apps/web/app/(dashboard)/drill/_components/drill-hub.tsx` — accept
  `themes` + `onStartTargeted`; render the weak-spot section + "/progress" link
  above the mode launchers.
- **Modify** `apps/web/app/(dashboard)/drill/_components/__tests__/drill-hub.test.tsx`
  (or create if absent) — cover the new section, the map link, the tap callback,
  and the empty-state hide.
- **Modify** `apps/web/app/(dashboard)/drill/page.tsx` — make `grammarPointKey`
  stateful; add `onStartTargeted`; pass `themes` + `onStartTargeted` to `DrillHub`.
- **Modify** `apps/web/app/(dashboard)/drill/page.test.tsx` — a hub weak-spot tap
  creates a session config carrying that `grammarPointKey`.

---

### Task 1: `WorkOnThese` gains an optional `onSelect` (in-page start variant)

**Files:**
- Modify: `apps/web/app/(dashboard)/_components/work-on-these.tsx`
- Test: `apps/web/app/(dashboard)/_components/__tests__/work-on-these.test.tsx`

**Interfaces:**
- Produces: `WorkOnThese({ themes, onSelect? }: { themes: InsightsErrorTheme[]; onSelect?: (grammarPointKey: string) => void })`. When `onSelect` is provided, a theme WITH a `grammarPointKey` renders as a `<button>` calling `onSelect(key)`; otherwise the existing `<Link>` (no `onSelect`) / plain-text (no key) behavior is unchanged.

- [ ] **Step 1: Write the failing test**

Find the existing test file; if none, create `apps/web/app/(dashboard)/_components/__tests__/work-on-these.test.tsx`. Add (mirror any existing render setup — `WorkOnThese` is a plain component, no providers needed):

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { InsightsErrorTheme } from '@language-drill/api-client';
import { WorkOnThese } from '../work-on-these';

function theme(over: Partial<InsightsErrorTheme> = {}): InsightsErrorTheme {
  return {
    grammarPointKey: 'tr-a1-accusative',
    grammarPointName: 'Accusative -(y)I',
    errorType: 'morphology',
    count: 8,
    sample: { wrongText: 'bulaşık', correction: 'bulaşıkları' },
    ...over,
  } as InsightsErrorTheme;
}

describe('WorkOnThese', () => {
  it('renders a Link to a targeted drill when no onSelect is given', () => {
    render(<WorkOnThese themes={[theme()]} />);
    const link = screen.getByRole('link', { name: /Accusative/ });
    expect(link.getAttribute('href')).toBe(
      '/drill?start=quick&grammarPoint=tr-a1-accusative',
    );
  });

  it('renders a button calling onSelect(key) when onSelect is given', () => {
    const onSelect = vi.fn();
    render(<WorkOnThese themes={[theme()]} onSelect={onSelect} />);
    expect(screen.queryByRole('link')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Accusative/ }));
    expect(onSelect).toHaveBeenCalledWith('tr-a1-accusative');
  });

  it('keeps a keyless theme non-interactive even with onSelect', () => {
    const onSelect = vi.fn();
    render(
      <WorkOnThese themes={[theme({ grammarPointKey: null })]} onSelect={onSelect} />,
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('renders nothing for an empty themes list', () => {
    const { container } = render(<WorkOnThese themes={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run, verify fail** — `pnpm --filter @language-drill/web test -- work-on-these` → FAIL (button variant not implemented).

- [ ] **Step 3: Implement** — update `work-on-these.tsx`. Add `onSelect?` to props. In the map, when `t.grammarPointKey` exists and `onSelect` is provided, render a `<button type="button" onClick={() => onSelect(t.grammarPointKey!)} className="block w-full text-left hover:text-accent">{inner}</button>`; else keep the existing `<Link>` (key, no onSelect) / plain `inner` (no key) branches. Keep the `<h2>work on these</h2>` heading and the row markup identical.

```tsx
export function WorkOnThese({
  themes,
  onSelect,
}: {
  themes: InsightsErrorTheme[];
  onSelect?: (grammarPointKey: string) => void;
}) {
  // ...existing items/empty guard/inner unchanged...
  return (
    <li key={key}>
      {t.grammarPointKey ? (
        onSelect ? (
          <button
            type="button"
            onClick={() => onSelect(t.grammarPointKey!)}
            className="block w-full text-left hover:text-accent"
          >
            {inner}
          </button>
        ) : (
          <Link
            href={`/drill?start=quick&grammarPoint=${encodeURIComponent(t.grammarPointKey)}`}
            className="block hover:text-accent"
          >
            {inner}
          </Link>
        )
      ) : (
        inner
      )}
    </li>
  );
}
```

- [ ] **Step 4: Run, verify pass** — `pnpm --filter @language-drill/web test -- work-on-these` → PASS.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(dashboard)/_components/work-on-these.tsx" "apps/web/app/(dashboard)/_components/__tests__/work-on-these.test.tsx"
git commit -m "feat(web): WorkOnThese supports an onSelect in-page start variant"
```

---

### Task 2: `DrillHub` renders the weak-spot section

**Files:**
- Modify: `apps/web/app/(dashboard)/drill/_components/drill-hub.tsx`
- Test: `apps/web/app/(dashboard)/drill/_components/__tests__/drill-hub.test.tsx`

**Interfaces:**
- Consumes: `WorkOnThese` (with `onSelect`), `InsightsErrorTheme`.
- Produces: `DrillHub` gains props `themes: InsightsErrorTheme[]` and `onStartTargeted: (grammarPointKey: string) => void` (in addition to the existing `difficulty`/`baseline`/`onDifficultyChange`/`onStartQuick`/`onStartDictation`).

- [ ] **Step 1: Write the failing test**

Find/create `apps/web/app/(dashboard)/drill/_components/__tests__/drill-hub.test.tsx`. `DrillHub` imports `DrillTodayStatus` (which may fetch) and `DrillMeta` — check how those are handled in any existing hub test and mirror it (mock `DrillTodayStatus` if it makes network calls). Then:

```tsx
// ...imports + any needed mocks for DrillTodayStatus...
const theme = (over = {}) => ({
  grammarPointKey: 'tr-a1-accusative', grammarPointName: 'Accusative -(y)I',
  errorType: 'morphology', count: 8,
  sample: { wrongText: 'bulaşık', correction: 'bulaşıkları' }, ...over,
});
const baseProps = {
  difficulty: CefrLevel.A1, baseline: CefrLevel.A1,
  onDifficultyChange: vi.fn(), onStartQuick: vi.fn(), onStartDictation: vi.fn(),
};

it('renders weak spots + a link to /progress, and fires onStartTargeted on tap', () => {
  const onStartTargeted = vi.fn();
  render(<DrillHub {...baseProps} themes={[theme()]} onStartTargeted={onStartTargeted} />);
  // the map link
  expect(screen.getByRole('link', { name: /full map|progress/i }).getAttribute('href')).toBe('/progress');
  // tapping the weak spot starts a targeted drill
  fireEvent.click(screen.getByRole('button', { name: /Accusative/ }));
  expect(onStartTargeted).toHaveBeenCalledWith('tr-a1-accusative');
  // mode launchers still present
  expect(screen.getByRole('button', { name: /quick drill/i })).toBeDefined();
});

it('hides the weak-spot section + map link when there are no themes', () => {
  render(<DrillHub {...baseProps} themes={[]} onStartTargeted={vi.fn()} />);
  expect(screen.queryByRole('link', { name: /full map|progress/i })).toBeNull();
  expect(screen.getByRole('button', { name: /quick drill/i })).toBeDefined();
});
```

- [ ] **Step 2: Run, verify fail** — `pnpm --filter @language-drill/web test -- drill-hub` → FAIL.

- [ ] **Step 3: Implement** — add the two props; between `DrillMeta` and the mode-launcher `div`, render the weak-spot section ONLY when `themes.length > 0`:

```tsx
import Link from 'next/link';
import type { InsightsErrorTheme } from '@language-drill/api-client';
import { WorkOnThese } from '../../_components/work-on-these';
// ...
{themes.length > 0 && (
  <div className="mb-s-6">
    <WorkOnThese themes={themes} onSelect={onStartTargeted} />
    <Link
      href="/progress"
      className="t-mono mt-s-3 inline-block text-[12px] text-ink-soft hover:text-accent"
    >
      see your full map →
    </Link>
  </div>
)}
```

Place it after the `DrillMeta` block and before the `<div className="flex flex-col gap-s-4">` mode launchers. (Optional: add a `t-micro` "or pick a mode" label above the mode launchers for separation — keep it subtle; not required.)

- [ ] **Step 4: Run, verify pass** — `pnpm --filter @language-drill/web test -- drill-hub` → PASS.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(dashboard)/drill/_components/drill-hub.tsx" "apps/web/app/(dashboard)/drill/_components/__tests__/drill-hub.test.tsx"
git commit -m "feat(web): drill hub surfaces recurring-error weak spots as targeted launches"
```

---

### Task 3: Wire `onStartTargeted` into the drill page

**Files:**
- Modify: `apps/web/app/(dashboard)/drill/page.tsx`
- Test: `apps/web/app/(dashboard)/drill/page.test.tsx`

**Interfaces:**
- Consumes: `DrillHub` (now needing `themes` + `onStartTargeted`); the already-present `insights = useInsightsErrors(...)`.

- [ ] **Step 1: Write the failing test**

In `drill/page.test.tsx` (read how it mocks `useInsightsErrors`, `useCreateSession`, `useSearchParams`, and how it asserts the create-session config — mirror that exactly). Seed `useInsightsErrors` to return a theme with `grammarPointKey: 'tr-a1-locative'`; render the page so the hub shows (no `?start`/`?resume`); click the weak-spot start button; assert the `createSession.mutate` config includes `grammarPointKey: 'tr-a1-locative'` (and `exerciseCount: DEFAULT_EXERCISE_COUNT`, no `exerciseType`).

```tsx
it('starting a hub weak spot creates a targeted session for that point', async () => {
  // seed useInsightsErrors → one theme with grammarPointKey 'tr-a1-locative'
  // render <PracticePage/> with no ?start / ?resume → DrillHub visible
  fireEvent.click(screen.getByRole('button', { name: /locative|Locative/ }));
  await waitFor(() =>
    expect(mockCreateMutate).toHaveBeenCalledWith(
      expect.objectContaining({ grammarPointKey: 'tr-a1-locative' }),
      expect.anything(),
    ),
  );
});
```

- [ ] **Step 2: Run, verify fail** — `pnpm --filter @language-drill/web test -- drill/page` → FAIL.

- [ ] **Step 3: Implement**
  - Make `grammarPointKey` stateful: change `const [grammarPointKey] = useState<string | null>(...)` to `const [grammarPointKey, setGrammarPointKey] = useState<string | null>(...)`.
  - Add a handler:
    ```tsx
    function handleStartTargeted(key: string) {
      setGrammarPointKey(key);
      setStartIntent('quick');
    }
    ```
    (Both setters batch → one re-render → the existing create-session effect fires with `startIntent==='quick'` and the new `grammarPointKey`. Add `grammarPointKey` to that effect's dependency array so the closure is guaranteed fresh.)
  - Pass the new props to `DrillHub` in the idle-hub return:
    ```tsx
    <DrillHub
      difficulty={difficulty}
      baseline={baseline}
      onDifficultyChange={handleDifficultyChange}
      onStartQuick={() => setStartIntent('quick')}
      onStartDictation={() => setStartIntent('dictation')}
      themes={insights.data?.themes ?? []}
      onStartTargeted={handleStartTargeted}
    />
    ```

- [ ] **Step 4: Run, verify pass** — `pnpm --filter @language-drill/web test -- drill/page` → PASS (and the existing drill-page tests still green).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(dashboard)/drill/page.tsx" "apps/web/app/(dashboard)/drill/page.test.tsx"
git commit -m "feat(web): launch a targeted drill from a hub weak spot"
```

---

### Task 4: Full gate

- [ ] **Step 1:** `pnpm build` → exit 0.
- [ ] **Step 2:** `pnpm lint && pnpm typecheck && pnpm test` → exit 0. Watch: existing `WorkOnThese` consumers (/home, /progress) must still render `<Link>` (no `onSelect` passed); the drill-page hub tests now need the `useInsightsErrors` mock to provide `themes`.
- [ ] **Step 3:** No separate commit (gate only).

---

## Self-Review

- **Design coverage:** weak spots surfaced in the hub from recurring errors → Tasks 1-3 ✓; one-tap targeted mixed drill (no mode picker) → Task 3 (reuses the existing `grammarPointKey` create-session path) ✓; "/progress" link → Task 2 ✓; new-user empty state hides the section → Tasks 1 (`WorkOnThese` null) + 2 (`themes.length > 0` gate) ✓; /home & /progress unchanged → Task 1 keeps the no-`onSelect` Link branch ✓; recurring-errors-only (no plan/map blend) → Global Constraints + Task 3 reuses the existing `insights` ✓.
- **Placeholder scan:** concrete code/tests in every task; the "find/create the test file" + "mirror the existing mock setup" notes point at real existing patterns (drill/page.test.tsx already mocks these hooks).
- **Type consistency:** `onSelect?: (grammarPointKey: string) => void` (Task 1) ≡ `onStartTargeted: (grammarPointKey: string) => void` (Tasks 2-3) ≡ `handleStartTargeted(key: string)` (Task 3). `themes: InsightsErrorTheme[]` flows page → DrillHub → WorkOnThese unchanged. The launched config reuses the existing `grammarPointKey` spread in the create-session effect — same shape `POST /sessions` already accepts.
