# Conjugation Drill UI/UX Polish — Design

**Date:** 2026-06-28
**Branch:** `feat/conjugation-drill-ui-polish`
**Prototype:** Claude Design project `d676e7c3-…`, file `Conjugation Session - Mobile.html`

## Goal

Polish the conjugation drill for mobile web, where the device keyboard eats
vertical space. Focus on real deltas; do not chase pixel-perfection or change
the basic shared UI components (Button, Input, etc.). The prototype is a
reference, not a contract.

## Deltas

### 1. Compact target-form chips
**File:** `apps/web/components/drill/conjugation-feature-bundle.tsx` (`card` variant only).

The pronoun (subject) badge and feature chips are too tall. Reduce their
vertical footprint to reclaim ~1 line above the mobile keyboard:

- Subject badge: drop the pronoun from `t-display-s` to a smaller size
  (~18px), tighten padding (`py-s-2` → ~5px).
- Feature chips: smaller main text, tighter padding.
- Reduce the bundle's top gap (`mt-s-3` → `mt-s-2`).

The `inline` variant (debrief) is **not** touched.

### 2. Remove the mobile accent keyboard (app-wide)
**File:** `apps/web/components/ui/accent-picker.tsx`.

The on-screen accent/diacritic row is redundant on mobile — the device
keyboard provides accented characters via long-press. Hide it on mobile
**everywhere** the picker renders (drills, conjugation, dictation,
free-writing, fluency, vocab-review) by adding `useIsMobile()` and returning
`null` on mobile. Combine into the existing `if (!chars) return null` guard,
**after** all hooks so hook order stays stable. Desktop is unaffected
(keeps the picker and physical-Shift support).

- SSR-safe: server renders desktop; hydrates to `null` on mobile.
- jsdom tests default to desktop (no `matchMedia` → `useIsMobile` is false),
  so existing accent-picker tests stay green. Add one test asserting the row
  is hidden when `matchMedia` reports mobile.

### 3 + 4 + 5. Conjugation page rework
**File:** `apps/web/app/(dashboard)/drill/conjugation/page.tsx`.

- **Header rearrange (delta 5):** the `conjugation warm-up` title gets its own
  line. Below it, a single meta row reuses **`DrillMeta`** —
  `[drill level ▾ · theory · <topic>]` — with the `drill these fast →` link
  pushed to the right edge of that row. Nothing competes with the title's
  baseline anymore.
- **Functional level selector (delta 5):** convert the page's `difficulty`
  from a derived constant into state (`level`, defaulting to the profile
  baseline). `DrillMeta` supplies the pill plus the drift signal
  ("↑ above / ↓ below your `<baseline>` baseline · reset"). Changing the level
  re-keys `useExercise` (difficulty is a query key) → a fresh conjugation
  exercise loads at the chosen CEFR level.
- **Theory link (delta 4):** derive `theoryTopicId` via
  `exerciseTypeHasTheory(exercise.type)` +
  `topicIdForGrammarPointKey(exercise.grammarPointKey, activeLanguage)`,
  render `<TheoryTrigger>` in `DrillMeta`'s `topic` slot, and mount the
  `<TheoryPanel>` host (open/close + trigger element state), mirroring the
  generic `drill/page.tsx`. `TheoryTrigger` self-hides when the grammar point
  has no mapped theory topic.
- **Flag button (delta 3):** capture `submissionId` off the submit result
  (`(result as { submissionId?: string }).submissionId`) into the submission
  state, then render `<FlagExerciseControl>` under the feedback once the
  submission is `evaluated` and a `submissionId` exists — exactly as
  `drill/page.tsx` does.

### 6. Grammar-point title — OMIT
**Decision:** do **not** add the prototype's
`POSSESSIVE — 3RD PERSON PLURAL` eyebrow. The chips already encode the target
(pronoun + features) and the new theory link names the grammar point
("theory · Possessive -lAr(I)"). A third restatement spends the very vertical
space we are reclaiming for mobile. The page stays: title → meta row → prompt
card → input → feedback.

## Out of scope

- The sticky mobile action bar: conjugation uses an **inline** submit today
  (no `DrillActionProvider`); unchanged.
- No changes to shared base components (Button/Input/Textarea/Chip).
- No backend/API changes — flag + theory endpoints already exist and are used
  by the generic drill page.

## Verification

- `pnpm lint && pnpm typecheck && pnpm test` (web package) — zero failures.
- New accent-picker test: row hidden on mobile, present on desktop.
- Conjugation page wiring tests: flag control appears after evaluation; theory
  trigger rendered in the meta row; level change refetches.
