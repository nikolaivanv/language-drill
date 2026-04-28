# App Shell — Requirements

## Overview

Build the persistent left-sidebar navigation that wraps all authenticated pages. The shell provides: brand mark, language switcher, nav items (today / drill / read / progress), and a user footer. This is the chrome that frames every page from this point forward.

**Current state:** The `(dashboard)` route group has a minimal layout that only checks for language profiles and redirects to onboarding. There's no navigation, no language switcher, no shell.

**Target state:** A 220px fixed left rail using the warm paper palette, with a working language switcher dropdown and Next.js-routed nav items. Pages render in a 1100px max-width main column to the right of the rail.

---

## Alignment with Product Vision

Language Drill is positioned as a polyglot tool — the language switcher is a first-class affordance, not an afterthought. The "warm paper" editorial chrome reinforces the calm, focused aesthetic that differentiates the product from gamified competitors. No streak counter, no XP, no "level up" badges in the chrome — the user's progress is encoded in their CEFR estimate and grammar mastery, surfaced on the progress page (not in the nav).

The footer shows a quiet user identity (avatar + name) — enough to confirm "yes, you're signed in," without the flame icons and streak guilt of consumer language apps.

---

## Assumptions & Constraints

- The design system spec (Phase A) is complete — all design tokens, UI primitives (Button, Card, Chip), and fonts are available
- The user is authenticated and has at least one language profile (otherwise the existing redirect to `/onboarding` fires before the shell renders)
- Active language is stored in a cookie (server-readable) so the shell can render the current language on first paint without flicker
- Web-only — desktop ≥1024px is the primary target. Mobile/tablet responsive behavior is out of scope for this phase
- Only the 4 nav items present in the current design will be implemented (today, drill, read, progress). The "review queue" item from the prototype is deferred — review functionality is not yet built
- Read and progress routes will be created as **placeholder pages** so the nav doesn't break — full implementation comes in later phases (J and I respectively)
- The `drill` nav item routes to the existing `/practice` page; `/practice` will be aliased to `/drill` (or the existing route renamed)

---

## User Stories

### US-1: Persistent navigation
**As a** signed-in user,
**I want** a consistent left nav visible on every authenticated page,
**so that** I can move between today's plan, drills, reading, and progress without losing my place or hunting for menus.

### US-2: Language switching
**As a** polyglot user with profiles in multiple languages,
**I want** a language switcher that shows my current active language and lets me switch in one click,
**so that** I can practice Spanish in the morning and German in the afternoon without re-onboarding.

### US-3: Active page indication
**As a** user navigating between sections,
**I want** the current page's nav item visually distinct (filled ink background),
**so that** I always know where I am in the app.

### US-4: User identity confirmation
**As a** signed-in user,
**I want** to see my name and avatar at the bottom of the nav with a way to sign out,
**so that** I can confirm I'm in the right account and end my session when needed.

### US-5: Brand presence
**As a** user (and as the portfolio reviewer),
**I want** the app's brand mark and name visible at the top of the nav,
**so that** the app feels like a finished product, not a wireframe.

---

## Functional Requirements

### FR-1: App Shell layout (US-1)
- **FR-1.1:** WHEN a signed-in user visits any page in the `(dashboard)` route group, THEN the app shell renders with a 220px left nav and a flexible main content area.
- **FR-1.2:** The main content area SHALL constrain to `max-w-max-content` (1100px) and center horizontally with 36px top/bottom and 48px left/right padding.
- **FR-1.3:** The shell SHALL be a flex container at full viewport height (`h-screen`); main content scrolls independently of the nav.
- **FR-1.4:** The nav SHALL have a 1px right border (`border-rule`) and `bg-paper` background; main content SHALL also have `bg-paper`.

### FR-2: Brand area (US-5)
- **FR-2.1:** The top of the nav SHALL render a brand mark (28px square, `bg-ink`, `text-paper`, `rounded-[7px]`) containing a checkmark or "d" glyph, with the brand name "drill" in Fraunces 20px / 600 weight to the right.
- **FR-2.2:** The brand SHALL link to `/` (today's plan).

### FR-3: Language switcher (US-2)
- **FR-3.1:** Below the brand, a language switcher button SHALL show: a 24px colored flagdot, the language name in lowercase (e.g., "español"), and the user's CEFR level for that language (mono 10px, ink-mute).
- **FR-3.2:** Flagdot colors per language: `ES` → `--accent` (terracotta #c96442), `DE` → `#4b4138` (warm dark brown), `TR` → `#c01818` (Turkish red). The flagdot SHALL show the 2-letter language code in mono font, white text.
- **FR-3.3:** Clicking the switcher SHALL toggle a dropdown menu listing all of the user's language profiles. Each row: flagdot + name + CEFR level + selection indicator (filled accent dot if active).
- **FR-3.4:** Clicking a language in the dropdown SHALL update the active language (cookie write) and reload the current page so server data refetches with the new language.
- **FR-3.5:** Clicking outside the dropdown SHALL close it. Pressing Escape SHALL close it.
- **FR-3.6:** IF the user has only one language profile, THEN the switcher SHALL render as a non-interactive display (no dropdown chevron, no hover state).
- **FR-3.7:** The dropdown SHALL also include a "manage languages" link at the bottom that routes to `/onboarding?edit=1`.

### FR-4: Nav items (US-1, US-3)
- **FR-4.1:** Below the language switcher, 4 nav items SHALL render in this order:
  1. **today** → `/` (home/dashboard)
  2. **drill** → `/drill` (the existing practice page, accessible at this new path)
  3. **read** → `/read` (placeholder page in this phase)
  4. **progress** → `/progress` (placeholder page in this phase)
- **FR-4.2:** Each nav item SHALL show a 16px outline icon on the left and the label in lowercase 13px Inter to the right. Icons: today (sun/home), drill (play), read (book), progress (chart).
- **FR-4.3:** WHEN the current pathname matches a nav item's route (or starts with it for nested routes), THEN that item SHALL render with `bg-ink text-paper` (active state).
- **FR-4.4:** Hover state for inactive items: `bg-paper-2 text-ink`.
- **FR-4.5:** Nav items SHALL render as Next.js `Link` components with proper `href`.

### FR-5: User footer (US-4)
- **FR-5.1:** At the bottom of the nav (sticky via `mt-auto`), a footer SHALL render with: avatar (30px circle, `bg-accent-soft`, `text-accent-2`, Fraunces 14px 600, showing user initials), user's first name in Inter 13px, and an overflow menu trigger (3-dot icon).
- **FR-5.2:** The avatar initials SHALL come from Clerk's user data (`firstName[0]` + `lastName[0]`, fallback to `firstName[0]` or "?").
- **FR-5.3:** Clicking the overflow menu SHALL show: "settings" (link to `/settings`, placeholder route in this phase) and "sign out" (Clerk's signOut handler).
- **FR-5.4:** The footer SHALL have a 1px top border (`border-rule`) and 18px top padding.
- **FR-5.5:** The footer SHALL NOT show streak counts, XP, or any gamification element.

### FR-6: Active language context (US-2)
- **FR-6.1:** Active language SHALL be persisted in a cookie named `active_language` (value: ES / DE / TR).
- **FR-6.2:** On first load (no cookie), the active language SHALL default to the first profile in the user's `useLanguageProfiles` result.
- **FR-6.3:** A React context (`ActiveLanguageContext`) SHALL provide the active language value and a setter to all components within the shell.
- **FR-6.4:** The cookie SHALL be readable on the server (for SSR) — set with `path=/`, `SameSite=Lax`, no `HttpOnly` (client must read it).

### FR-7: Placeholder pages (US-1, FR-4.1)
- **FR-7.1:** A placeholder `/read` page SHALL exist with a `t-display-l` heading "read & collect", a subtitle "coming soon — paste anything you're reading and i'll flag words above your level", and use the design system Card component.
- **FR-7.2:** A placeholder `/progress` page SHALL exist with a `t-display-l` heading "progress", a subtitle "coming soon — your skill radar, mastery map, and exam readiness will live here".
- **FR-7.3:** A placeholder `/settings` page SHALL exist with a `t-display-l` heading "settings", subtitle "coming soon".

### FR-8: Drill route migration (FR-4.1)
- **FR-8.1:** The existing `/practice` page SHALL be moved or aliased to `/drill`. Direct visits to `/practice` SHALL redirect to `/drill` (so any existing bookmarks don't break).
- **FR-8.2:** The page's logic, components, and tests SHALL remain functionally unchanged — only the route path changes.

---

## Non-Functional Requirements

### NFR-1: Performance
- The shell SHALL render server-side where possible, with client-only islands for the language switcher dropdown and footer overflow menu (interactivity).
- No layout shift between server-rendered initial paint and client hydration.

### NFR-2: Accessibility
- Nav items SHALL use semantic `<nav>` element with `aria-label="primary"`.
- The language switcher button SHALL have `aria-haspopup="listbox"`, `aria-expanded`, and proper keyboard navigation (arrow keys move between options, Enter selects, Escape closes).
- Active nav item SHALL use `aria-current="page"`.
- Focus rings SHALL be visible on all interactive elements (3px ring, 8% ink opacity, matching the design system).

### NFR-3: Usability
- Nav item click targets SHALL be at least 32px tall (achieved via padding).
- The language switcher SHALL show the dropdown within 150ms of click (no animation longer than the design system's 0.15s transition standard).

### NFR-4: Security
- The `active_language` cookie value SHALL be validated against the `Language` enum on every read — invalid values fall back to the user's first profile.
- The footer's sign-out action SHALL use Clerk's official `signOut()` method.

### NFR-5: Reliability
- IF the user has no language profiles (edge case despite the existing redirect), THEN the shell SHALL render with a graceful empty switcher and the existing redirect logic SHALL handle the routing.
- IF Clerk user data is loading, THEN the footer SHALL show a skeleton (paper-2 pulsing block in place of name and avatar).

### NFR-6: Developer Experience
- Shell components SHALL live in `apps/web/components/shell/`.
- Each component SHALL be a single file with co-located types.
- Components SHALL be exported from `apps/web/components/shell/index.ts` barrel.

### NFR-7: Testing
- Each interactive component (LanguageSwitcher, NavItem, UserFooter) SHALL have a Vitest test covering: rendering, active state, click behavior, keyboard navigation where applicable.

---

## Out of Scope

- **Mobile/tablet responsive shell** — phone has its own bottom-nav design (`m-kit.jsx`); we'll build that later
- **Review queue** — the design prototype shows a "review queue" nav item with badge count; deferred until spaced repetition is wired into the dashboard
- **Coach FAB** — the floating coach button is a future feature; not in this phase
- **Read & progress page content** — only placeholders here; real implementations in Phases I and J
- **Settings page content** — placeholder only
- **Streak counters, XP, or any gamification element** in the footer
- **Theme switching** (no dark mode in the design)
- **Custom flagdot SVGs** — using colored circles with 2-letter codes is sufficient; flag icons are not in the handoff
