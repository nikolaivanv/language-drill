# Requirements Document

## Introduction

Replace the current single-page onboarding form with a 4-step conversational wizard plus a left coach pane. The flow gathers languages, primary language and CEFR level, learning goals, and daily time commitment, then persists everything via the **rewritten** `PUT /profiles/languages` endpoint (now requiring the full onboarding payload) plus a new `userPreferences` table.

This is the user's first impression of the app. It needs to feel personal and unhurried — the prototype's coach pane carries that voice. It also collects the signals (goals, schedule, nudges) that downstream phases (dashboard, session flow, debrief) depend on without forcing a synchronous placement test.

There is no production data yet, so we do **not** preserve backwards compatibility with the legacy minimal `{ profiles: [...] }` shape. The wizard is the sole caller of `PUT /profiles/languages`; existing tests will be updated to send the new full payload.

## Alignment with Product Vision

- **Active production over passive recognition.** Onboarding signals (goals, primary language, level) feed the daily plan (Phase D) and the per-skill mastery model — not a generic curriculum.
- **Honest skill-based progress.** The placement test placeholder is **disabled** with a "coming soon" callout per `docs/web-implementation-plan.md` (Phase 3+ feature). Users self-place at a CEFR band; the model refines from real exercise evidence.
- **Polyglot by default.** Languages are multi-select; `userLanguageProfiles` already supports multiple profiles per user.
- **No gamification.** "Gentle nudges" replaces streaks; the schedule step explicitly disclaims "no XP, no levels, no leaderboards."
- **Adapted from prototype.** Per `docs/web-implementation-plan.md` "Adjustments from original handoff": languages are limited to **ES, DE, TR** (matching the `Language` enum), the placement test is disabled, and the post-onboarding `streak` footer is dropped.

## Assumptions & Constraints

- The user reaches `/onboarding` via the dashboard layout's redirect (`apps/web/app/(dashboard)/layout.tsx`) when they have zero language profiles. The Clerk JWT and `getToken()` plumbing already exist (`useAuth` + `createAuthenticatedFetch`).
- The dashboard root path is `/` — the `(dashboard)` route group renders the today's-plan view there. There is no `/today` route. Onboarding's success redirect therefore goes to `/`.
- For the new-user flow, **only the primary language gets an explicit CEFR level**. Non-primary selected languages are persisted with `proficiencyLevel: A1` as a placeholder. Re-running onboarding via `?edit=1` is the supported path to change a per-language level until a richer per-language CEFR step is added in a later phase.
- A single new table, `userPreferences`, holds onboarding signals that don't belong on `userLanguageProfiles`: `primaryLanguage`, `goals`, `dailyMinutes`, `gentleNudges`, `notes`. Schema sketched in Requirement 7.
- `PUT /profiles/languages` requires the **full onboarding payload** on every call (profiles + primaryLanguage + goals + dailyMinutes + gentleNudges + notes). There is no production data yet, so we do not preserve the legacy minimal shape; the existing tests in `infra/lambda/src/routes/profiles.test.ts` are rewritten to send the full payload.
- EN is **not** a learning language and is rejected at both the API layer and the wizard. The Zod schema enforces ES/DE/TR only with `profiles.min(1).max(3)`.
- The default `gentleNudges` value is `true` everywhere it is referenced (UI default in Step 4, server default for missing rows in Requirement 9).
- The middle-dot in the coach-pane checklist summary ("ES · B2") is U+00B7 (`·`), matching the prototype.

## Requirements

### Requirement 1 — Multi-step wizard scaffolding

**User Story:** As a new user, I want a stepwise flow with clear progress and the ability to go back, so that I never feel committed to a choice before I've seen the whole picture.

#### Acceptance Criteria

1. WHEN the user lands on `/onboarding` AND has zero language profiles AND `?edit=1` is NOT present THEN the system SHALL render Step 1 of 4 by default.
2. WHEN the user lands on `/onboarding` AND has at least one language profile AND `?edit=1` is NOT present THEN the system SHALL redirect to `/` (the dashboard root).
3. WHEN the URL contains `?edit=1` AND the user has at least one language profile THEN the system SHALL pre-populate every step's fields from `GET /profiles/languages` and `GET /profiles/preferences` and SHALL render the "edit" header variant ("update your setup") with final CTA "save changes →".
4. WHEN the user is on any step except Step 1 THEN the system SHALL render a "back" control that returns to the previous step preserving entered data.
5. WHEN the user is on Step 1 THEN the back control SHALL be hidden (not just disabled).
6. WHEN the user advances or returns between steps THEN the system SHALL preserve all data already entered in any step.
7. WHEN any step is rendered THEN the system SHALL display a progress indicator showing the current step number out of total steps (e.g., "1 / 4") and a 4-segment progress bar where segments at or before the current step are filled.
8. WHEN the current step's required fields are not satisfied THEN the system SHALL disable the primary "continue" / "finish setup" / "save changes" CTA.

### Requirement 2 — Step 1: language selection

**User Story:** As a new user, I want to pick which languages I'm working on, so that the app knows what content to drill me on.

#### Acceptance Criteria

1. WHEN Step 1 is rendered THEN the system SHALL display a 2-column grid of 3 language tiles for **ES, DE, TR** (English is excluded — it is a source-only language for translation exercises, not a learning target).
2. WHEN a tile is rendered THEN it SHALL contain a `Flagdot`, the localized language name in lowercase ("español", "deutsch", "türkçe"), and a checkbox indicator that reflects selection state.
3. WHEN the user clicks a tile THEN the system SHALL toggle that language's selection state.
4. WHEN at least one language is selected THEN the "continue" CTA SHALL be enabled.
5. WHEN zero languages are selected THEN the "continue" CTA SHALL be disabled and the system SHALL NOT advance.
6. WHEN the step is rendered THEN it SHALL show the eyebrow `step 1`, the headline "which languages are you learning?", and the body "pick any you're working on — even ones you haven't started yet."
7. WHEN edit mode is active AND the user has only one language selected AND attempts to deselect it THEN the system SHALL keep the tile selected and SHALL display an inline `t-small` `ink-mute` message "you need at least one language — to fully reset, delete your account from settings."

### Requirement 3 — Step 2: primary language and CEFR level

**User Story:** As a new user, I want to declare my proficiency in my main language, so that exercises target the right level instead of restarting from A1.

#### Acceptance Criteria

1. WHEN Step 2 is rendered AND more than one language was selected in Step 1 THEN the system SHALL render a primary-language selector (single-select chip group) defaulted to the first selected language; otherwise the system SHALL skip the primary selector and treat the only selected language as primary.
2. WHEN edit mode is active THEN the primary-language selector SHALL be editable so the user can change which selected language is the primary.
3. WHEN the primary language is set THEN the headline SHALL render as "roughly, where are you with **<primary language name>**?" with the primary language wrapped in a `<span class="hilite">`.
4. WHEN Step 2 is rendered THEN the system SHALL display a vertical stack of 6 CEFR choice cards (A1, A2, B1, B2, C1, C2) using the level descriptions defined in the prototype (e.g., A1 — "beginner — basic phrases, hello / goodbye"; B2 — "upper int. — fluent on familiar topics, some friction").
5. WHEN the user selects a CEFR card THEN the system SHALL store that as the primary language's `proficiencyLevel`.
6. WHEN Step 2 is rendered THEN the system SHALL display a placement-test informational callout (`paper-2` background, dashed `--rule` border, hand-script "not sure?" + body "a 5-min adaptive placement test is coming soon — for now, pick the band that feels closest.") that is **strictly non-interactive**:
   - The callout SHALL NOT be a `<button>`, `<a>`, or have any `onClick`/`onKeyDown` handler.
   - The callout SHALL render as a non-interactive `<aside>` (or `<div role="note">`) with `cursor: default`.
   - The callout SHALL NOT be focusable (no `tabindex`) and SHALL NOT appear in the keyboard tab order.
7. WHEN no CEFR card is selected THEN the "continue" CTA SHALL be disabled.
8. WHEN the user advances past Step 2 AND non-primary languages were selected THEN the system SHALL persist those non-primary languages with `proficiencyLevel: A1` as a default.

### Requirement 4 — Step 3: goals and optional notes

**User Story:** As a new user, I want to indicate what I'm trying to improve, so that the daily plan prioritizes those skills.

#### Acceptance Criteria

1. WHEN Step 3 is rendered at viewport widths ≥600px THEN the system SHALL display a 2-column × 3-row grid of 6 goal tiles (multi-select); WHEN viewport width is <600px THEN the grid SHALL collapse to a single column. Goal list:
   - 📝 **grammar** — "subjunctive, tenses, conjugation"
   - 🗣 **speaking fluency** — "real conversations, less hesitation"
   - 🎧 **understanding fast speech** — "podcasts, native speakers, films"
   - ✍️ **writing** — "emails, essays, longer texts"
   - 📚 **vocabulary** — "expanding active range"
   - 🎯 **prep for a trip / convo** — "specific upcoming need"
2. WHEN the user clicks a goal tile THEN the system SHALL toggle its selection state.
3. WHEN Step 3 is rendered THEN the system SHALL display an optional `Textarea` labeled "anything specific i should know? (optional)" with placeholder "e.g. I keep mixing up preterite vs imperfect…" and a 500-character limit.
4. WHEN the user has selected zero goals AND the Textarea is empty THEN the "continue" CTA SHALL still be enabled (Step 3 is fully optional).
5. IF the user enters notes longer than 500 characters THEN the system SHALL show an inline character-count warning and the "continue" CTA SHALL be disabled.
6. WHEN the notes field is submitted to the server THEN the value SHALL be trimmed of leading/trailing whitespace and CRLF line endings normalised to LF before persistence.

### Requirement 5 — Step 4: daily time and gentle nudges

**User Story:** As a new user, I want to set how much time I can give per day and whether I want reminders, so that the app respects my schedule without nagging me.

#### Acceptance Criteria

1. WHEN Step 4 is rendered at viewport widths ≥600px THEN the system SHALL display a 4-column grid of choice tiles for `5`, `10`, `20`, `30` minutes (single-select), each tile showing the number in `t-display-m` and the caption "min / day"; WHEN viewport width is <600px THEN the grid SHALL collapse to a 2×2 layout.
2. WHEN no daily time is selected AND the user has not previously saved one THEN the system SHALL default the selection to `10` minutes.
3. WHEN Step 4 is rendered THEN the system SHALL display a `Card` containing a `Checkbox` labeled "gentle nudges on quiet days" with body "no streak shaming. one calm note if you've missed two days, never more." defaulted to `checked`.
4. WHEN Step 4 is rendered THEN the system SHALL display a hand-script note "p.s. no XP, no levels, no leaderboards. honest skill numbers only." in `t-hand` with the `accent` color for "p.s.".
5. WHEN a daily time is selected THEN the primary CTA SHALL read "finish setup →" (new-user) or "save changes →" (edit) and SHALL be enabled.
6. WHEN the user clicks the primary CTA THEN the system SHALL submit all collected data (Requirement 7).

### Requirement 6 — Coach pane (left rail)

**User Story:** As a new user, I want a calm coach presence that explains what's happening at each step, so that the flow feels guided rather than transactional.

#### Acceptance Criteria

1. WHEN any step is rendered at viewport widths ≥900px THEN the system SHALL display a 320px-wide left coach rail with `paper-2` background and a 1px `rule` right border.
2. WHEN the rail is rendered THEN the top SHALL show the existing `Brand` component, then a 44×44px avatar circle (`ink` background, `paper` text, "c" glyph in `t-display-s`) labeled "coach" with sub-label "your AI tutor".
3. WHEN any step is rendered THEN the rail SHALL show a Card-bordered message box containing the per-step coach message:
   - Step 1: "let's start with languages. you can add more later."
   - Step 2: "for <primary language name> — where would you place yourself? rough is fine."
   - Step 3: "what do you want to drill? pick whatever fits — even all of them."
   - Step 4: "last thing — how much time can you usually give me?"
4. WHEN the rail is rendered THEN it SHALL show a "so far" checklist below the message box, with one row per step displaying:
   - `✓` (in `ok` color) if the step is completed,
   - `●` (in `accent` color) if it is the current step,
   - `○` (in `ink-mute`) if it is pending.
5. WHEN a step row in the checklist is completed THEN it SHALL display a short summary value:
   - languages: "N selected"
   - primary + level: "<lang code uppercase> · <CEFR code>" using `·` (U+00B7), e.g., "ES · B2"
   - goals: "N picked" (or "none" if zero)
   - schedule: "N min/day"
6. WHEN the user has selected non-primary languages AND has reached or passed Step 2 THEN the "languages" checklist row SHALL include a `t-small` sub-line "level: a1 (adjustable later)" so the placeholder default is discoverable.
7. WHEN the rail is rendered THEN the bottom SHALL show a `t-hand` `ink-mute` note "~2 min total · skip anything".
8. WHEN the viewport width is <900px THEN the coach rail SHALL collapse: only the brand + per-step coach message box render at the top of the right pane (above the progress bar). The avatar, checklist, and footer note are hidden. The collapsed coach message box SHALL be `aria-hidden="true"` if the same content is otherwise duplicated, otherwise `aria-live="polite"`.

### Requirement 7 — Submission and persistence

**User Story:** As a new user, I want my onboarding choices saved so that I land on a personalised dashboard.

#### Acceptance Criteria

1. WHEN the user clicks the primary CTA on Step 4 THEN the client SHALL call `PUT /profiles/languages` with a body containing **all** of the following fields:
   - `profiles[]` — one entry per selected language with `language` and `proficiencyLevel` (primary uses the chosen CEFR; non-primary default to `A1`)
   - `primaryLanguage` — the language code chosen as primary (or the only selected language)
   - `goals[]` — array of goal IDs from the canonical list (empty array if none selected)
   - `dailyMinutes` — `5 | 10 | 20 | 30`
   - `gentleNudges` — boolean
   - `notes` — string up to 500 chars (empty string if not provided)
2. WHEN the server receives a valid request THEN it SHALL atomically (single Drizzle transaction) replace the user's `userLanguageProfiles` rows AND upsert the user's `userPreferences` row.
3. WHEN the request succeeds in new-user mode THEN the client SHALL navigate to `/` (the dashboard root in the `(dashboard)` route group).
4. WHEN the request succeeds in edit mode THEN the client SHALL navigate to `document.referrer` if it is same-origin, else to `/settings`.
5. IF the request fails with a 4xx error THEN the system SHALL display the validation message inline at the bottom of the right pane (above the action footer) and SHALL keep the user on Step 4.
6. IF the request fails with a 5xx error or network error THEN the system SHALL display a generic "something went wrong — try again" message inline and re-enable the primary CTA.
7. WHEN the request is in flight THEN the primary CTA SHALL show its `loading` state and SHALL be disabled.
8. WHEN this requirement is implemented THEN the new `userPreferences` table SHALL exist with the following Drizzle schema:
    - `userId` — `text` PRIMARY KEY, FOREIGN KEY → `users.id` ON DELETE CASCADE
    - `primaryLanguage` — `text` (Language enum value), NOT NULL
    - `goals` — `jsonb` (array of goal IDs), NOT NULL DEFAULT `[]`
    - `dailyMinutes` — `smallint`, NOT NULL
    - `gentleNudges` — `boolean`, NOT NULL DEFAULT `true`
    - `notes` — `text`, NOT NULL DEFAULT `''`
    - `updatedAt` — `timestamp with time zone`, NOT NULL DEFAULT `now()`

### Requirement 8 — Edit mode

**User Story:** As an existing user, I want to revisit onboarding from Settings to update my languages, level, goals, or schedule.

#### Acceptance Criteria

1. WHEN the URL is `/onboarding?edit=1` AND the user has at least one language profile THEN the system SHALL pre-fill all 4 steps from `GET /profiles/languages` (existing endpoint — no changes required) and `GET /profiles/preferences` (new endpoint, see Requirement 9).
2. WHEN edit mode is active THEN the right-pane page header SHALL read "update your setup" and the final CTA SHALL read "save changes →".
3. WHEN edit mode is active THEN the user SHALL be able to change any value collected by any step, including which language is `primaryLanguage`.
4. WHEN the user submits in edit mode THEN the success redirect SHALL go to `document.referrer` if same-origin, else `/settings` (NOT `/`).
5. WHEN edit mode is active AND the user is on Step 1 THEN the back control SHALL still be hidden but a "cancel" ghost link SHALL be shown in the right-pane footer linking to `document.referrer` (or `/settings` if no same-origin referrer).

### Requirement 9 — Preferences read endpoint

**User Story:** As any client (web now, mobile later), I want a single endpoint that returns my saved onboarding preferences, so that the dashboard, settings, and re-onboarding can all hydrate from the same source.

#### Acceptance Criteria

1. WHEN the client calls `GET /profiles/preferences` with a valid Clerk JWT THEN the server SHALL return `{ primaryLanguage, goals, dailyMinutes, gentleNudges, notes }` from the user's `userPreferences` row.
2. IF the user has no `userPreferences` row THEN the server SHALL return `{ primaryLanguage: null, goals: [], dailyMinutes: null, gentleNudges: true, notes: '' }`.
3. IF the JWT is missing or invalid THEN the server SHALL return 401 with `{ code: 'MISSING_SUB' }` (matching the existing `profiles.ts` auth pattern).
4. WHEN `PUT /profiles/languages` writes new preferences THEN a subsequent `GET /profiles/preferences` for the same user SHALL return the new values.

## Non-Functional Requirements

### Performance
- The first-paint of `/onboarding` SHALL render Step 1 within 200ms after the dashboard layout determines the user has zero profiles.
- Step transitions SHALL be instant (no loading state) — all data is held in client state until the final submit.
- The bundled JS for the onboarding route SHALL be no larger than 35KB gzipped (no TanStack Query — a single mutation suffices).

### Security
- All API calls SHALL include the Clerk JWT via `createAuthenticatedFetch` from `@language-drill/api-client` (no new auth code).
- Server-side validation (Zod) SHALL reject:
  - `language` values not in the `Language` enum
  - `proficiencyLevel` values not in the `CefrLevel` enum
  - duplicate `language` values in `profiles[]`
  - `dailyMinutes` not in `{5, 10, 20, 30}`
  - `goals[]` entries not in the canonical goal-id list (`grammar`, `speaking`, `listening`, `writing`, `vocab`, `travel`)
  - `notes` longer than 500 characters
  - `primaryLanguage` not present in the submitted `profiles[]` languages
- The new `userPreferences` table SHALL have a foreign key to `users.id` with `ON DELETE CASCADE`.

### Reliability
- `PUT /profiles/languages` SHALL be atomic: profiles + preferences write happens in a single Drizzle transaction so a partial save is impossible.
- The client SHALL NOT submit on Step 4 if any required field is invalid (defence-in-depth alongside server validation).
- The existing `PUT /profiles/languages` tests in `infra/lambda/src/routes/profiles.test.ts` SHALL be rewritten to use the new full payload (no production data depends on the legacy shape).

### Usability
- All copy SHALL be lowercase per the established design system voice (matching the prototype and existing pages), with the exception of language code abbreviations (`ES`, `DE`, `TR`) and CEFR codes (`A1`–`C2`) which remain uppercase.
- The flow SHALL be keyboard-navigable: `Tab` cycles within the step, `Enter` on the primary CTA advances, `Esc` does nothing (no modal to close).
- Step transitions SHALL include a 250ms fade-in matching the prototype's `.fade-in` animation, but SHALL respect `prefers-reduced-motion: reduce` (no animation when reduced motion is requested).
- All form controls SHALL meet WCAG 2.1 AA contrast (already covered by design tokens).

## Out of Scope

The following are explicitly **not** part of this spec and live in later phases or separate work:

- **Backwards compatibility with the legacy `{ profiles: [...] }` shape.** No production data exists yet; the wizard is the only caller and always sends the full payload.
- **Partial-update support for `userPreferences`.** When `/settings` grows real edit affordances in Phase 3+, it can call a dedicated `PATCH /profiles/preferences` endpoint or just resubmit the full `PUT /profiles/languages` payload. We do not introduce a partial-write code path here.
- **Per-language CEFR collection during onboarding.** Only the primary language gets an explicit level; non-primary languages default to `A1`. Per-language CEFR adjustment is planned for the `/settings` page in Phase 3+.
- **Live placement test.** Step 2's callout is informational only; the actual adaptive test is Phase 3+ per `docs/web-implementation-plan.md`.
- **Mobile-specific layout.** The desktop-first design with a coach-pane collapse rule at <900px is intentional. A bespoke mobile onboarding (matching `prototypes/mobile/`) lives in the mobile (Expo) phase.
- **Telemetry / analytics events.** No event instrumentation is specified here.
- **Post-onboarding tutorial overlay or dashboard tour.** The dashboard's first-run UX is part of Phase D.
- **Server-side rate limiting** of `PUT /profiles/languages`. Existing API-Gateway / Upstash protections (per `CLAUDE.md`) apply to the route as-is; no new limits are introduced.
- **Notification delivery for "gentle nudges".** This requirement only persists the `gentleNudges` preference; the actual nudge-sending mechanism is Phase 4+.
