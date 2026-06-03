# Implementation Plan

## Task Overview

Responsive reflow of `apps/web` at a single ≤760px breakpoint, built bottom-up: a foundation (breakpoint constant + `useIsMobile` hook + CSS variant/overrides), shared primitives (BottomSheet, promoted hooks, mobile shell pieces, drill action-bar context), then per-screen reflows. Most screen tasks are CSS-only (`mobile:` variant); a minority swap the DOM tree via `useIsMobile`. Each task is atomic (1–3 files), ships co-located Vitest coverage, and preserves the desktop layout (≥761px) unchanged.

All paths are relative to `apps/web/`.

## Steering Document Compliance

- Route-scoped components stay in `app/(dashboard)/<route>/_components/`; cross-cutting primitives in `components/ui/`; shell pieces in `components/shell/`; shared hooks in `lib/hooks/`. Matches observed conventions (no `structure.md`).
- Tailwind v4 CSS-config (`@theme`/`@custom-variant` in `globals.css`), bespoke `components/ui` primitives, tokens-as-CSS-vars — per tech.md's actual implementation. No new dependencies (CLAUDE.md package policy).
- Co-located `__tests__/*.test.tsx` run by Vitest; pre-push `pnpm lint && pnpm typecheck && pnpm test` (CLAUDE.md).

## Atomic Task Requirements
Each task touches 1–3 files, is completable in 15–30 min, has one testable outcome, names exact files, and references requirements + code to leverage.

## Tasks

### 1. Foundation

- [x] 1.1 Create breakpoint constant + `useIsMobile` hook in `lib/responsive.ts`
  - File: `lib/responsive.ts`, `lib/__tests__/responsive.test.ts`
  - Export `MOBILE_MAX_WIDTH = 760`, `MOBILE_MEDIA_QUERY = '(max-width: 760px)'`, and `useIsMobile()` using `useSyncExternalStore` (React 19) with `getServerSnapshot` → `false`; subscribe to `window.matchMedia(MOBILE_MEDIA_QUERY)`; return `false` when `matchMedia` is undefined
  - Test: SSR-safe default `false`, reconcile-on-mount when query matches, update on change event, graceful fallback when `matchMedia` absent (mock `window.matchMedia`)
  - Purpose: Single source of breakpoint truth + SSR-safe viewport branching for all DOM-tree swaps
  - _Leverage: lib/cn.ts (test setup patterns), vitest.setup.ts_
  - _Requirements: 1.1, 1.6; NFR Performance, Reliability_

- [x] 1.2 Add mobile `@custom-variant` + type-scale/spacing overrides in `app/globals.css`
  - File: `app/globals.css`
  - Add `@custom-variant mobile (@media (max-width: 760px));`; add a `@media (max-width: 760px)` block overriding `.t-display-xl` (34px/1.2), `.t-display-l` (28px/1.2), `.t-display-m` (22px/1.2); leave body/small/micro/mono unchanged
  - Purpose: Enable the `mobile:` utility prefix project-wide and shrink display type per the brief
  - _Leverage: app/globals.css (existing @theme + .t-display-* classes)_
  - _Requirements: 1.1, 1.3, 1.4_

- [x] 1.3 Promote sheet hooks to `lib/hooks/` and widen the focus-trap selector
  - File: `lib/hooks/use-body-scroll-lock.ts`, `lib/hooks/use-focus-trap.ts`, `lib/hooks/use-scroll-spy.ts` (move from `components/theory/`, move their `__tests__` too), update imports in `components/theory/theory-panel.tsx` + `components/theory/index.ts`
  - Widen `useFocusTrap` `FOCUSABLE_SELECTOR` to include `textarea, select, input:not([type="hidden"])`
  - Test: existing theory hook tests pass at new path; add a case asserting an `input`/`textarea` is now trapped
  - Purpose: Make scroll-lock/focus-trap/scroll-spy reusable by every sheet without duplication
  - _Leverage: components/theory/use-body-scroll-lock.ts, use-focus-trap.ts, use-scroll-spy.ts (+ tests)_
  - _Requirements: 11.2_

### 2. Shared primitives

- [x] 2.1 Create `BottomSheet` primitive + sheet keyframes
  - File: `components/ui/bottom-sheet.tsx`, `components/ui/__tests__/bottom-sheet.test.tsx`, `app/globals.css` (keyframes + reduced-motion)
  - Portal to `document.body`; scrim `rgba(26,22,18,0.42)`; slide-up panel (24px top radius, drag handle, optional sticky header + close); `maxHeight` default `78vh`, `fullScreen` ~`92vh`; close on scrim/close/`Escape`; `role="dialog"` + `ariaLabel`; add `sheet-slide`/`sheet-fade` keyframes to globals and extend the existing `prefers-reduced-motion` block
  - Test: open renders children + scrim; scrim click, close button, and Escape call `onClose`; scroll-lock active while open; focus trapped; `aria-label` present
  - Purpose: The one reusable bottom sheet for language/theory/word/bank
  - _Leverage: lib/hooks/use-body-scroll-lock, lib/hooks/use-focus-trap (from 1.3), app/globals.css (prefers-reduced-motion block ~L495)_
  - _Requirements: 3.1, 3.4, 6.1, 8.2, 8.7, 11.2, 11.3_

- [x] 2.2 Export `BottomSheet` from the UI barrel
  - File: `components/ui/index.ts`
  - Add `export { BottomSheet } from './bottom-sheet';` (+ its prop type)
  - Purpose: Consistent import surface for downstream sheet consumers
  - _Leverage: components/ui/index.ts_
  - _Requirements: 3.1_

### 3. Shell (top app-bar + bottom tab-bar)

- [x] 3.1 Extract `NAV_DESTINATIONS` and refactor `NavItems` to consume it
  - File: `components/shell/nav-items.tsx`, `components/shell/__tests__/nav-items.test.tsx` (new)
  - Export a `NAV_DESTINATIONS` array (`{ href, label, icon }` for today/drill/read/progress); have `NavItems` map over it; no visual change
  - Test: `NavItems` still renders all four links with correct hrefs/labels
  - Purpose: Single source of nav truth shared by desktop rail and mobile tab-bar
  - _Leverage: components/shell/nav-items.tsx, nav-icons.tsx, nav-item.tsx_
  - _Requirements: 2.2, 2.4_

- [x] 3.2 Create `MobileTabBar`
  - File: `components/shell/mobile-tab-bar.tsx`, `components/shell/__tests__/mobile-tab-bar.test.tsx`
  - ~64px fixed bar mapping `NAV_DESTINATIONS` to icon + 10px label buttons; active via `usePathname` (mirror `NavItem` active logic, root `/` exact); each tab ≥44px tall; `aria-current` on active
  - Test: renders four destinations; active reflects mocked pathname; tap navigates (Link/href present)
  - Purpose: Thumb-reachable primary nav at phone width (Req 2.2–2.4)
  - _Leverage: components/shell/nav-items.tsx (NAV_DESTINATIONS), nav-icons.tsx, nav-item.tsx (active logic)_
  - _Requirements: 2.2, 2.3, 2.4, 11.1, 11.4_

- [x] 3.3 Create `LanguageSheet`
  - File: `components/shell/language-sheet.tsx`, `components/shell/__tests__/language-sheet.test.tsx`
  - `BottomSheet` listing learning profiles (Flagdot + name + proficiency badge + selected dot); select → `setActiveLanguage` + close; include "manage languages →" link to `/onboarding?edit=1`; `listbox`/`option` semantics
  - Test: lists profiles; select calls `setActiveLanguage` + closes; "manage languages" link present
  - Purpose: Touch-friendly language switching (Req 3.1, 3.3, 3.5)
  - _Leverage: components/ui/bottom-sheet (2.1), components/shell/active-language-provider.tsx (useActiveLanguage), flagdot.tsx, language-switcher.tsx (profile-filtering logic)_
  - _Requirements: 3.1, 3.3, 3.4, 3.5, 11.4_

- [x] 3.4 Create `MobileTopBar`
  - File: `components/shell/mobile-top-bar.tsx`, `components/shell/__tests__/mobile-top-bar.test.tsx`
  - 52px sticky bar: brand mark + compact language pill (opens `LanguageSheet`; disabled/no-sheet when single language) + avatar; pill shows active flag + name + level
  - Test: renders brand + pill + avatar; tapping pill opens the sheet; single-language pill does not open a sheet
  - Purpose: Top chrome at phone width (Req 2.1, 3.1, 3.2)
  - _Leverage: components/shell/brand.tsx, flagdot.tsx, user-footer.tsx, language-sheet.tsx (3.3), active-language-provider.tsx_
  - _Requirements: 2.1, 3.1, 3.2, 11.1_

- [x] 3.5 Branch `AppShell` between desktop rail and mobile chrome
  - File: `components/shell/app-shell.tsx`, `components/shell/__tests__/app-shell.test.tsx` (new)
  - `useIsMobile()`: desktop → existing `<Nav>` + centered `<main>` (unchanged); mobile → `<MobileTopBar>` + scrollable `<main className="px-[18px] …">` with bottom padding for the tab-bar + `<MobileTabBar>`; export the barrel additions in `components/shell/index.ts`
  - Test: `useIsMobile` mocked true → top bar + tab-bar present, rail absent; mocked false → rail present, bars absent
  - Purpose: One seam reflows chrome for every screen (Req 2.1, 2.5, 2.6)
  - _Leverage: lib/responsive (1.1), components/shell/nav.tsx, mobile-top-bar.tsx (3.4), mobile-tab-bar.tsx (3.2), index.ts_
  - _Requirements: 2.1, 2.5, 2.6, 1.5, 12.3, 12.4_

### 4. Drill (cloze · translation · vocab)

- [x] 4.1 Create `DrillActionContext` (provider + hook)
  - File: `app/(dashboard)/drill/_components/drill-action-context.tsx`, `app/(dashboard)/drill/_components/__tests__/drill-action-context.test.tsx`
  - Define `DrillPrimaryAction`, context value (`active`, `primaryAction`, `setPrimaryAction`, `meta`, `setMeta`); `DrillActionProvider` takes `active` prop; `useDrillAction()` hook returns a safe default (`active:false`, no-op setters) when no provider
  - Test: provider exposes/updates action + meta; hook outside provider returns inert default
  - Purpose: Let exercises publish their primary CTA to a sticky bar on mobile only
  - _Leverage: app/(dashboard)/drill/_components/session-reducer.ts (meta shape)_
  - _Requirements: 5.4_

- [x] 4.2 Create `DrillActionBar`
  - File: `app/(dashboard)/drill/_components/drill-action-bar.tsx`, `app/(dashboard)/drill/_components/__tests__/drill-action-bar.test.tsx`
  - Sticky bottom bar: `meta` ("item N of M") left, primary `<Button>` (label/onClick/disabled/loading/variant) right; renders a disabled placeholder when `primaryAction` is null; ≥44px controls
  - Test: shows meta + primary; null action → disabled placeholder; click fires onClick; loading/disabled map through
  - Purpose: The sticky check/next bar replacing the tab-bar during a drill (Req 5.4)
  - _Leverage: drill-action-context (4.1), components/ui/button.tsx_
  - _Requirements: 5.4, 11.1_

- [x] 4.3 Create `SessionDots`
  - File: `app/(dashboard)/drill/_components/session-dots.tsx`, `app/(dashboard)/drill/_components/__tests__/session-dots.test.tsx`
  - Horizontal scrollable dot/number row from `{ current, total }`; past = check, current = filled ink, future = muted
  - Test: renders `total` dots; marks current/past states
  - Purpose: Horizontal session position indicator above the prompt (Req 5.2)
  - _Leverage: app/(dashboard)/drill/_components/session-reducer.ts (selectors)_
  - _Requirements: 5.2_

- [x] 4.4 Create `CoachCard` (collapsible mobile coach)
  - File: `app/(dashboard)/drill/_components/coach-card.tsx`, `app/(dashboard)/drill/_components/__tests__/coach-card.test.tsx`
  - Collapsible card (paper-2, ink "c" avatar) rendering the coach message; collapsed/expanded toggle
  - Test: renders message; toggles collapse
  - Purpose: Coach rail → top card at phone width (Req 5.1)
  - _Leverage: app/(dashboard)/drill/_components/coach-rail.tsx (message rendering)_
  - _Requirements: 5.1_

- [x] 4.5 Add mobile branch to `DrillLayout`
  - File: `app/(dashboard)/drill/_components/drill-layout.tsx`, `app/(dashboard)/drill/_components/__tests__/drill-layout.test.tsx`
  - Replace `[@media(min-width:900px)]:grid-cols-[280px_1fr]` with canonical `mobile:`-driven logic: mobile → single column, no `<aside>` rail, render an `actionBar` slot region at the bottom; desktop → existing grid + rail unchanged; keep the 3px top progress bar
  - Test: mobile (mock `useIsMobile`) → no aside rail, action-bar slot rendered; desktop → aside rail present
  - Purpose: One-column drill with sticky action-bar slot (Req 5.1, 5.4)
  - _Leverage: lib/responsive (1.1), drill-action-bar (4.2), existing drill-layout.tsx_
  - _Requirements: 5.1, 5.4, 12.3_

- [x] 4.6 `ClozeExercise`: publish action on mobile + 1-col options ≥48px
  - File: `app/(dashboard)/drill/_components/cloze-exercise.tsx`, `app/(dashboard)/drill/_components/__tests__/cloze-exercise.test.tsx`
  - When `useDrillAction().active`: publish `{label:'submit'|nextLabel, onClick, disabled, loading}` via effect and skip the inline `<Button>`; else render inline (unchanged). Make MC options `mobile:flex-col` with each `Choice` ≥48px
  - Test: desktop → inline submit button still present (existing tests pass); mobile (mock active) → no inline button, action published; options stack
  - Purpose: Cloze single-column + action-bar integration (Req 5.3, 5.4)
  - _Leverage: drill-action-context (4.1), components/ui/choice.tsx, feedback-shell.tsx_
  - _Requirements: 5.3, 5.4, 11.1_

- [x] 4.7 `TranslationExercise`: publish action on mobile + stacked layout
  - File: `app/(dashboard)/drill/_components/translation-exercise.tsx`, `app/(dashboard)/drill/_components/__tests__/translation-exercise.test.tsx`
  - Same publish-vs-inline pattern; ensure prompt/textarea/accent-picker stack full-width on mobile (already column); keep hint control inline in body
  - Test: desktop inline submit present; mobile publishes action, no inline submit; hint button stays in body
  - Purpose: Translation single-column + action bar above keyboard (Req 5.6, 5.4)
  - _Leverage: drill-action-context (4.1), components/ui/{textarea,accent-picker,button}.tsx_
  - _Requirements: 5.6, 5.4_

- [x] 4.8 `VocabExercise`: publish action on mobile + stacked layout
  - File: `app/(dashboard)/drill/_components/vocab-exercise.tsx`, `app/(dashboard)/drill/_components/__tests__/vocab-exercise.test.tsx`
  - Same publish-vs-inline pattern; term/input/hint chips stack single-column on mobile
  - Test: desktop inline submit present; mobile publishes action; layout stacks
  - Purpose: Vocab single-column + action bar (Req 5.7, 5.4)
  - _Leverage: drill-action-context (4.1), components/ui/{input,button}.tsx_
  - _Requirements: 5.7, 5.4_

- [x] 4.9 `FeedbackShell`: publish "next" on mobile
  - File: `app/(dashboard)/drill/_components/feedback-shell.tsx`, `app/(dashboard)/drill/_components/__tests__/feedback-shell.test.tsx`
  - When `active`: publish `{label:nextLabel, onClick:onNext, variant:'primary'}` and omit the inline next button; else render inline (unchanged); full-width feedback strip on mobile; keep theory trigger reachable
  - Test: desktop inline next present; mobile publishes next action; feedback content/colors unchanged; the existing keyboard Enter-to-advance path still fires `onNext` (Req 5.8)
  - Purpose: Post-check "next" flows through the action bar (Req 5.4, 5.5)
  - _Leverage: drill-action-context (4.1), existing feedback-shell.tsx_
  - _Requirements: 5.4, 5.5, 5.8_

- [x] 4.10 Wire the drill page for mobile (provider + coach card + dots + action bar)
  - File: `app/(dashboard)/drill/page.tsx`, `app/(dashboard)/drill/page.test.tsx`
  - Wrap content in `DrillActionProvider active={useIsMobile()}`; on mobile render `CoachCard` at top of `main` and `SessionDots` above the prompt, pass the `DrillActionBar` into `DrillLayout`'s slot, set `meta`; desktop path unchanged (rail = `CoachRail`)
  - Test: desktop renders `CoachRail`; mobile renders `CoachCard` + `SessionDots` + action bar; submit→next still advances cursor
  - Purpose: Compose the mobile drill experience end-to-end (Req 5.1, 5.2, 5.4)
  - _Leverage: lib/responsive (1.1), drill-action-context (4.1), drill-action-bar (4.2), session-dots (4.3), coach-card (4.4), drill-layout (4.5)_
  - _Requirements: 5.1, 5.2, 5.4, 5.8, 12.3_

### 5. Theory panel

- [x] 5.1 Add theory mobile `@media` reflow to `app/globals.css`
  - File: `app/globals.css`
  - Under `@media (max-width: 760px)`: `.theory-overlay { align-items: flex-end; }`; `.theory-panel { width:100vw; height:92vh; max-height:92vh; border-left:0; border-radius:24px 24px 0 0; }`; `.theory-body { flex-direction:column; }`; `.theory-toc { width:100%; border-right:0; border-bottom:1px solid var(--color-rule); overflow-x:auto; }` with its `ul` as a horizontal row; add a slide-up animation variant + reduced-motion guard
  - Purpose: Right slide-over → full-screen bottom sheet (Req 6.1, 6.2)
  - _Leverage: app/globals.css (.theory-* classes, prefers-reduced-motion block)_
  - _Requirements: 6.1, 6.2, 6.5, 11.3_

- [x] 5.2 `TheoryToc`: horizontal tab strip on mobile
  - File: `components/theory/theory-toc.tsx`, `components/theory/__tests__/theory-toc.test.tsx`
  - Branch on `useIsMobile()`: desktop → existing vertical sidebar; mobile → horizontal scrollable tab strip (section buttons in a row, active highlighted); keep jump-to-section + active-section props
  - Test: mobile renders a horizontal strip; desktop renders the sidebar; clicking a tab calls `onJump`; active section highlighted
  - Purpose: TOC sidebar → tab strip with scroll-sync preserved (Req 6.2, 6.3)
  - _Leverage: lib/responsive (1.1), components/theory/theory-toc.tsx, theory-panel.tsx (useScrollSpy wiring)_
  - _Requirements: 6.2, 6.3, 6.4, 6.5_

### 6. Read & collect

- [x] 6.1 Extract `WordCardBody` from `WordPopover`
  - File: `app/(dashboard)/read/_components/word-card-body.tsx`, `app/(dashboard)/read/_components/word-popover.tsx`, `app/(dashboard)/read/_components/__tests__/word-popover.test.tsx`
  - Lift the popover's header/body/footer markup into `WordCardBody` (props: entry, word, inBank, onSave, onSkip); `WordPopover` renders the body inside its positioned shell (desktop behavior unchanged)
  - Test: existing popover tests pass; `WordCardBody` renders lemma/POS/CEFR/gloss/example/freq + save/skip
  - Purpose: Share identical word-card content between popover and sheet
  - _Leverage: app/(dashboard)/read/_components/word-popover.tsx, components/ui/button.tsx_
  - _Requirements: 8.2_

- [x] 6.2 Create `WordSheet`
  - File: `app/(dashboard)/read/_components/word-sheet.tsx`, `app/(dashboard)/read/_components/__tests__/word-sheet.test.tsx`
  - `BottomSheet` (~50vh) wrapping `WordCardBody`; save/skip wired to props
  - Test: renders word-card content; save/skip fire; closes on scrim/Escape
  - Purpose: Word card as a bottom sheet on mobile (Req 8.2, 8.7)
  - _Leverage: components/ui/bottom-sheet (2.1), word-card-body (6.1)_
  - _Requirements: 8.2, 8.7_

- [x] 6.3 Create `WordBankSheet`
  - File: `app/(dashboard)/read/_components/word-bank-sheet.tsx`, `app/(dashboard)/read/_components/__tests__/word-bank-sheet.test.tsx`
  - `BottomSheet` wrapping the `WordBankRail` list content; `IntensityToggle` in the sheet header
  - Test: renders bank rows + intensity toggle; remove fires; closes
  - Purpose: Word bank rail → sheet with intensity toggle in header (Req 8.1, 8.3)
  - _Leverage: components/ui/bottom-sheet (2.1), word-bank-rail.tsx, intensity-toggle.tsx_
  - _Requirements: 8.1, 8.3, 8.7_

- [x] 6.4 `AnnotatedView`: mobile branch (chip + sheets)
  - File: `app/(dashboard)/read/_components/annotated-view.tsx`, `app/(dashboard)/read/_components/__tests__/annotated-view.test.tsx`
  - Branch on `useIsMobile()`: desktop → existing 2-col grid + `WordPopover` + sticky `WordBankRail` (unchanged); mobile → single column, a toolbar chip ("word bank · N") opens `WordBankSheet`, word tap opens `WordSheet` (not the popover), intensity toggle hosted in the bank sheet header
  - Test: desktop renders popover + rail; mobile renders chip + opens `WordSheet` on word click and `WordBankSheet` on chip click; reducer `activeWord` reused
  - Purpose: Reader reflow with sheets (Req 8.1, 8.2, 8.3)
  - _Leverage: lib/responsive (1.1), word-sheet (6.2), word-bank-sheet (6.3), _state/read-page-reducer.ts_
  - _Requirements: 8.1, 8.2, 8.3_

- [x] 6.5 `SaveToast`: mobile inset
  - File: `app/(dashboard)/read/_components/save-toast.tsx`, `app/(dashboard)/read/_components/__tests__/save-toast.test.tsx`
  - Add `mobile:` classes so the toast insets from screen edges (no overflow) and stays above the tab-bar/action area; desktop centered toast unchanged
  - Test: renders content; mobile inset classes present (class assertion)
  - Purpose: Toast fits the phone viewport (Req 8.6)
  - _Leverage: app/(dashboard)/read/_components/save-toast.tsx_
  - _Requirements: 8.6_

- [x] 6.6 Paste / empty / history read views full-width on mobile
  - File: `app/(dashboard)/read/_components/paste-view.tsx`, `app/(dashboard)/read/_components/empty-view.tsx`, `app/(dashboard)/read/_components/history-view.tsx` (+ update the affected co-located `__tests__`)
  - Ensure the paste view (title input + passage textarea + char counter + action row), the empty view, and the history cards stack full-width on mobile with the canonical 18px gutters; preserve the existing char-limit/disabled behavior and the `read-top-bar` actions; desktop max-width columns unchanged
  - Test: mobile applies full-width/stacked classes for each view; char-limit disabled behavior unchanged; desktop columns unchanged
  - Purpose: Reader paste/empty/history reflow (Req 8.4, 8.5)
  - _Leverage: app/(dashboard)/read/_components/paste-view.tsx, empty-view.tsx, history-view.tsx, read-top-bar.tsx_
  - _Requirements: 8.4, 8.5_

### 7. Debrief / feedback

- [x] 7.1 Debrief stat cards → snap-scroll + condensed skill bars _(N/A — the implemented debrief has no stat-card grid or skill-impact bars; stats are a header text line and `DebriefTab` is a coach card + callout. The debrief page already stacks single-column full-width, so Req 7.1 is satisfied. Per user decision, no fabricated UI.)_
  - File: `app/(dashboard)/drill/debrief/_components/debrief-tab.tsx`, `app/(dashboard)/drill/debrief/_components/__tests__/debrief-tab.test.tsx`
  - Stat-card container → `mobile:` horizontal snap-scroll (`overflow-x-auto snap-x snap-mandatory`); skill-impact bars condense to one track per skill with before→after labels at mobile; desktop grid unchanged
  - Test: mobile applies snap-scroll classes; skill bars render condensed; desktop unchanged
  - Purpose: Debrief stats/skill bars reflow (Req 7.2, 7.3)
  - _Leverage: app/(dashboard)/drill/debrief/_components/debrief-tab.tsx, components/ui/bar.tsx_
  - _Requirements: 7.2, 7.3_

- [x] 7.2 `DebriefFooter` → sticky mobile action bar
  - File: `app/(dashboard)/drill/debrief/_components/debrief-footer.tsx`, `app/(dashboard)/drill/debrief/_components/__tests__/debrief-footer.test.tsx`
  - On mobile, footer becomes a sticky bottom bar holding primary "next session" + secondary actions; desktop footer unchanged; controls ≥44px
  - Test: mobile sticky classes + actions present; desktop layout unchanged
  - Purpose: Debrief action footer reflow (Req 7.5)
  - _Leverage: app/(dashboard)/drill/debrief/_components/debrief-footer.tsx, components/ui/button.tsx_
  - _Requirements: 7.5, 7.1, 11.1_

- [x] 7.3 Reconcile `review-item-card` grid to the canonical breakpoint
  - File: `app/(dashboard)/drill/debrief/_components/review-item-card.tsx`, `app/(dashboard)/drill/debrief/_components/__tests__/review-item-card.test.tsx`
  - Replace `md:grid-cols-2` with canonical mobile-driven 1-col ≤760 / 2-col above; keep expand/collapse behavior
  - Test: existing expand/collapse tests pass; grid uses canonical classes
  - Purpose: One breakpoint for review rows (Req 7.4, 1.6)
  - _Leverage: app/(dashboard)/drill/debrief/_components/review-item-card.tsx_
  - _Requirements: 7.4, 1.6_

### 8. Progress

- [x] 8.1 `RadarChart` mobile size clamp
  - File: `app/(dashboard)/progress/_components/radar-chart.tsx`, `app/(dashboard)/progress/_components/__tests__/radar-chart.test.tsx`
  - Clamp rendered width to `min(320px, 100%)` and center at mobile; keep SVG aspect/labels legible; desktop size unchanged
  - Test: mobile applies clamped width; desktop unchanged; labels present
  - Purpose: Radar fits a 320px square (Req 9.1)
  - _Leverage: app/(dashboard)/progress/_components/radar-chart.tsx_
  - _Requirements: 9.1_

- [x] 8.2 `HeatmapGrid` mobile cell sizing
  - File: `app/(dashboard)/progress/_components/heatmap-grid.tsx`, `app/(dashboard)/progress/_components/__tests__/heatmap-grid.test.tsx`
  - Reduce day-cell size to ~10–12px and left-align row/topic labels at smaller font on mobile without clipping; desktop unchanged
  - Test: mobile cell-size/label classes applied; desktop unchanged
  - Purpose: Heatmap squeezes to phone width (Req 9.3)
  - _Leverage: app/(dashboard)/progress/_components/heatmap-grid.tsx_
  - _Requirements: 9.3_

- [x] 8.3 `ShapeTab` / side cards + skill cards stack
  - File: `app/(dashboard)/progress/_components/shape-tab.tsx`, `app/(dashboard)/progress/_components/shape-side-cards.tsx`, `app/(dashboard)/progress/_components/__tests__/shape-tab.test.tsx`
  - Stack side cards below the radar and skill detail cards to a single column at mobile; desktop multi-column unchanged
  - Test: mobile applies single-column classes; desktop unchanged
  - Purpose: Progress side/skill cards stack (Req 9.2, 9.4, 9.5)
  - _Leverage: app/(dashboard)/progress/_components/shape-tab.tsx, shape-side-cards.tsx_
  - _Requirements: 9.2, 9.4, 9.5_

### 9. Dashboard

- [x] 9.1 Create `NextUpCard`
  - File: `app/(dashboard)/_components/next-up-card.tsx`, `app/(dashboard)/_components/__tests__/next-up-card.test.tsx`
  - Mobile-only primary CTA card surfacing the first/in-progress plan item (title + meta) routing to it on tap; reuses timeline item data
  - Test: renders the next item; tap routes to the drill; renders nothing when no plan item
  - Purpose: "next up" one-tap CTA under the greeting (Req 4.2)
  - _Leverage: app/(dashboard)/_components/today-timeline.tsx, timeline-item.tsx, _lib/timeline-labels.ts_
  - _Requirements: 4.2_

- [x] 9.2 Wire dashboard mobile reflow (NextUpCard + timeline nodes + skill grid)
  - File: `app/(dashboard)/page.tsx`, `app/(dashboard)/_components/today-timeline.tsx`, `app/(dashboard)/_components/skill-snapshot-grid.tsx`
  - Render `NextUpCard` under the greeting on mobile (`useIsMobile`); reduce timeline node size to ~28px on mobile; reconcile `skill-snapshot-grid` `sm:grid-cols-2` → canonical 1-col ≤760 / 2-col above; update affected `__tests__`
  - Test: mobile renders NextUpCard + 28px nodes + 1-col skills; desktop unchanged
  - Purpose: Dashboard single-column reflow (Req 4.1, 4.3, 4.4, 4.5)
  - _Leverage: lib/responsive (1.1), next-up-card (9.1), today-timeline.tsx, skill-snapshot-grid.tsx_
  - _Requirements: 4.1, 4.3, 4.4, 4.5, 4.6, 1.6_

### 10. Onboarding

- [x] 10.1 Reconcile coach pane / mobile coach header to the canonical breakpoint
  - File: `components/onboarding/coach-pane.tsx`, `components/onboarding/mobile-coach-header.tsx`, `components/onboarding/__tests__/coach-pane.test.tsx`
  - Change `hidden lg:flex` → hidden ≤760 / shown above (canonical); `lg:hidden` → shown ≤760 / hidden above; keep `aria-hidden` handling
  - Test: at mobile the coach pane is hidden and the mobile header shown; above 760 the inverse
  - Purpose: Coach rail dissolves at phone width on the canonical breakpoint (Req 10.1, 1.6)
  - _Leverage: components/onboarding/coach-pane.tsx, mobile-coach-header.tsx_
  - _Requirements: 10.1, 1.6, 12.3_

- [x] 10.2 Reconcile step choice grids to single column + ≥48px cards
  - File: `components/onboarding/steps/step-languages.tsx`, `components/onboarding/steps/step-goals.tsx`, `components/onboarding/steps/step-schedule.tsx`
  - In `step-goals.tsx` and `step-schedule.tsx`, replace the `[@media(min-width:600px)]` grid breakpoints with the canonical mobile-driven 1-col ≤760 / multi-col above; in `step-languages.tsx` (plain `grid-cols-2`, no media query) **add** a `mobile:` single-column rule (1-col ≤760, 2-col above). Ensure choice cards ≥48px tall at mobile; update the co-located `__tests__` for each step (`step-goals.test.tsx`, `step-schedule.test.tsx`, `step-languages.test.tsx`)
  - Test: mobile applies single-column classes for languages/goals/schedule; desktop multi-col unchanged
  - Purpose: Choice grids stack at phone width (Req 10.3, 10.5, 1.6, 11.1)
  - _Leverage: components/onboarding/steps/*.tsx, components/ui/choice.tsx_
  - _Requirements: 10.3, 10.5, 11.1, 1.6_

- [x] 10.3 `WizardFooter` sticky action bar + `WizardProgress` placement
  - File: `components/onboarding/wizard-footer.tsx`, `components/onboarding/onboarding-shell.tsx`, `components/onboarding/__tests__/wizard-footer.test.tsx`
  - On mobile, `WizardFooter` becomes a sticky bottom action bar (back/continue/finish, ≥44px); reduce `WizardRightPane` padding (`px-[64px]` → `mobile:px-[18px]`) and pin `WizardProgress` near the top; desktop layout unchanged
  - Test: mobile footer sticky classes + buttons present; desktop unchanged; placement-test callout (step 2) still functions
  - Purpose: One step per screen with bottom nav bar (Req 10.2, 10.4)
  - _Leverage: components/onboarding/wizard-footer.tsx, wizard-progress.tsx, onboarding-shell.tsx_
  - _Requirements: 10.2, 10.4, 10.6, 11.1_

### 11. Touch targets & primitives

- [x] 11.1 Mobile minimum tap-height on `Button` and `Choice`
  - File: `components/ui/button.tsx`, `components/ui/choice.tsx`, `components/ui/__tests__/button.test.tsx`, `components/ui/__tests__/choice.test.tsx`
  - Add `mobile:` min-height so buttons are ≥44px and choice cards ≥48px tall at phone width; icon-only buttons padded to ≥44px hit boxes; desktop sizes unchanged
  - Test: mobile min-height classes present on each size variant; desktop classes unchanged
  - Purpose: Global tap-target floor (Req 11.1)
  - _Leverage: components/ui/button.tsx (size map), choice.tsx_
  - _Requirements: 11.1_

### 12. End-to-end & verification

- [x] 12.1 Add a mobile-viewport Playwright project + smoke spec
  - File: `apps/web/playwright.config.ts`, `apps/web/e2e/tests/authenticated/mobile-responsive.spec.ts`
  - Add an `authenticated-mobile` project at 402×874; spec loads dashboard (tab-bar visible, no horizontal overflow), starts a drill (action bar visible), opens theory (full-screen sheet), opens reader (word bank chip); plus a desktop-viewport assertion that the left rail is present and the tab-bar absent
  - Test: the spec itself (run via `pnpm --filter @language-drill/web test:e2e`)
  - Purpose: Lock in the mobile flows and the desktop regression guard (Req 12.3, NFR Usability)
  - _Leverage: apps/web/playwright.config.ts, e2e/tests/authenticated/dashboard.spec.ts, e2e/helpers/*_
  - _Requirements: 11.1, 12.3, 12.4; NFR Usability_

- [x] 12.2 Full-suite verification + cleanup
  - File: (no new files) run `pnpm lint && pnpm typecheck && pnpm test` from the repo root; fix any regressions; confirm all existing unit tests are green and new responsive tests pass
  - Test: zero lint/type/test failures
  - Purpose: Desktop regression guard + green suite before push (Req 12.1, 12.2)
  - _Leverage: package.json scripts, vitest configs_
  - _Requirements: 12.1, 12.2_
