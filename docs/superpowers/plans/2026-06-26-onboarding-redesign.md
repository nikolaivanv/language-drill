# Onboarding Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the web onboarding wizard to match the new Claude Design prototype (desktop + mobile, light + dark from system) — replacing the coach persona with a neutral numbered progress rail — without changing any step data, reducer logic, or API wiring.

**Architecture:** Presentation-layer only. The `OnboardingProvider` + `use-onboarding-reducer` + page-level submit orchestration are untouched. We add three new presentational pieces (`ProgressRail`, `MobileOnboardingHeader`, `GoalIcon`), rewire `OnboardingShell` to use them, restyle the four step components, and delete the four now-dead components (`CoachPane`, `MobileCoachHeader`, `SoFarChecklist`, `PlacementTestCallout`).

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind v4 (`@theme` tokens in `apps/web/app/globals.css`), Vitest + React Testing Library.

## Global Constraints

- Work entirely inside the worktree: `/Users/seal/dev/language-drill/.claude/worktrees/onboarding-redesign`. Every path below is relative to `apps/web/` unless stated. Branch: `worktree-onboarding-redesign`. **Assert the branch before every commit** (`git rev-parse --abbrev-ref HEAD` → must be `worktree-onboarding-redesign`).
- Style only with existing `globals.css` tokens / utility classes (`bg-paper`, `border-rule`, `text-ink-mute`, `text-accent`, `t-display-l`, `t-body`, `t-small`, `t-micro`, `t-mono`, `t-hand`, `.hilite`, `rounded-md`, `rounded-pill`, `gap-s-*`, `px-s-*`). **Never** hardcode the prototype's hex values or import its `theme.css`/`theme.js` — dark mode comes for free from `html.dark` token overrides.
- Mobile breakpoint is the custom `mobile:` variant (≤760px). Desktop is the unprefixed base.
- Supported languages are exactly `ES`, `DE`, `TR` (`LearningLanguage`). Do **not** add fr/it/pt.
- Lowercase UI voice. Preserve verbatim copy strings already pinned in the components (CEFR descriptions, gentle-nudges/weekly-summary body, p.s. note, em dash U+2014, ellipsis U+2026, middle dot U+00B7).
- Keep `selectCoachMessage` in `use-onboarding-reducer.ts` and its reducer tests intact — it becomes unused by the UI but stays exported (removing it is out of scope).
- TDD: write/adjust the test first, watch it fail, implement, watch it pass, commit. Run web tests with: `pnpm --filter @language-drill/web test -- <file>`.

---

### Task 1: `GoalIcon` — line-SVG icons for the goals step

Replaces the decorative emoji in `StepGoals` with the prototype's stroke-SVG line icons. New self-contained presentational component; `GOAL_COPY` (shared with settings) is left untouched.

**Files:**
- Create: `apps/web/components/onboarding/goal-icon.tsx`
- Test: `apps/web/components/onboarding/__tests__/goal-icon.test.tsx`

**Interfaces:**
- Produces: `GoalIcon({ id }: { id: GoalId }): JSX.Element` — renders an `aria-hidden` `<svg data-testid="goal-icon-${id}">` with the prototype's path for that goal.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/components/onboarding/__tests__/goal-icon.test.tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { GOAL_IDS } from '@language-drill/shared';
import { GoalIcon } from '../goal-icon';

describe('GoalIcon', () => {
  it('renders an aria-hidden svg with a stable testid for every goal id', () => {
    for (const id of GOAL_IDS) {
      const { container } = render(<GoalIcon id={id} />);
      const svg = container.querySelector(`[data-testid="goal-icon-${id}"]`);
      expect(svg, `missing icon for ${id}`).not.toBeNull();
      expect(svg!.tagName.toLowerCase()).toBe('svg');
      expect(svg!.getAttribute('aria-hidden')).toBe('true');
      expect(svg!.querySelector('path, rect, circle')).not.toBeNull();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/web test -- goal-icon`
Expected: FAIL — `Cannot find module '../goal-icon'`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// apps/web/components/onboarding/goal-icon.tsx
import type { GoalId } from '@language-drill/shared';

// Inner SVG geometry per goal, verbatim from the prototype
// (Onboarding - Desktop.html, GOALS[].icon). Rendered inside a shared
// 24x24 stroke wrapper. Decorative only — aria-hidden; the goal label is
// the meaningful text.
const GOAL_ICON_PATHS: Record<GoalId, string> = {
  grammar:
    '<path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3z"/><path d="M13.5 6.5l3 3"/>',
  speaking: '<path d="M20 11.5a7 7 0 0 1-9.8 6.4L5 19.5l1.6-5A7 7 0 1 1 20 11.5z"/>',
  listening:
    '<path d="M4 13a8 8 0 0 1 16 0"/><rect x="3" y="13" width="4" height="7" rx="1.6"/><rect x="17" y="13" width="4" height="7" rx="1.6"/>',
  writing: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>',
  vocab:
    '<path d="M12 5.5C10.5 4.4 8.3 4 5.5 4.2 4.7 4.2 4 4.9 4 5.7v11.6c0 .8.7 1.4 1.5 1.4 2.8-.2 5 .2 6.5 1.3 1.5-1.1 3.7-1.5 6.5-1.3.8 0 1.5-.6 1.5-1.4V5.7c0-.8-.7-1.5-1.5-1.5-2.8-.2-5 .2-6.5 1.3z"/><path d="M12 5.5v13"/>',
  travel:
    '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2.2 5.3-5.3 2.2 2.2-5.3z"/>',
};

export function GoalIcon({ id }: { id: GoalId }) {
  return (
    <svg
      data-testid={`goal-icon-${id}`}
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="w-[23px] h-[23px] flex-shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      // eslint-disable-next-line react/no-danger -- static, in-repo icon geometry
      dangerouslySetInnerHTML={{ __html: GOAL_ICON_PATHS[id] }}
    />
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @language-drill/web test -- goal-icon`
Expected: PASS (6 goals iterated).

- [ ] **Step 5: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # must print worktree-onboarding-redesign
git add apps/web/components/onboarding/goal-icon.tsx apps/web/components/onboarding/__tests__/goal-icon.test.tsx
git commit -m "feat(onboarding): add GoalIcon line-svg icon set"
```

---

### Task 2: `ProgressRail` — desktop left rail (replaces `CoachPane`)

A 300px neutral rail: brand, "setup" label, numbered step list with per-step selected value, and an italic footer note. Absorbs the per-step summary logic from `SoFarChecklist` (which is deleted in Task 8). No coach avatar/message.

**Files:**
- Create: `apps/web/components/onboarding/progress-rail.tsx`
- Test: `apps/web/components/onboarding/__tests__/progress-rail.test.tsx`

**Interfaces:**
- Consumes: `useOnboarding()` (state), `Brand`, `cn`, `OnboardingState`/`OnboardingStep` types.
- Produces: `ProgressRail(): JSX.Element` — `<aside data-testid="onboarding-progress-rail">`, hidden under `mobile:`. Each step row is an `<li data-step={n} data-status={'completed'|'current'|'pending'}>`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/components/onboarding/__tests__/progress-rail.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { CefrLevel, Language } from '@language-drill/shared';
import { OnboardingProvider } from '../onboarding-context';
import { initialNewUserState, type OnboardingState } from '../use-onboarding-reducer';
import { ProgressRail } from '../progress-rail';

function build(overrides: Partial<OnboardingState> = {}): OnboardingState {
  return { ...initialNewUserState(), ...overrides };
}
function renderRail(state: OnboardingState) {
  return render(
    <OnboardingProvider initialState={state}>
      <ProgressRail />
    </OnboardingProvider>
  );
}
const row = (n: number) =>
  document.querySelector(`[data-testid="onboarding-progress-rail"] [data-step="${n}"]`)!;

describe('ProgressRail', () => {
  it('renders the four step labels and the footer note', () => {
    renderRail(build());
    expect(screen.getByText('languages')).toBeInTheDocument();
    expect(screen.getByText('primary + level')).toBeInTheDocument();
    expect(screen.getByText('goals')).toBeInTheDocument();
    expect(screen.getByText('schedule')).toBeInTheDocument();
    expect(screen.getByText('~2 min total · skip anything')).toBeInTheDocument();
  });

  it('marks the current step and shows a number marker for non-completed steps', () => {
    renderRail(build({ step: 2 }));
    expect(row(2).getAttribute('data-status')).toBe('current');
    expect(within(row(2) as HTMLElement).getByText('2')).toBeInTheDocument();
    expect(row(3).getAttribute('data-status')).toBe('pending');
  });

  it('shows a check (not the number) for completed steps', () => {
    renderRail(build({ step: 3 }));
    expect(row(1).getAttribute('data-status')).toBe('completed');
    expect(within(row(1) as HTMLElement).queryByText('1')).toBeNull();
    expect((row(1) as HTMLElement).querySelector('svg')).not.toBeNull();
  });

  it('renders the per-step selected value once the step is reached', () => {
    renderRail(
      build({
        step: 2,
        languages: [Language.ES, Language.DE],
        primaryLanguage: Language.ES,
        levels: { [Language.ES]: CefrLevel.B1 },
      })
    );
    // step 1 completed → "2 selected"; step 2 current → "ES · B1"
    expect(within(row(1) as HTMLElement).getByText('2 selected')).toBeInTheDocument();
    expect(within(row(2) as HTMLElement).getByText('ES · B1')).toBeInTheDocument();
  });

  it('hides the value for steps not yet reached', () => {
    renderRail(build({ step: 1, languages: [Language.ES] }));
    expect(within(row(4) as HTMLElement).queryByText(/min\/day/)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/web test -- progress-rail`
Expected: FAIL — `Cannot find module '../progress-rail'`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// apps/web/components/onboarding/progress-rail.tsx
'use client';

// ---------------------------------------------------------------------------
// ProgressRail — desktop left rail of the onboarding wizard (≥761px).
// Brand + "setup" label + numbered step list (with the value selected so far)
// + an italic footer note. Replaces the old coach pane; no persona. Hidden at
// the `mobile:` breakpoint, where `MobileOnboardingHeader` takes over.
// ---------------------------------------------------------------------------

import { Brand } from '../shell/brand';
import { cn } from '../../lib/cn';
import { useOnboarding } from './onboarding-context';
import type { OnboardingState, OnboardingStep } from './use-onboarding-reducer';

const MIDDLE_DOT = '·'; // U+00B7
const FOOTER_NOTE = '~2 min total · skip anything';

type RowStatus = 'completed' | 'current' | 'pending';
type RailRow = { step: OnboardingStep; label: string; summary: string | null };

function rowStatus(rowStep: OnboardingStep, current: OnboardingStep): RowStatus {
  if (rowStep < current) return 'completed';
  if (rowStep === current) return 'current';
  return 'pending';
}

function buildRows(state: OnboardingState): RailRow[] {
  const { languages, primaryLanguage, levels, goals, dailyMinutes } = state;
  return [
    { step: 1, label: 'languages', summary: languages.length >= 1 ? `${languages.length} selected` : null },
    {
      step: 2,
      label: 'primary + level',
      summary:
        primaryLanguage !== null && levels[primaryLanguage] !== undefined
          ? `${primaryLanguage} ${MIDDLE_DOT} ${levels[primaryLanguage]}`
          : null,
    },
    { step: 3, label: 'goals', summary: goals.length === 0 ? 'none' : `${goals.length} picked` },
    { step: 4, label: 'schedule', summary: dailyMinutes !== null ? `${dailyMinutes} min/day` : null },
  ];
}

function Marker({ step, status }: { step: OnboardingStep; status: RowStatus }) {
  if (status === 'completed') {
    return (
      <span
        aria-hidden="true"
        className="mt-[1px] flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-full bg-ok text-paper"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 13l4 4L19 7" />
        </svg>
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        'mt-[1px] flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-full border-[1.8px] t-mono text-[12px] font-bold',
        status === 'current' ? 'border-accent text-accent' : 'border-rule-strong text-ink-mute'
      )}
    >
      {step}
    </span>
  );
}

export function ProgressRail() {
  const { state } = useOnboarding();
  const rows = buildRows(state);

  return (
    <aside
      data-testid="onboarding-progress-rail"
      className="flex mobile:hidden w-[300px] flex-shrink-0 flex-col border-r border-rule bg-paper px-s-6 py-[30px]"
    >
      <Brand />
      <p className="t-micro text-ink-mute mt-s-5 mb-s-2 px-s-1">setup</p>
      <ol className="flex flex-col" aria-label="onboarding steps">
        {rows.map((r) => {
          const status = rowStatus(r.step, state.step);
          const showSummary = (status === 'completed' || status === 'current') && r.summary !== null;
          return (
            <li
              key={r.step}
              data-step={r.step}
              data-status={status}
              className="flex gap-s-3 border-b border-dashed border-rule px-s-1 py-s-3 last:border-b-0"
            >
              <Marker step={r.step} status={status} />
              <div className="flex min-w-0 flex-col">
                <span
                  className={cn(
                    't-body',
                    status === 'current' ? 'text-ink' : status === 'completed' ? 'text-ink-2' : 'text-ink-soft'
                  )}
                >
                  {r.label}
                </span>
                {showSummary ? (
                  <span className="t-mono text-[12px] text-ink-mute mt-[3px]">{r.summary}</span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="mt-auto px-s-1 pt-s-5 t-hand text-ink-mute">{FOOTER_NOTE}</p>
    </aside>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @language-drill/web test -- progress-rail`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add apps/web/components/onboarding/progress-rail.tsx apps/web/components/onboarding/__tests__/progress-rail.test.tsx
git commit -m "feat(onboarding): add ProgressRail (replaces coach pane)"
```

---

### Task 3: `MobileOnboardingHeader` (replaces `MobileCoachHeader`)

Compact mobile top bar: brand + `N / 4` count + the segmented `WizardProgress`. No coach message.

**Files:**
- Create: `apps/web/components/onboarding/mobile-onboarding-header.tsx`
- Test: `apps/web/components/onboarding/__tests__/mobile-onboarding-header.test.tsx`

**Interfaces:**
- Consumes: `useOnboarding()`, `Brand`, `WizardProgress`.
- Produces: `MobileOnboardingHeader(): JSX.Element` — `<header data-testid="onboarding-mobile-header">`, shown only under `mobile:`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/components/onboarding/__tests__/mobile-onboarding-header.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OnboardingProvider } from '../onboarding-context';
import { initialNewUserState } from '../use-onboarding-reducer';
import { MobileOnboardingHeader } from '../mobile-onboarding-header';

function renderHeader(step: 1 | 2 | 3 | 4) {
  return render(
    <OnboardingProvider initialState={{ ...initialNewUserState(), step }}>
      <MobileOnboardingHeader />
    </OnboardingProvider>
  );
}

describe('MobileOnboardingHeader', () => {
  it('shows the step counter and a progressbar, no coach copy', () => {
    renderHeader(2);
    expect(screen.getByTestId('onboarding-mobile-header')).toBeInTheDocument();
    expect(screen.getByText('2 / 4')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2');
    expect(screen.queryByText(/coach|tutor/i)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/web test -- mobile-onboarding-header`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```tsx
// apps/web/components/onboarding/mobile-onboarding-header.tsx
'use client';

// ---------------------------------------------------------------------------
// MobileOnboardingHeader — narrow-viewport top bar (≤760px). Brand + "N / 4"
// counter + the segmented WizardProgress. Replaces the coach strip; no
// persona message. Hidden ≥761 where ProgressRail takes over.
// ---------------------------------------------------------------------------

import { Brand } from '../shell/brand';
import { useOnboarding } from './onboarding-context';
import { WizardProgress } from './wizard-progress';

const STEP_COUNT = 4;

export function MobileOnboardingHeader() {
  const { state } = useOnboarding();
  return (
    <header
      data-testid="onboarding-mobile-header"
      className="hidden mobile:flex flex-col gap-s-3 border-b border-rule bg-paper px-s-4 pt-s-4 pb-s-3"
    >
      <div className="flex items-center justify-between">
        <Brand />
        <span className="t-mono text-ink-mute">
          {state.step} / {STEP_COUNT}
        </span>
      </div>
      <WizardProgress />
    </header>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @language-drill/web test -- mobile-onboarding-header`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add apps/web/components/onboarding/mobile-onboarding-header.tsx apps/web/components/onboarding/__tests__/mobile-onboarding-header.test.tsx
git commit -m "feat(onboarding): add MobileOnboardingHeader (replaces mobile coach header)"
```

---

### Task 4: Rewire `OnboardingShell` + `index.ts`

Swap the coach components for the new rail/header, and make the in-pane `WizardProgress` + footer counter desktop-only (mobile carries them in the header).

**Files:**
- Modify: `apps/web/components/onboarding/onboarding-shell.tsx`
- Modify: `apps/web/components/onboarding/index.ts`
- Modify: `apps/web/components/onboarding/wizard-footer.tsx:124-130` (hide counter on mobile)
- Test: existing `apps/web/app/onboarding/page.test.tsx` is the integration guard (no new test file).

**Interfaces:**
- Consumes: `ProgressRail` (Task 2), `MobileOnboardingHeader` (Task 3).

- [ ] **Step 1: Update the shell imports + render**

In `onboarding-shell.tsx`, replace the two coach imports:

```tsx
// remove:
import { CoachPane } from './coach-pane';
import { MobileCoachHeader } from './mobile-coach-header';
// add:
import { ProgressRail } from './progress-rail';
import { MobileOnboardingHeader } from './mobile-onboarding-header';
```

Replace the shell body render:

```tsx
    <div className="flex mobile:flex-col min-h-screen bg-paper">
      <ProgressRail />
      <MobileOnboardingHeader />
      <WizardRightPane mode={mode} onComplete={onComplete} />
    </div>
```

In `WizardRightPane`, wrap the in-pane progress so it only shows on desktop (mobile shows it in the header):

```tsx
        <div className="mobile:hidden">
          <WizardProgress />
        </div>
        <ActiveStep />
        <WizardFooter onPrimary={onPrimary} />
```

- [ ] **Step 2: Hide the footer counter on mobile**

In `wizard-footer.tsx`, change the counter wrapper (around line 124) to add `mobile:hidden`:

```tsx
        <div
          className="mobile:hidden t-mono text-ink-mute"
          data-testid="wizard-footer-counter"
        >
          {state.step} / {STEP_COUNT}
        </div>
```

- [ ] **Step 3: Update the barrel exports**

In `index.ts`, replace the coach/placement exports:

```tsx
// remove these three lines:
export { CoachPane } from './coach-pane';
export { MobileCoachHeader } from './mobile-coach-header';
export { PlacementTestCallout } from './placement-test-callout';
// add:
export { ProgressRail } from './progress-rail';
export { MobileOnboardingHeader } from './mobile-onboarding-header';
```

- [ ] **Step 4: Run the integration + unit guards**

Run: `pnpm --filter @language-drill/web test -- app/onboarding/page wizard-footer onboarding-shell`
Expected: PASS. (If `wizard-footer.test` asserts the counter is present, jsdom has no viewport so `mobile:hidden` does not remove it — the assertion still passes. If a test fails because it imports `CoachPane`/`MobileCoachHeader`, that's expected to be cleaned in Task 8; here only `page.test.tsx`/`wizard-footer.test` should run.)

- [ ] **Step 5: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add apps/web/components/onboarding/onboarding-shell.tsx apps/web/components/onboarding/index.ts apps/web/components/onboarding/wizard-footer.tsx
git commit -m "feat(onboarding): rewire shell to progress rail + mobile header"
```

---

### Task 5: `StepLevel` — drop placement callout, add primary badge

Remove the `PlacementTestCallout` and show the native language name + a "primary" badge on the selected primary tile (prototype step 2).

**Files:**
- Modify: `apps/web/components/onboarding/steps/step-level.tsx`
- Test: `apps/web/components/onboarding/__tests__/step-level.test.tsx`

- [ ] **Step 1: Update the test**

Open `step-level.test.tsx`. Remove any assertion that the placement callout renders (search `placement`), and replace it with the opposite assertion; add a primary-badge assertion. Add/adjust:

```tsx
it('does not render a placement-test callout', () => {
  // render with ≥1 language selected (use the file's existing render helper)
  // then:
  expect(screen.queryByTestId('placement-test-callout')).toBeNull();
});

it('shows a "primary" badge on the selected primary language tile', () => {
  // render with two languages selected and primaryLanguage = ES
  expect(screen.getByText('primary')).toBeInTheDocument();
});
```

If an existing test asserts the primary tile shows the bare code (e.g. `getByText('ES')` for the tab), update it to the native name (`español`) — the tile now renders `LANGUAGE_NATIVE_NAMES[language]`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/web test -- step-level`
Expected: FAIL — callout still present / badge missing.

- [ ] **Step 3: Implement**

In `step-level.tsx`: remove `import { PlacementTestCallout } from '../placement-test-callout';` and the `<PlacementTestCallout />` element (last child before `</div>`).

Replace the primary tile children block:

```tsx
              <span className="flex items-center gap-s-3 w-full">
                <Flagdot language={language} />
                <span className="flex-1 t-body text-ink">
                  {LANGUAGE_NATIVE_NAMES[language]}
                </span>
                {state.primaryLanguage === language ? (
                  <span className="t-micro uppercase tracking-[0.4px] text-accent-2 bg-accent-soft border border-accent rounded-pill px-s-2 py-[2px] flex-shrink-0">
                    primary
                  </span>
                ) : null}
              </span>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @language-drill/web test -- step-level`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add apps/web/components/onboarding/steps/step-level.tsx apps/web/components/onboarding/__tests__/step-level.test.tsx
git commit -m "feat(onboarding): step 2 — drop placement callout, add primary badge"
```

---

### Task 6: `StepGoals` — swap emoji for `GoalIcon`

**Files:**
- Modify: `apps/web/components/onboarding/steps/step-goals.tsx`
- Test: `apps/web/components/onboarding/__tests__/step-goals.test.tsx`

- [ ] **Step 1: Update the test**

In `step-goals.test.tsx`, replace any emoji-presence assertion (search `emoji` / `📝`) with an icon assertion:

```tsx
it('renders a line-svg icon for each goal', () => {
  // render StepGoals inside a provider (use the existing helper)
  expect(document.querySelector('[data-testid="goal-icon-grammar"]')).not.toBeNull();
  expect(document.querySelector('[data-testid="goal-icon-travel"]')).not.toBeNull();
});
```

Keep all label/description assertions unchanged.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/web test -- step-goals`
Expected: FAIL — icon testid not found.

- [ ] **Step 3: Implement**

In `step-goals.tsx`: add `import { GoalIcon } from '../goal-icon';`. In the map, drop `emoji` from the destructure (`const { label, description } = GOAL_COPY[id];`) and replace the emoji span with:

```tsx
              <span className="flex items-start gap-s-3 w-full">
                <span aria-hidden="true" className={selected ? 'text-accent' : 'text-ink-soft'}>
                  <GoalIcon id={id} />
                </span>
                <span className="flex-1 flex flex-col">
                  <span className="t-body text-ink">{label}</span>
                  <span className="t-small text-ink-mute">{description}</span>
                </span>
              </span>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @language-drill/web test -- step-goals`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add apps/web/components/onboarding/steps/step-goals.tsx apps/web/components/onboarding/__tests__/step-goals.test.tsx
git commit -m "feat(onboarding): step 3 — line-svg goal icons"
```

---

### Task 7: `StepSchedule` minute-tile alignment (visual parity)

The prototype minute cards center their content; the current tiles left-align. Small change; verify the existing test stays green.

**Files:**
- Modify: `apps/web/components/onboarding/steps/step-schedule.tsx:82-85`
- Test: existing `apps/web/components/onboarding/__tests__/step-schedule.test.tsx` (no change expected).

- [ ] **Step 1: Implement**

Change the minute-tile inner span from `items-start` to centered:

```tsx
            <span className="flex flex-col items-center gap-[3px]">
              <span className="t-display-m text-ink">{minutes}</span>
              <span className="t-small text-ink-mute">min / day</span>
            </span>
```

- [ ] **Step 2: Run test to verify nothing regressed**

Run: `pnpm --filter @language-drill/web test -- step-schedule`
Expected: PASS (label/value text unchanged).

- [ ] **Step 3: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add apps/web/components/onboarding/steps/step-schedule.tsx
git commit -m "feat(onboarding): step 4 — center minute tiles to match prototype"
```

> Note: `StepLanguages` already matches the prototype (2-col grid, flagdot + checkbox, name field above) — no code change. Confirm visually in Task 9.

---

### Task 8: Delete the dead coach/placement components + tests

Now that nothing imports them, remove the four components and their three test files.

**Files:**
- Delete: `apps/web/components/onboarding/coach-pane.tsx` + `__tests__/coach-pane.test.tsx`
- Delete: `apps/web/components/onboarding/mobile-coach-header.tsx`
- Delete: `apps/web/components/onboarding/so-far-checklist.tsx` + `__tests__/so-far-checklist.test.tsx`
- Delete: `apps/web/components/onboarding/placement-test-callout.tsx` + `__tests__/placement-test-callout.test.tsx`

- [ ] **Step 1: Confirm no remaining importers**

Run:
```bash
cd apps/web && grep -rln -e CoachPane -e MobileCoachHeader -e SoFarChecklist -e PlacementTestCallout \
  --include='*.ts' --include='*.tsx' components app
```
Expected: only the files about to be deleted appear (no shell/index/step references). If `index.ts` still references them, fix Task 4 before deleting.

- [ ] **Step 2: Delete the files**

```bash
cd apps/web && git rm \
  components/onboarding/coach-pane.tsx \
  components/onboarding/__tests__/coach-pane.test.tsx \
  components/onboarding/mobile-coach-header.tsx \
  components/onboarding/so-far-checklist.tsx \
  components/onboarding/__tests__/so-far-checklist.test.tsx \
  components/onboarding/placement-test-callout.tsx \
  components/onboarding/__tests__/placement-test-callout.test.tsx
```

- [ ] **Step 3: Verify typecheck + onboarding tests**

Run: `pnpm --filter @language-drill/web typecheck && pnpm --filter @language-drill/web test -- onboarding`
Expected: PASS, no unresolved imports. (`selectCoachMessage` remains in the reducer and its reducer test still passes — it is intentionally retained though now unused by the UI.)

- [ ] **Step 4: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git commit -m "refactor(onboarding): remove dead coach pane + placement callout"
```

---

### Task 9: Full verification + visual check

**Files:** none (verification only).

- [ ] **Step 1: Run the full pre-push suite from repo root**

```bash
cd /Users/seal/dev/language-drill/.claude/worktrees/onboarding-redesign
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @language-drill/web build
```
Expected: all green. Fix any failure before proceeding (do not push on red — per CLAUDE.md).

- [ ] **Step 2: Visual check, desktop + mobile, light + dark**

The onboarding route requires Clerk auth which blocks rendering `/onboarding` locally without real dev keys (see project memory "verify-landing-without-clerk"). Render the wizard in isolation instead: mount `OnboardingShell` (inside `OnboardingProvider` with `initialNewUserState()`) in a throwaway harness, transpile with tsc/esbuild, and screenshot via Playwright at 1280px and 390px widths, toggling the `dark` class on `<html>`. Confirm against the prototype:
- Desktop: 300px rail (brand, "setup", numbered steps with values, italic note) + segmented progress + step body + footer (back / `N / 4` / primary CTA).
- Mobile: top bar (brand + `N / 4` + progress), step body, sticky footer (back + full-width primary), no in-pane progress, no footer counter.
- Dark mode: rail/cards/markers read correctly (tokens invert automatically).
- Step 2 has no placement callout + shows the "primary" badge; step 3 shows line icons.

- [ ] **Step 3: Commit any visual fixes, then finish**

```bash
git rev-parse --abbrev-ref HEAD
git add -A && git commit -m "fix(onboarding): visual parity tweaks from screenshot review"   # only if needed
```

Then hand off via `superpowers:finishing-a-development-branch` (push + PR).

---

## Self-Review

**Spec coverage:**
- Shell/rail/mobile-header restructure → Tasks 2, 3, 4. ✓
- 3 supported languages only → Global Constraints + StepLanguages unchanged (Task 7 note). ✓
- Drop coach persona → Tasks 4, 8 (+ `selectCoachMessage` retained, noted). ✓
- Drop placement callout → Tasks 5, 8. ✓
- Goal emoji → line-SVG icons → Tasks 1, 6. ✓
- Theming on existing tokens / dark from system → Global Constraints + Task 9 dark check. ✓
- Per-step restyle (1–4) → Tasks 5, 6, 7 + StepLanguages no-op note. ✓
- Testing: replace coach/so-far/placement tests with progress-rail; keep footer/progress/reducer/page green; add `next build` → Tasks 2, 3, 8, 9. ✓
- Out of scope (no backend/API/new options) → honored; no such tasks. ✓

**Placeholder scan:** No TBD/TODO; every code step shows concrete code; test steps include real assertions. ✓

**Type consistency:** `GoalIcon({id})`, `ProgressRail()`, `MobileOnboardingHeader()` signatures are used consistently across Tasks 1/6, 2/4, 3/4. `rowStatus`/`buildRows` are self-contained in `progress-rail.tsx`. `data-step`/`data-status` attributes used by the Task 2 test match the Task 2 implementation. ✓
