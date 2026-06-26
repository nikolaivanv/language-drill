# Onboarding redesign — design spec

**Date:** 2026-06-26
**Branch:** `worktree-onboarding-redesign`
**Source design:** Claude Design project `d676e7c3-d8fe-495f-a250-94c38e174fbd` — `Onboarding - Desktop.html`, `Onboarding - Mobile.html`

## Goal

Restyle the web onboarding flow to match the new design prototype (desktop + mobile web, light + dark inferred from system). This is a **presentation-layer restructure** — the step structure, data model, reducer, context, validation, and submit orchestration are unchanged.

## Decisions (locked)

- **Languages:** render only the 3 supported languages (ES / DE / TR). The prototype's `fr/it/pt` are ignored — no backend/curriculum support.
- **Coach persona:** removed. The left coach pane and per-step coach messages are replaced by a neutral numbered **progress rail**.
- **Placement-test callout:** removed from step 2 to match the prototype.
- **Theming:** build on existing `apps/web/app/globals.css` design tokens so light/dark (system-inferred) work with no per-component dark handling. Do **not** introduce the prototype's hardcoded hexes or its `theme.css`/`theme.js`.

## What stays exactly as-is

- `use-onboarding-reducer.ts` (state shape, cross-field invariants, edit-mode guards)
- `onboarding-context.tsx` provider + `useOnboarding()`
- Submit orchestration in `app/onboarding/page.tsx`: `PUT /profiles/languages`, `PATCH /profiles/preferences`, best-effort display-name + weekly-summary side effects, error classification, redirects
- Shared constants in `packages/shared/src/onboarding.ts` (goal IDs, languages, daily-minute values, 500-char notes cap)
- The 4 steps and the data each collects: name, languages, primary language, per-language CEFR level, goals, notes, daily minutes, gentle nudges, weekly summary

## Layout

### Desktop (≥761px)
Two columns: a **300px left progress rail** + a scrollable right pane. The right pane is a centered max-width content column containing, top to bottom: a **segmented progress bar**, the current step body, and a footer row (back / `N / 4` count / primary CTA).

### Mobile (≤760px)
Top bar (brand + `N / 4` count + segmented progress bar), scrollable step body, and a **sticky bottom action bar** (back button + full-width primary CTA).

## Components

### New: `ProgressRail` (replaces `CoachPane`, folds in `SoFarChecklist`)
- Brand mark (logo + "drill") and a "setup" eyebrow label.
- Numbered step list. Each row: a marker (the step number, or a ✓ check when complete; ring in accent color when active) + the step name + the **selected value** in mono type:
  - step 1 → `N selected`
  - step 2 → `ES · B1` (primary code · its level)
  - step 3 → `N picked`
  - step 4 → `10 min/day`
- The per-step summary-value logic already exists in `SoFarChecklist` and moves here verbatim.
- Footer note in italic Fraunces: "~2 min total · skip anything".
- No avatar, no coach message, no persona `aria-live`.

### Changed: mobile header (replaces `MobileCoachHeader`)
- Brand + `step / 4` count + the shared segmented progress bar. No coach message.

### Changed: `OnboardingShell`
- Compose the new rail (desktop) / header (mobile) + right pane + footer per the layout above.

### Changed: `WizardProgress`
- Reused for both the desktop pane-top bar and the mobile header. 4 segments; active segment widened, completed segments filled (`--color-ink`). Adjust active-segment flex toward the prototype's proportion.

### Changed steps (data/logic unchanged, visual only)
- **`step-languages`:** 2-col grid of choice tiles (flag-dot lang code + name + checkbox); name input above. ES/DE/TR only.
- **`step-level`:** primary-language tabs (2-col desktop / stacked mobile) with a "primary" badge + radio; per-language CEFR blocks (mono level code + name + description + radio). Remove the placement-test callout.
- **`step-goals`:** replace emoji with the prototype's stroke-SVG line icons (grammar / speaking / listening / writing / vocab / travel); 2-col grid; notes textarea below.
- **`step-schedule`:** 4-col (2×2 mobile) minute cards with Fraunces big numerals; gentle-nudges + weekly-summary toggles; "p.s. no XP, no levels…" note.

### Changed: `WizardFooter`
- Desktop: back (ghost) / count / primary CTA (`continue →` / `finish setup →` / `save changes →`). Mobile: back + full-width primary. Keep existing edit-mode cancel + `canAdvance` gating.

## Removals
- `components/onboarding/coach-pane.tsx` (+ test)
- `components/onboarding/mobile-coach-header.tsx` (+ test, if present)
- `components/onboarding/so-far-checklist.tsx` (+ test) — logic absorbed by `ProgressRail`
- `components/onboarding/placement-test-callout.tsx` (+ test)

## Typography
Map to the prototype: `q-title` ≈ Fraunces weight 500, ~50px desktop / ~31px mobile, tight tracking; uppercase `step N` eyebrow in muted ink. Prefer existing `t-display-*` utility classes; add minimal presentational classes only where an existing token/utility doesn't cover it.

## Testing
- Update step tests for the icon swap (goals) and callout removal (level).
- Replace `coach-pane` / `so-far-checklist` / `mobile-coach-header` / `placement-test-callout` tests with a new `progress-rail` test (markers, active/done states, per-step selected values).
- Keep `wizard-footer`, `wizard-progress`, reducer, and `app/onboarding/page.test.tsx` green — swap any coach-message assertions in the page test for rail-value assertions.
- Run `pnpm --filter @language-drill/web build` (Next prerender) in addition to lint/typecheck/test, since the onboarding tree touches the layout/providers area.

## Out of scope
- No backend, schema, or API changes.
- No new languages, goals, or schedule options.
- No changes to landing, home, or other screens.
