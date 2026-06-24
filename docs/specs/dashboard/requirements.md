# Requirements Document

## Introduction

The Dashboard (`/`, the index of the `(dashboard)` route group) is the **landing surface** of Language Drill — the first screen the learner sees after auth and onboarding, and the place from which a practice session is started. It replaces the current minimal welcome page at `apps/web/app/(dashboard)/page.tsx` (a one-line greeting plus a "Start Practice" link).

Phase D delivers the **v1 editorial dashboard** for the active learning language: an editorial header with greeting and framing, a vertical timeline of 5 planned exercises ("today's plan"), a 6-item skill snapshot grid (weakest first), and a Read & Collect entry card. The page is read-mostly — it renders pre-computed planning data plus the same skill aggregates the Progress page already serves, and its only mutating action is starting a session via the existing `POST /sessions` endpoint.

This phase is intentionally **not** a feed of completed sessions, a streak counter, or a planner UI. It surfaces today's plan, the user's skill shape, and a single primary CTA to start drilling.

### Out of scope (v1)

The following are explicitly deferred and SHALL NOT be implemented in this phase:

- Streak / XP / lesson-count indicators of any kind (hard rule — see `CLAUDE.md` and the Phase D adjustment in `web-implementation-plan.md`)
- An adaptive plan selector that weights weak skills higher than recent ones — v1 uses a simple heuristic documented in `design.md`; adaptive logic comes later
- Per-item "preview" affordances that open the exercise without committing to the session — the timeline shows the plan, the primary button starts the session
- Multi-day planning (week view, calendar) — only "today" is shown
- Localised greeting copy for non-English UI — v1 is English-only chrome regardless of the learning language; translated UI comes in a later phase
- A "skip / replace this item" affordance on timeline items — v1 plans are read-only previews of what `POST /sessions` will return
- Mobile / sub-1024px responsive layouts — desktop only, matching the rest of the dashboard
- Server-side rendering of the personalised content — the page is a client component that fetches via TanStack Query, matching the Progress page

## Alignment with Product Vision

The product positioning (`product.md` §2) frames Language Drill as **"what you do between italki sessions"** — a practice app, not a feed app. Phase D makes that promise concrete on the landing surface: the dashboard is **a plan, not a stream**. Specifically:

- **Active production over passive recognition** (`product.md` §2.1) — the timeline's primary CTA leads directly into a session of cloze / translation / vocab exercises that demand typed production. There is no "browse exercises" or "pick what you feel like" path.
- **Honest skill-based progress** (`product.md` §2.2) — the skill snapshot grid renders the same six enabling-competency aggregates that the Progress page does, ordered weakest-first so the diagnostic is immediate.
- **No gamification** (`product.md` "What to Avoid Claiming"; `CLAUDE.md` "Don't Revisit") — no streak callout, no XP, no celebratory toast, no lesson counter. The prototype's "🔥 12-day streak" card is removed.
- **Polyglot-aware** (`product.md` §2.3) — every datum on the page is scoped to the active language from `ActiveLanguageProvider`. Switching the rail re-fetches everything.
- **Pre-generated content reuse** (`tech.md` §7) — the timeline's plan is composed from the existing exercise pool via the same selection pathway `POST /sessions` already uses, so no new content generation is triggered by visiting the dashboard.

## Requirements

### Requirement 1 — Page route and shell integration

**User Story:** As a learner, I want the dashboard to load at the root URL of the app, so that I land on today's plan without an extra click after sign-in.

#### Acceptance Criteria

1. WHEN an authenticated user with at least one language profile navigates to `/` THEN the system SHALL render the new dashboard at `apps/web/app/(dashboard)/page.tsx` inside the existing dashboard shell (left rail + active-language switcher).
2. WHEN the page mounts THEN it SHALL read the active language from the existing `ActiveLanguageProvider` context — it SHALL NOT introduce its own language picker.
3. WHEN the user switches the active language via the rail THEN the system SHALL refetch `GET /sessions/today` and `GET /progress/radar` for the newly selected language and re-render the timeline and skill snapshot.
4. WHEN the route loads with no authenticated session, or with an authenticated user who has no language profiles THEN the system SHALL behave identically to other dashboard routes (handled by the existing `(dashboard)/layout.tsx`: redirect to onboarding or sign-in — out of scope for this spec).
5. IF the page is rendered for a user whose active language has zero exercise history AND zero exercises in the pool for any difficulty THEN the system SHALL render a fallback "your pool isn't seeded yet" empty state (see Requirement 7) instead of a broken timeline.

### Requirement 2 — Header section

**User Story:** As a learner, I want a header that greets me by name and tells me what today is about, so that the page feels like a daily plan rather than a generic dashboard.

#### Acceptance Criteria

1. WHEN the page renders THEN the system SHALL display, in this order: an eyebrow line in `t-micro` containing the local weekday in lowercase, the iso week index `· week N`, and the active language label (English name, lowercased, e.g. `tuesday · week 6 · spanish`); a `t-display-xl` heading reading `good morning, <firstName>.` / `good afternoon, …` / `good evening, …` based on the user's local time; and a `t-display-l` italic subline reading `here's today's plan.`
2. WHEN the user's first name is unknown (no Clerk `firstName` and no `userLanguageProfiles.displayName`) THEN the heading SHALL omit the name and read `good morning.` / `good afternoon.` / `good evening.` with no trailing space before the period.
3. WHEN today is a day where the user has at least one weakest-axis topic from the radar (mastery < 0.5, evidenceCount ≥ 1) THEN the system SHALL render a `t-body-l` framing paragraph below the subline that names the weakest axis in plain language and what today's plan emphasises (template documented in `design.md`, generated client-side from radar data — no Claude call).
4. WHEN no axis qualifies for the framing paragraph (insufficient data or all axes ≥ 0.5) THEN the system SHALL render a generic framing line (e.g. `a balanced session — production first, then a vocabulary rep.`).
5. WHEN the header renders THEN it SHALL display, top-right of the title row, a `t-mono` total `~XX min planned` derived as the sum of `estimatedMinutes` across the day's plan items.
6. WHEN the user has no language profile for the active language (a transient state during a switch) THEN the header SHALL render a skeleton placeholder rather than throwing.

### Requirement 3 — Today's plan timeline

**User Story:** As a learner, I want to see the 5 exercises that make up today's session laid out as a vertical rail with the next-up item highlighted, so that I know what I'm committing to before I start.

#### Acceptance Criteria

1. WHEN the dashboard renders THEN the system SHALL display a vertical timeline of **exactly 5 items** (the v1 fixed session size, matching `DEFAULT_EXERCISE_COUNT = 5` in `apps/web/lib/drill/session-config.ts`) below the header. Each item SHALL show: a numbered or check circle on the rail (`01`–`05`, or `✓` if completed earlier today), the exercise type as title (e.g. `core · subjunctive cloze`), a `t-body` subtitle describing the topic and item count, an estimated minute count in `t-mono`, and a status chip (`done` / `next up`).
2. WHEN the timeline renders THEN exactly **one item** SHALL be marked as the "next up" primary item — the first item whose status is not `done`. Its circle SHALL use the `accent` colour with an `accent-soft` halo and its row SHALL render a primary `start →` button. All other not-done items SHALL render with no inline button.
3. WHEN the user clicks the primary `start →` button THEN the system SHALL navigate to `/drill?language=<active>&difficulty=<plan-difficulty>` and the existing drill page SHALL invoke `POST /sessions` to start the session with the same parameters the dashboard previewed.
4. WHEN the dashboard re-renders after the user has completed today's session and returned to `/` THEN items already attempted in today's most recent session for the active language SHALL render with the `done` status chip, a strike-through title, and 55% opacity (matching the prototype). The "next up" highlight SHALL move to the first not-done item; if all items are done, no item is highlighted and the primary button is replaced by a `start a fresh session →` button at the end of the rail (Requirement 4 covers the all-done state in detail).
5. WHEN any timeline item's data is missing a topic name (e.g. an exercise without `topicHint`) THEN the system SHALL fall back to the exercise type as the subtitle text rather than rendering an empty line.
6. WHEN the timeline is rendered THEN it SHALL be accessible: each row's heading and subtitle SHALL form a single labelled landmark, the status chips SHALL include `aria-label` (`done`, `next up`), and the primary button SHALL be reachable via the standard tab order.

### Requirement 4 — All-done and empty plan states

**User Story:** As a learner who has already finished today's session, I want the dashboard to celebrate that without dangling a stale "start" button, so that I'm not nagged into a redundant session.

#### Acceptance Criteria

1. WHEN every item in today's plan has status `done` THEN the system SHALL render — in place of any timeline item's inline button — a single end-of-rail card with the heading `you're done for today.` (`t-display-s`), a `t-body` line summarising the session (e.g. `5 of 5 · 18 minutes`), and a secondary `start a fresh session →` button that navigates to `/drill?language=<active>` (no `difficulty` param so the drill page falls back to its default).
2. WHEN the user has zero exercise history for the active language but the pool is seeded THEN the system SHALL render the timeline with the standard 5-item plan and the standard `next up` highlight on item 01 — there is no separate "first session" empty state.
3. WHEN the pool has no exercises for the active language at any difficulty (the pre-generation Lambda hasn't seeded it yet) THEN the timeline section SHALL be replaced by a single card reading `your <language> pool isn't ready yet — check back tomorrow.` and the primary CTA SHALL be hidden. The skill snapshot and Read & Collect card SHALL still render.
4. WHEN the backend returns an error for `GET /sessions/today` THEN the timeline section SHALL render an inline error card with a `retry` button — the rest of the page (skill snapshot, Read & Collect) SHALL remain usable.

### Requirement 5 — Skill snapshot grid

**User Story:** As an intermediate learner, I want a compact snapshot of my six core skill aggregates ordered weakest-first, so that I can see where my progress is going without leaving the dashboard.

#### Acceptance Criteria

1. WHEN the page renders THEN the system SHALL display, below the timeline and a 1px `rule` divider, a section with: an eyebrow `t-micro` reading `your <language> · weakest first`, a `t-display-m` heading `skill snapshot`, a top-right ghost button `see full progress →` that links to `/progress`, and a 2-column grid of **exactly 6 rows** — one per radar axis.
2. WHEN the grid renders THEN each row SHALL show: the axis label in lowercase (`grammar`, `vocabulary`, `listening`, `reading`, `speaking`, `writing`), the current mastery percentage as `t-mono` (e.g. `71%`), a `Bar` component fill at `currentMastery`, and a `t-mono` delta column on the right (e.g. `+4`, `−2`, `—`) computed as `Math.round((current − previous) × 100)` with `+` / `−` / `—` prefix.
3. WHEN an axis has `currentMastery < 0.5` THEN both the percentage label and the bar fill SHALL use the `accent` colour (matching the radar's "warn" state). Otherwise the percentage SHALL use `ink-soft` and the bar SHALL use the default `ink` fill.
4. WHEN axis rows are rendered THEN they SHALL be sorted by `currentMastery ascending` — weakest first — using `key` as a stable tie-breaker so the order is deterministic across renders.
5. WHEN every axis returns `evidenceCount: 0` (the user has no exercise history yet) THEN the grid SHALL be replaced with a single card reading `practice a few exercises and your skill snapshot will appear here.` with a primary `start a session →` button matching the timeline's primary CTA.
6. WHEN the radar request fails THEN the grid SHALL render a per-section error card with a `retry` button — the timeline SHALL remain usable.

### Requirement 6 — Read & Collect entry card

**User Story:** As a learner, I want a visible entry point to the Read & Collect feature on the dashboard, so that I can paste reading material and pull above-level words into my drills.

#### Acceptance Criteria

1. WHEN the page renders THEN the system SHALL display, below the skill snapshot, a single horizontal card with a 44×44 `r-md` icon tile (book glyph, `accent-soft` background, `accent-2` foreground), a title in `t-display-s` reading `reading something this week?`, a `new` chip in `accent`, a `t-small` subtitle reading `paste a paragraph — i'll mark words above your level and weave them into your next session.`, and a primary `open reader →` button that navigates to `/read`.
2. WHEN Phase J (Read & Collect) has not yet shipped a working `/read` page THEN the link target SHALL still be `/read` — the existing placeholder route handles the dead-link case. This spec SHALL NOT add a "coming soon" disabled variant.
3. WHEN the card renders THEN the icon, title, chip, and CTA SHALL be visually consistent with the prototype reference at `docs/design-archive/design_handoff_language_drill/prototypes/web/hifi/dashboard.jsx` lines 117–136 — same paddings, gaps, and copy.
4. WHEN the card is rendered THEN it SHALL be the **only** non-essential element on the page; no other promotional / banner / nudge cards are added in v1.

### Requirement 7 — Loading and error states

**User Story:** As a learner on a slow network, I want the dashboard to render a stable skeleton while data loads and to recover gracefully from per-section errors, so that the page never feels broken.

#### Acceptance Criteria

1. WHEN any of the page's queries (`GET /sessions/today`, `GET /progress/radar`) is in its initial loading state THEN the system SHALL render a layout-stable skeleton for the affected section (header eyebrow + timeline rows + skill snapshot rows) using neutral `paper-2` blocks. The skeleton SHALL match the final layout dimensions to avoid CLS.
2. WHEN a query fails THEN only the affected section SHALL show an error state with a `retry` button — the other sections SHALL remain interactive. (Per-section error boundaries; matching the Progress page's pattern.)
3. WHEN both queries fail THEN the page SHALL render two stacked error cards, one per section — it SHALL NOT redirect, sign the user out, or block the rail.
4. WHEN the user clicks a `retry` button THEN the system SHALL invoke the query's `refetch()` and re-render that section without affecting other sections.

### Requirement 8 — Backend: GET /sessions/today

**User Story:** As the dashboard, I want a single endpoint that returns today's planned 5-item session preview for the active language, so that the page can render the timeline without aggregating client-side.

#### Acceptance Criteria

1. WHEN `GET /sessions/today?language=<ES|DE|TR>` is called with a valid Clerk JWT THEN the system SHALL respond with `200` and a body of shape `{ language, generatedAt, totalEstimatedMinutes, items: Array<{ index, type, topicHint, difficulty, itemCount, estimatedMinutes, status }> }` where `index` is `1..5`, `status` is one of `done | queued`, and the items are returned in plan order.
2. WHEN the user has at least one practice session for `(userId, language)` whose `startedAt` falls on the current UTC day AND the session is `completed` THEN the items in that session SHALL be returned with `status: done` and the planning logic SHALL skip generating a fresh plan — instead, the response SHALL reflect what was practised today (matching Requirement 4 §1).
3. WHEN no completed session exists for today THEN the system SHALL build a fresh 5-item plan using the v1 heuristic documented in `design.md`: pick a difficulty equal to the user's `proficiencyLevel` for the language (fallback `B1`), compose 5 exercises drawn from the available pool with a fixed type-mix and `topicHint` diversity rules pinned in `design.md` (placeholder until adaptive logic lands). Picks SHALL NOT be persisted to `practiceSessions` — the dashboard preview is read-only.
4. WHEN the user has an in-progress session today (started but not completed) THEN the response SHALL hydrate from that session: items already submitted return `status: done`, the next item gets the implicit "next up" position, and the remaining items return as queued. The dashboard SHALL still show the same primary `start →` button — it routes to `/drill` and the drill page resumes the in-progress session via existing logic in `apps/web/app/(dashboard)/drill/page.tsx`.
5. WHEN the pool has fewer than 5 exercises for the chosen `(language, difficulty)` THEN the system SHALL respond `200` with `items: []` and a `code: INSUFFICIENT_POOL` extension on the body so the client can render Requirement 4 §3 directly.
6. WHEN the request omits or contains an invalid `language` query param THEN the system SHALL respond with `400 VALIDATION_ERROR`.
7. WHEN the request lacks a valid JWT THEN the system SHALL respond with `401` (handled by existing `authMiddleware`).
8. WHEN the response is computed THEN per-item `estimatedMinutes` SHALL be derived from a static integer lookup keyed by `type` (exact values pinned in `design.md`'s `ESTIMATED_MINUTES_BY_TYPE` constant); they SHALL NOT be persisted on the exercise rows. `totalEstimatedMinutes` SHALL be the integer sum.

### Requirement 9 — API client hooks and dashboard reuse of useProgressRadar

**User Story:** As a frontend developer, I want a typed TanStack Query hook for `GET /sessions/today` and to reuse the existing `useProgressRadar` hook for the skill snapshot, so that I don't introduce a parallel data path.

#### Acceptance Criteria

1. WHEN the api-client package is built THEN it SHALL export `useTodayPlan({ fetchFn, language, enabled? })` returning a `UseQueryResult<TodayPlanResponse, Error>`, keyed by `['todayPlan', language]`, parsed through a Zod schema, with `staleTime` set to `60 * 1000` (one minute — the plan is generally stable across a single session of dashboard usage).
2. WHEN the dashboard renders the skill snapshot grid THEN it SHALL call `useProgressRadar({ fetchFn, language })` — already exported from `@language-drill/api-client` — and SHALL NOT call `GET /stats/skills` (no such endpoint is added; the existing radar endpoint covers the six axes the snapshot needs).
3. WHEN the active language changes THEN both query keys SHALL invalidate naturally via the keying-by-language pattern; the dashboard SHALL NOT manually call `queryClient.invalidateQueries`.
4. WHEN a hook is called with `enabled: false` THEN no fetch SHALL fire (matching the existing `useProgressRadar` and `useLanguageProfiles` behaviour).
5. WHEN the API returns a malformed payload THEN the Zod schema SHALL throw and the error SHALL surface in `result.error` — matching the existing pattern in the api-client package.

### Requirement 10 — Dashboard header time-of-day greeting

**User Story:** As a learner, I want the greeting to match my local time of day, so that the page feels alive rather than templated.

#### Acceptance Criteria

1. WHEN the page renders THEN the greeting SHALL be computed client-side from the browser's local clock: `04:00–11:59` → `good morning`, `12:00–17:59` → `good afternoon`, `18:00–03:59` → `good evening`.
2. WHEN the page renders THEN the eyebrow weekday SHALL also be computed client-side from the browser's local clock using `toLocaleDateString('en-US', { weekday: 'long' })` lowercased. The week index SHALL be the ISO week number computed from the same date.
3. WHEN the greeting or eyebrow could differ between the server and the client (e.g. an SSR pass on the boundary of midnight) THEN the page SHALL render the time-dependent strings only after mount (rendered as `null` server-side and hydrated on the client) to avoid a hydration mismatch.

### Requirement 11 — Reuse of existing language switcher behaviour

**User Story:** As a polyglot learner, I want the dashboard to update fully when I switch the active language, so that I never see stale data from another language.

#### Acceptance Criteria

1. WHEN the user switches the active language via the rail THEN the dashboard SHALL re-mount and re-fetch every section's data via the existing `ActiveLanguageProvider` reload behaviour — this spec SHALL NOT modify that provider.
2. WHEN the dashboard's TanStack Query hooks are inspected THEN both `useTodayPlan` and `useProgressRadar` SHALL be keyed by `[name, language]` so a future in-memory language switch (no full reload) re-fetches automatically without code changes in this spec's scope.

## Non-Functional Requirements

### Performance

- Initial page render SHALL fire **at most two parallel API requests**: `GET /sessions/today` and `GET /progress/radar`. The Read & Collect card is static and SHALL NOT trigger a request.
- The `GET /sessions/today` handler SHALL execute its DB queries in **at most two SQL round trips** to Neon (one to look up today's session for `(userId, language)` and one to draw the pool sample). Aggregations SHALL run in SQL, not in Lambda memory.
- The endpoint SHOULD respond in **p95 < 250ms** for the typical case (≤ 5 sessions in the last 24h for the active language, pool size ≥ 50).
- The radar response is cached for 5 min by `useProgressRadar`'s `staleTime`; the dashboard SHALL NOT lower that. The today-plan response is cached for 60s — long enough to feel snappy on tab-switching, short enough that completing a session and returning shows fresh `done` items.
- The page's largest contentful paint (the header `t-display-xl` heading) SHALL render before either fetch completes — the heading is static text and the only thing it gates on is the Clerk user object, which is already loaded by `(dashboard)/layout.tsx`.

### Reliability

- The page SHALL render a per-section error boundary: if the today-plan request fails, the skill snapshot SHALL still be usable, and vice versa (matching Requirement 7).
- Both endpoints SHALL gracefully handle the no-history case (return zero-value or empty payloads, never throw).
- No new database tables are introduced in this spec — the design relies on existing `practice_sessions`, `user_exercise_history`, `exercises`, and `user_language_profiles` data.
- A failed `useTodayPlan` query SHALL NOT block the user from starting a session — the `start a fresh session →` button at the bottom of the page (rendered as part of Requirement 4 §1's all-done card or Requirement 5 §5's no-data card) SHALL always link to `/drill` regardless of fetch state, so the dashboard never strands the user.

### Security

- `GET /sessions/today` SHALL be mounted behind `authMiddleware` (matching `/sessions/*`).
- The handler SHALL filter by the authenticated `userId` from the JWT — never trust a `userId` query param.
- The `language` query param SHALL be validated against the `LearningLanguageEnum` (ES / DE / TR); EN SHALL be rejected with `400`.
- The endpoint SHALL NOT expose internal exercise IDs in the response that the user could not already retrieve via `POST /sessions` — the response leaks no new authorisation surface (it's a read-only preview of the same selection logic).

### Usability

- The page SHALL match the visual language of Phases A, B, F, E, H, and I: warm-paper background, Fraunces display type, Inter body, terracotta accents, no shadows on plan items beyond the existing `Card` component shadows.
- All interactive elements (timeline primary button, "see full progress" ghost button, "open reader" primary button, retry buttons) SHALL meet WCAG AA contrast against `paper`.
- The timeline SHALL include an accessible text summary readable by a screen reader (visually hidden ordered list summarising the 5 items, e.g. "Today's plan, 5 items: 1. warm-up cloze, done. 2. core subjunctive cloze, next up. ...") so the page is usable without seeing the rail.
- No streak indicator, XP counter, or lesson-count metric SHALL appear anywhere on the page (hard rule from `CLAUDE.md`). The prototype's "🔥 12-day streak" card SHALL NOT be ported.
- The greeting and weekday SHALL be lowercased to match the editorial voice established by other dashboard pages (`good morning, juno.`, `tuesday · week 6 · spanish`). User-supplied first names SHALL NOT be lowercased — they render as Clerk stores them.
