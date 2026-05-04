# Requirements Document

## Introduction

Phase E of `docs/web-implementation-plan.md`. Today, `/drill` shows one exercise at a time, with no concept of a "session." Each exercise is an isolated event — there is no top progress bar, no continuity between items, and no per-session accuracy view.

This phase introduces **multi-exercise sessions**: a fixed-length sequence of N exercises (default 5) bundled into a server-tracked entity. The session frame wraps the existing exercise renderers (`ClozeExercise`, `TranslationExercise`, `VocabExercise`) without changing them. The user advances item-by-item with a top progress bar reflecting position; on completion, a lightweight summary screen reports count correct / accuracy and offers "another session" or "done."

Phase E intentionally does **not** include the rich per-item review tabs or skill-delta bars from `feedback.jsx` — those are Phase G (debrief). Phase E ships the minimum frame that makes Phase G possible.

## Alignment with Product Vision

- **Active production over passive recognition** — sessions are an unmetered commitment to N items, not a single dabble. Reinforces the "between italki sessions" positioning by treating practice as a deliberate block.
- **No streaks, no XP** — the session summary reports accuracy and item count only; no XP awarded, no streak counter (`CLAUDE.md` hard rule).
- **Skill-based progress signal** — by tagging each `user_exercise_history` row with a `sessionId`, we unlock per-session progress analytics required by Phase G (debrief) and Phase D (dashboard's "today's plan").
- **API-first** — the new `practiceSessions` table and `/sessions` routes live in the Lambda API, reachable from the future Expo mobile app without rework.

## Requirements

### Requirement 1 — Session creation

**User Story:** As a learner, when I open the drill page I want a fresh N-item session created for my active language and proficiency, so that I have a clear practice block instead of an open-ended single-exercise loop.

#### Acceptance Criteria

1. WHEN the drill page loads with no `?sessionId` query parameter THEN the page SHALL POST `/sessions` with `{ language, difficulty, exerciseCount }` and render the first exercise from the returned manifest.
2. IF the user has at least one language profile THEN the page SHALL default `language` to `activeLanguage` from the shell context and `difficulty` to that profile's `proficiencyLevel`.
3. IF the user has zero language profiles THEN the page SHALL skip session creation and render the existing "no profiles" placeholder unchanged.
4. WHEN `POST /sessions` succeeds THEN the response body SHALL contain `{ id: string, exercises: ExerciseResponse[] }` where `exercises.length === exerciseCount`.
5. WHEN the user changes language or difficulty via the existing selectors THEN the page SHALL discard the in-progress session and create a new session with the new filters. The discarded session row SHALL be left in the database with `completed_at = NULL` (treated as "abandoned" — explicitly OUT OF SCOPE for v1: server-side cleanup, resumption, or marking with an explicit `abandoned` status).
6. IF the requested `(language, difficulty)` filter has fewer than `exerciseCount` matching exercises THEN `POST /sessions` SHALL return HTTP 422 with `code: 'INSUFFICIENT_EXERCISES'`, and the page SHALL render the existing "no exercises available" card.

### Requirement 2 — Top progress bar reflects session position

**User Story:** As a learner, I want to see a top progress bar that fills as I advance through items, so that I always know how much of the session remains.

#### Acceptance Criteria

1. WHEN a session is in progress THEN `DrillLayout`'s `progressFraction` SHALL equal `completedItems / exerciseCount`, where `completedItems` is the number of items the user has submitted (regardless of correctness).
2. WHEN the user submits the current item THEN the progress bar SHALL animate to its new fraction within 300ms (existing `transition-[width] duration-300` on `DrillLayout`).
3. WHEN no session exists yet (initial render, error state, no profiles) THEN `progressFraction` SHALL be `0`.
4. WHEN the session reaches the summary screen (all items completed) THEN `progressFraction` SHALL be `1`.

### Requirement 3 — Per-item navigation

**User Story:** As a learner, I want to evaluate the current item, see the verdict, and click "next" to move on, so that the rhythm of practice is uninterrupted.

#### Acceptance Criteria

1. WHEN the user submits an answer THEN the page SHALL evaluate via the existing `POST /exercises/:id/submit` flow and display the verdict using the existing `FeedbackShell` / per-type evaluated views.
2. WHEN the verdict is shown AND the current item index is `< exerciseCount - 1` THEN the "next" button SHALL advance to the next exercise from the manifest, reset submission state to `idle`, and clear theory panel state.
3. WHEN the verdict is shown AND the current item index is `exerciseCount - 1` (last item) THEN the next button label SHALL read "see results" and clicking it SHALL POST `/sessions/:id/complete` and route to the summary view.
4. WHEN the user attempts backward navigation (browser back, "previous" intent) within a session THEN the page SHALL NOT re-render a prior item; v1 is forward-only and each verdict is final once submitted.
5. WHEN no answer has been submitted for the current item THEN the page SHALL NOT advance regardless of any other UI events.

### Requirement 4 — Session summary screen

**User Story:** As a learner, after I finish a session I want a brief summary that tells me how many I got right and offers an obvious next step, so that I can decide whether to keep going.

#### Acceptance Criteria

1. WHEN `POST /sessions/:id/complete` returns successfully THEN the page SHALL render a summary view containing: session duration formatted `mm:ss` from the server-provided `durationSeconds`, the line `correctCount of exerciseCount` (with `skippedCount` shown separately if `> 0`), accuracy percentage computed as `correctCount / attemptedCount` (where `attemptedCount = exerciseCount - skippedCount`; if `attemptedCount === 0` accuracy is shown as `—`), and two CTA buttons: "another session" and "done."
2. WHEN the user clicks "another session" THEN the page SHALL create a new session with the same `language` and `difficulty` and reset the UI to the first item.
3. WHEN the user clicks "done" THEN the page SHALL navigate to `/` (root, which Phase D will replace with the dashboard).
4. WHEN the summary screen renders THEN it SHALL NOT display: streak counter, XP, skill-delta bars, per-item review cards, or coach narrative beyond a single congratulatory line. (Those are Phase G scope.)
5. WHEN the summary screen renders THEN the progress bar SHALL be at `1.0` exactly and the coach rail SHALL NOT render a "next exercise" state.

### Requirement 5 — Server-side session persistence

**User Story:** As the system, I want each session and its manifest stored in Postgres so that submissions can be tagged with `sessionId`, downstream analytics work, and (in v1.1+) interrupted sessions can be resumed.

#### Acceptance Criteria

1. THE DATABASE SHALL contain a `practice_sessions` table with columns: `id` (uuid pk), `user_id` (text fk → users), `language` (text), `difficulty` (text), `exercise_count` (smallint), `correct_count` (smallint default 0), `exercise_ids` (jsonb — ordered array of uuids), `started_at` (timestamptz default now), `completed_at` (timestamptz nullable).
2. THE `user_exercise_history` TABLE SHALL gain a nullable `session_id` (uuid fk → practice_sessions) column. Existing rows SHALL remain valid with `session_id` NULL.
3. WHEN `POST /sessions` is called THEN the API SHALL insert a `practice_sessions` row with `exercise_ids` populated, `started_at` set, and `completed_at` NULL.
4. WHEN `POST /exercises/:id/submit` is called with a body containing `sessionId` THEN the API SHALL verify the session belongs to the calling user, is not yet completed, and `:id` is in its `exercise_ids` manifest. IF any check fails THEN the API SHALL return HTTP 400 `code: 'INVALID_SESSION'` and SHALL NOT call Claude.
5. WHEN a `user_exercise_history` row is inserted by the submit endpoint AND a valid `sessionId` was provided THEN the row SHALL have `session_id` set to that value.
6. WHEN `POST /sessions/:id/complete` is called THEN the API SHALL set `completed_at = now()` and `correct_count = (count of user_exercise_history rows for this session_id with score >= CORRECT_THRESHOLD)`, where `CORRECT_THRESHOLD` is a named constant exported from `@language-drill/shared` (initial value: `0.7`, matching the `solid` tier in `apps/web/lib/drill/verdict-tier.ts`). The endpoint SHALL return `{ id, exerciseCount, correctCount, attemptedCount, skippedCount, durationSeconds }` where `attemptedCount` is the number of distinct `exercise_ids` with at least one history row for this session and `skippedCount = exerciseCount - attemptedCount`.
7. IF `POST /sessions/:id/complete` is called on a session not owned by the user, or already completed, THEN the API SHALL return HTTP 400 `code: 'INVALID_SESSION'`.

### Requirement 6 — Mid-session error handling

**User Story:** As a learner, when something goes wrong mid-session (rate limit, network blip), I want to understand what happened and recover without losing progress.

#### Acceptance Criteria

1. WHEN `POST /exercises/:id/submit` returns HTTP 429 (`RATE_LIMIT_EXCEEDED`) THEN the page SHALL render the existing rate-limit `SubmissionErrorCard` with an additional "end session early" button that calls `POST /sessions/:id/complete` and routes to the summary.
2. WHEN `POST /exercises/:id/submit` returns HTTP 502 (`AI_UNAVAILABLE`) or any other 5xx THEN the page SHALL render `SubmissionErrorCard` with "try again" (re-submits the same answer) and "skip item" (advances to the next item without recording history).
3. WHEN the user "skip item" advances past an unsubmitted item THEN that item SHALL count toward `completedItems` for progress-bar purposes; it SHALL NOT contribute to `correctCount` (no history row exists for it); and on the summary it SHALL be excluded from the `attemptedCount` denominator for accuracy (Req 4.1).
4. WHEN `POST /sessions` itself fails THEN the page SHALL render an error card with a "retry" button and SHALL NOT render the exercise pane.

### Requirement 7 — Backward-compatible drill route

**User Story:** As a developer, I want the existing `/drill` route to switch from single-exercise mode to session mode without breaking deep links or shell navigation.

#### Acceptance Criteria

1. THE `/drill` ROUTE SHALL continue to exist (no rename, no redirect). Its component is rewritten to be a session host.
2. THE EXISTING UI PRIMITIVES (`DrillLayout`, `CoachRail`, `ExercisePane`, `FeedbackShell`, theory panel triggers, accent picker) SHALL be reused unmodified except where Requirement 3.3 requires the "next" button label change.
3. THE EXISTING `useExercise` AND `useSubmitAnswer` HOOKS SHALL remain in `@language-drill/api-client` for backwards compatibility (the mobile app, when added, may still want single-exercise mode); they SHALL NOT be removed.
4. NEW SESSION HOOKS (`useCreateSession`, `useCompleteSession`) SHALL be added alongside, not replacing, the existing exercise hooks.

## v1 Non-Goals

These are explicitly deferred and SHALL NOT be implemented in this phase:

- **Session resumption.** If the user closes the tab or navigates away mid-session, returning to `/drill` creates a fresh session; the prior `practice_sessions` row is left orphaned (`completed_at = NULL`). Resumption UI and an `abandoned` status enum are deferred to v1.1+.
- **Backward navigation.** No "previous item" affordance. Forward-only flow keeps the state machine trivial (Req 3.4).
- **Per-item review tabs / skill-delta bars / coach debrief narrative.** These are the entire scope of Phase G (debrief).
- **Heterogeneous session manifests.** All N items in a v1 session share `(language, difficulty)`. Mixed-type / mixed-skill plans (per the dashboard timeline mock) are Phase D.
- **Session pacing or time limits.** No timer, no per-item countdown.
- **Persistent session selectors.** Language/difficulty are read from the active-language context and the matching profile at session-creation time; we do not surface per-session overrides beyond the existing selectors.

## Non-Functional Requirements

### Performance

- `POST /sessions` SHALL pre-fetch all N exercise rows in a single query (`ORDER BY random() LIMIT N`) so that the session manifest is fully resolved before the user sees the first item; the client SHALL NOT round-trip per item to the existing `GET /exercises` endpoint.
- The session page initial render time after `POST /sessions` resolves SHALL be ≤ 100ms in dev mode (no per-item refetch, manifest already in client state).

### Security

- `practice_sessions` rows SHALL only be readable/writable by their owning user. The submit endpoint SHALL verify session ownership before accepting `sessionId` (Requirement 5.4).
- The `POST /sessions/:id/complete` endpoint SHALL be idempotent on re-completion attempts (returns HTTP 400 with `INVALID_SESSION`, never double-counts).

### Reliability

- Rate-limit hits mid-session SHALL not corrupt session state; the user can always reach `POST /sessions/:id/complete` to finalize a partial session (Requirement 6.1).
- Migration `0003_*.sql` SHALL be forward-only and use `ALTER TABLE ... ADD COLUMN session_id uuid` with no default, so existing `user_exercise_history` rows are unaffected.

### Usability

- The progress bar increment SHALL be visible (≥ 1px change for `exerciseCount = 5`) — already satisfied by the existing 100% width bar.
- The summary screen SHALL be reachable in ≤ 1 click from the last item's verdict (Requirement 3.3).
- The session length SHALL be configurable as a constant `DEFAULT_EXERCISE_COUNT` in `apps/web/lib/drill/session-config.ts`, defaulting to `5` to match the dashboard timeline shown in `prototypes/web/hifi/dashboard.jsx`.
