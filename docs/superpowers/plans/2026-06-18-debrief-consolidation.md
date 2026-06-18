# Debrief Page Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate the post-session debrief tab so each fact is stated once — score in the header, skill movement as the sole data-true hero, actions in the footer — removing the templated coach card and the redundant what's-next callout.

**Architecture:** Pure frontend change in `apps/web`. Rewrite `SkillMovementsPanel` into the hero "what moved" panel (sorted, reworded, with real empty states), reduce `DebriefTab` to render only that panel, and delete the now-dead narrative/coach-sessionComplete code. No backend, schema, API, or type changes.

**Tech Stack:** Next.js (App Router) + TypeScript, Vitest + @testing-library/react, Tailwind + design tokens (`.t-micro`, `.t-body`, `text-emerald-600`, `text-rose-600`, `text-ink-soft`, `gap-s-2`, `mb-s-3`, `mt-s-3`, `mt-s-6`), shared `Card` UI component.

## Global Constraints

- **Copy is lowercase** for body/eyebrow copy per design.md (e.g. `what moved`, `strong gain`, `slipped`). The `.t-micro` class renders eyebrows uppercase via CSS — author them lowercase in JSX.
- **No mastery numbers** in the debrief — never print raw `[0,1]` scores or decimals.
- **No streaks / XP / gamification** copy (project rule).
- **TDD:** write the failing test, watch it fail, implement, watch it pass, commit. One logical change per commit.
- Commands run from the worktree root: `/Users/seal/dev/language-drill/.claude/worktrees/polish-debrief-improvements`.
- Web test command: `pnpm --filter @language-drill/web test -- <path>` (single file) or `pnpm --filter @language-drill/web test` (all).
- `SkillMovement` shape (from `@language-drill/shared`): `{ grammarPointKey: string; label: string; band: 'new' | 'strong-gain' | 'gain' | 'steady' | 'slip'; confidence: 'high' | 'low' }`.

---

## File Structure

| File | Responsibility after this change |
|---|---|
| `apps/web/app/(dashboard)/drill/debrief/_components/skill-movements-panel.tsx` | The "what moved" hero panel: sorted movers, reworded band + confidence phrasing, all-steady and no-movement empty states. Always renders (never `null`). |
| `apps/web/app/(dashboard)/drill/debrief/_components/skill-movements-panel.test.tsx` | Unit tests for the panel's three render modes + sort + pluralization. |
| `apps/web/app/(dashboard)/drill/debrief/_components/debrief-tab.tsx` | Thin wrapper that renders only the panel. |
| `apps/web/app/(dashboard)/drill/debrief/_components/__tests__/debrief-tab.test.tsx` | Tests that the tab renders the panel and shows no coach card / no what's-next / no score. |
| `apps/web/lib/drill/coach-messages.ts` | `idle` + `evaluated` coach lines for the live drill only (`sessionComplete` removed). |
| `apps/web/lib/drill/__tests__/coach-messages.test.ts` | Coverage for the remaining `idle`/`evaluated` branches. |
| `apps/web/lib/drill/debrief-narrative.ts` | **Deleted.** |
| `apps/web/lib/drill/__tests__/debrief-narrative.test.ts` | **Deleted.** |

---

## Task 1: Rewrite SkillMovementsPanel into the "what moved" hero

**Files:**
- Modify: `apps/web/app/(dashboard)/drill/debrief/_components/skill-movements-panel.tsx`
- Test: `apps/web/app/(dashboard)/drill/debrief/_components/skill-movements-panel.test.tsx`

**Interfaces:**
- Consumes: `SkillMovement[]` from `@language-drill/shared` (shape in Global Constraints).
- Produces: `SkillMovementsPanel({ movements }: { movements: SkillMovement[] })` — a React component that **always renders** a `Card` with the `what moved` eyebrow, then one of: (a) sorted mover rows + optional steady footnote, (b) all-steady message, (c) no-movement message.

- [ ] **Step 1: Replace the test file with the new expectations**

Overwrite `skill-movements-panel.test.tsx` with:

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { SkillMovement } from '@language-drill/shared';
import { SkillMovementsPanel } from './skill-movements-panel';

const m = (over: Partial<SkillMovement>): SkillMovement => ({
  grammarPointKey: 'gp', label: 'Point', band: 'gain', confidence: 'high', ...over,
});

describe('SkillMovementsPanel', () => {
  it('renders the no-movement message when there are no movements', () => {
    render(<SkillMovementsPanel movements={[]} />);
    expect(screen.getByText('what moved')).toBeInTheDocument();
    expect(screen.getByText(/no skill movement recorded/i)).toBeInTheDocument();
  });

  it('renders the all-steady message when every movement is steady', () => {
    render(
      <SkillMovementsPanel
        movements={[m({ grammarPointKey: 'a', band: 'steady' }), m({ grammarPointKey: 'b', band: 'steady' })]}
      />,
    );
    expect(screen.getByText(/nothing shifted much/i)).toBeInTheDocument();
    expect(screen.getByText(/2 skills held steady/i)).toBeInTheDocument();
    expect(screen.getByText(/adds signal/i)).toBeInTheDocument();
  });

  it('renders mover rows with reworded band + confidence copy and no mastery numbers', () => {
    render(
      <SkillMovementsPanel
        movements={[
          m({ grammarPointKey: 'a', label: 'Subjuntivo', band: 'strong-gain', confidence: 'high' }),
          m({ grammarPointKey: 'b', label: 'Concesivos', band: 'slip', confidence: 'low' }),
        ]}
      />,
    );
    expect(screen.getByText('Subjuntivo')).toBeInTheDocument();
    expect(screen.getByText(/strong gain · we're confident/)).toBeInTheDocument();
    expect(screen.getByText(/slipped · early signal/)).toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toMatch(/\d\.\d/);
  });

  it('sorts movers positive-first (strong-gain → gain → new → slip)', () => {
    render(
      <SkillMovementsPanel
        movements={[
          m({ grammarPointKey: 'd', label: 'Dslip', band: 'slip' }),
          m({ grammarPointKey: 'c', label: 'Cnew', band: 'new' }),
          m({ grammarPointKey: 'b', label: 'Bgain', band: 'gain' }),
          m({ grammarPointKey: 'a', label: 'Astrong', band: 'strong-gain' }),
        ]}
      />,
    );
    const labels = screen.getAllByText(/Astrong|Bgain|Cnew|Dslip/).map((el) => el.textContent);
    expect(labels).toEqual(['Astrong', 'Bgain', 'Cnew', 'Dslip']);
  });

  it('summarizes steady points beside movers with a pluralized footnote', () => {
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
    expect(screen.getByText(/2 skills held steady/)).toBeInTheDocument();
  });

  it('uses singular "skill" when exactly one held steady', () => {
    render(
      <SkillMovementsPanel
        movements={[
          m({ grammarPointKey: 'a', label: 'Gained', band: 'gain' }),
          m({ grammarPointKey: 'b', label: 'Flat1', band: 'steady' }),
        ]}
      />,
    );
    expect(screen.getByText(/1 skill held steady/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/web test -- skill-movements-panel`
Expected: FAIL — current panel returns `null` for empty/all-steady and uses the old `Strong gain · high confidence` copy.

- [ ] **Step 3: Rewrite the panel**

Overwrite `skill-movements-panel.tsx` with:

```tsx
import type { SkillMovement, SkillMovementBand } from '@language-drill/shared';
import { Card } from '../../../../../components/ui';

// Mover display: glyph + lowercase phrase + color token + sort weight.
// `sort` orders movers positive-first (strong gain → gain → new → slip) so the
// panel ends on what to work on next.
const MOVER_DISPLAY: Record<
  Exclude<SkillMovementBand, 'steady'>,
  { glyph: string; phrase: string; className: string; sort: number }
> = {
  'strong-gain': { glyph: '▲▲', phrase: 'strong gain', className: 'text-emerald-600', sort: 0 },
  gain: { glyph: '▲', phrase: 'gained', className: 'text-emerald-600', sort: 1 },
  new: { glyph: '★', phrase: 'new — first evidence', className: 'text-ink-soft', sort: 2 },
  slip: { glyph: '▼', phrase: 'slipped', className: 'text-rose-600', sort: 3 },
};

const CONFIDENCE_PHRASE: Record<SkillMovement['confidence'], string> = {
  high: "we're confident",
  low: 'early signal',
};

function heldSteady(count: number): string {
  return `${count} ${count === 1 ? 'skill' : 'skills'} held steady`;
}

export interface SkillMovementsPanelProps {
  movements: SkillMovement[];
}

export function SkillMovementsPanel({ movements }: SkillMovementsPanelProps) {
  const movers = movements
    .filter((mv) => mv.band !== 'steady')
    .sort(
      (a, b) =>
        MOVER_DISPLAY[a.band as Exclude<SkillMovementBand, 'steady'>].sort -
        MOVER_DISPLAY[b.band as Exclude<SkillMovementBand, 'steady'>].sort,
    );
  const steadyCount = movements.length - movers.length;

  return (
    <Card padding="md">
      <p className="t-micro text-ink-soft mb-s-3">what moved</p>

      {movers.length > 0 ? (
        <>
          <div className="flex flex-col gap-s-2">
            {movers.map((mv) => {
              const d = MOVER_DISPLAY[mv.band as Exclude<SkillMovementBand, 'steady'>];
              return (
                <div
                  key={mv.grammarPointKey}
                  className="flex items-center justify-between t-body"
                >
                  <span className="text-ink">
                    <span aria-hidden="true" className={`${d.className} mr-s-2`}>
                      {d.glyph}
                    </span>
                    {mv.label}
                  </span>
                  <span className={`${d.className} font-medium`}>
                    {d.phrase} · {CONFIDENCE_PHRASE[mv.confidence]}
                  </span>
                </div>
              );
            })}
          </div>
          {steadyCount > 0 && (
            <p className="t-micro text-ink-soft mt-s-3">{heldSteady(steadyCount)}</p>
          )}
        </>
      ) : movements.length > 0 ? (
        <p className="t-body text-ink-soft">
          Nothing shifted much this round — {heldSteady(steadyCount)}. That&apos;s normal;
          another short session adds signal.
        </p>
      ) : (
        <p className="t-body text-ink-soft">No skill movement recorded this round.</p>
      )}
    </Card>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/web test -- skill-movements-panel`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/\(dashboard\)/drill/debrief/_components/skill-movements-panel.tsx apps/web/app/\(dashboard\)/drill/debrief/_components/skill-movements-panel.test.tsx
git commit -m "feat(debrief): promote skill movements to the what-moved hero panel"
```

---

## Task 2: Reduce DebriefTab to the panel only

**Files:**
- Modify: `apps/web/app/(dashboard)/drill/debrief/_components/debrief-tab.tsx`
- Test: `apps/web/app/(dashboard)/drill/debrief/_components/__tests__/debrief-tab.test.tsx`

**Interfaces:**
- Consumes: `DebriefResponse` from `@language-drill/api-client` (uses only `skillMovements`); `SkillMovementsPanel` from Task 1.
- Produces: `DebriefTab({ debrief }: { debrief: DebriefResponse })` rendering a single `<div className="fade-in mt-s-6">` wrapping `<SkillMovementsPanel movements={debrief.skillMovements} />`.

- [ ] **Step 1: Replace the test file with the consolidated expectations**

Overwrite `__tests__/debrief-tab.test.tsx` with:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { DebriefResponse } from '@language-drill/api-client';
import { DebriefTab } from '../debrief-tab';

function makeDebrief(overrides: Partial<DebriefResponse> = {}): DebriefResponse {
  return {
    id: '11111111-2222-4222-8222-555555555555',
    language: 'ES' as DebriefResponse['language'],
    difficulty: 'B1' as DebriefResponse['difficulty'],
    startedAt: '2026-05-04T10:00:00.000Z',
    completedAt: '2026-05-04T10:04:38.000Z',
    durationSeconds: 278,
    exerciseCount: 5,
    correctCount: 4,
    attemptedCount: 5,
    skippedCount: 0,
    items: [],
    skillMovements: [],
    ...overrides,
  };
}

describe('DebriefTab — what moved panel', () => {
  it('renders mover rows when the debrief carries movers', () => {
    render(
      <DebriefTab
        debrief={makeDebrief({
          skillMovements: [
            { grammarPointKey: 'es-b1-subjunctive', label: 'Subjuntivo', band: 'strong-gain', confidence: 'high' },
          ],
        })}
      />,
    );
    expect(screen.getByText('Subjuntivo')).toBeInTheDocument();
    expect(screen.getByText(/strong gain/)).toBeInTheDocument();
  });

  it('renders the all-steady message when nothing moved', () => {
    const { container } = render(
      <DebriefTab
        debrief={makeDebrief({
          skillMovements: [
            { grammarPointKey: 'a', label: 'A', band: 'steady', confidence: 'high' },
            { grammarPointKey: 'b', label: 'B', band: 'steady', confidence: 'high' },
          ],
        })}
      />,
    );
    expect(container.textContent).toContain('held steady');
    expect(container.textContent).toContain('adds signal');
  });

  it('renders the no-movement message when there are no movements', () => {
    const { container } = render(<DebriefTab debrief={makeDebrief({ skillMovements: [] })} />);
    expect(container.textContent).toContain('No skill movement recorded');
  });
});

describe('DebriefTab — consolidation', () => {
  it('does not render a coach card / coach voice', () => {
    const { container } = render(<DebriefTab debrief={makeDebrief()} />);
    expect((container.textContent ?? '').toLowerCase()).not.toContain('coach');
  });

  it('does not render a what\'s-next callout', () => {
    const { container } = render(<DebriefTab debrief={makeDebrief()} />);
    expect((container.textContent ?? '').toLowerCase()).not.toContain("what's next");
  });

  it('does not restate the score (no "X of Y" — that lives in the header)', () => {
    const { container } = render(
      <DebriefTab
        debrief={makeDebrief({
          correctCount: 4,
          attemptedCount: 5,
          skillMovements: [
            { grammarPointKey: 'a', label: 'A', band: 'gain', confidence: 'high' },
          ],
        })}
      />,
    );
    expect(container.textContent ?? '').not.toMatch(/\d of \d/);
  });

  it('does not render any link (forward actions live in the footer)', () => {
    render(<DebriefTab debrief={makeDebrief()} />);
    expect(screen.queryByRole('link')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/web test -- __tests__/debrief-tab`
Expected: FAIL — the current tab still renders the coach card ("coach"), the what's-next callout, and a link.

- [ ] **Step 3: Rewrite the tab**

Overwrite `debrief-tab.tsx` with:

```tsx
import type { DebriefResponse } from '@language-drill/api-client';
import { SkillMovementsPanel } from './skill-movements-panel';

// ---------------------------------------------------------------------------
// DebriefTab — default panel content for the post-session debrief screen.
//   A single "what moved" panel. The score lives in the header and forward
//   actions in the footer, so the tab body carries only the skill-movement
//   signal — the one thing not stated elsewhere on the page.
// ---------------------------------------------------------------------------

export interface DebriefTabProps {
  debrief: DebriefResponse;
}

export function DebriefTab({ debrief }: DebriefTabProps) {
  return (
    <div className="fade-in mt-s-6">
      <SkillMovementsPanel movements={debrief.skillMovements} />
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/web test -- __tests__/debrief-tab`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/\(dashboard\)/drill/debrief/_components/debrief-tab.tsx apps/web/app/\(dashboard\)/drill/debrief/_components/__tests__/debrief-tab.test.tsx
git commit -m "feat(debrief): reduce debrief tab to the what-moved panel"
```

---

## Task 3: Delete dead narrative + sessionComplete code

**Files:**
- Delete: `apps/web/lib/drill/debrief-narrative.ts`
- Delete: `apps/web/lib/drill/__tests__/debrief-narrative.test.ts`
- Modify: `apps/web/lib/drill/coach-messages.ts`
- Modify: `apps/web/lib/drill/__tests__/coach-messages.test.ts`

**Interfaces:**
- Produces: `CoachContext` narrowed to `{ kind: 'idle'; ... } | { kind: 'evaluated'; ... }`; `coachMessage` no longer accepts `sessionComplete`. `drill/page.tsx` (the only other caller) uses `idle`/`evaluated` only — unaffected.

- [ ] **Step 1: Delete the dead narrative module and its test**

```bash
git rm apps/web/lib/drill/debrief-narrative.ts apps/web/lib/drill/__tests__/debrief-narrative.test.ts
```

(`debriefNarrative` had only one runtime caller — `debrief-tab.tsx`, rewritten in Task 2 — and its own test.)

- [ ] **Step 2: Remove the `sessionComplete` test block**

In `apps/web/lib/drill/__tests__/coach-messages.test.ts`, delete lines 237–283 inclusive — the
`// sessionComplete branch (Req 4.4)` comment header through the closing `});` of
`describe('coachMessage — sessionComplete', ...)` (the block immediately before
`// SENTENCE_CONSTRUCTION coverage`). Leave the surrounding blocks intact.

- [ ] **Step 3: Remove `sessionComplete` from the source**

In `apps/web/lib/drill/coach-messages.ts` make three deletions:

1. Drop the union member from `CoachContext`:

```ts
export type CoachContext =
  | { kind: "idle"; type: ExerciseType }
  | { kind: "evaluated"; type: ExerciseType; score: number };
```

2. Delete the entire `sessionCompleteMessage` function (the `function sessionCompleteMessage(accuracy: number | null): string { ... }` block).

3. Delete the `case "sessionComplete":` arm from the `coachMessage` switch:

```ts
export function coachMessage(ctx: CoachContext): string {
  switch (ctx.kind) {
    case "idle":
      return idleMessage(ctx.type);
    case "evaluated":
      return evaluatedMessage(ctx.type, ctx.score);
    default: {
      const _exhaustive: never = ctx;
      throw new Error(`unknown CoachContext: ${String(_exhaustive)}`);
    }
  }
}
```

- [ ] **Step 4: Run the affected tests + typecheck**

Run: `pnpm --filter @language-drill/web test -- coach-messages`
Expected: PASS (remaining idle/evaluated coverage).

Run: `pnpm --filter @language-drill/web typecheck`
Expected: PASS — no orphaned imports of `debriefNarrative` or `sessionComplete`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/drill/coach-messages.ts apps/web/lib/drill/__tests__/coach-messages.test.ts
git commit -m "refactor(debrief): drop dead narrative + coach sessionComplete code"
```

---

## Task 4: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Lint**

Run: `pnpm lint`
Expected: PASS, zero warnings introduced. (Watch for `react/no-unescaped-entities` on the apostrophes — the panel uses `&apos;` and `we're` inside a JS string, both safe.)

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS across all packages.

- [ ] **Step 3: Test**

Run: `pnpm test`
Expected: PASS. No references remain to `debrief-narrative` or `coachMessage({ kind: 'sessionComplete' })`.

- [ ] **Step 4: Grep for stragglers**

Run: `grep -rn "debriefNarrative\|debrief-narrative\|sessionComplete" apps/web`
Expected: no matches.

- [ ] **Step 5: Commit (only if Steps 1–4 produced fixes)**

```bash
git add -A
git commit -m "test(debrief): green lint/typecheck/test after consolidation"
```

---

## Self-Review

**Spec coverage:**
- Header unchanged → no task touches it (correct; verified not in file list). ✓
- "What moved" hero with sort + reworded phrasing → Task 1. ✓
- All-steady + no-movement empty states (never `null`) → Task 1 (tests + impl). ✓
- Coach card + what's-next callout deleted → Task 2. ✓
- Footer unchanged → no task touches it. ✓
- Dead code removal (`debrief-narrative.*`, coach `sessionComplete`) → Task 3. ✓
- Full suite green → Task 4. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; exact delete line range (237–283) given for the test block. ✓

**Type consistency:** `SkillMovement` shape used in tests matches Global Constraints; `heldSteady()`, `MOVER_DISPLAY`, `CONFIDENCE_PHRASE` defined once in Task 1 and referenced consistently; `CoachContext` narrowing in Task 3 matches the remaining `idle`/`evaluated` callers. ✓
