# Requirements Document

## Introduction

The Language Drill web app (`apps/web`) is currently designed for desktop (≥1024px): a fixed 220px left nav rail, multi-column layouts, hover-driven popovers, and a right-side theory slide-over. On a phone-width browser these layouts break — the left rail eats the viewport, multi-column grids overflow, and hover affordances are unreachable by touch.

This feature makes the **existing** web app responsive at a single **≤760px breakpoint**, reflowing the desktop SPA into a phone layout per the "Language Drill - Mobile Web.html" design handoff. It is explicitly **not** a new app or a native experience — same components, same design tokens, same copy, same data shapes, same interaction model. Above 760px, the desktop layout is unchanged.

The design source of truth is the handoff bundle (`README.md`, `SCREENS.md`, `tokens.css`, and the `mobileweb/m-*.jsx` pattern references). The brief's own words: _"the same product at phone width, not a different product that happens to be smaller."_

## Alignment with Product Vision

The product is positioned as _"what you do between italki sessions"_ — short, deliberate practice sessions that fit into spare moments. Those spare moments overwhelmingly happen on a phone (commute, queue, sofa), so a usable phone-web experience is core to the product's stated job-to-be-done, not a nice-to-have. `product.md` / CLAUDE.md also flag mobile (Expo) as a later phase; making the web responsive serves real phone users now without waiting for the native app, and keeps the web app "portfolio-quality and shareable" (a shared link must look right when opened on a phone).

It also preserves the product's explicit anti-gamification stance: the responsive layout carries the same honest skill meters, calm coach voice, and lowercase copy — no streaks/XP are introduced by the mobile chrome.

## Requirements

### Requirement 1 — Global responsive foundation (breakpoint, type scale, spacing)

**User Story:** As a developer, I want a single shared responsive breakpoint and phone-scaled type/spacing tokens, so that every screen adapts consistently and the desktop layout is provably untouched above the breakpoint.

#### Acceptance Criteria

1. WHEN the viewport width is ≤ 760px THEN the system SHALL apply the mobile layout for all in-app screens.
2. WHEN the viewport width is ≥ 761px THEN the system SHALL render the existing desktop layout unchanged (visual parity with current main branch).
3. WHEN the mobile layout is active THEN the display type scale SHALL reduce as follows: display-xl 56→34px, display-l 40→28px, display-m 28→22px; body (14), small (12), micro (11), and mono badge (10) sizes SHALL remain unchanged.
4. WHEN a wrappable display headline renders at mobile sizes THEN its line-height SHALL be ≥ 1.2 (no 1.05–1.15 collisions on wrap). _Note: this follows the handoff README's explicit "line-height ≥ 1.2 on any wrappable display headline" rule and deliberately overrides the prototype's literal `.mw-h1` value of 1.06 — do not "fix" it back to match the JSX._
5. WHEN the mobile layout is active THEN horizontal screen padding SHALL be 18px (down from 48px) and card padding SHALL be 14–16px (down from 24/28px).
6. The breakpoint value SHALL be defined in one place (a shared constant/utility or a documented CSS `@media` convention) so screens do not each hard-code a different pixel value.

### Requirement 2 — Responsive app shell (top app-bar + bottom tab-bar)

**User Story:** As a phone user, I want the left nav rail to collapse into a top app-bar plus a bottom tab-bar, so that navigation is reachable with my thumbs and the content gets the full viewport width.

#### Acceptance Criteria

1. WHEN the viewport is ≤ 760px THEN the system SHALL hide the 220px left nav rail and render a 52px sticky top app-bar containing the brand mark, a compact language pill, and the user avatar.
2. WHEN the viewport is ≤ 760px THEN the system SHALL render a bottom tab-bar (≈64px tall) with the existing primary nav destinations (today, drill, read, progress), each shown as a line icon plus a ~10px label.
3. WHEN a tab corresponds to the current route THEN that tab SHALL be styled active (ink) and the others inactive (ink-mute), matching the existing `NavItem` active logic.
4. WHEN the user taps a tab THEN the system SHALL navigate to that route using the existing routing (no new routes invented).
5. WHEN the viewport is ≥ 761px THEN the top app-bar and bottom tab-bar SHALL NOT render and the existing left rail SHALL render unchanged.
6. WHEN content scrolls THEN the top app-bar SHALL remain sticky and the bottom tab-bar SHALL remain fixed/anchored above the home-indicator safe area, without overlapping scrollable content (content area accounts for both bars).

### Requirement 3 — Language switcher as bottom sheet

**User Story:** As a phone user, I want to switch languages from a bottom sheet, so that the choice is touch-friendly instead of a tiny dropdown.

#### Acceptance Criteria

1. WHEN the viewport is ≤ 760px AND the user taps the language pill in the top app-bar THEN the system SHALL open a bottom sheet listing the user's learning languages with flag dot, name, and proficiency badge.
2. WHEN the user has only one learning language THEN the language pill SHALL render but SHALL NOT open a sheet (parity with the existing disabled single-language behavior).
3. WHEN the user selects a language in the sheet THEN the system SHALL set it active (reusing the existing `useActiveLanguage` provider) and dismiss the sheet.
4. WHEN the bottom sheet is open THEN tapping the scrim or the close affordance SHALL dismiss it, and background scroll SHALL be locked while it is open.
5. WHEN the sheet renders THEN it SHALL include the existing "manage languages →" link to `/onboarding?edit=1`.

### Requirement 4 — Dashboard reflow

**User Story:** As a phone user, I want the dashboard to stack into a single column with my next action one tap away, so that I can start practicing immediately.

#### Acceptance Criteria

1. WHEN the dashboard renders at ≤ 760px THEN the greeting headline SHALL render at ~34px (mobile display) with the eyebrow and framing line preserved.
2. WHEN the dashboard renders at ≤ 760px THEN a primary "next up" CTA card SHALL appear directly under the greeting, surfacing the first/in-progress plan item and routing to it on tap.
3. WHEN the today timeline renders at ≤ 760px THEN it SHALL remain a vertical list with timeline nodes reduced to ~28px (from ~38px) and full-width rows.
4. WHEN the skill snapshot renders at ≤ 760px THEN the skill meters SHALL stack to a single column.
5. WHEN the read-collect entry card renders at ≤ 760px THEN it SHALL remain full-width and tappable, routing to `/read`.
6. WHEN any dashboard empty/error/loading state renders at ≤ 760px THEN it SHALL remain legible and unbroken at phone width.

### Requirement 5 — Drill reflow (cloze, translation, vocab)

**User Story:** As a phone user, I want drills to use a single-column layout with a sticky action bar, so that prompts, options, and the check/next button are all reachable without horizontal scrolling.

#### Acceptance Criteria

1. WHEN a drill renders at ≤ 760px THEN the desktop coach rail SHALL collapse into a coach card at the top of the content (collapsible), not a side rail.
2. WHEN a drill renders at ≤ 760px THEN the session position SHALL be shown as a horizontal progress indicator (existing top progress bar and/or a dot row) above the prompt.
3. WHEN a cloze multiple-choice drill renders at ≤ 760px THEN the choice options SHALL stack into a single column with each choice ≥ 48px tall.
4. WHEN a drill renders at ≤ 760px THEN the bottom tab-bar SHALL be replaced by a sticky action bar showing progress meta ("item N of M") on the left and the primary check/next control on the right. Existing secondary controls (cloze mode toggle, translation hint) SHALL remain inline in the body; the error-path skip SHALL remain in `SubmissionErrorCard` (no new happy-path skip is introduced).
5. WHEN inline feedback (correct/near/incorrect) renders at ≤ 760px THEN it SHALL appear below the prompt full-width using the existing feedback-shell component and color semantics, with the theory trigger reachable.
6. WHEN the translation drill renders at ≤ 760px THEN the prompt card, full-width textarea, and accent-character picker SHALL stack vertically and the action bar SHALL stay reachable above the on-screen keyboard.
7. WHEN the vocab drill renders at ≤ 760px THEN the definition/term card, typed input, and progressive hint chips SHALL stack in a single column with the same action-bar pattern.
8. WHEN a keyboard Enter is pressed on a connected keyboard at ≤ 760px THEN the existing submit/advance behavior SHALL still work (interaction model unchanged).

### Requirement 6 — Theory panel as full-screen sheet

**User Story:** As a phone user, I want theory to open as a full-screen sheet with the table of contents as a tab strip, so that I can read it comfortably instead of fighting a right-side overlay.

#### Acceptance Criteria

1. WHEN the theory panel opens at ≤ 760px THEN it SHALL present as a full-screen (or near-full-height) sheet sliding up from the bottom, not a right-anchored slide-over.
2. WHEN the theory sheet is open at ≤ 760px THEN the TOC SHALL render as a horizontal, scrollable tab strip at the top instead of a 240px left sidebar.
3. WHEN the user taps a TOC tab at ≤ 760px THEN the content SHALL scroll to that section, and as the user scrolls, the active tab SHALL update (existing scroll-spy behavior preserved).
4. WHEN the theory sheet is open at ≤ 760px THEN a close affordance SHALL dismiss it and background scroll SHALL be locked (existing body-scroll-lock/focus-trap behavior preserved).
5. WHEN the viewport is ≥ 761px THEN the theory panel SHALL render as the existing right-side slide-over unchanged.

### Requirement 7 — Session debrief / feedback reflow

**User Story:** As a phone user, I want the post-session debrief to stack into one column with stat cards I can swipe through, so that I can review results comfortably on a phone.

#### Acceptance Criteria

1. WHEN the debrief renders at ≤ 760px THEN the header, tab switcher (review · debrief), and content SHALL stack in a single column at full width.
2. WHEN the debrief stat cards render at ≤ 760px THEN they SHALL present as a horizontal snap-scroll row instead of a multi-column grid.
3. WHEN skill-impact bars render at ≤ 760px THEN each skill SHALL condense to a single track per skill with before→after labels.
4. WHEN review item rows render at ≤ 760px THEN they SHALL be full-width cards retaining the existing expand/collapse (incorrect expanded, correct collapsed) behavior.
5. WHEN the debrief action footer renders at ≤ 760px THEN it SHALL be a bottom action bar holding the primary "next session" and secondary actions.

### Requirement 8 — Read & collect reflow

**User Story:** As a phone user, I want the word bank and word definitions to open as bottom sheets, so that I can collect words by tapping instead of relying on a sticky side rail and hover popovers.

#### Acceptance Criteria

1. WHEN the annotated read view renders at ≤ 760px THEN the sticky right-rail word bank SHALL be replaced by a toolbar chip/affordance that opens the word bank as a bottom sheet.
2. WHEN the user taps a flagged word at ≤ 760px THEN the word card SHALL open as a bottom sheet (not a click-anchored popover), preserving lemma/POS/CEFR/gloss/example/frequency and the save/skip actions.
3. WHEN the word bank sheet is open at ≤ 760px THEN the highlight-intensity toggle (subtle/assertive) SHALL be available in the sheet header.
4. WHEN the paste view renders at ≤ 760px THEN the title input, passage textarea (Fraunces reading type), char counter, and action row SHALL stack full-width with the same limit/disabled behavior.
5. WHEN the empty and history views render at ≤ 760px THEN they SHALL stack into a single column with full-width cards.
6. WHEN a save toast appears at ≤ 760px THEN it SHALL render within the phone viewport (inset from the edges) without overflowing.
7. WHEN a word/bank bottom sheet is open at ≤ 760px THEN background scroll SHALL be locked and a scrim/close affordance SHALL dismiss it.

### Requirement 9 — Progress reflow

**User Story:** As a phone user, I want the progress radar, heatmap, and skill cards to fit a phone screen, so that I can read my skill shape and activity without zooming or scrolling sideways.

#### Acceptance Criteria

1. WHEN the progress "shape" tab renders at ≤ 760px THEN the radar chart SHALL shrink to fit within a ~320px-wide square and remain centered and legible.
2. WHEN the shape tab's side cards render at ≤ 760px THEN they SHALL stack below the radar in a single column.
3. WHEN the heatmap tab renders at ≤ 760px THEN day cells SHALL squeeze to ~10–12px columns and topic/row labels SHALL left-align at a smaller font without clipping.
4. WHEN per-skill detail cards render at ≤ 760px THEN they SHALL stack into a single column at full width.
5. WHEN the progress tab switcher renders at ≤ 760px THEN both tabs SHALL remain reachable and the URL tab-state behavior SHALL be preserved.

### Requirement 10 — Onboarding reflow

**User Story:** As a phone user setting up the app, I want one onboarding step per screen with the stepper in the top bar and navigation in a bottom action bar, so that each step is focused and the controls are thumb-reachable.

#### Acceptance Criteria

1. WHEN onboarding renders at ≤ 760px THEN the left coach pane SHALL be hidden and the step content SHALL fill the width (the existing mobile coach header may carry coach intent).
2. WHEN onboarding renders at ≤ 760px THEN the step progress indicator SHALL appear near the top of the screen and the back/continue (or finish) controls SHALL appear in a sticky bottom action bar.
3. WHEN a multi-select or single-select choice grid renders at ≤ 760px (languages, level, goals) THEN it SHALL stack to a single column with each choice card ≥ 48px tall.
4. WHEN the level step's placement-test callout renders at ≤ 760px THEN its idle/dismissed/taking states and both CTAs SHALL remain functional and legible.
5. WHEN the schedule step renders at ≤ 760px THEN the time-per-day options and the gentle-nudge checkbox SHALL stack/wrap without overflow.
6. WHEN onboarding is reached at ≥ 761px THEN the existing two-column coach + content layout SHALL render unchanged.

### Requirement 11 — Touch targets & accessibility at phone width

**User Story:** As a phone user, I want every interactive element to be comfortably tappable and accessible, so that I can use the app one-handed without mis-taps.

#### Acceptance Criteria

1. WHEN any interactive control renders at ≤ 760px THEN its effective tap target SHALL be ≥ 44px tall (choice buttons ≥ 48px; icon buttons ≥ 34×34px padded into ≥ 44px hit boxes).
2. WHEN a bottom sheet or full-screen sheet is open at ≤ 760px THEN focus SHALL be managed (trapped within the sheet) and Escape/close SHALL dismiss it, reusing existing focus-trap/scroll-lock utilities where available.
3. WHEN the user has `prefers-reduced-motion: reduce` THEN sheet/slide animations SHALL be disabled or reduced (extending the existing reduced-motion handling).
4. WHEN nav items, tabs, and sheet options render THEN they SHALL expose appropriate roles/labels (e.g. current tab marked, listbox/option semantics on the language sheet) consistent with existing components.

### Requirement 12 — Desktop regression guard

**User Story:** As a maintainer, I want assurance that the responsive work does not alter the desktop experience, so that existing users and tests are unaffected.

#### Acceptance Criteria

1. WHEN the existing unit test suite runs THEN all current tests SHALL continue to pass (any test changed SHALL be changed only where behavior legitimately and intentionally changed).
2. WHEN new responsive behavior is added THEN it SHALL have accompanying tests (viewport-branching logic, sheet open/close, active-tab state).
3. WHEN any screen renders at ≥ 761px THEN it SHALL be visually and behaviorally identical to the current main-branch desktop layout.
4. WHEN responsive styles are added THEN they SHALL be additive/guarded by the mobile breakpoint so the default (desktop) code paths are not regressed.

## Non-Functional Requirements

### Performance
- Responsive adaptations SHALL be CSS-driven wherever possible; JavaScript viewport branching (e.g. rendering a sheet vs. a side panel) SHALL use a single shared `useMediaQuery`/match-media hook to avoid layout thrash and hydration mismatches.
- No additional heavy dependencies SHALL be introduced; bottom-sheet and tab-bar primitives SHALL be built from the existing component/token vocabulary.
- The breakpoint switch SHALL not cause cumulative layout shift beyond the expected reflow, and images/fonts already loaded SHALL be reused (no new font weights).

### Security
- No change to auth, data fetching, or API surface. The sign-in page remains the Clerk-hosted `<SignIn />` (already responsive); no credentials or tokens are handled by new code.

### Reliability
- SSR/CSR consistency: components that branch on viewport SHALL render a stable default on the server and reconcile on mount without throwing hydration errors.
- All new responsive code paths SHALL degrade gracefully if `matchMedia` is unavailable (default to desktop layout).

### Usability
- Copy, tone (lowercase, calm coach voice), color, fonts, and component vocabulary SHALL be unchanged from desktop — only layout reflows.
- Every screen SHALL be usable one-handed at 402px width (the responsive-web prototype's reference viewport — `IOSDevice width={402}` in `Language Drill - Mobile Web.html`; distinct from the 412px Pixel reference used by the separate native mobile prototype) with no horizontal scrolling of primary content.

## Out of Scope / Decisions

- **Auth (sign-in):** Clerk-hosted `<SignIn />` is already responsive; scope is limited to verifying it reflows acceptably, not re-skinning it.
- **Settings:** Currently a "coming soon" placeholder (not built on desktop). Building the 7-section settings experience shown in the mock is a separate feature, not responsive work; excluded here.
- **Fifth "review" bottom-nav tab:** The mock shows a 5th "review" tab with a badge; no such route exists in the app today. The bottom tab-bar mirrors the existing four destinations (today/drill/read/progress); adding a review destination is out of scope.
- **Native mobile screens** (`Mobile Prototype.html` / Expo): explicitly not this feature — this is responsive *web* only.
- **New screens, data, or API changes:** none. Same data shapes and endpoints.
