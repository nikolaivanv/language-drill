# Implementation Plan

## Task Overview

Build the 4-step onboarding wizard from the foundation up: shared constants → wire schemas → DB schema + migration → Lambda routes + tests → API client hooks → state reducer → layout shell → step components → page integration. Each task is bounded to 1–3 files and 15–30 minutes.

The order is a dependency-respecting topological sort. Lambda work lands first so the client has stable contracts to integrate against; the wizard UI lands last with a single page-level rewrite.

## Steering Document Compliance

- **`tech.md`**: Next.js App Router + TypeScript strict; Hono + Zod on Lambda; Drizzle + Neon for the new `userPreferences` table; Clerk JWT via existing `createAuthenticatedFetch`. No new infrastructure pieces.
- **`structure.md`**: web components live under `apps/web/components/onboarding/` (kebab-case files, `__tests__/` co-located). Shared types in `packages/shared/src/onboarding.ts`. Wire schemas in `packages/api-client/src/schemas/preferences.ts`. New API client hooks in `packages/api-client/src/hooks/usePreferences.ts` (matching the `use<Name>.ts` convention).
- **CLAUDE.md hard rules**: lowercase copy throughout; no streaks/XP/gamification; ES/DE/TR are the only learning languages (EN excluded at the wizard layer); pre-push checks (`pnpm lint`, `pnpm typecheck`, `pnpm test`) must pass green.

## Atomic Task Requirements

Each task in this plan satisfies:
- **File Scope**: 1–3 related files maximum
- **Time Boxing**: 15–30 minutes by an agent
- **Single Purpose**: one testable outcome
- **Specific Files**: exact paths to create or modify
- **Agent-Friendly**: clear input/output, leverages existing code

## Tasks

### Foundation & shared types

- [x] 1. Create shared onboarding constants module
  - File: `packages/shared/src/onboarding.ts` (create)
  - File: `packages/shared/src/index.ts` (modify — re-export everything from `./onboarding`)
  - Define and export: `GOAL_IDS = ['grammar','speaking','listening','writing','vocab','travel'] as const`, `GoalId = typeof GOAL_IDS[number]`, `DAILY_MINUTES = [5,10,20,30] as const`, `DailyMinutes = typeof DAILY_MINUTES[number]`, `NOTES_MAX_LENGTH = 500`, `LANGUAGE_NATIVE_NAMES: Record<LearningLanguage,string>` (`ES → 'español'`, `DE → 'deutsch'`, `TR → 'türkçe'`).
  - Purpose: a single source of truth for onboarding domain values used by Lambda, api-client, and web.
  - _Leverage: `packages/shared/src/index.ts` (existing `Language` enum + `LANGUAGE_NAMES`)_
  - _Requirements: 4.1 (goal-id list), 5.1 (daily-minute set), 4.3 (notes max length), 2.2 (native names)_

- [x] 2. Add preferences Zod schemas in api-client
  - File: `packages/api-client/src/schemas/preferences.ts` (create)
  - File: `packages/api-client/src/index.ts` (modify — re-export new types/schemas)
  - Export: `PreferencesResponseSchema`, `PreferencesResponse`, `LearningLanguageEnum`, `SavePreferencesInputSchema`, `SavePreferencesInput`. Wire-schema `SavePreferencesInputSchema` enforces ES/DE/TR only, `profiles.min(1).max(3)`, and the `primaryLanguage ∈ profiles[].language` refinement.
  - Purpose: typed wire contracts shared across the web app and (later) the mobile app.
  - _Leverage: `packages/api-client/src/schemas/profile.ts`, `packages/shared/src/onboarding.ts`, `packages/shared/src/index.ts` (Language, CefrLevel)_
  - _Requirements: 7.1 (payload shape), 9.1–9.2 (response shape with nullable primary)_

- [x] 3. Add unit tests for `SavePreferencesInputSchema`
  - File: `packages/api-client/src/schemas/preferences.test.ts` (create — sibling-test convention used by existing `packages/api-client/src/schemas/exercise.test.ts`)
  - Cover: accepts valid payload (ES B2 single profile, multi-profile with primary in set, all goal IDs, all daily-minute values); rejects EN in profiles; rejects 4-profile array (max 3); rejects empty profiles; rejects unknown goal id; rejects `notes` > 500 chars; rejects `primaryLanguage` not in `profiles[]`; rejects `dailyMinutes` not in {5,10,20,30}.
  - Purpose: lock the wire contract to prevent regressions.
  - _Leverage: existing vitest setup in `packages/api-client/`, schema from task 2_
  - _Requirements: 7.1, NFR.Security_

### Database schema

- [x] 4. Add `userPreferences` Drizzle table
  - File: `packages/db/src/schema/users.ts` (modify — append the new table)
  - Append `userPreferences` table per design data-model section: `userId text PK FK→users.id ON DELETE CASCADE`, `primaryLanguage text NOT NULL`, `goals jsonb NOT NULL default []`, `dailyMinutes smallint NOT NULL`, `gentleNudges boolean NOT NULL default true`, `notes text NOT NULL default ''`, `updatedAt timestamptz NOT NULL defaultNow()`. Export `UserPreferences` and `NewUserPreferences` types via `InferSelectModel`/`InferInsertModel`.
  - **Verify:** `pnpm --filter @language-drill/db typecheck`.
  - Purpose: persist onboarding signals without bloating `userLanguageProfiles`.
  - _Leverage: existing `users` and `userLanguageProfiles` definitions in the same file_
  - _Requirements: 7.10, NFR.Security (FK + CASCADE)_

- [x] 5. Generate and commit Drizzle migration for `userPreferences`
  - File: `packages/db/migrations/<auto-named>.sql` (create — drizzle-kit auto-names files using the next sequence number + a random suffix, e.g., `0002_xxx_yyy.sql`. Trust drizzle-kit's output; do NOT rename it. See existing files like `packages/db/migrations/0001_calm_mesmero.sql` for the naming convention.)
  - Run `pnpm drizzle-kit generate` from repo root; verify the generated SQL creates `user_preferences` with the expected columns, defaults, and FK; commit the generated file unchanged. **Fallback:** if `DATABASE_URL` is unreachable in the current shell, hand-write the SQL matching the Drizzle schema in task 4 and place it under `packages/db/migrations/` with the next sequence prefix (e.g., `0002_user_preferences.sql`).
  - **Verify:** `pnpm db:migrate` runs cleanly against the local Neon dev branch and `pnpm db:studio` shows the new table.
  - Purpose: forward-only migration ready for CI to run on the per-PR Neon branch.
  - _Requirements: 7.10_

### Lambda — extend `PUT /profiles/languages`

- [x] 6. Replace `UpdateProfilesSchema` with the strict full-payload schema
  - File: `infra/lambda/src/routes/profiles.ts` (modify — replace the existing schema)
  - Replace the existing `UpdateProfilesSchema` with the strict version: `profiles: array(LearningProfileSchema).min(1).max(3)` (ES/DE/TR only via `LearningLanguageEnum`), required `primaryLanguage` (also from `LearningLanguageEnum`), required `goals: array(enum(GOAL_IDS))`, required `dailyMinutes` ∈ {5,10,20,30}, required `gentleNudges: boolean`, required `notes: string().max(NOTES_MAX_LENGTH)`. Keep the existing duplicate-languages refinement; add the `primaryLanguage ∈ profiles[].language` refinement. Also drop the `LanguageProfileSchema` re-use if it allowed EN — define a local `LearningProfileSchema` that uses `LearningLanguageEnum` instead.
  - **Verify:** `pnpm --filter @language-drill/lambda typecheck`. The existing `profiles.test.ts` will fail at this point — that's expected; task 9 rewrites those tests.
  - Purpose: enforce the new wire contract at the API boundary.
  - _Leverage: `GOAL_IDS`, `NOTES_MAX_LENGTH` from `@language-drill/shared` (task 1), `Language`/`CefrLevel` enums_
  - _Requirements: 7.1, 7.8, NFR.Security_

- [x] 7. Rewrite `PUT /profiles/languages` handler with transaction + preferences upsert
  - File: `infra/lambda/src/routes/profiles.ts` (modify — rewrite the PUT handler)
  - Wrap the existing delete-then-insert of `userLanguageProfiles` in `db.transaction(async (tx) => { … })`. Inside the same transaction, perform `INSERT … ON CONFLICT (user_id) DO UPDATE` on `userPreferences` writing all 5 columns from the validated body. Return `{ profiles, preferences }` where `preferences` echoes the upserted row.
  - **Verify:** `pnpm --filter @language-drill/lambda typecheck`.
  - Purpose: atomic full write of profiles + preferences in one round-trip.
  - _Leverage: Drizzle's `db.transaction((tx) => …)` pattern, `userPreferences` table from task 4, `userLanguageProfiles` already in the same file_
  - _Requirements: 7.2, NFR.Reliability_

- [x] 8. Add new `GET /profiles/preferences` route
  - File: `infra/lambda/src/routes/profiles.ts` (modify — add the route)
  - Read `userPreferences` for the authenticated user via `c.get('userId')` (the `authMiddleware` in `infra/lambda/src/middleware/auth.ts` already handles 401 + `MISSING_SUB`; route handlers do not need to re-implement that). Return the documented defaults if the row is absent: `{ primaryLanguage: null, goals: [], dailyMinutes: null, gentleNudges: true, notes: '' }`. Mirror the response style of the existing `GET /profiles/languages` handler in the same file.
  - **Verify:** `pnpm --filter @language-drill/lambda typecheck`.
  - Purpose: hydrate edit mode and (later) settings/dashboard from a single endpoint.
  - _Leverage: existing `GET /profiles/languages` handler in `infra/lambda/src/routes/profiles.ts` (mirror its `c.get('userId')` pattern), `authMiddleware` (already wired)_
  - _Requirements: 9.1, 9.2, 9.3_

### Lambda — tests

- [x] 9. Rewrite + extend `PUT /profiles/languages` tests
  - File: `infra/lambda/src/routes/profiles.test.ts` (modify — rewrite existing PUT test cases and add new validation tests)
  - **Rewrite:** every existing PUT test must send the new full payload (replace `EN` with `ES`/`DE`/`TR`; add `primaryLanguage`, `goals: []`, `dailyMinutes: 10`, `gentleNudges: true`, `notes: ''`). Existing happy-path tests (create, replace, returns 200, sets `assessedAt`) stay in shape — they just use the new body. **Preserve the existing `assessedAt` assertion across the rewrite** — the new transaction also writes `userPreferences`, but the rule that profiles get `assessedAt: new Date()` on insert is unchanged.
  - **Add cases:** valid full payload also creates a `userPreferences` row with the 5 columns; second call upserts the existing row; response shape includes the `preferences` field; reject EN in `profiles[]` → 400; reject `profiles.length > 3` → 400; reject `primaryLanguage` not in `profiles[]` → 400; reject invalid goal id → 400; reject `notes > 500` → 400; reject `dailyMinutes` not in `{5,10,20,30}` → 400; reject any missing required field → 400. Keep the existing 401-on-missing-JWT test.
  - **Verify:** `pnpm --filter @language-drill/lambda test` — every PUT test passes, including the rewritten ones.
  - Purpose: lock the new strict contract end-to-end.
  - _Leverage: existing `profiles.test.ts` setup helpers (mock auth, test DB), Drizzle `userPreferences`_
  - _Requirements: 7.1, 7.2, NFR.Security, NFR.Reliability_

- [x] 10. Add Lambda tests for `GET /profiles/preferences`
  - File: `infra/lambda/src/routes/profiles.test.ts` (modify — append)
  - Cases: (a) returns documented defaults when no row exists (including `gentleNudges: true`); (b) returns stored values when a row exists; (c) returns 401 with `{ code: 'MISSING_SUB' }` when JWT is missing.
  - Purpose: lock the read-endpoint contract.
  - _Leverage: existing test setup_
  - _Requirements: 9.1, 9.2, 9.3_

### API client — hooks

- [x] 11. Create `useGetPreferences` and `useSavePreferences` hooks
  - File: `packages/api-client/src/hooks/usePreferences.ts` (create)
  - File: `packages/api-client/src/index.ts` (modify — re-export the new hooks)
  - `useGetPreferences({ fetchFn, enabled })` uses TanStack Query with key `['preferences']`. `useSavePreferences({ fetchFn })` is a mutation that:
    1. Builds the `profiles[]` array from the wizard's selected languages: the `primaryLanguage` gets the user's chosen `primaryLevel`, every other selected language gets `proficiencyLevel: 'A1'` (R3.8 / R7.1).
    2. Trims and CRLF-normalises `notes` (R4.6).
    3. Validates the resulting payload against `SavePreferencesInputSchema`.
    4. `PUT`s `/profiles/languages`.
    5. On success invalidates `['languageProfiles']` and `['preferences']` query keys.
  - Purpose: single client-side entry point for both reads and writes of onboarding signals; centralises the non-primary A1 default and the notes normalisation.
  - _Leverage: existing `useLanguageProfiles.ts` hook conventions, `createAuthenticatedFetch` from `fetchClient.ts`_
  - _Requirements: 3.8, 4.6, 7.1, 9.1, 9.4_

- [x] 12. Add unit tests for `usePreferences` hooks
  - File: `packages/api-client/src/hooks/usePreferences.test.ts` (create — sibling-test convention used by existing `packages/api-client/src/hooks/useLanguageProfiles.test.ts`)
  - Cover: `useSavePreferences` builds the wire `profiles[]` correctly when only a primary language is selected; fills non-primary selected languages with `proficiencyLevel: 'A1'` (R3.8); trims leading/trailing whitespace from `notes` and converts CRLF→LF before validation; rejects 501-char notes only after trim; throws `ApiError` on 4xx with the server message; on 2xx success, both `['languageProfiles']` and `['preferences']` keys are invalidated. `useGetPreferences` is skipped when `enabled: false`.
  - Purpose: lock the client-side payload-build, normalization, and cache-invalidation behaviour.
  - _Leverage: existing test patterns in `packages/api-client/src/hooks/useLanguageProfiles.test.ts`_
  - _Requirements: 3.8, 4.6, 9.4_

### Onboarding state (web)

- [x] 13. Create onboarding context, types, and reducer
  - File: `apps/web/components/onboarding/onboarding-context.tsx` (create)
  - File: `apps/web/components/onboarding/use-onboarding-reducer.ts` (create)
  - In `use-onboarding-reducer.ts`: define `OnboardingState`, `OnboardingAction`, the `reducer` function, `initialNewUserState()`, `initialEditState(profiles, prefs)` (which coalesces null `dailyMinutes` to `10`), `selectCanAdvance(state)`, `selectCoachMessage(state)`. Enforce invariants: `setLanguages([])` is a no-op in edit mode; if `setLanguages` removes the current `primaryLanguage` from the set, reset `primaryLanguage` and `primaryLevel`; `setPrimary` must be in `state.languages`.
  - In `onboarding-context.tsx`: `OnboardingProvider` (wraps `useReducer`) and `useOnboarding()` hook.
  - **Verify:** `pnpm --filter @language-drill/web typecheck`.
  - Purpose: the single source of state truth for the wizard.
  - _Leverage: `LearningLanguage` from `apps/web/lib/active-language.ts`, `Language`/`CefrLevel` from `@language-drill/shared`, `GoalId`/`DailyMinutes` from task 1_
  - _Requirements: 1.4, 1.6, 2.7 (last-language deselect)_

- [x] 14. Add reducer + selector tests
  - File: `apps/web/components/onboarding/__tests__/use-onboarding-reducer.test.ts` (create)
  - Cover every action: `goNext`/`goBack` boundary cases; `setLanguages` enforces the edit-mode last-language guard and resets primary when it drops out; `setPrimary` no-ops when not in `languages`; `setLevel`, `toggleGoal`, `setNotes`, `setDailyMinutes`, `setGentleNudges`. Cover selectors: `selectCanAdvance` per step (Step 1: ≥1 lang; Step 2: primary + level set; Step 3: notes ≤500 chars; Step 4: dailyMinutes set); `selectCoachMessage` returns the correct copy per step. Cover `initialEditState` coalescing null `dailyMinutes` to `10`.
  - **Verify:** `pnpm --filter @language-drill/web test use-onboarding-reducer` shows all tests passing.
  - Purpose: lock the reducer's invariants and validation rules.
  - _Leverage: vitest config in `apps/web/`_
  - _Requirements: 1, 2.7, 3.7, 4.5, 5.5, all selectors_

### Onboarding layout shell

- [x] 15. Create `OnboardingShell` layout component
  - File: `apps/web/components/onboarding/onboarding-shell.tsx` (create)
  - 'use client'. Props: `mode: 'new' | 'edit'`, `initialState: OnboardingState`, `onComplete: (mode) => void`. Renders the `OnboardingProvider` wrapping `<CoachPane />`, `<MobileCoachHeader />`, and `<WizardRightPane />` (a small inline component composing `<WizardProgress />`, the active step, and `<WizardFooter />`). Two-pane layout: `flex min-h-screen bg-paper`; coach pane at `w-[320px]` hidden below `lg`; right pane `flex-1 px-[64px] py-[56px] max-w-[760px] mx-auto`.
  - **Verify:** `pnpm --filter @language-drill/web typecheck`.
  - Purpose: top-level layout + state provider for the wizard.
  - _Leverage: design tokens from `apps/web/app/globals.css`_
  - _Requirements: 6.1, 6.8, 1.7_

- [x] 16. Implement `CoachPane` + `SoFarChecklist`
  - File: `apps/web/components/onboarding/coach-pane.tsx` (create)
  - File: `apps/web/components/onboarding/so-far-checklist.tsx` (create)
  - `CoachPane`: top-aligned `Brand`, then 44×44 `c` avatar circle (`bg-ink text-paper t-display-s`) with "coach"/"your AI tutor" labels; Card-bordered message box rendering `selectCoachMessage(state)`; the `<SoFarChecklist />`; bottom-aligned `t-hand text-ink-mute` "~2 min total · skip anything". `aria-hidden` on the rail when collapsed.
  - `SoFarChecklist`: 4 rows; each row shows `✓` / `●` / `○` glyph (in `ok`/`accent`/`ink-mute`) + label + summary value when filled. The "languages" row shows the placeholder-A1 sub-line ("level: a1 (adjustable later)") when ≥1 non-primary language was selected. Use `·` (U+00B7) in the "primary + level" summary.
  - Purpose: the left rail's brand + coach message + progress checklist.
  - _Leverage: `Brand` from `apps/web/components/shell/brand.tsx`, `Card` from `apps/web/components/ui/`, `LANGUAGE_NAMES` from `@language-drill/shared`, `useOnboarding` from task 13_
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

- [x] 17. Add `MobileCoachHeader` for narrow viewports
  - File: `apps/web/components/onboarding/mobile-coach-header.tsx` (create)
  - 'use client'. Renders `Brand` + the per-step coach message in a compact strip. `aria-live="polite"` so screen readers announce step transitions. Visible only below `lg`; the desktop coach pane is `aria-hidden` at the same breakpoint to avoid duplication.
  - Purpose: minimum viable coach UX at narrow widths without building the full mobile design.
  - _Leverage: `Brand`, `selectCoachMessage` from task 13, design tokens_
  - _Requirements: 6.8_

- [x] 18. Implement `WizardProgress` + `WizardFooter`
  - File: `apps/web/components/onboarding/wizard-progress.tsx` (create)
  - File: `apps/web/components/onboarding/wizard-footer.tsx` (create)
  - `WizardProgress`: 4-segment bar; the active segment renders 2× width, segments at or before the active step are `bg-ink`, others `bg-paper-3`.
  - `WizardFooter`: ghost "back" button (hidden on Step 1; replaced by ghost "cancel" link in edit mode → referrer-or-`/settings`), `t-mono` "X / 4" counter, and primary CTA. CTA label resolves to `continue →` (steps 1–3, new mode), `finish setup →` (Step 4, new mode), or `save changes →` (edit mode, Step 4). Renders an inline `t-small` error message above the row when `state.submission.status === 'error'`. Disables the CTA when `selectCanAdvance(state)` is false or submission is loading; shows the `Button` `loading` state during submit.
  - Purpose: top progress + bottom navigation + error display for the wizard.
  - _Leverage: `Button` from `apps/web/components/ui/`, design tokens, `useOnboarding`_
  - _Requirements: 1.5, 1.6, 7.7, 7.8, 7.9, 8.5_

- [x] 19. Add tests for `CoachPane` + `SoFarChecklist`
  - File: `apps/web/components/onboarding/__tests__/coach-pane.test.tsx` (create)
  - File: `apps/web/components/onboarding/__tests__/so-far-checklist.test.tsx` (create)
  - Cover: per-step coach message renders correctly; checklist glyphs change with step progress; placeholder-A1 sub-line appears only when non-primary languages are selected; "primary + level" summary uses `·` (U+00B7) and uppercase language code; "N selected" / "N picked" / "N min/day" formatting.
  - Purpose: lock coach pane content and the placeholder-A1 disclosure.
  - _Leverage: `OnboardingProvider` for in-test state, vitest + Testing Library_
  - _Requirements: 6.3–6.6_

### Step components

- [x] 20. Implement `PlacementTestCallout` (strictly non-interactive)
  - File: `apps/web/components/onboarding/placement-test-callout.tsx` (create)
  - 'use client' is NOT required (pure presentational). Render `<aside role="note" class="cursor-default ...">` with the dashed `--rule` border, `paper-2` background, hand-script "not sure?" + body "a 5-min adaptive placement test is coming soon — for now, pick the band that feels closest." No `<button>`, no `<a>`, no `onClick`, no `onKeyDown`, no `tabIndex`.
  - Purpose: the disabled callout from R3.6 — and a single component to police non-interactivity in tests.
  - _Leverage: design tokens, `t-small`, `t-hand` utility classes_
  - _Requirements: 3.6_

- [x] 21. Add the regression-proof `PlacementTestCallout` test
  - File: `apps/web/components/onboarding/__tests__/placement-test-callout.test.tsx` (create)
  - Walk the rendered subtree with `container.querySelectorAll('button, a, [role="button"], [role="link"], [tabindex]')` and assert empty. Assert root has class `cursor-default`. Wrap in a context spy and assert `click` and `keydown` (Enter, Space) on the root dispatch zero actions. Assert `aside.outerHTML` contains none of `onclick=`, `onmousedown=`, `onkeydown=`, `href=`.
  - Purpose: a future regression where someone wires up an `onClick` (or any interactivity) is caught here.
  - _Leverage: vitest + Testing Library_
  - _Requirements: 3.6_

- [x] 22. Implement `StepLanguages`
  - File: `apps/web/components/onboarding/steps/step-languages.tsx` (create)
  - Eyebrow `step 1`, headline, body, then a 2-column grid of 3 `Choice` tiles (mode `checkbox`) for ES/DE/TR. Each tile contains `<Flagdot language={l} />` + lowercase native name from `LANGUAGE_NATIVE_NAMES` + an indicator. In edit mode, attempting to deselect when only one language remains keeps the tile selected and shows an inline `t-small ink-mute` message "you need at least one language — to fully reset, delete your account from settings."
  - **Verify:** `pnpm --filter @language-drill/web typecheck`.
  - Purpose: language selection step.
  - _Leverage: `Choice` and `Flagdot`, `useOnboarding`, `LANGUAGE_NATIVE_NAMES` from task 1_
  - _Requirements: 2.1–2.7_

- [x] 23. Add `StepLanguages` tests
  - File: `apps/web/components/onboarding/__tests__/step-languages.test.tsx` (create)
  - Cover: renders 3 tiles in the right order; clicking toggles state; "continue" enabled iff ≥1 language; the EN language is not present anywhere in the rendered output; in edit mode, clicking the only selected tile shows the inline guard message and does not deselect.
  - _Requirements: 2.1, 2.3, 2.4, 2.5, 2.7_

- [x] 24. Implement `StepLevel`
  - File: `apps/web/components/onboarding/steps/step-level.tsx` (create)
  - Eyebrow `step 2`, headline `roughly, where are you with <span className="hilite">{primaryName}</span>?`, body, then (only when `state.languages.length > 1`) a `<div role="radiogroup" aria-label="primary language">` containing one `<Choice mode="radio" />` per selected language (with `Flagdot` + uppercase code) — keyboard arrow keys move focus among the tiles. Below that, a vertical stack of 6 CEFR cards (`Choice` mode `radio`) with code + name + description copy from R3.4. Below the cards, render `<PlacementTestCallout />`.
  - **Verify:** `pnpm --filter @language-drill/web typecheck`.
  - Purpose: primary language + CEFR level + the disabled placement callout.
  - _Leverage: `Choice`, `Flagdot`, `PlacementTestCallout` (task 20), `useOnboarding`_
  - _Requirements: 3.1–3.7_

- [x] 25. Add `StepLevel` tests
  - File: `apps/web/components/onboarding/__tests__/step-level.test.tsx` (create)
  - Cover: primary radiogroup is hidden when only 1 language is selected; visible and keyboard-arrow-navigable when ≥2 languages; selecting a CEFR card sets `primaryLevel`; placement callout is rendered (the non-interactivity is covered by task 21); "continue" disabled until a level is picked.
  - _Requirements: 3.1, 3.2, 3.3, 3.5, 3.7_

- [x] 26. Implement `StepGoals`
  - File: `apps/web/components/onboarding/steps/step-goals.tsx` (create)
  - Eyebrow `step 3`, headline, body, then a 2-column × 3-row grid of 6 `Choice` tiles (mode `checkbox`) using the goal list from R4.1 (with emojis rendered as inline text wrapped in `<span aria-hidden="true">`). Below the grid, a `Textarea` with label "anything specific i should know? (optional)", placeholder, and `maxLength={NOTES_MAX_LENGTH}`. Show a `t-small accent-2` character counter `${notes.length} / 500` once length exceeds 500 (i.e., paste-overflow). At ≥600px the grid is 2 columns × 3 rows; below 600px it collapses to a single column.
  - **Verify:** `pnpm --filter @language-drill/web typecheck`.
  - Purpose: goals + optional notes collection.
  - _Leverage: `Choice`, `Textarea` from `apps/web/components/ui/`, `useOnboarding`_
  - _Requirements: 4.1–4.5_

- [x] 27. Add `StepGoals` tests
  - File: `apps/web/components/onboarding/__tests__/step-goals.test.tsx` (create)
  - Cover: all 6 goals render in order with their emojis aria-hidden; toggling works; notes textarea respects `maxLength`; pasting >500 chars shows the warning counter and disables "continue" via the reducer guard; "continue" enabled with zero goals + empty notes.
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 28. Implement `StepSchedule`
  - File: `apps/web/components/onboarding/steps/step-schedule.tsx` (create)
  - Eyebrow `step 4`, headline, body, then a 4-column grid of `Choice` tiles (mode `radio`) for `5/10/20/30` (collapse to 2×2 below 600px); each tile renders the number in `t-display-m` + caption "min / day". Below the grid, a `Card padding="md"` containing a `Checkbox` labeled "gentle nudges on quiet days" with body copy from R5.3. Below the Card, the `t-hand` p.s. note from R5.4 with `accent`-coloured "p.s.".
  - **Verify:** `pnpm --filter @language-drill/web typecheck`.
  - Purpose: schedule + nudges + the no-streaks disclaimer.
  - _Leverage: `Choice`, `Card`, `Checkbox`, design tokens, `useOnboarding`_
  - _Requirements: 5.1–5.5_

- [x] 29. Add `StepSchedule` tests
  - File: `apps/web/components/onboarding/__tests__/step-schedule.test.tsx` (create)
  - Cover: 4 time tiles render and select correctly; default selection in new mode is `10`; checkbox defaults to checked; clicking checkbox toggles `gentleNudges`; primary CTA reads "finish setup →" when in new mode and "save changes →" when in edit mode.
  - _Requirements: 5.1, 5.2, 5.3, 5.5_

### Page integration

- [x] 30. Add onboarding components barrel export
  - File: `apps/web/components/onboarding/index.ts` (create)
  - Export the public API: `OnboardingShell`, `OnboardingProvider`, `useOnboarding`, `CoachPane`, `MobileCoachHeader`, `WizardProgress`, `WizardFooter`, `PlacementTestCallout`, the four step components, `OnboardingState`, `OnboardingAction`, `initialNewUserState`, `initialEditState`.
  - Purpose: clean import surface for the page.
  - _Requirements: project structure convention_

- [x] 31a. Rewrite `OnboardingPage` skeleton — search params, hooks, redirect, loading/error states
  - File: `apps/web/app/onboarding/page.tsx` (rewrite — replaces existing single-step form)
  - **Before writing:** open `packages/api-client/src/hooks/useLanguageProfiles.ts` and confirm the exported hook signature; if it accepts `{ fetchFn }`, match it; otherwise adapt to the actual signature (do NOT assume).
  - 'use client'. Read `useSearchParams().get('edit') === '1'` into `editMode`. Call `useLanguageProfiles({ fetchFn })` and `useGetPreferences({ fetchFn, enabled: editMode })`. Render branches:
    - Loading (either query loading) → spinner card matching the dashboard layout's loading state.
    - Hydration error (any query errored) AND `editMode` → paper-card error with retry button.
    - `profiles.length > 0 && !editMode` → `router.replace('/')` and return null.
    - Otherwise → render a placeholder `<div>wizard goes here</div>` (replaced in 31b).
  - **Verify:** `pnpm --filter @language-drill/web typecheck`.
  - Purpose: the routing/loading/hydration skeleton; behaviour layered in next.
  - _Leverage: `useLanguageProfiles` (verify signature), `useGetPreferences` (task 11), `useAuth().getToken` + `createAuthenticatedFetch` pattern from `(dashboard)/layout.tsx`, dashboard layout's loading + error markup_
  - _Requirements: 1.1, 1.2, 1.3, 8.1_

- [x] 31b. Wire `OnboardingShell` into `OnboardingPage`
  - File: `apps/web/app/onboarding/page.tsx` (modify)
  - Replace the placeholder from 31a with `<OnboardingShell mode={editMode ? 'edit' : 'new'} initialState={editMode ? initialEditState(profiles, prefs) : initialNewUserState()} onComplete={handleComplete} />`. `handleComplete` is a stub that does nothing yet — submission orchestration lands in 31c.
  - **Verify:** `pnpm --filter @language-drill/web typecheck`.
  - Purpose: the wizard renders end-to-end with hydrated state in both modes.
  - _Leverage: `OnboardingShell` (task 15), `initialNewUserState`/`initialEditState` (task 13)_
  - _Requirements: 1.1, 1.3, 8.1_

- [x] 31c. Implement submit orchestration with same-origin redirect
  - File: `apps/web/app/onboarding/page.tsx` (modify)
  - Wire `useSavePreferences({ fetchFn })`. The shell's `onComplete` (or a callback the shell exposes via context) ultimately dispatches `submitStart`, calls `mutateAsync`, then dispatches `submitSuccess` and triggers navigation, or dispatches `submitError` with the appropriate `kind`. On success: in `new` mode → `router.push('/')`. In `edit` mode → if `document.referrer` parses successfully AND `new URL(document.referrer).origin === window.location.origin` → `router.push(document.referrer)`; else → `router.push('/settings')` (the placeholder route shipped in app-shell task 22).
  - **Verify:** `pnpm --filter @language-drill/web typecheck && pnpm --filter @language-drill/web lint`.
  - Purpose: the end-to-end submission + redirect, with the same-origin guard against open-redirect.
  - _Leverage: `useSavePreferences` (task 11), reducer actions from task 13_
  - _Requirements: 7.5, 7.6, 7.7, 7.8, 8.4_

- [x] 31d. Delete the now-unused `useSaveLanguageProfiles` hook
  - File: `packages/api-client/src/hooks/useLanguageProfiles.ts` (modify — remove the `useSaveLanguageProfiles` export)
  - File: `packages/api-client/src/hooks/useLanguageProfiles.test.ts` (modify — delete the `useSaveLanguageProfiles` test cases)
  - File: `packages/api-client/src/index.ts` (modify — remove the `useSaveLanguageProfiles` re-export if present)
  - Confirm via `grep -r "useSaveLanguageProfiles" apps/ packages/ infra/` that no caller remains, then delete.
  - **Verify:** `pnpm typecheck && pnpm lint && pnpm test` from repo root.
  - Purpose: remove dead code per the CLAUDE.md "delete unused code" rule (no production data; no caller after 31c).
  - _Requirements: project hygiene (CLAUDE.md "delete unused code" rule — not tied to a numbered AC)_

- [x] 32a. Page integration tests — happy path + edit-mode pre-fill + error paths
  - File: `apps/web/app/onboarding/page.test.tsx` (create)
  - Cover (with mocked `useLanguageProfiles`, `useGetPreferences`, `useSavePreferences`, `useRouter`, `useSearchParams`):
    - **Happy path:** 0 profiles → wizard mounts on Step 1 → walk through Steps 1–4 → submit calls `useSavePreferences.mutate` with the expected payload → `router.push('/')`.
    - **Edit mode pre-fill:** profiles + prefs returned → all 4 steps pre-filled → final CTA reads "save changes →".
    - **4xx response:** inline error message visible, user remains on Step 4, primary CTA re-enabled.
    - **5xx / network error:** generic "something went wrong — try again." inline message visible.
  - **Verify:** `pnpm --filter @language-drill/web test page.test.tsx`.
  - Purpose: lock the happy path + the most common failure modes.
  - _Leverage: existing `apps/web/app/(dashboard)/drill/page.test.tsx` mocking patterns_
  - _Requirements: 1.1, 7.5, 7.7, 7.8, 8.1_

- [x] 32b. Page integration tests — redirect cases (referrer + returning-user skip)
  - File: `apps/web/app/onboarding/page.test.tsx` (modify — append)
  - Cover (mocking `window.location.origin` and `document.referrer`):
    - **Edit mode + same-origin referrer:** submit redirects to `document.referrer` exactly.
    - **Edit mode + cross-origin referrer:** submit falls back to `router.push('/settings')`.
    - **Edit mode + empty referrer:** submit falls back to `router.push('/settings')`.
    - **Returning user without `?edit=1`:** `router.replace('/')` is called and the wizard does not render (no Step 1 markup in the DOM).
  - **Verify:** `pnpm test`, `pnpm typecheck`, `pnpm lint` all pass green from repo root.
  - Purpose: lock the open-redirect guard and the redirect-on-mount behaviour.
  - _Leverage: vitest's `Object.defineProperty` pattern for stubbing `window.location` (already used in `apps/web/components/shell/__tests__/language-switcher.test.tsx`)_
  - _Requirements: 1.2, 7.6, 8.4_
