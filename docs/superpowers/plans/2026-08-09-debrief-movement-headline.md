# Debrief Movement Headline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the debrief headline report what the session did to the learner's skills, instead of what fraction of items they got right.

**Architecture:** A new pure module `movement-summary.ts` maps the `SkillMovement[]` already present on `DebriefResponse` to a `{ state, title, subline }`, using a first-match-wins precedence over six states. `debrief-header.tsx` renders that instead of the accuracy tier, plus a muted factual `N items · M skipped` line with no percentage. `accuracy-tier.ts` then has no live consumer and is deleted along with `DebriefFooter`'s dead `tier` prop.

**Tech Stack:** Next.js (App Router) + TypeScript, React Testing Library + Vitest.

**Spec:** `docs/superpowers/specs/2026-08-09-debrief-movement-headline-design.md`

## Global Constraints

- **Frontend only.** No change to any API route, Zod schema, DB schema, or server-side movement logic. `skillMovements` is already on `DebriefResponse` and already on the client.
- **No banding logic on the client.** `movement-summary.ts` reads the `band` values already in the payload. It must never compute a band, and must never see or render a mastery number.
- **No numerals in the header beyond** the duration, the item count, and the skipped count. In particular **no `%` character anywhere** in the rendered header.
- **All header copy is lowercase.** An existing test asserts every letter character in the rendered header is lowercase — it must keep passing.
- **No streak / XP / day-counter copy.** An existing test asserts the header never renders `streak`, `xp`, `day`, or `🔥`.
- Exact state titles, verbatim: `session done.` · `mixed session.` · `worth another look.` · `solid session.` · `new ground.` · `steady session.`
- `correctCount` stays on the API payload and in `practice_sessions` — admin triage and the today-plan tile still consume it. Only the debrief **header** stops using it.
- Branch: `feat/debrief-movement-headline`. Assert with `git branch --show-current` before every commit — this workspace has a known habit of flipping to `main`.
- Work only in the worktree `/Users/seal/dev/language-drill/.claude/worktrees/debrief-movement-headline`.
- Pre-push gate: `pnpm lint && pnpm typecheck && pnpm test`, **plus** `pnpm --filter @language-drill/web build` — the standard gate does not run `next build`, so prerender errors pass locally and fail CI.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `apps/web/lib/drill/movement-summary.ts` | Pure map from `SkillMovement[]` → `{state, title, subline}`. Sole home of state precedence and subline wording. | 1 |
| `apps/web/lib/drill/__tests__/movement-summary.test.ts` | Unit tests for all six states + precedence boundaries + number words. | 1 |
| `apps/web/app/(dashboard)/drill/debrief/_components/debrief-header.tsx` | Renders eyebrow, movement title, subline, factual line. | 2 |
| `apps/web/app/(dashboard)/drill/debrief/_components/__tests__/debrief-header.test.tsx` | Header rendering tests; the accuracy-tier describes are replaced. | 2 |
| `apps/web/lib/drill/accuracy-tier.ts` + its test | **Deleted** — no live consumer once Task 2 lands. | 3 |
| `apps/web/app/(dashboard)/drill/debrief/_components/debrief-footer.tsx` | Drops the dead `tier` prop. | 3 |
| `apps/web/app/(dashboard)/drill/debrief/[sessionId]/page.tsx` | Drops the `accuracyTier` call + import. | 3 |
| `apps/web/app/(dashboard)/drill/debrief/[sessionId]/page.test.tsx` | Updates the one assertion of `'nice work.'` (line ~155). | 3 |

---

### Task 1: The `movementSummary` pure module

**Files:**
- Create: `apps/web/lib/drill/movement-summary.ts`
- Test: `apps/web/lib/drill/__tests__/movement-summary.test.ts`

**Interfaces:**
- Consumes: `SkillMovement` from `@language-drill/shared` — `{ grammarPointKey: string; label: string; band: 'new' | 'strong-gain' | 'gain' | 'steady' | 'slip'; confidence: 'high' | 'low' }`.
- Produces, for Task 2:
  ```ts
  export type MovementState = 'none' | 'mixed' | 'slipped' | 'gained' | 'new' | 'steady';
  export interface MovementSummary { state: MovementState; title: string; subline: string }
  export function movementSummary(movements: readonly SkillMovement[]): MovementSummary;
  ```
  Takes movements **only** — no session counts. The factual `N items · M skipped` line is assembled in the header from `exerciseCount` / `skippedCount`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/lib/drill/__tests__/movement-summary.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { SkillMovement } from '@language-drill/shared';
import { movementSummary } from '../movement-summary';

let seq = 0;
const mv = (band: SkillMovement['band'], key = `gp-${band}-${seq++}`): SkillMovement => ({
  grammarPointKey: key,
  label: `Point ${key}`,
  band,
  confidence: 'high',
});

describe('movementSummary — states', () => {
  it('is "none" for no movements at all', () => {
    const s = movementSummary([]);
    expect(s.state).toBe('none');
    expect(s.title).toBe('session done.');
    expect(s.subline).toBe('nothing graded this round');
  });

  it('is "steady" when every movement is steady', () => {
    const s = movementSummary([mv('steady'), mv('steady')]);
    expect(s.state).toBe('steady');
    expect(s.title).toBe('steady session.');
    expect(s.subline).toBe("nothing shifted much — that's normal");
  });

  it('is "gained" for gains with no slips', () => {
    const s = movementSummary([mv('gain')]);
    expect(s.state).toBe('gained');
    expect(s.title).toBe('solid session.');
    expect(s.subline).toBe('one skill gained · nothing slipped');
  });

  it('counts strong-gain as a gain', () => {
    const s = movementSummary([mv('strong-gain')]);
    expect(s.state).toBe('gained');
  });

  it('is "slipped" for slips with no gains', () => {
    const s = movementSummary([mv('slip')]);
    expect(s.state).toBe('slipped');
    expect(s.title).toBe('worth another look.');
    expect(s.subline).toBe('one slipped');
  });

  it('is "mixed" when gains and slips both appear', () => {
    const s = movementSummary([mv('gain'), mv('gain'), mv('slip')]);
    expect(s.state).toBe('mixed');
    expect(s.title).toBe('mixed session.');
    expect(s.subline).toBe('two gained · one slipped');
  });

  it('is "new" when new is the only mover', () => {
    const s = movementSummary([mv('new'), mv('new')]);
    expect(s.state).toBe('new');
    expect(s.title).toBe('new ground.');
    expect(s.subline).toBe('two skills · first evidence');
  });
});

describe('movementSummary — precedence', () => {
  it('new alongside a gain does NOT change the title', () => {
    expect(movementSummary([mv('gain'), mv('new')]).state).toBe('gained');
  });

  it('new alongside a slip does NOT change the title', () => {
    expect(movementSummary([mv('slip'), mv('new')]).state).toBe('slipped');
  });

  it('gain + slip + new is mixed', () => {
    expect(movementSummary([mv('gain'), mv('slip'), mv('new')]).state).toBe('mixed');
  });

  it('steady movements never mask a real mover', () => {
    expect(movementSummary([mv('steady'), mv('slip'), mv('steady')]).state).toBe('slipped');
  });
});

describe('movementSummary — number words', () => {
  it('spells out one through nine', () => {
    const nine = movementSummary(Array.from({ length: 9 }, (_, i) => mv('slip', `k${i}`)));
    expect(nine.subline).toBe('nine slipped');
  });

  it('uses digits from ten up', () => {
    const ten = movementSummary(Array.from({ length: 10 }, (_, i) => mv('slip', `k${i}`)));
    expect(ten.subline).toBe('10 slipped');
  });

  it('renders no percent sign in any state', () => {
    const all: SkillMovement['band'][] = ['new', 'strong-gain', 'gain', 'steady', 'slip'];
    for (const band of all) {
      expect(movementSummary([mv(band)]).subline).not.toContain('%');
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @language-drill/web exec vitest run lib/drill/__tests__/movement-summary.test.ts
```

Expected: FAIL — cannot resolve `../movement-summary`.

- [ ] **Step 3: Implement the module**

Create `apps/web/lib/drill/movement-summary.ts`:

```ts
import type { SkillMovement } from '@language-drill/shared';

// Single source of truth for the post-session debrief headline. Maps the bands
// already present on the payload to a session-shaped verdict.
//
// The header states the SHAPE of the session; SkillMovementsPanel is the only
// place point names and bands appear. Keeping those jobs separate is what stops
// the two from contradicting each other — the failure this replaced, where
// "you got 5 of 5 · accuracy 100%" sat directly above "slipped".
//
// No banding happens here and no mastery number is ever read: `band` is computed
// server-side precisely so the client cannot render raw scores.

export type MovementState =
  | 'none'
  | 'mixed'
  | 'slipped'
  | 'gained'
  | 'new'
  | 'steady';

export interface MovementSummary {
  state: MovementState;
  title: string;
  subline: string;
}

export const STATE_TITLE: Record<MovementState, string> = {
  none: 'session done.',
  mixed: 'mixed session.',
  slipped: 'worth another look.',
  gained: 'solid session.',
  new: 'new ground.',
  steady: 'steady session.',
};

const NUMBER_WORDS = [
  'zero', 'one', 'two', 'three', 'four',
  'five', 'six', 'seven', 'eight', 'nine',
] as const;

/** Spelled out for 0–9, digits from 10 up. Subline copy only. */
function count(n: number): string {
  return n < NUMBER_WORDS.length ? NUMBER_WORDS[n]! : String(n);
}

function pluralSkills(n: number): string {
  return `${count(n)} ${n === 1 ? 'skill' : 'skills'}`;
}

export function movementSummary(
  movements: readonly SkillMovement[],
): MovementSummary {
  const gained = movements.filter(
    (m) => m.band === 'gain' || m.band === 'strong-gain',
  ).length;
  const slipped = movements.filter((m) => m.band === 'slip').length;
  const fresh = movements.filter((m) => m.band === 'new').length;

  // First match wins. `new` never decides the title when a gain or slip is
  // present — it only reaches rule 5 as the sole mover.
  let state: MovementState;
  let subline: string;

  if (movements.length === 0) {
    state = 'none';
    subline = 'nothing graded this round';
  } else if (gained > 0 && slipped > 0) {
    state = 'mixed';
    subline = `${count(gained)} gained · ${count(slipped)} slipped`;
  } else if (slipped > 0) {
    state = 'slipped';
    subline = `${count(slipped)} slipped`;
  } else if (gained > 0) {
    state = 'gained';
    subline = `${pluralSkills(gained)} gained · nothing slipped`;
  } else if (fresh > 0) {
    state = 'new';
    subline = `${pluralSkills(fresh)} · first evidence`;
  } else {
    state = 'steady';
    subline = "nothing shifted much — that's normal";
  }

  return { state, title: STATE_TITLE[state], subline };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @language-drill/web exec vitest run lib/drill/__tests__/movement-summary.test.ts
```

Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git branch --show-current   # must be feat/debrief-movement-headline
git add apps/web/lib/drill/movement-summary.ts apps/web/lib/drill/__tests__/movement-summary.test.ts
git commit -m "feat(debrief): add movementSummary, a session-shape verdict from skill movements

Maps the bands already on DebriefResponse to a {state, title, subline}
over six states, first-match-wins. `new` never decides the title when a
gain or slip is present. No banding and no mastery number on the client."
```

---

### Task 2: Rewire the header

**Files:**
- Modify: `apps/web/app/(dashboard)/drill/debrief/_components/debrief-header.tsx`
- Test: `apps/web/app/(dashboard)/drill/debrief/_components/__tests__/debrief-header.test.tsx`

**Interfaces:**
- Consumes: `movementSummary`, `MovementSummary`, `MovementState` from Task 1 (`../../../../../../lib/drill/movement-summary` — verify the depth against the existing `accuracy-tier` import in the same file, which is `'../../../../../lib/drill/accuracy-tier'`).
- Produces: `DebriefHeaderProps` is **unchanged** (`{ debrief: DebriefResponse }`), so no caller needs editing for this task.

- [ ] **Step 1: Replace the accuracy-tier tests with movement tests**

In `__tests__/debrief-header.test.tsx`, **delete** the whole `describe('DebriefHeader — title by accuracy tier', …)` block (6 tests, ~lines 32–68) and the whole `describe('DebriefHeader — body line', …)` block (~lines 108–163). Keep the duration, no-streak/XP, and lowercase-copy describes untouched — they still apply.

Add in their place:

```tsx
import type { SkillMovement } from '@language-drill/shared';

const mv = (band: SkillMovement['band'], key: string): SkillMovement => ({
  grammarPointKey: key,
  label: `Point ${key}`,
  band,
  confidence: 'high',
});

describe('DebriefHeader — movement title', () => {
  it('renders the gained title when a skill gained', () => {
    render(<DebriefHeader debrief={makeDebrief({ skillMovements: [mv('gain', 'a')] })} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('solid session.');
    expect(screen.getByText('one skill gained · nothing slipped')).toBeInTheDocument();
  });

  it('renders the slipped title when a skill slipped with no gain', () => {
    render(<DebriefHeader debrief={makeDebrief({ skillMovements: [mv('slip', 'a')] })} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('worth another look.');
  });

  it('renders the none title when nothing was graded', () => {
    render(<DebriefHeader debrief={makeDebrief({ skillMovements: [] })} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('session done.');
  });
});

describe('DebriefHeader — factual line', () => {
  it('renders the item count without a skipped clause at zero', () => {
    render(<DebriefHeader debrief={makeDebrief({ exerciseCount: 5, skippedCount: 0 })} />);
    expect(screen.getByText('5 items')).toBeInTheDocument();
  });

  it('appends the skipped clause when skippedCount > 0', () => {
    render(<DebriefHeader debrief={makeDebrief({ exerciseCount: 5, skippedCount: 2 })} />);
    expect(screen.getByText('5 items · 2 skipped')).toBeInTheDocument();
  });
});

describe('DebriefHeader — no accuracy percentage', () => {
  // The regression guard for this change: the header must never again put a
  // percentage next to a movement verdict.
  it('renders no percent sign, whatever the counts', () => {
    const { container } = render(
      <DebriefHeader
        debrief={makeDebrief({
          correctCount: 5, attemptedCount: 5, exerciseCount: 5,
          skillMovements: [mv('slip', 'a')],
        })}
      />,
    );
    expect(container.textContent).not.toContain('%');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @language-drill/web exec vitest run "app/(dashboard)/drill/debrief/_components/__tests__/debrief-header.test.tsx"
```

Expected: the new movement/factual tests FAIL (header still renders `nice work.` and the accuracy body line); the percent-sign test FAILS because `accuracy 100%` is still rendered.

- [ ] **Step 3: Rewrite the header**

Replace the `accuracy-tier` import, the `tier`/`title`/`accuracyDisplay`/`bodyParts` block, and the JSX body line:

```tsx
import type { DebriefResponse } from '@language-drill/api-client';
import { movementSummary } from '../../../../../lib/drill/movement-summary';

// Editorial header for the post-session debrief screen. Eyebrow + movement-keyed
// display title + movement subline + a muted factual line. All copy lowercase.
//
// The title reports what the session did to the learner's SKILLS, not what
// fraction of items were right: accuracy is binary at CORRECT_THRESHOLD while
// mastery is continuous, so an accuracy-keyed title could read "nice work ·
// 100%" directly above a "slipped" row in the panel below.
```

Inside the component:

```tsx
  const { exerciseCount, skippedCount, durationSeconds, skillMovements } = debrief;

  const { title, subline } = movementSummary(skillMovements);

  // Factual, verdict-free. Skips need somewhere to be accounted for.
  const factualLine =
    skippedCount > 0
      ? `${exerciseCount} items · ${skippedCount} skipped`
      : `${exerciseCount} items`;
```

and the JSX:

```tsx
  return (
    <header>
      <div className="t-micro">session done · {formatDuration(durationSeconds)}</div>
      <h1 className="t-display-xl mt-s-1">{title}</h1>
      <p className="t-body-l mt-s-3">{subline}</p>
      <p className="t-micro text-ink-soft mt-s-2">{factualLine}</p>
    </header>
  );
```

`formatDuration` is unchanged. `correctCount` / `attemptedCount` are no longer destructured — if TypeScript flags them as unused, remove them from the destructure rather than prefixing with `_`.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @language-drill/web exec vitest run "app/(dashboard)/drill/debrief/_components/__tests__/debrief-header.test.tsx"
```

Expected: PASS. The pre-existing lowercase-copy and no-streak/XP tests must still pass — if the lowercase test fails, some new copy introduced a capital letter; fix the copy, not the test.

- [ ] **Step 5: Commit**

```bash
git branch --show-current   # must be feat/debrief-movement-headline
git add "apps/web/app/(dashboard)/drill/debrief/_components/debrief-header.tsx" "apps/web/app/(dashboard)/drill/debrief/_components/__tests__/debrief-header.test.tsx"
git commit -m "feat(debrief): headline reports skill movement, not accuracy

The header led with accuracy, which drives nothing adaptive and could
contradict the panel directly beneath it. It now reports the shape of the
session from skillMovements, with a muted '5 items · 2 skipped' line so
skips stay accounted for. No percentage is rendered."
```

---

### Task 3: Delete the accuracy tier and its dead prop

**Files:**
- Delete: `apps/web/lib/drill/accuracy-tier.ts`, `apps/web/lib/drill/__tests__/accuracy-tier.test.ts`
- Modify: `apps/web/app/(dashboard)/drill/debrief/_components/debrief-footer.tsx`, `apps/web/app/(dashboard)/drill/debrief/[sessionId]/page.tsx`, `apps/web/app/(dashboard)/drill/debrief/[sessionId]/page.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `DebriefFooterProps` becomes an empty-prop component — change the signature to `export function DebriefFooter()` and delete the `DebriefFooterProps` interface and its `AccuracyTier` import. `page.tsx` then renders `<DebriefFooter />` with no props.

**Why this is safe:** `DebriefFooter` already ignores the prop — its parameter is literally `_props`, retained "for future tier-keyed copy variants" that never arrived. After Task 2, `accuracyTier` has no live caller.

- [ ] **Step 1: Confirm there are no remaining consumers**

```bash
rg -n "accuracyTier|TIER_TITLE|AccuracyTier" -g '*.ts' -g '*.tsx' apps/web | grep -v node_modules
```

Expected: hits **only** in `lib/drill/accuracy-tier.ts`, its test, `debrief-footer.tsx`, and `page.tsx`. If anything else appears, STOP and report — the spec's claim that the header was the only live consumer would be wrong.

- [ ] **Step 2: Delete and unwire**

```bash
git rm apps/web/lib/drill/accuracy-tier.ts apps/web/lib/drill/__tests__/accuracy-tier.test.ts
```

In `debrief-footer.tsx`: remove the `import type { AccuracyTier } …` line, delete the `DebriefFooterProps` interface and the comment block above it describing the reserved prop, and change the signature to:

```tsx
export function DebriefFooter() {
```

In `page.tsx`: remove the `import { accuracyTier } …` line and replace the `<DebriefFooter tier={accuracyTier(…)} />` element with `<DebriefFooter />`.

- [ ] **Step 3: Update the one stale page-test assertion**

`page.test.tsx` line ~153–155 asserts the header renders `'nice work.'` with a comment explaining the 4/5 → 80% → high tier derivation. Its fixture has `correctCount: 4` and `skillMovements: []`, so under the new header it renders `session done.`

Replace the assertion **and** its now-wrong comment:

```tsx
      // Header — movement-keyed display title. This fixture carries no
      // skillMovements, so the session reports as ungraded.
        'session done.',
```

Read the surrounding lines before editing — match the existing assertion form rather than assuming it is a `toHaveTextContent`.

- [ ] **Step 4: Run the affected tests**

```bash
pnpm --filter @language-drill/web exec vitest run "app/(dashboard)/drill/debrief"
```

Expected: PASS across the debrief page and component tests.

- [ ] **Step 5: Commit**

```bash
git branch --show-current   # must be feat/debrief-movement-headline
git add -A
git commit -m "refactor(debrief): delete the accuracy tier and its dead footer prop

accuracyTier had one live consumer, the header, despite a doc comment
claiming three. DebriefFooter's `tier` prop was never read — the
component signature was literally `_props`, held for tier-keyed copy
variants that never arrived. Both go now that the header is
movement-keyed."
```

---

### Task 4: Full gate

**Files:** none modified — verification only.

- [ ] **Step 1: Confirm no orphaned references to the old copy**

```bash
rg -n "nice work\.|good attempt\.|back next time|accuracy " -g '*.ts' -g '*.tsx' apps/web/app/\(dashboard\)/drill/debrief apps/web/lib/drill | grep -v node_modules
```

Expected: no output.

- [ ] **Step 2: Run the full gate**

```bash
pnpm lint
pnpm typecheck
pnpm test
```

Expected: all three clean. If the full suite reports a package failure, re-run that package alone before concluding it is real — `@language-drill/web` and `@language-drill/infra` both have a known flake under parallel load. Capture the failing test name; never report a filtered exit code as evidence, since a pipe masks the real status.

- [ ] **Step 3: Run the web build**

```bash
pnpm --filter @language-drill/web build
```

Expected: success. The standard gate does not run `next build`, so prerender errors would otherwise pass locally and fail CI.

- [ ] **Step 4: Report**

Summarize: the six states, what was deleted, and the gate results. Do **not** push or open a PR — the controller handles that with the human.

---

## Notes for the implementer

- **Do not add accuracy back "just in case."** The whole point is that accuracy drives nothing adaptive. If you feel the header looks bare, say so in your report rather than adding a number.
- **Do not move banding to the client.** `band` is computed server-side specifically so the client cannot render mastery numbers. `movement-summary.ts` reads bands; it never derives them.
- **The lowercase-copy test is a real constraint.** Every new string must be lowercase, including after any punctuation.
- If a test fails for a reason you did not expect, report it — do not adjust the assertion to match the output.
