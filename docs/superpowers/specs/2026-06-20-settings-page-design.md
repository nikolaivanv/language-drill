# Settings Page — Design

**Date:** 2026-06-20
**Branch:** `feat-settings-page`
**Status:** Approved (design), pending implementation plan

## Problem

The `/settings` page today renders only `<PlanAndLimits>` (plan tier, today's
usage across three buckets, redeem-code box). There is no way to:

- Set or change CEFR level per language from settings.
- Add / remove / re-focus learning languages from settings.

The only path to manage languages is `/onboarding?edit=1`, the 4-step
onboarding wizard in edit mode. That path is **broken for multiple
languages**: the wizard's reducer captures a single `primaryLevel`
(`use-onboarding-reducer.ts:45-46`) tied to `primaryLanguage`, and the CEFR
step (`step-level.tsx`) only sets that one level. Selecting ES + DE + TR
captures a level for the primary only; the other languages are saved with the
primary's level (or a default) — they are silently mis-leveled.

The data model already supports the fix: `userLanguageProfiles` stores a
`proficiencyLevel` **per language**, and `PUT /profiles/languages` accepts a
`profiles: [{language, proficiencyLevel}]` array with independent levels. Only
the UI (wizard + absent settings UI) fails to collect per-language levels.

## Goals

A real `/settings` page that ports the approved prototype
(`hifi/settings.jsx`) into the app, delivering four sections:

1. **languages & levels** — per-language CEFR editing, set "today's focus"
   (primary), add/remove a language. *The core fix.*
2. **goals** — daily target, why-you're-learning reasons, gentle nudges.
3. **plan & limits** — the existing section, restyled into the page.
4. **account** — email, sign-in methods, sessions, delete account.

Plus fixing the new-user onboarding wizard to collect per-language levels, and
retiring the broken `/onboarding?edit=1` editor.

## Non-goals (explicitly out of scope)

The prototype shows two sections with **no backend** — they are deferred:

- **calibration** — reading floor, coach voice, autoplay audio, speech
  recognition. None of these settings exist in the data model.
- **data & privacy** — JSON export, anonymous usage-stats opt-in, weekly
  recaps, clear reading history. None exist.

Also dropped from the prototype because the underlying feature/data does not
exist:

- **"explanation language"** and **time zone** in the prototype's profile
  section — no data model.
- **"retake placement"** — the placement test is not built (the
  `PlacementTestCallout` is disabled).
- Per-language **word / session counts** in the language rows — not readily
  available; rows stay lean.
- The prototype's **"streak protection"** toggle — this product explicitly
  bans streaks/XP (CLAUDE.md). The goals section keeps our existing
  `gentleNudges` toggle instead.

## Key decisions (from brainstorming)

| Decision | Choice |
|---|---|
| v1 scope | languages & levels, goals, account, plan & limits |
| Save model | Autosave + split endpoints |
| Onboarding wizard | Redirect `edit→settings` **and** fix the new-user CEFR step to be per-language |
| Account UI | Embed Clerk `<UserProfile>` |

## Design

### 1. Page architecture & routing

- `/settings` becomes a **single scrolling page with a sticky left
  anchor-nav**, porting the prototype's `SettingsHiFi` structure into the
  app's Tailwind token system. Reuse existing UI primitives (`Card`,
  `Choice`, `Checkbox`, `Chip`, `Flagdot`, `Input`, `Button`) rather than the
  prototype's inline styles. (See the "Free-writing prototype CSS port"
  lesson: a prototype port needs token remap + the prototype's base classes,
  but here we re-express in existing components.)
- Section order: **languages & levels · goals · plan & limits · account**.
  The anchor nav highlights the in-view section via `IntersectionObserver`
  (as in the prototype).
- Tagline under the title: "changes save as you make them." — there is **no
  global save button**; each section autosaves.
- `/onboarding?edit=1` → **redirect to `/settings`**. The wizard's edit-mode
  hydration + submit branch and `initialEditState` are removed; the wizard
  becomes new-user-only.

### 2. Section — languages & levels (the core fix)

- One row per learning profile: `Flagdot` + native language name + an
  **inline CEFR picker** (6 segmented buttons A1–C2, the prototype's pattern)
  + a "today's focus" chip on the primary + a remove (trash) button.
- **"set as focus"** on a non-primary row sets `primaryLanguage`.
- **"+ add a language"** → choose an unused learning language (ES/DE/TR) and
  an initial level, then it is appended. Disabled at 3 languages (max).
- Every change autosaves via `PUT /profiles/languages` with the full profiles
  array + `primaryLanguage`.
- Edge cases:
  - Cannot remove the last remaining language (min 1).
  - Removing the current primary auto-reassigns focus to the first remaining
    language **before** saving (server refine requires `primaryLanguage ∈
    profiles`).
  - The "add a language" picker only offers languages not already present.

### 3. Section — goals

- **Daily target:** the same 4-tile radiogroup as the wizard's `step-schedule`
  (5 / 10 / 20 / 30). **Not** the prototype's 5–60 slider — the backend only
  accepts those four values (`DAILY_MINUTES`).
- **"why you're learning":** a checklist of the real `GOAL_IDS`
  (`grammar`, `speaking`, `listening`, `writing`, `vocab`, `travel`), reusing
  the wizard's `step-goals` label mapping.
- **gentle nudges:** our existing `gentleNudges` toggle (label/body reused
  from `step-schedule`: "gentle nudges on quiet days").
- Autosaves via the new `PATCH /profiles/preferences`.

### 4. Section — plan & limits

- The existing `<PlanAndLimits>` (plan tier, today's usage, redeem-code box),
  restyled to sit as a section within the new page. **No behavior change.**

### 5. Section — account

- Embed Clerk's **`<UserProfile>`**, themed via `appearance` to match the
  app. Covers email, sign-in methods, active sessions, avatar/display name,
  and delete-account (which already triggers the `user.deleted` webhook → FK
  cascade across dependent rows). This replaces the prototype's bespoke
  profile + account sections.

### 6. Backend — split endpoints

- **`PUT /profiles/languages`** — *slimmed* to:
  ```
  { profiles: [{language, proficiencyLevel}] (1..3), primaryLanguage }
  ```
  Atomic replace of the user's profiles + set `userPreferences.primaryLanguage`.
  Keeps the cross-table invariant (`primaryLanguage ∈ profiles`) inside one
  transaction. **Drops** `goals` / `dailyMinutes` / `gentleNudges` / `notes`
  from this endpoint.
- **`PATCH /profiles/preferences`** (new) — partial update:
  ```
  { goals?, dailyMinutes?, gentleNudges?, notes? }
  ```
  Updates only the provided fields; upserts the row if absent. Validates each
  field with the existing shared enums/limits.
- **api-client:** split `useSavePreferences` into `useUpdateLanguages` +
  `useUpdatePreferences` (TanStack mutations; invalidate the
  `/profiles/languages` and `/profiles/preferences` queries on success).
  Both new wire schemas mirror the Lambda schemas (drift caught by parallel
  test suites, matching the existing convention).

### 7. Onboarding wizard fix (new-user, per-language levels)

- **Reducer** (`use-onboarding-reducer.ts`): replace single
  `primaryLevel: CefrLevel | null` with
  `levels: Partial<Record<LearningLanguage, CefrLevel>>`. `setLevel` becomes
  `{ language, level }`. `selectCanAdvance` step 2 = every selected language
  has a level **and** a primary is chosen. `setLanguages` drops the level for
  any language removed from the set (and clears primary if the primary was
  removed).
- **`step-level.tsx`:** render a compact CEFR picker **per selected language**
  (each headed by the native name), plus the primary/"today's focus"
  selector. Single-language fast-path still auto-selects the only language as
  primary.
- **Wizard finish** (`onboarding/page.tsx`): call the two new endpoints
  sequentially — `useUpdateLanguages` (with per-language levels) then
  `useUpdatePreferences`. First-run partial failure (languages saved, prefs
  not) is recoverable in settings; surface the error as today.
- Remove edit-mode plumbing: `initialEditState`, the `?edit=1` branch,
  `useGetPreferences` hydration in the wizard page.

### 8. Testing

- **Reducer:** per-language `levels` map; `setLevel` by language;
  `setLanguages` pruning levels + clearing primary; `selectCanAdvance` step 2.
- **Endpoints:** `PUT /profiles/languages` slimmed schema (rejects the dropped
  fields' absence gracefully, enforces `primaryLanguage ∈ profiles`, 1..3,
  no-duplicates); `PATCH /profiles/preferences` partial updates (each field
  independently, upsert when no row, validation errors).
- **api-client hooks:** `useUpdateLanguages` / `useUpdatePreferences` request
  shape, success/error, query invalidation.
- **Components:** each settings section; languages autosave on level change /
  focus change / add / remove; remove-primary reassignment; add disabled at 3;
  goals autosave.
- **Routing:** `/onboarding?edit=1` redirects to `/settings`.
- **Regression sweep:** grep the whole web app for `onboarding?edit=1` /
  `edit=1` and the old `primaryLevel` symbol; update any test/integration that
  renders the affected components (per the label/route-change lesson).
- Authenticated E2E specs that mount the dashboard shell must keep mocking
  `**/profiles/languages` (per the E2E dashboard-shell lesson).

## Risks & notes

- **Endpoint contract change:** slimming `PUT /profiles/languages` changes its
  request shape; the wizard and any caller of `useSavePreferences` must be
  migrated in the same change, and the Lambda + api-client schemas updated
  together.
- **Two-call wizard finish:** first-run is no longer a single transaction.
  Accepted: the failure mode (languages saved, prefs missing) is recoverable
  in settings and the prefs default sensibly.
- **Clerk `<UserProfile>` theming:** needs an `appearance` config to match the
  paper/ink token palette; behavior is otherwise Clerk-owned.
- **No `Toggle`/`Switch` primitive exists** — only `Checkbox`. Either add a
  small `Switch` UI primitive or use `Checkbox` for `gentleNudges` in the
  goals section (decide in the implementation plan).
