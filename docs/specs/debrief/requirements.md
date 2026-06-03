# Requirements Document

## Introduction

Phase G replaces the lightweight `SessionSummary` card (Phase E) with a dedicated post-session debrief screen at `/drill/debrief/[sessionId]`. The debrief is the user's reward for finishing a session: an editorial header with accuracy + coach copy, a tabbed area showing **Debrief** (coach narrative + "what's next") and **Review** (per-item diff list), and an action footer.

This is the first screen that gives the user a memorable, full-page outcome — essential for motivation in the absence of streaks/XP. It is also the first place the app surfaces the per-item evaluation history outside of the live drill, which sets the foundation for later progress-tracking integrations.

This spec deliberately scopes **skill deltas** (the prototype's "subjunctive · doubt clauses 71 → 78" bars) **out of v1**: the app has no per-topic mastery store yet (CEFR estimate work is later — see `docs/progress-tracking.md`). Once that store exists (likely paired with the `/progress` page's mastery grid), skill deltas can be added to the same endpoint and Debrief tab without breaking changes.

## Alignment with Product Vision

- **Active production over passive consumption** (`product.md` §2.1): The Review tab puts the user's typed answer next to the reference and Claude's per-item explanation — converting one session's output into a structured retrospective.
- **Honest skill-based progress** (`product.md` §2.2): No streaks, no XP, no "you're on a 12-day roll." The header reports accuracy and seconds-per-item; the Debrief tab gives a coach narrative tied to what the user actually did. The route deliberately omits anything that could be read as gamification.
- **Polyglot / per-language scope** (`product.md` §2.3): Debrief is keyed by `sessionId`, which already carries `(language, difficulty)`. Switching languages mid-debrief is irrelevant — the user is reviewing one finished session.
- **Phase plan** (`tech.md` §14): Sits in Phase 1 — "Core exercises … basic progress dashboard." Phase G is the editorial bridge between a single session and the per-skill dashboard work in Phase I.

## Requirements

### Requirement 1 — Routing and entry

**User Story:** As a learner who has just finished a 5-item drill session, I want to land on a dedicated debrief page rather than a small summary card, so that I get a clear sense of what I just did and where to go next.

#### Acceptance Criteria

1. WHEN the user clicks "see results" on the last item of a session AND `useCompleteSession` resolves successfully, THEN the drill page SHALL navigate the browser to `/drill/debrief/[sessionId]` (replacing the current in-page `SessionSummary` card).
2. WHEN the user clicks "end session early" on a rate-limit error card AND `useCompleteSession` resolves successfully, THEN the drill page SHALL navigate to `/drill/debrief/[sessionId]` for the same session.
3. IF `useCompleteSession` fails (network or server error), THEN the drill page SHALL keep the user on `/drill` and surface the existing complete-error fallback (no navigation occurs).
4. WHEN the user navigates directly to `/drill/debrief/[sessionId]` for a session they own that is completed, THEN the page SHALL render the full debrief view.
5. IF the user is unauthenticated, THEN the page SHALL redirect to the existing sign-in route (the same auth gate as `/drill`), no debrief data SHALL be fetched server-side without a JWT.
6. WHEN the user navigates to `/drill/debrief/[sessionId]` for a session they do NOT own, OR for an `id` that does not exist, OR for a session whose `completed_at IS NULL`, THEN the API SHALL return HTTP 404 and the page SHALL render a "session not found" state with a "back to drill" button.

### Requirement 2 — Debrief endpoint contract

**User Story:** As the debrief page, I want one round-trip to load every datum I need, so that the screen renders without waterfall fetches and remains responsive on slow networks.

#### Acceptance Criteria

1. WHEN the client calls `GET /sessions/:id/debrief` with a valid Clerk JWT, THEN the server SHALL respond with a single JSON payload including: session metadata (id, language, difficulty, startedAt, completedAt, durationSeconds), aggregate counters (exerciseCount, correctCount, attemptedCount, skippedCount), and a `items` array — one entry per exercise in the original manifest, in manifest order.
2. WHEN multiple `user_exercise_history` rows exist for the same `(session_id, exercise_id)` (retry submissions), THEN the response item SHALL reflect the **most recent** submission (`max(evaluated_at)`) — score, user answer, and evaluation are taken from that row. Earlier submissions for the same item SHALL NOT appear in the response; v1 debrief is a single-pass retrospective.
3. WHEN the manifest contains an exercise that has no `user_exercise_history` row for this session, THEN the response item SHALL set `status: 'skipped'`, `userAnswer: null`, `score: null`, `evaluation: null`.
4. WHEN a manifest exercise has a most-recent `score >= CORRECT_THRESHOLD` (0.7), THEN its item SHALL set `status: 'correct'`; otherwise `status: 'incorrect'` (when attempted) or `'skipped'` (when not).
5. IF the requesting user does not own the session, OR `completed_at IS NULL`, OR the id does not exist, THEN the server SHALL respond HTTP 404 `{ error, code: 'SESSION_NOT_FOUND' }` (404 — never 403 — to avoid leaking session existence across users).
6. WHEN the response includes `items[i].contentJson`, THEN it SHALL be the exact `contentJson` from the `exercises` table at debrief-time (not a snapshot from session creation). The seed/pregeneration pipeline treats exercise rows as immutable once inserted; this is captured as a project invariant in the seed script. (If that invariant is ever violated, the design phase will need to revisit by snapshotting `contentJson` into `responseJson` at submit time.)
7. WHEN the response is computed, THEN the server SHALL run NO Claude calls and write NO new rows; the endpoint is a pure read.
8. WHEN the response includes `durationSeconds`, THEN it SHALL be `floor((completedAt - startedAt) / 1000)` — server-authoritative, identical to the Phase E `CompleteSessionResponse.durationSeconds` formula in `infra/lambda/src/routes/sessions.ts`.
9. WHEN the response includes `attemptedCount`, THEN its semantics SHALL match Phase E: count of distinct `exercise_id` values in `user_exercise_history` for this `session_id`. Therefore `skippedCount = exerciseCount - attemptedCount`.

### Requirement 3 — Header

**User Story:** As a learner reading the debrief, I want a single editorial header that tells me how the session went, so that I can decide whether to celebrate or to dig into the review.

#### Acceptance Criteria

1. WHEN the debrief page renders successfully, THEN the header SHALL include: an eyebrow line ("session done · `mm:ss`"), a display title that varies by accuracy tier, and a body line containing "you got X of Y · accuracy Z%" (Z is `Math.round((correctCount / attemptedCount) * 100)`; `attemptedCount === 0` → display "—" for accuracy). The accuracy denominator semantics match `CompleteSessionResponse.attemptedCount` from Phase E.
2. WHEN `correctCount / attemptedCount >= 0.8`, THEN the title SHALL be "nice work."
3. WHEN `correctCount / attemptedCount >= 0.5` AND `< 0.8`, THEN the title SHALL be "good attempt."
4. WHEN `correctCount / attemptedCount < 0.5` (or `attemptedCount === 0`), THEN the title SHALL be "back next time?"
5. WHEN `skippedCount > 0`, THEN the body line SHALL include " · `skippedCount` skipped" appended after the accuracy.
6. The header SHALL NOT mention streaks, XP, levels, days-in-a-row, or any time-based gamification (CLAUDE.md hard rule).
7. All header copy SHALL be lowercase per the design system (eyebrow, titles, body) — matches the prototype and the rest of Phase F.

### Requirement 4 — Debrief tab (default)

**User Story:** As a learner, I want a short coach narrative that summarizes what happened, so that I don't have to read every item to feel oriented.

#### Acceptance Criteria

1. WHEN the page renders, THEN the **Debrief** tab SHALL be selected by default.
2. The Debrief tab SHALL render a single coach card (avatar + speech bubble) containing 1–2 short paragraphs of templated narrative copy (no AI call, no per-session generation in v1) chosen from the same accuracy tiers used in the header (≥ 0.8 / ≥ 0.5 / < 0.5).
3. The narrative SHALL reference the session's language at least once (e.g., "your spanish run" / "your german run") and the count of items practiced.
4. The Debrief tab SHALL include a "what's next" callout: a single short suggestion linking to one downstream route. The link SHALL be chosen by accuracy: `accuracy >= 0.8` → link to `/progress` (review what moved); `accuracy < 0.8` (or `attemptedCount === 0`) → link to `/drill` (try another session). Both targets exist as of Phase B; never link to features that don't.
5. The Debrief tab SHALL NOT render a skill-delta section in v1. (Deferred — see Introduction.)

### Requirement 5 — Review tab (per-item)

**User Story:** As a learner, I want to scroll through the items I just did and see where I went wrong on each one, so that I can spot patterns without re-doing the drill.

#### Acceptance Criteria

1. WHEN the user switches to the **Review** tab, THEN the page SHALL render one card per manifest item, in manifest order.
2. WHEN an item's `status === 'correct'`, THEN its card SHALL show a sage "✓ correct" chip; the user's answer is rendered with `correct` styling per the type-specific layouts in 5.5–5.7.
3. WHEN an item's `status === 'incorrect'`, THEN its card SHALL show a terracotta "✗ missed" chip; the user's answer is rendered with `incorrect` styling (per the type-specific layouts in 5.5–5.7), and the Claude `feedback` text from `evaluation.feedback` is rendered below the answer/reference cells.
4. WHEN an item's `status === 'skipped'`, THEN its card SHALL show a paper-3 "skipped" chip, the prompt only, no user answer, and a small caption "skipped — no submission".
5. WHEN an item is `'cloze'` AND attempted, THEN the card SHALL render two cells: "your answer" with the sentence containing the user's fill in a tinted token (sage on correct, terracotta with strike-through on incorrect), and "corrected" / "why it works" with the sentence containing the reference fill in a green-bordered token. Matches the Phase F cloze feedback pattern.
6. WHEN an item is `'translation'` AND attempted, THEN the card SHALL render two cells side by side: "your translation" with the user's text, and "reference" / "one accepted form" with `referenceTranslation`. Matches the Phase F translation feedback pattern.
7. WHEN an item is `'vocab_recall'` AND attempted, THEN the card SHALL render the prompt definition as an italic line, then two cells: "you typed" with the user's answer, and "target word" with `expectedWord` and an example sentence below.
8. The Review tab SHALL NOT show the per-item theory trigger or the live theory panel — debrief is read-only retrospective, not active drilling.
9. Item cards SHALL be expand/collapse: correct items SHALL default to collapsed (one-line summary), incorrect and skipped items SHALL default to expanded. Expand state SHALL be local per card and SHALL NOT persist across reloads, tab switches, or navigation.

### Requirement 6 — Action footer

**User Story:** As a learner who just read the debrief, I want clear next steps so that I'm not dropped into a dead end.

#### Acceptance Criteria

1. WHEN the page renders, THEN a sticky action footer (or a footer pinned to the end of the content) SHALL render three actions: primary "another session", ghost "see your progress →", ghost "done".
2. WHEN the user clicks "another session", THEN the page SHALL `router.push('/drill')` — the drill page kicks off a fresh session with the user's current `(activeLanguage, difficulty)` (the existing Phase E auto-create effect handles this).
3. WHEN the user clicks "see your progress →", THEN the page SHALL `router.push('/progress')`.
4. WHEN the user clicks "done", THEN the page SHALL `router.push('/')` (dashboard / today's plan).

### Requirement 7 — Tab interaction

**User Story:** As a learner, I want to flip between Debrief and Review without losing scroll position so that I can compare the coach narrative against specific items.

#### Acceptance Criteria

1. WHEN the user clicks a tab trigger, THEN the active tab SHALL change with a 180ms fade-in (matching the Phase F drill aesthetic).
2. WHEN the user reloads the page (or navigates back), THEN the default tab SHALL be **Debrief** — tab state is not persisted in v1.
3. The tab triggers SHALL be keyboard-navigable (Tab to focus, Enter/Space to activate, ArrowLeft / ArrowRight to move between tabs) per WAI-ARIA tablist semantics.

### Requirement 8 — Phase E summary removal

**User Story:** As an engineer, I want to delete the now-redundant in-page `SessionSummary` so that the codebase has one canonical post-session screen.

#### Acceptance Criteria

1. WHEN session completion succeeds, THEN the `/drill` page SHALL no longer render the `SessionSummary` card; instead it SHALL navigate to `/drill/debrief/[sessionId]`.
2. The `SessionSummary` component file (`apps/web/app/(dashboard)/drill/_components/session-summary.tsx`) and its tests SHALL be deleted.
3. The `coachMessage({ kind: 'sessionComplete', ... })` branch SHALL remain (used by the new debrief Header coach copy via the same accuracy buckets) — repurposed, not removed.
4. The session-reducer's `summary` state and `COMPLETE_SUCCEEDED` action SHALL be removed; on `useCompleteSession` success, the page issues `router.push` and the reducer remains in `completing` until the route changes (the unmount destroys it).
   - Alternative considered and rejected: keep `summary` state and dual-render; this leaves stale UI flicker before navigation. Removing is cleaner.
5. WHEN the user clicks the browser back button on the debrief page, THEN they return to `/drill`, which (since the prior session is finished) auto-creates a fresh session via the existing Phase E effect. This is intentional: `/drill` is a session host, not a session reader; revisiting a finished session is the debrief's job.

## Non-Functional Requirements

### Performance

- **TTFB (server):** `GET /sessions/:id/debrief` must complete in ≤ 200 ms p95 warm (cold-starts on Lambda excluded, matching Phase E precedent). Single SQL round trip, no Claude, no S3, no external services.
- **Initial render (client):** Debrief page must render the header + tabs (skeleton items OK) within 100 ms of HTML response, and full per-item review within 300 ms after fetch resolves on a 5-item session.
- **No N+1:** Per-item evaluation data must be loaded in a single SQL query joining `exercises` and the most-recent `user_exercise_history` row per `(session_id, exercise_id)` (use a subquery or window function).
- **Cacheable:** Once `completedAt` is set, the debrief response is immutable. The endpoint MAY emit `Cache-Control: private, max-age=300` (or rely on TanStack Query default `staleTime`); both are acceptable and the design phase chooses one.

### Security

- **Ownership:** The endpoint MUST verify `practice_sessions.user_id === c.get('userId')` before returning any per-item data. A different-user request returns 404 (not 403) to avoid leaking which session ids exist.
- **Completion gate:** A request for a session with `completed_at IS NULL` returns 404 (the debrief is for finished sessions only — partial debriefs are out of scope and would leak in-progress state).
- **No new secrets, no new env vars.** The endpoint reuses `authMiddleware` and existing DB credentials.
- **Auth-protected route:** The Next.js page must be inside the `(dashboard)` group so it inherits the existing Clerk gate. Unauthenticated visits redirect to sign-in.
- **No PII in URL:** The `sessionId` is a server-issued UUID. Don't add user identifiers, language, or anything else to the path; query params are not used.

### Reliability

- **Idempotent reads:** Reloading the page or revisiting from history fires the same query and returns the same payload. No state is mutated by the GET.
- **Migration-free:** No DB schema changes are required (Phase E already added `practice_sessions` and `user_exercise_history.session_id`).
- **No background jobs:** No SQS, EventBridge, or pre-generation Lambda involvement.
- **Survives stale-page navigation:** If the user has the debrief page open, then triggers another session in another tab, then revisits this tab, the data is still consistent — the session is immutable once completed.

### Usability

- **Editorial layout:** Header uses `t-display-xl` per the prototype; max-width 920px centered (matching `prototypes/web/hifi/feedback.jsx`).
- **Accent picker N/A:** Debrief is read-only.
- **Color tiers:** Sage (`--ok-soft`), terracotta (`--accent-soft`), paper-3 — same tokens as the live feedback shell.
- **Empty/error states:** "session not found", "you took 0 items" (impossible per Phase E `INSUFFICIENT_EXERCISES` guard, but defensive), and a "this session was completed before this feature shipped" branch (sessions with no `user_exercise_history.session_id` rows — possible for any session completed before Phase E `0003_*.sql` migration, all of which are dev-only) return a graceful "review unavailable" message rather than a crash.
- **No streak / XP** anywhere on this screen (CLAUDE.md hard rule).
- **Keyboard / a11y:** tabs are a proper `role="tablist"`; item cards are buttons when expandable; focus-visible rings match the existing design system.
