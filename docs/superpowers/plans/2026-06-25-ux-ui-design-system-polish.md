# UX/UI Design-System Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the Claude Design prototype refresh to Home (Today), Drill Session, and Progress — desktop + mobile — and consolidate the button / typography / accent rules they imply across the whole web app.

**Architecture:** Adapt design *intent* into the existing Next.js App Router + Tailwind-4 (`@theme`) component system. Fix the design-system foundations (Button, tokens, shared link, heading scale) first, then apply per-surface changes that depend on them. Presentation-only: no API, data-model, or evaluation/SR logic changes.

**Tech Stack:** Next.js (App Router) + TypeScript, Tailwind CSS 4 (`@theme` tokens in `apps/web/app/globals.css`), TanStack Query, Vitest + Testing Library, Playwright e2e. Fonts: Fraunces / Inter / JetBrains Mono / Caveat via `next/font`.

**Spec:** `docs/superpowers/specs/2026-06-25-ux-ui-design-system-polish-design.md`

## Global Constraints

- All work happens in the worktree `/Users/seal/dev/language-drill/.claude/worktrees/ux-polish-design-system` on branch `worktree-ux-polish-design-system`. Use **absolute paths under the worktree root** for every edit; `cd` into the worktree for every Bash command. Assert `git branch --show-current` returns the worktree branch before each commit. (Memory: edits via main-repo paths silently land on `main`; the checked-out branch can flip to `main` between ops.)
- Colors, spacing, radius, shadows, fonts must resolve to **design tokens only** (`--color-*`, `--spacing-s-*`, `--radius-r-*`, `--shadow-*`, `--font-*`). The one allowed new raw hex is `#322b24`, introduced **once** as the token `--color-ink-hover`.
- **Terracotta (`accent`/`accent-2`) is accent-only** — never a primary CTA fill or primary-button hover.
- **Exactly two visible button styles ship:** ink-filled primary + bordered-transparent ghost. Tertiary = underlined text link. **No white/card-filled buttons** (the `chip` pill control is the sole intended `bg-card` exception).
- **Dashed borders = preview/optional containers only** (never buttons/CTAs).
- **Top-level page H1 = 62px desktop / 36px mobile.**
- **Turkish accent keyboard (`components/ui/accent-picker.tsx`) is NOT changed.**
- **`work on these` stays live `useInsightsErrors()` data** — never hardcode the prototype sample set.
- Mobile breakpoint is `mobile:` (≤760px), mirrored in `lib/responsive.ts`.
- Per task: implement → write/update tests → `pnpm lint && pnpm typecheck` green for touched packages → commit. Full `pnpm test` + `pnpm --filter @language-drill/web build` run in the final task (and any task that changes behavior covered by tests).
- Commit message footer on every commit:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```

---

## File Structure

**Foundations**
- `apps/web/app/globals.css` — add `--color-ink-hover`; bump `.t-display-xl` to 62/36; add `.link-arrow` tertiary-link utility.
- `apps/web/components/ui/button.tsx` — redefine `primary` hover, `ghost`; deprecate `accent`.
- `apps/web/components/ui/text-link.tsx` *(new)* — shared tertiary `<TextLink>` (wraps `.link-arrow`), optional helper. (May be skipped in favor of the class — Task 1 decides.)

**Nav**
- `apps/web/components/shell/nav-items.tsx`, `nav-icons.tsx`, `nav-item.tsx`, `mobile-tab-bar.tsx`.

**Home** — `apps/web/app/(dashboard)/_components/`: `dashboard-header.tsx`, `daily-load-control.tsx`, `next-up-card.tsx`, `read-collect-card.tsx`, `skill-snapshot-grid.tsx`, `today-timeline.tsx`/`timeline-item.tsx`, plus `app/(dashboard)/home/page.tsx`.

**Drill** — `apps/web/app/(dashboard)/drill/`: `page.tsx`, `_components/coach-rail.tsx`, `drill-layout` (in `page.tsx`/layout), `cloze-exercise.tsx`, `feedback-shell.tsx`, `drill-hub.tsx`, `drill-meta.tsx`, `fluency-promo.tsx`; debrief: `debrief/[sessionId]/page.tsx`, `debrief/_components/debrief-tabs.tsx`, `review-item-card.tsx`, `skill-movements-panel.tsx`.

**Progress** — `apps/web/app/(dashboard)/progress/_components/`: `map-tab.tsx`, `point-detail-sheet.tsx`.

**Shared widget** — `apps/web/app/(dashboard)/_components/work-on-these.tsx`.

---

## Task 1: Design-system foundations — tokens, heading scale, shared link

**Files:**
- Modify: `apps/web/app/globals.css`
- Test: `apps/web/app/__tests__/globals-tokens.test.ts` *(new, lightweight string assertion)*

**Interfaces:**
- Produces: token `--color-ink-hover` (usable as `bg-ink-hover`/`border-ink-hover`); `.t-display-xl` = 62px / 36px mobile; `.link-arrow` utility class for tertiary links.

- [ ] **Step 1: Add the ink-hover token.** In `globals.css`, inside `@theme { … /* Colors */ }`, after the `--color-ink-*` block (line ~17), add:

```css
  /* Primary-button hover: a slight lighten of --color-ink (NOT terracotta). */
  --color-ink-hover: #322b24;
```

- [ ] **Step 2: Bump the top-level heading scale.** Change `.t-display-xl` (line ~82) `font-size: 56px;` → `font-size: 62px;` and `letter-spacing: -1.5px;` → `letter-spacing: -1.2px;`. In the mobile override block (`@media (max-width: 760px)`, line ~232) change `.t-display-xl { font-size: 34px; … }` → `font-size: 36px;`.

- [ ] **Step 3: Add the shared tertiary-link utility.** Append near the other shared utilities (after `.hilite`, ~line 156):

```css
/* ─── Tertiary action link (shared "see the map →", "read the theory →" style) ─── */
.link-arrow {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  font-size: 15px;
  color: var(--color-ink-soft);
  text-decoration: underline;
  text-underline-offset: 3px;
  text-decoration-color: var(--color-rule-strong);
  cursor: pointer;
  background: none;
  border: 0;
  padding: 0;
  font-family: inherit;
  transition: color 0.15s ease, text-decoration-color 0.15s ease;
}
.link-arrow:hover {
  color: var(--color-ink);
  text-decoration-color: var(--color-ink-mute);
}
```

- [ ] **Step 4: Write the guard test.** Create `apps/web/app/__tests__/globals-tokens.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const css = readFileSync(join(__dirname, '..', 'globals.css'), 'utf8');

describe('design-system foundations', () => {
  it('defines the ink-hover token (#322b24)', () => {
    expect(css).toMatch(/--color-ink-hover:\s*#322b24/);
  });
  it('sets the top-level heading to 62px desktop', () => {
    expect(css).toMatch(/\.t-display-xl\s*\{[^}]*font-size:\s*62px/);
  });
  it('sets the top-level heading to 36px mobile', () => {
    expect(css).toMatch(/@media \(max-width: 760px\)[\s\S]*\.t-display-xl\s*\{[^}]*font-size:\s*36px/);
  });
  it('defines the shared tertiary link utility', () => {
    expect(css).toMatch(/\.link-arrow\s*\{/);
  });
});
```

- [ ] **Step 5: Run the test.** `cd` to worktree, `pnpm --filter @language-drill/web test -- globals-tokens` → Expected: PASS (4 tests).

- [ ] **Step 6: Commit.**

```bash
git add apps/web/app/globals.css apps/web/app/__tests__/globals-tokens.test.ts
git commit -m "feat(ui): design-system tokens — ink-hover, 62/36 heading, shared link"
```

---

## Task 2: Button refactor — two styles, deprecate terracotta

**Files:**
- Modify: `apps/web/components/ui/button.tsx`
- Test: `apps/web/components/ui/__tests__/button.test.tsx` (create if absent)

**Interfaces:**
- Consumes: `--color-ink-hover` (Task 1).
- Produces: `ButtonVariant = 'default' | 'primary' | 'ghost' | 'chip'` (`accent` removed). `primary` hovers to ink-hover; `ghost` is the bordered-transparent secondary.

- [ ] **Step 1: Find every `accent` button usage.**

```bash
cd /Users/seal/dev/language-drill/.claude/worktrees/ux-polish-design-system
grep -rn 'variant="accent"' apps/web --include=*.tsx
```

Record the list. Each becomes `variant="primary"` (default emphasis) unless context clearly wants a secondary, in which case `variant="ghost"`.

- [ ] **Step 2: Redefine the variant classes.** In `button.tsx`, change `variantClasses` (lines ~19-32) to:

```ts
const variantClasses: Record<ButtonVariant, string> = {
  // Primary CTA — ink fill, lightens on hover (never terracotta). Desktop shadow lift.
  primary:
    'border border-ink bg-ink text-paper hover:bg-ink-hover hover:border-ink-hover hover:shadow-2',
  // Secondary — bordered transparent, no fill. The single ghost/secondary style.
  ghost:
    'border border-rule-strong bg-transparent text-ink-2 hover:bg-paper-2 hover:text-ink',
  // `default` is an alias of the secondary ghost so only two button styles ship.
  default:
    'border border-rule-strong bg-transparent text-ink-2 hover:bg-paper-2 hover:text-ink',
  // Bordered pill control on paper/card — the sole intended bg-card exception.
  chip: 'border border-rule bg-card text-ink hover:border-ink hover:bg-paper-2',
};
```

- [ ] **Step 3: Remove `accent` from the type union.** Change line 5 to:

```ts
export type ButtonVariant = 'default' | 'primary' | 'ghost' | 'chip';
```

- [ ] **Step 4: Migrate the usages found in Step 1.** Edit each file, replacing `variant="accent"` → `variant="primary"` (or `"ghost"` where it's a secondary action). Commit-relevant files include drill submit/next and any results CTAs — verify none remain:

```bash
grep -rn 'variant="accent"' apps/web --include=*.tsx
```

Expected: no output.

- [ ] **Step 5: Add/extend the button test.** In `apps/web/components/ui/__tests__/button.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Button } from '../button';

describe('Button variants', () => {
  it('primary hovers to ink-hover, not terracotta', () => {
    render(<Button variant="primary">go</Button>);
    const cls = screen.getByRole('button').className;
    expect(cls).toContain('bg-ink');
    expect(cls).toContain('hover:bg-ink-hover');
    expect(cls).not.toContain('accent');
  });
  it('ghost is bordered-transparent with no fill', () => {
    render(<Button variant="ghost">x</Button>);
    const cls = screen.getByRole('button').className;
    expect(cls).toContain('border-rule-strong');
    expect(cls).toContain('bg-transparent');
  });
});
```

- [ ] **Step 6: Run tests.** `pnpm --filter @language-drill/web test -- button` → Expected: PASS.

- [ ] **Step 7: Typecheck (catches removed `accent` references in tests/components).** `pnpm --filter @language-drill/web typecheck` → fix any `'accent'` literal references surfaced, then re-run. Expected: clean.

- [ ] **Step 8: Commit.**

```bash
git add apps/web/components/ui/button.tsx apps/web/components/ui/__tests__/button.test.tsx <migrated files>
git commit -m "feat(ui): Button — ink-hover primary, ghost secondary, drop terracotta accent"
```

---

## Task 3: Navigation — rename review → vocabulary, flashcards icon

**Files:**
- Modify: `apps/web/components/shell/nav-items.tsx`, `apps/web/components/shell/nav-icons.tsx`, `apps/web/components/shell/mobile-tab-bar.tsx`
- Test: existing nav/e2e specs (grep + update)

**Interfaces:**
- Produces: `NavDestination` gains optional `mobileLabel`; desktop label `my vocabulary`, mobile `vocab`; `ReviewIcon` is a stacked-cards glyph.

- [ ] **Step 1: Add a mobile label to the nav type + data.** In `nav-items.tsx`, change the interface and the `/review` entry:

```ts
export interface NavDestination {
  href: string;
  label: string;
  mobileLabel?: string;
  icon: React.ReactNode;
}
```
```ts
  { href: '/review', label: 'my vocabulary', mobileLabel: 'vocab', icon: <ReviewIcon /> },
```

- [ ] **Step 2: Swap the review icon to flashcards (stacked cards).** Replace `ReviewIcon` in `nav-icons.tsx`:

```tsx
export function ReviewIcon() {
  // Stacked cards (flashcards) — matches the "my vocabulary" label.
  return (
    <svg {...SHARED_PROPS} aria-hidden="true">
      <rect x="4" y="5.5" width="9" height="7" rx="1.3" />
      <path d="M3 8.5V4.2A1.2 1.2 0 0 1 4.2 3h7.3" />
    </svg>
  );
}
```

- [ ] **Step 3: Make the mobile tab-bar use `mobileLabel`.** In `mobile-tab-bar.tsx`, where the label renders, use `d.mobileLabel ?? d.label`. (Read the file; the map over `NAV_DESTINATIONS` will reference `.label` — change to the fallback.)

- [ ] **Step 4: Grep + update tests referencing the old label.**

```bash
grep -rn "'review'\|\"review\"\|>review<\|getByText('review')\|/review" apps/web --include=*.test.* --include=*.spec.* -l
```

Update label assertions to `my vocabulary` (desktop) / `vocab` (mobile). Route `/review` is unchanged — keep route assertions.

- [ ] **Step 5: Run nav unit tests.** `pnpm --filter @language-drill/web test -- nav` → Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add apps/web/components/shell/nav-items.tsx apps/web/components/shell/nav-icons.tsx apps/web/components/shell/mobile-tab-bar.tsx <updated tests>
git commit -m "feat(nav): rename review → my vocabulary / vocab + flashcards icon"
```

---

## Task 4: Home header — remove greeting, promote "today's plan."

**Files:**
- Modify: `apps/web/app/(dashboard)/_components/dashboard-header.tsx` (and `home/page.tsx` if the heading lives there)
- Test: `apps/web/app/(dashboard)/_components/__tests__/dashboard-header.test.tsx` (create/extend)

- [ ] **Step 1: Read `dashboard-header.tsx`** to capture current props (it receives first name + minutes + framing from `useTodayPlan()`).

- [ ] **Step 2: Replace the greeting with the promoted heading.** Remove the "good evening, {name}" line entirely. Render:
  - H1 `today's plan.` with class `t-display-xl`.
  - `~{minutes} min planned` beside it on desktop / beneath on mobile. Use a flex row that wraps: `<div className="flex items-baseline justify-between gap-s-6 mobile:flex-col mobile:items-start mobile:gap-s-2">`, heading on the left, `<span className="t-mono text-ink-mute whitespace-nowrap">~{minutes} min planned</span>` on the right.
  - Keep the lead paragraph ("today leans into … — your liveliest error spots") below, class `t-body-l text-ink-2`.

- [ ] **Step 3: Update the test.** Assert the greeting text is gone and the heading + minutes render:

```tsx
it('shows the promoted plan heading and minutes, no greeting', () => {
  render(<DashboardHeader minutes={20} framing="today leans into X." /* ...actual props */ />);
  expect(screen.getByRole('heading', { name: /today's plan/i })).toBeInTheDocument();
  expect(screen.getByText(/~20 min planned/)).toBeInTheDocument();
  expect(screen.queryByText(/good evening|good morning|good afternoon/i)).not.toBeInTheDocument();
});
```
(Match the component's real prop names — read them in Step 1.)

- [ ] **Step 4: Run the test.** `pnpm --filter @language-drill/web test -- dashboard-header` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/web/app/(dashboard)/_components/dashboard-header.tsx apps/web/app/(dashboard)/_components/__tests__/dashboard-header.test.tsx
git commit -m "feat(home): drop greeting, promote \"today's plan.\" heading + minutes"
```

---

## Task 5: Home — segmented "today's load" control

**Files:**
- Modify: `apps/web/app/(dashboard)/_components/daily-load-control.tsx`
- Test: `apps/web/app/(dashboard)/_components/__tests__/daily-load-control.test.tsx` (create/extend)

**Interfaces:**
- Consumes: `DAILY_GOALS`, `DailyGoal` from `@language-drill/shared` (unchanged).
- Produces: same `DailyLoadControlProps` (`current`, `onSelect`, `disabled`) — drop-in; presentation changes only.

- [ ] **Step 1: Replace the `Choice` chips with a segmented track.** Rewrite the component body (keep imports of `cn`, `DAILY_GOALS`, `DailyGoal`; drop the `Choice` import):

```tsx
export function DailyLoadControl({ current, onSelect, disabled = false }: DailyLoadControlProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-s-4 gap-y-s-2">
      <span className="t-micro text-ink-mute whitespace-nowrap">today's load</span>
      <div
        role="radiogroup"
        aria-label="today's load"
        aria-disabled={disabled}
        className={cn(
          'inline-flex gap-1 rounded-r-pill bg-paper-3 p-[5px]',
          disabled && 'opacity-60 pointer-events-none'
        )}
      >
        {DAILY_GOALS.map((g) => {
          const selected = current === g;
          return (
            <button
              key={g}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => !disabled && onSelect(g)}
              className={cn(
                'min-w-[88px] justify-center rounded-r-pill px-s-5 py-[10px] text-[15px] font-semibold transition-all duration-150',
                selected
                  ? 'bg-hilite text-ink shadow-1'
                  : 'bg-transparent text-ink-soft hover:text-ink'
              )}
            >
              {g}
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write/extend the test.** Assert radiogroup semantics + selection + yellow fill on the selected segment:

```tsx
it('marks the current goal as checked and calls onSelect', async () => {
  const onSelect = vi.fn();
  render(<DailyLoadControl current="medium" onSelect={onSelect} />);
  const long = screen.getByRole('radio', { name: 'long' });
  expect(screen.getByRole('radio', { name: 'medium' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByRole('radio', { name: 'medium' }).className).toContain('bg-hilite');
  await userEvent.click(long);
  expect(onSelect).toHaveBeenCalledWith('long');
});
```

- [ ] **Step 3: Run the test.** `pnpm --filter @language-drill/web test -- daily-load-control` → PASS.

- [ ] **Step 4: Commit.**

```bash
git add apps/web/app/(dashboard)/_components/daily-load-control.tsx apps/web/app/(dashboard)/_components/__tests__/daily-load-control.test.tsx
git commit -m "feat(home): segmented yellow today's-load control"
```

---

## Task 6: Home — neutral Next Up & reading promo cards

**Files:**
- Modify: `apps/web/app/(dashboard)/_components/next-up-card.tsx`, `apps/web/app/(dashboard)/_components/read-collect-card.tsx`, and the desktop "current item" in `timeline-item.tsx`
- Test: extend each component's existing test if present

- [ ] **Step 1: Read all three files** to capture current markup/props.

- [ ] **Step 2: Neutralize `next-up-card.tsx`.** Card surface → `bg-card border border-rule shadow-1 rounded-r-lg`. The "next up" eyebrow → `t-micro text-accent-2` (terracotta kept here only). CTA `start →` → `<Button variant="primary" size="md">`. Remove any terracotta panel fill / accent background on the card itself.

- [ ] **Step 3: Neutralize `read-collect-card.tsx`.** Card → neutral white (`bg-card border-rule shadow-1`). Keep the small `new` tag as `bg-accent-soft text-accent-2`. CTA `open reader →` → `<Button variant="primary">`. No terracotta fill.

- [ ] **Step 4: Desktop current timeline item** (`timeline-item.tsx`): ensure the active item's `start →` is `variant="primary"` and the row is not terracotta-filled; the "next up" chip uses `<Chip variant="accent">`.

- [ ] **Step 5: Update/extend tests** to assert the CTA is a primary button and the card is not terracotta-filled (e.g. `expect(card.className).not.toMatch(/bg-accent(?!-soft)/)`).

- [ ] **Step 6: Run tests.** `pnpm --filter @language-drill/web test -- next-up read-collect timeline-item` → PASS.

- [ ] **Step 7: Commit.**

```bash
git add apps/web/app/(dashboard)/_components/next-up-card.tsx apps/web/app/(dashboard)/_components/read-collect-card.tsx apps/web/app/(dashboard)/_components/timeline-item.tsx <tests>
git commit -m "feat(home): neutral Next Up + reading promo cards, ink CTAs"
```

---

## Task 7: Home — status/link rows + skill-snapshot eyebrow

**Files:**
- Modify: `apps/web/app/(dashboard)/home/page.tsx` (path cue row), `apps/web/app/(dashboard)/_components/skill-snapshot-grid.tsx`
- Test: extend `skill-snapshot-grid` test

- [ ] **Step 1: Path-cue + see-the-map row.** In `home/page.tsx` where the "you're around point N · next: …" cue renders, wrap it in a row: `<div className="flex items-baseline justify-between gap-s-6 mobile:flex-col mobile:items-start mobile:gap-s-2">`, cue text left (`t-micro text-ink-mute`), and the link right as `<Link href="/progress" className="link-arrow">see the map →</Link>`.

- [ ] **Step 2: Skill-snapshot header.** In `skill-snapshot-grid.tsx`: section top row → eyebrow `your turkish` (left) — **remove "weakest first"** from the eyebrow text — and `<Link href="/progress" className="link-arrow">see full progress →</Link>` (right). Keep the weakest-first *ordering* logic; only the eyebrow copy changes.

- [ ] **Step 3: Update the snapshot test.** Assert the eyebrow no longer contains "weakest first" and the link uses the shared style:

```tsx
expect(screen.queryByText(/weakest first/i)).not.toBeInTheDocument();
expect(screen.getByRole('link', { name: /see full progress/i })).toHaveClass('link-arrow');
```

- [ ] **Step 4: Run the test.** `pnpm --filter @language-drill/web test -- skill-snapshot` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/web/app/(dashboard)/home/page.tsx apps/web/app/(dashboard)/_components/skill-snapshot-grid.tsx <tests>
git commit -m "feat(home): unified status/link rows, drop \"weakest first\""
```

---

## Task 8: Drill — desktop 2-column, dots inline, coach rail dormant

**Files:**
- Modify: `apps/web/app/(dashboard)/drill/page.tsx` (desktop layout), `apps/web/app/(dashboard)/drill/_components/coach-rail.tsx`
- Test: drill page integration test (extend)

- [ ] **Step 1: Read `drill/page.tsx`** to find the desktop layout wrapper that mounts `CoachRail` as a 3rd column, and where `SessionDots` renders.

- [ ] **Step 2: Drop the coach-rail column.** Remove the `<CoachRail … />` mount from the desktop layout; collapse the grid to a single main content column (prototype `max-width: 1040px`). Move `SessionDots` to render **inline at the top of the main column**, above the topic line (it already renders in the mobile flow — reuse that placement for both breakpoints).

- [ ] **Step 3: Mark the rail dormant.** At the top of `coach-rail.tsx`, add a comment:

```tsx
// DORMANT (2026-06): the dedicated coach rail is not mounted. The coach nudge
// now lives inside the per-answer feedback card (feedback-shell.tsx). Kept for
// reintroduction once the coach gives genuinely useful, item-matched advice.
```
Leave the component exported but unused. (If lint flags an unused import in `page.tsx`, remove the import there.)

- [ ] **Step 4: Update the drill integration test** to assert no separate coach-rail region renders during a session and the progress dots appear in the main column.

- [ ] **Step 5: Run tests.** `pnpm --filter @language-drill/web test -- drill` → PASS.

- [ ] **Step 6: Commit.**

```bash
git add apps/web/app/(dashboard)/drill/page.tsx apps/web/app/(dashboard)/drill/_components/coach-rail.tsx <tests>
git commit -m "feat(drill): 2-column desktop, inline progress dots, dormant coach rail"
```

---

## Task 9: Drill — remove lately banner, in-session fluency, helper lines

**Files:**
- Modify: `apps/web/app/(dashboard)/drill/page.tsx` and/or the session view components; `apps/web/app/(dashboard)/drill/_components/fluency-promo.tsx` mounts
- Test: drill integration test (extend)

- [ ] **Step 1: Remove the "lately" recap banner.** Find the passive "lately …" banner shown on item 1 of the session and delete it (markup + any feeding state used only by it).

- [ ] **Step 2: Remove the in-session `FluencyPromo`.** Delete its mount from the drill session (both desktop coach-rail placement — already gone via Task 8 — and the mobile bottom-of-scroll placement). Keep `fluency-promo.tsx` on disk for now (Task 10 decides reuse vs delete).

- [ ] **Step 3: Remove desktop helper lines.** Delete the "type straight into the gap" helper line and the "try next / fluency mode" dashed box from the desktop drill.

- [ ] **Step 4: Grep to confirm no in-session fluency entry remains.**

```bash
grep -rn 'FluencyPromo\|fluency mode\|try next' apps/web/app/\(dashboard\)/drill --include=*.tsx
```
Expected: only the dormant `fluency-promo.tsx` definition (no session mounts).

- [ ] **Step 5: Update the drill integration test** to assert the lately banner and fluency promo are absent during a session.

- [ ] **Step 6: Run tests.** `pnpm --filter @language-drill/web test -- drill` → PASS.

- [ ] **Step 7: Commit.**

```bash
git add -A apps/web/app/\(dashboard\)/drill
git commit -m "feat(drill): remove lately banner, in-session fluency promo, helper lines"
```

---

## Task 10: Drill hub — fluency launcher card

**Files:**
- Modify: `apps/web/app/(dashboard)/drill/_components/drill-hub.tsx`
- Possibly delete: `apps/web/app/(dashboard)/drill/_components/fluency-promo.tsx` (if unused after Task 9)
- Test: `drill-hub` test (extend)

- [ ] **Step 1: Read `drill-hub.tsx`** to capture the existing launcher-card pattern (quick drill / dictation / free writing / conjugation).

- [ ] **Step 2: Add a `fluency` launcher** matching the existing card pattern, linking to `/fluency`, framed "timed drills on what you already know". Place it after conjugation. Use the same card component/markup the others use (ink primary or `chip` per the existing hub convention — match siblings; do not introduce a terracotta CTA).

- [ ] **Step 3: Delete `fluency-promo.tsx` if now unused.**

```bash
grep -rn 'fluency-promo\|FluencyPromo' apps/web --include=*.tsx
```
If no references remain, `git rm apps/web/app/(dashboard)/drill/_components/fluency-promo.tsx` and remove its test if any.

- [ ] **Step 4: Update the `drill-hub` test** to assert a fluency launcher linking to `/fluency` is present.

- [ ] **Step 5: Run tests.** `pnpm --filter @language-drill/web test -- drill-hub` → PASS.

- [ ] **Step 6: Commit.**

```bash
git add -A apps/web/app/\(dashboard\)/drill
git commit -m "feat(drill): relocate fluency to a drill-hub launcher card"
```

---

## Task 11: Drill — coach nudge inside the feedback card

**Files:**
- Modify: `apps/web/app/(dashboard)/drill/_components/feedback-shell.tsx`
- Test: `feedback-shell` test (extend)

**Interfaces:**
- Consumes: the per-item weak-spot signal already threaded into the session (the same `useInsightsErrors()`/coach data that drove the old coach headline). Read `feedback-shell.tsx` + its parent to find the prop carrying the current item's grammar point + coach note.

- [ ] **Step 1: Read `feedback-shell.tsx` and its caller** to identify (a) the current grammar point key, (b) the coach note/tag for it, (c) whether it's a known weak spot.

- [ ] **Step 2: Render a coach block when the item is a weak spot.** At the bottom of the feedback card, gated on `isWeakSpot`:

```tsx
{coach && (
  <div className="mt-s-6 flex items-start gap-s-3 border-t border-rule pt-s-5">
    <span className="relative mt-[2px] h-[34px] w-[34px] flex-shrink-0 rounded-full bg-ink
      after:absolute after:bottom-[8px] after:left-1/2 after:h-[3px] after:w-[14px]
      after:-translate-x-1/2 after:rounded-[2px] after:bg-accent after:content-['']" />
    <div>
      <span className="t-micro block text-accent-2">{coach.tag}</span>
      <p className="mt-1 t-body text-ink-2">{coach.note}</p>
    </div>
  </div>
)}
```
Wire `coach`/`isWeakSpot` from the props identified in Step 1. When not a weak spot, render nothing.

- [ ] **Step 3: Extend the test** — coach block shows when a weak-spot coach note is provided, hidden otherwise.

- [ ] **Step 4: Run tests.** `pnpm --filter @language-drill/web test -- feedback` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/web/app/(dashboard)/drill/_components/feedback-shell.tsx <tests>
git commit -m "feat(drill): surface coach nudge inside the feedback card on weak spots"
```

---

## Task 12: Drill — detached cloze underline with feedback colors

**Files:**
- Modify: `apps/web/app/(dashboard)/drill/_components/cloze-exercise.tsx`
- Test: `cloze-exercise` test (extend)

- [ ] **Step 1: Read `cloze-exercise.tsx`** to find the gap input + its current underline styling.

- [ ] **Step 2: Detach the underline from the box.** Wrap the input in a relative `gapwrap` span and render the underline as a `::after`-style element offset below the box (gap ~9px). Use a small scoped element or Tailwind `after:`:
  - Box: white `bg-card border border-rule rounded-r-sm shadow-1` (unchanged from the box look).
  - Underline (the wrapper's `after`): `after:absolute after:left-0 after:right-0 after:-bottom-[9px] after:h-[2px] after:rounded-[2px] after:content-['']`, color by state:
    - rest/filled → `after:bg-accent`
    - correct → `after:bg-ok`
    - wrong → `after:bg-accent-2`
  - Gap text color: filled `text-accent-2`, correct `text-ok`, wrong `text-accent-2`.
  Drive state from the existing correctness/feedback flag in the component.

- [ ] **Step 3: Extend the test** — after a correct submission the underline carries the `ok` color class; after a wrong one, the `accent-2` color class.

- [ ] **Step 4: Run tests.** `pnpm --filter @language-drill/web test -- cloze` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/web/app/(dashboard)/drill/_components/cloze-exercise.tsx <tests>
git commit -m "feat(drill): detach cloze underline, recolor green/terracotta on feedback"
```

---

## Task 13: Drill — compact right-aligned desktop submit

**Files:**
- Modify: `apps/web/app/(dashboard)/drill/_components/exercise-pane.tsx` (or the submit-row owner) and `cloze-exercise.tsx`/`translation-exercise.tsx`/`conjugation-exercise.tsx` as needed
- Test: drill integration test

- [ ] **Step 1: Find the submit-row.** Locate the full-width submit bar on desktop. Read the relevant exercise components.

- [ ] **Step 2: Make it compact + right-aligned on desktop.** Wrap the submit button in `<div className="mt-s-6 flex justify-end">` and drop the full-width (`w-full`/`full`) modifier on desktop (keep mobile's existing action row `item N of M` / button layout intact — only desktop changes). Button stays `variant="primary"`. This mirrors the feedback "next →" placement.

- [ ] **Step 3: Update the drill integration test** if it asserts a full-width submit; assert the submit button is present and primary.

- [ ] **Step 4: Run tests.** `pnpm --filter @language-drill/web test -- drill` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add -A apps/web/app/\(dashboard\)/drill
git commit -m "feat(drill): compact right-aligned desktop submit"
```

---

## Task 14: Drill results — merge debrief + review into one scroll

**Files:**
- Modify: `apps/web/app/(dashboard)/drill/debrief/[sessionId]/page.tsx`, `debrief/_components/skill-movements-panel.tsx`, `review-item-card.tsx`
- Delete (if unused after): `debrief/_components/debrief-tabs.tsx`
- Test: debrief integration test

- [ ] **Step 1: Read the debrief page + its three components** to capture data wiring (skill movements, per-item correctness, explanations) and the tab switcher.

- [ ] **Step 2: Remove the tab switcher; compose a single scroll** in `page.tsx`:
  1. Summary head: eyebrow `session done · MM:SS`, H1 verdict (`t-display-xl`), `you got X of N · accuracy P%`.
  2. `<SkillMovementsPanel … />` reworked as the **"what moved"** card: ▼ slipped / ▲ gained rows + "N skills held steady" (prototype `.moved`).
  3. The **review list** of `<ReviewItemCard … />` for each item.

- [ ] **Step 3: Desktop review cards full-width + 2-column diff.** In `review-item-card.tsx`: header row = topic chip (`<Chip variant="default">`) + correct/missed badge (`<Chip variant="ok">`/`<Chip variant="accent">`) + chevron; expanded body = two-column `your answer` / `corrected` diff on desktop (`grid grid-cols-2 gap-s-4`), single-column on mobile. Keep the existing correctness + explanation data.

- [ ] **Step 4: Results action row + button hierarchy.** Primary `practice more`, ghost `done`, and a `see your progress →` `.link-arrow`. Desktop: link left, `[ghost done][primary practice more]` right (`flex items-center justify-between`). Mobile: stacked primary, ghost, then centered link.

- [ ] **Step 5: Delete `debrief-tabs.tsx` if unused.**

```bash
grep -rn 'debrief-tabs\|DebriefTabs' apps/web --include=*.tsx
```
If only the definition remains, `git rm` it and its test.

- [ ] **Step 6: Update the debrief integration test** — no tab switcher; "what moved" card + review list both visible in one scroll; action buttons present with correct variants.

- [ ] **Step 7: Run tests.** `pnpm --filter @language-drill/web test -- debrief` → PASS.

- [ ] **Step 8: Commit.**

```bash
git add -A apps/web/app/\(dashboard\)/drill/debrief
git commit -m "feat(drill): merge debrief + review into a single results scroll"
```

---

## Task 15: Progress map — row chevron affordance

**Files:**
- Modify: `apps/web/app/(dashboard)/progress/_components/map-tab.tsx`
- Test: `map-tab` test (extend)

- [ ] **Step 1: Read `map-tab.tsx`** to find the grammar-point row markup (the click target that opens `PointDetailSheet`).

- [ ] **Step 2: Add a trailing chevron** to each row: `<span aria-hidden className="ml-auto flex-shrink-0 self-start mt-[6px] text-[22px] leading-none text-rule-strong transition-all group-hover:text-ink-mute group-hover:translate-x-[3px]">›</span>` (add `group` to the row container if not present). Keep the whole row as the button/click target.

- [ ] **Step 3: Extend the test** — each point row renders a chevron and remains clickable (opens the sheet).

- [ ] **Step 4: Run tests.** `pnpm --filter @language-drill/web test -- map-tab` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/web/app/(dashboard)/progress/_components/map-tab.tsx <tests>
git commit -m "feat(progress): chevron affordance on grammar-point rows"
```

---

## Task 16: Progress drawer — button system + mastery/confidence

**Files:**
- Modify: `apps/web/app/(dashboard)/progress/_components/point-detail-sheet.tsx`
- Create: `apps/web/app/(dashboard)/progress/_components/confidence-band.ts` (pure helper)
- Test: `apps/web/app/(dashboard)/progress/_components/__tests__/confidence-band.test.ts` (new) + extend sheet test

**Interfaces:**
- Produces: `confidenceBand(conf: number): { label: string }` — `≥70 → 'high confidence'`, `40–69 → 'building confidence'`, `<40 → 'low confidence'`. Input is the same 0–100 confidence value the drawer already displays.

- [ ] **Step 1: Write the failing helper test.** `confidence-band.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { confidenceBand } from '../confidence-band';

describe('confidenceBand', () => {
  it('maps high', () => expect(confidenceBand(88).label).toBe('high confidence'));
  it('maps boundary 70 as high', () => expect(confidenceBand(70).label).toBe('high confidence'));
  it('maps building', () => expect(confidenceBand(55).label).toBe('building confidence'));
  it('maps boundary 40 as building', () => expect(confidenceBand(40).label).toBe('building confidence'));
  it('maps low', () => expect(confidenceBand(18).label).toBe('low confidence'));
});
```

- [ ] **Step 2: Run it — fails** (module missing). `pnpm --filter @language-drill/web test -- confidence-band` → FAIL.

- [ ] **Step 3: Implement the helper.** `confidence-band.ts`:

```ts
// Converts the 0–100 Bayesian confidence value into a qualitative band so the
// drawer reads in plain language instead of a misleading raw percentage.
export function confidenceBand(conf: number): { label: string } {
  if (conf >= 70) return { label: 'high confidence' };
  if (conf >= 40) return { label: 'building confidence' };
  return { label: 'low confidence' };
}
```

- [ ] **Step 4: Run it — passes.** Expected: PASS (5).

- [ ] **Step 5: Apply the drawer changes.** In `point-detail-sheet.tsx`:
  - **Buttons:** `mixed drill — adapts to your weak spots` → `<Button variant="primary" className="w-full">`. The `cloze` / `translation` mode buttons → `<Button variant="ghost">` (were white-filled). `read the theory →` → `<button className="link-arrow">read the theory →</button>` (was a dashed-border button).
  - **Mastery:** keep the `%` value/bar; add a one-line hint below the stats: `<p className="t-small text-ink-mute mt-s-2">mastery = your recent accuracy on this point, weighted by difficulty &amp; recency</p>`.
  - **Confidence:** replace the raw `%` display with `confidenceBand(conf).label` (use `<Chip variant="default">` or plain text where the `%` was). Keep evidence count unchanged.

- [ ] **Step 6: Extend the sheet test** — mixed drill is a primary button, mode buttons are ghost, theory is a `.link-arrow`, confidence shows the band label not a raw `%`, mastery hint present.

- [ ] **Step 7: Run tests.** `pnpm --filter @language-drill/web test -- point-detail confidence-band` → PASS.

- [ ] **Step 8: Commit.**

```bash
git add apps/web/app/(dashboard)/progress/_components/point-detail-sheet.tsx apps/web/app/(dashboard)/progress/_components/confidence-band.ts apps/web/app/(dashboard)/progress/_components/__tests__/confidence-band.test.ts
git commit -m "feat(progress): drawer button system + mastery hint + confidence band"
```

---

## Task 17: Content consistency — "work on these" single source

**Files:**
- Inspect: `apps/web/app/(dashboard)/_components/work-on-these.tsx` and its three call sites (home page, drill hub, progress map-tab)
- Test: `work-on-these` test (extend)

- [ ] **Step 1: Confirm one source + identical slicing.** Verify all three call sites pass `useInsightsErrors().data?.themes ?? []` and the component applies the same `MAX_ITEMS` (3) and ordering. Read the component + the three callers.

- [ ] **Step 2: Normalize any divergence.** If a call site sorts/slices differently before passing themes, remove that local transform so the component is the single place that limits to 3. Do **not** introduce hardcoded sample data.

- [ ] **Step 3: Add a regression test** — given the same `themes` input, the component renders the same first-3 items regardless of caller (a render-equality test on the component with a fixed themes array).

- [ ] **Step 4: Run tests.** `pnpm --filter @language-drill/web test -- work-on-these` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/web/app/(dashboard)/_components/work-on-these.tsx <call sites if changed> <tests>
git commit -m "fix(insights): work-on-these renders identically from one shared source"
```

---

## Task 18: Full gate + Next build + visual verification

**Files:** none (verification + fixups only)

- [ ] **Step 1: Lint.** `cd` worktree; `pnpm lint` → fix any issues; re-run until clean.

- [ ] **Step 2: Typecheck.** `pnpm typecheck` → clean.

- [ ] **Step 3: Full test suite.** `pnpm test` → 0 failures. (Note: if stale compiled test artifacts surface phantom failures, `rm -rf infra/lambda/dist` is unrelated to this web work — but this plan only touches `apps/web`, so failures here are real; root-cause them.) Report `X passed, Y failed`.

- [ ] **Step 4: Next build (the pre-push gate does NOT run this).** `pnpm --filter @language-drill/web build` → must succeed. Fix any prerender / `useSearchParams` Suspense errors (the drill page already uses Suspense — preserve it).

- [ ] **Step 5: Visual harness check.** Because Clerk blocks rendering `/` locally without real dev keys, render the changed page components in isolation via the tsc-transpile + Playwright harness pattern (per the project's `verify-landing-without-clerk` approach) and screenshot: Home header + segmented control + Next Up card; Drill session (inline dots, detached cloze underline, in-card coach, compact submit); merged debrief; Progress map chevrons + drawer (ghost mode buttons, theory link, confidence band). Eyeball against the prototypes.

- [ ] **Step 6: e2e (if label/route assertions touched).** `pnpm --filter @language-drill/web test:e2e` (authenticated project mocks `**/profiles/languages`). Update any nav-label or debrief-tab assertions.

- [ ] **Step 7: Final commit (any gate fixups).**

```bash
git add -A
git commit -m "chore(ui): design-system polish — lint/typecheck/test/build green"
```

---

## Self-Review (completed)

- **Spec coverage:** §2 foundations → Tasks 1–2; §3 nav → Task 3; §4 Home → Tasks 4–7; §5 Drill (layout/coach/fluency/cloze/submit/debrief) → Tasks 8–14; §6 Progress → Tasks 15–16; §7 mobile parity → folded into each task (mobile classes specified); §8 work-on-these → Task 17; §9 testing/build → Task 18. No gaps.
- **Type consistency:** `ButtonVariant` loses `accent` (Tasks 2 + downstream usages migrated); `confidenceBand` signature is defined once (Task 16) and used in the same task; `NavDestination.mobileLabel` defined + consumed in Task 3.
- **Placeholders:** code shown for every code step that introduces new content; component tasks that must match unread current markup begin with an explicit "read the file" step before the targeted, fully-specified edit (target classes/markup given) — this is read-then-edit, not a deferred TODO.
- **Decisions honored:** fluency = drill-hub only (Task 10, removed from session Task 9); mastery %+hint / confidence band (Task 16); all four structural changes (greeting Task 4, dormant rail Task 8, debrief merge Task 14, nav rename Task 3).
