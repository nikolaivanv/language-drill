# Design System Foundation — Requirements

## Overview

Establish the visual design system for Language Drill's web app based on the Claude Design handoff. This includes design tokens (colors, typography, spacing, shadows, radii), Google Fonts integration, Tailwind v4 theme configuration, base CSS styles, and a library of shared UI components that all pages will use.

**Current state:** The app uses bare Tailwind v4 defaults — no custom theme, no fonts beyond system defaults, no shared components. All styling is inline Tailwind classes with ad-hoc color choices (blue-600, gray-200, etc.) that don't match the design handoff's "warm paper" palette.

**Target state:** A complete design token system and reusable component library matching the handoff's visual language — warm paper/ink palette, Fraunces/Inter/JetBrains Mono/Caveat typography, editorial feel with restraint.

---

## Alignment with Product Vision

The design system directly supports Language Drill's positioning as a **portfolio-quality**, polished language learning tool for intermediate+ learners. The "warm paper" palette and editorial typography (Fraunces display + Inter UI) create a calm, focused environment — reinforcing the app's "no gamification" philosophy. Every visual choice signals seriousness and care, differentiating from the neon/cartoon aesthetics of Duolingo-style apps.

This is the foundation for all Phase 1–4 UI work. Without it, every new page would re-invent styling decisions. With it, building the dashboard, exercise flows, progress page, and onboarding becomes composition, not design.

---

## Assumptions & Constraints

- Tailwind CSS v4 is already installed and uses CSS-first configuration (`@theme` directive) — no JS config file
- `next/font/google` is available in Next.js 15 for font loading
- The app has a single `globals.css` entry point
- No external component library (shadcn, Radix, etc.) will be introduced — components are built from scratch with Tailwind
- No new npm dependencies are required for this phase
- Only web components — mobile (Expo) will have its own component set later

---

## User Stories

### US-1: Design Token Consistency
**As a** developer building new pages,
**I want** all design tokens (colors, fonts, spacing, radii, shadows) defined once in the Tailwind theme,
**so that** I can use semantic class names (e.g., `bg-paper`, `text-ink`, `font-display`) instead of hardcoded hex values, ensuring visual consistency across the app.

### US-2: Typography System
**As a** developer,
**I want** Google Fonts (Fraunces, Inter, JetBrains Mono, Caveat) loaded via `next/font` with CSS variable bindings and a clear type scale,
**so that** display headings, body text, monospace numbers, and handwritten accents render correctly and are easy to apply via Tailwind classes.

### US-3: Reusable UI Components
**As a** developer building exercise, dashboard, and progress pages,
**I want** a shared component library (Button, Chip, Card, Bar, Input, Textarea, Choice, Checkbox),
**so that** I can compose pages quickly without re-implementing the same visual patterns.

### US-4: Base Page Styling
**As a** user,
**I want** the app to have the warm paper background, proper font rendering, and consistent base styles from the first page load,
**so that** the app feels polished and cohesive.

### US-5: Accent Character Picker
**As a** learner typing answers in Spanish, German, or Turkish,
**I want** a row of accent/special character buttons (e.g., á é ñ ü ö ş ğ) that inserts characters into the active input,
**so that** I can type accented characters without switching keyboard layouts.

---

## Functional Requirements

### FR-1: Design Tokens in Tailwind v4 (US-1)
- **FR-1.1:** WHEN a developer uses `bg-paper`, `text-ink`, `border-rule`, etc., THEN the Tailwind theme resolves to the handoff's exact hex values (e.g., `--paper: #faf7f1`, `--ink: #1a1612`).
- **FR-1.2:** The following color tokens SHALL be defined: `paper`, `paper-2`, `paper-3`, `card`, `ink`, `ink-2`, `ink-soft`, `ink-mute`, `rule`, `rule-strong`, `accent`, `accent-2`, `accent-soft`, `hilite`, `hilite-soft`, `ok`, `ok-soft`.
- **FR-1.3:** The following font family tokens SHALL be defined: `display` (Fraunces), `ui` (Inter), `mono` (JetBrains Mono), `hand` (Caveat).
- **FR-1.4:** The spacing scale SHALL include: `s-1` (4px), `s-2` (8px), `s-3` (12px), `s-4` (16px), `s-5` (20px), `s-6` (24px), `s-7` (32px), `s-8` (40px).
- **FR-1.5:** Border radius tokens SHALL include: `r-sm` (6px), `r-md` (10px), `r-lg` (16px), `r-xl` (24px), `r-pill` (999px).
- **FR-1.6:** Shadow tokens SHALL include: `shadow-1`, `shadow-2`, `shadow-3` matching the handoff values.
- **FR-1.7:** All tokens SHALL be defined using Tailwind v4's CSS-first `@theme` directive in `globals.css`, not a JS config file.
- **FR-1.8:** Line-height tokens SHALL be defined: `lh-display-tight` (1.05), `lh-display` (1.1), `lh-display-medium` (1.2), `lh-body` (1.55), `lh-ui` (1.4).
- **FR-1.9:** A `--max-content` token SHALL be defined as `1100px` for the main content area max-width.

### FR-2: Font Loading (US-2)
- **FR-2.1:** Fraunces (variable, weights 400–600, axes: opsz, SOFT), Inter (weights 400, 500, 600, 700), JetBrains Mono (weights 400, 500), and Caveat (weight 600) SHALL be loaded via `next/font/google`.
- **FR-2.2:** Each font SHALL expose a CSS variable (`--font-display`, `--font-ui`, `--font-mono`, `--font-hand`) applied to the `<html>` element.
- **FR-2.3:** The body SHALL default to `font-ui` (Inter).
- **FR-2.4:** Fraunces display classes SHALL include `font-variation-settings: "opsz" 144, "SOFT" 50` for display-size headings.

### FR-3: Base Styles (US-4)
- **FR-3.1:** The `<body>` SHALL have `background: var(--color-paper)`, `color: var(--color-ink-2)`, `font-family: var(--font-ui)`, and `-webkit-font-smoothing: antialiased`. Body text uses `ink-2` (#3d362e); `ink` (#1a1612) is for headings and emphasis.
- **FR-3.2:** A CSS type scale SHALL be defined as utility classes with paired line-heights and letter-spacing:
  - `t-display-xl`: 56px / line-height 1.05 / letter-spacing -1.5px / Fraunces 500 / opsz 144
  - `t-display-l`: 40px / line-height 1.1 / letter-spacing -1px / Fraunces 500 / opsz 144
  - `t-display-m`: 28px / line-height 1.2 / letter-spacing -0.4px / Fraunces 500
  - `t-display-s`: 22px / line-height 1.25 / letter-spacing -0.2px / Fraunces 500
  - `t-body-l`: 17px / line-height 1.55 / color ink-2
  - `t-body`: 14px / line-height 1.55 / color ink-2
  - `t-small`: 12px / line-height 1.45 / color ink-soft
  - `t-micro`: 11px / line-height 1.4 / color ink-mute / uppercase / letter-spacing 1.2px / font-weight 500

### FR-4: Button Component (US-3)
- **FR-4.1:** Variants: `default` (1px ink border, transparent bg; hover → ink bg + paper text), `primary` (ink bg, paper text; hover → accent-2 bg + accent-2 border), `ghost` (transparent border, ink-soft text; hover → paper-2 bg + ink text), `accent` (accent bg, white text; hover → accent-2 bg).
- **FR-4.2:** Sizes: `sm` (6px 12px padding, 12px font, r-sm radius), `md` (10px 18px, 13px font, r-md radius — default), `lg` (14px 24px, 15px font, r-md radius).
- **FR-4.3:** States: hover (per variant above), disabled (reduced opacity, cursor not-allowed, non-interactive), loading (text replaced by a small spinner, button non-interactive, `aria-busy="true"`).
- **FR-4.4:** SHALL render as `<button>` or `<a>` depending on whether `href` is provided.
- **FR-4.5:** All transitions SHALL use 0.15s duration.

### FR-5: Chip Component (US-3)
- **FR-5.1:** Variants: `default` (1px rule border, paper bg, ink-soft text), `solid` (ink bg, paper text, ink border), `accent` (accent-soft bg, accent-2 text, accent-soft border), `ok` (ok-soft bg, ok text, ok-soft border).
- **FR-5.2:** Pill-shaped (999px radius), 11px font, 500 weight, 3px 9px padding.

### FR-6: Card Component (US-3)
- **FR-6.1:** `var(--color-card)` background, 1px rule border, r-lg radius, shadow-1.
- **FR-6.2:** Accepts `padding` prop for content spacing (default: `s-4` / 16px).
- **FR-6.3:** Card is non-interactive by default — no hover states. Interactive variants are page-specific.

### FR-7: Bar (Progress Meter) Component (US-3)
- **FR-7.1:** 6px height track with paper-3 background, pill radius.
- **FR-7.2:** Fill color variants: `ink` (default), `accent`, `ok`.
- **FR-7.3:** Fill width SHALL animate over 0.3s using CSS `transition: width 0.3s`.
- **FR-7.4:** Accepts `value` (0–100) and `max` (default 100) props.

### FR-8: Input and Textarea Components (US-3)
- **FR-8.1:** Styled with `var(--color-card)` background, 1px rule border, r-md radius, 14px font, ink text color.
- **FR-8.2:** Focus state: ink border color, `box-shadow: 0 0 0 3px rgba(26,22,18,0.08)`.
- **FR-8.3:** Textarea SHALL support `rows` prop and disable manual resize (`resize: none`).
- **FR-8.4:** Input padding: 12px 14px. Textarea padding: 14px.
- **FR-8.5:** Transition: `border-color 0.15s, box-shadow 0.15s`.

### FR-9: Choice Component (US-3)
- **FR-9.1:** Selectable tile with 1px rule border, card background, r-md radius, 12px 16px padding.
- **FR-9.2:** Hover: ink border, paper-2 background.
- **FR-9.3:** Selected: ink border, hilite-soft background.
- **FR-9.4:** Supports `mode` prop: `radio` (single select — shows circular dot indicator when selected) or `checkbox` (multi-select — shows square check indicator when selected).
- **FR-9.5:** Transition: 0.15s on border-color and background.

### FR-10: Checkbox Component (US-3)
- **FR-10.1:** 18px square, 1.5px ink border, 4px radius.
- **FR-10.2:** Checked state: ink background, white checkmark (✓, 12px, bold).
- **FR-10.3:** Transition: background 0.15s.

### FR-11: AccentPicker Component (US-5)
- **FR-11.1:** Renders a horizontal row of character buttons for the given language.
- **FR-11.2:** Spanish: á é í ó ú ñ ¿ ¡. German: ä ö ü ß. Turkish: ç ğ ı ö ş ü. Returns null for unsupported languages.
- **FR-11.3:** WHEN a character button is clicked, THEN it inserts the character at the cursor position in the target input/textarea and triggers a React-compatible change event.
- **FR-11.4:** Accepts a `targetRef` (React ref to an input/textarea element) and a `language` prop.
- **FR-11.5:** IF `targetRef.current` is null, THEN character buttons SHALL be disabled.
- **FR-11.6:** Each button SHALL use the `sm` button size styling (ghost variant) with mono font.

---

## Non-Functional Requirements

### NFR-1: Performance
- Font files SHALL use `next/font` `display: 'swap'` to prevent FOIT (flash of invisible text).
- No layout shift from font loading (appropriate fallback metrics via `next/font`'s built-in `adjustFontFallback`).

### NFR-2: Accessibility
- All interactive components SHALL have proper `aria` attributes.
- Button disabled state SHALL use `aria-disabled` in addition to the `disabled` attribute.
- Color contrast: ink on paper SHALL meet WCAG AA (4.5:1 for body text). The handoff values (#1a1612 on #faf7f1) exceed this at ~15:1.
- Focus states SHALL be visible (ink border + box-shadow ring).

### NFR-3: Usability
- All interactive elements SHALL have a minimum tap/click target of 32px (matching `--tap-sm`).
- Button and Choice hover transitions SHALL be 0.15s — fast enough to feel responsive, slow enough to be visible.

### NFR-4: Security
- Components do not handle user data or external content. No XSS vectors exist in the component props — all text content is rendered as React children (auto-escaped).
- AccentPicker manipulates input values via DOM APIs but only inserts hardcoded character literals.

### NFR-5: Reliability
- Fonts SHALL have system font fallbacks in the font-family stack: Fraunces → Georgia, Inter → system-ui, JetBrains Mono → Menlo, Caveat → cursive.
- IF Google Fonts CDN is unreachable, THEN the app SHALL render correctly with fallback fonts (no broken layouts).

### NFR-6: Developer Experience
- All components SHALL be TypeScript with exported prop types.
- Components SHALL be located in `apps/web/components/ui/`.
- Each component SHALL be a single file (component + types co-located).
- Components SHALL be exported from `apps/web/components/ui/index.ts` barrel file.

### NFR-7: Testing
- Each component SHALL have a test file covering: rendering, variants, interactive states.
- Tests SHALL use Vitest + React Testing Library (matching existing test setup).

---

## Out of Scope

- App shell / navigation layout (Phase B)
- Page-specific components (exercise cards, skill radar, etc.)
- Dark mode (not in the design handoff)
- Mobile-specific components (bottom nav, FAB, bottom sheet)
- Animation library — CSS transitions are sufficient per the handoff
- Icon library — line icons will be addressed per-page as needed
