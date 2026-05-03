# Requirements Document

## Introduction

The Progress page (`/progress`) is the **motivational engine** of Language Drill — the place where the app's core differentiator becomes visible: honest, skill-based progress tracking instead of streaks or XP. It replaces the current placeholder at `apps/web/app/(dashboard)/progress/page.tsx`.

Phase I delivers the **v1 progress dashboard** for the active learning language: a tabbed view containing (1) a 6-axis skill radar comparing now vs. 30 days ago, (2) a topic × days practice heatmap, and (3) a History tab stub. The page is read-only — it surfaces what's already in `user_exercise_history` and `skill_topics` and presents it through the editorial, "warm paper" visual language established in Phases A and B.

This phase is intentionally scoped down from `docs/progress-tracking.md`'s full vision (CEFR estimates per skill, grammar mastery grid, exam readiness, vocabulary coverage). Those are deferred to later phases; v1 ships the radar + heatmap shape.

### Out of scope (v1)

The following are explicitly deferred and SHALL NOT be implemented in this phase:

- Grammar mastery grid (per-grammar-point green/yellow/red view from `progress-tracking.md` §3)
- Exam readiness panel (IELTS / DELE / Goethe / YDS scoring)
- Vocabulary frequency-band coverage view
- Peer comparison ("avg learner @ B2") on the radar
- Sparkline trends in the History tab — stub only
- Bayesian / IRT mastery update rule — v1 uses a simple recency-weighted average
- Timezone-aware day bucketing — v1 uses UTC days
- Mobile / sub-1024px responsive layouts — desktop only, matching the rest of the dashboard

## Alignment with Product Vision

The product positioning (`product.md` §2) explicitly names **"honest skill-based progress"** as one of the four defensible differentiators. `progress-tracking.md` makes this concrete: track demonstrated ability per skill, never streaks. `web-implementation-plan.md` Phase I defers the mastery grid to a drilldown but keeps the radar as the visual anchor.

Specifically, this feature:

- Implements the "no streaks / no XP / no lesson counts" rule from `CLAUDE.md` and `exercise-strategy.md` — the page shows skill mastery and recency, full stop.
- Surfaces the imbalance between input and output skills, which is the **central diagnostic** for the intermediate-plateau learner (`product.md` §2.3).
- Reuses the active-language model from Phase B — progress is always shown for the language selected in the left-rail switcher, never aggregated.
- Pre-positions the data shape that later phases will extend: the radar's enabling-competency axes and the heatmap's topic axis both align with Layer 1 + Layer 3 of the skill taxonomy in `progress-tracking.md`.

## Requirements

### Requirement 1 — Page route and shell integration

**User Story:** As a learner, I want to navigate to `/progress` from the left-rail nav, so that I can see my current skill profile for the active language.

#### Acceptance Criteria

1. WHEN the user clicks the "progress" item in the left nav THEN the system SHALL render the new progress page at `/progress` with the dashboard shell (left rail + active language switcher) intact.
2. WHEN the page mounts THEN the system SHALL read the active language from the existing `ActiveLanguageProvider` context — it SHALL NOT use a separate language selector.
3. WHEN the user switches the active language via the rail THEN the system SHALL refetch progress data for the newly selected language and update all three tabs.
4. WHEN the page route loads with no authenticated session THEN the system SHALL behave identically to other dashboard routes (handled by the existing `(dashboard)/layout.tsx` — out of scope for this spec).
5. IF the page is rendered for a user with zero exercise history in the active language THEN the system SHALL render an empty state on every tab (see Requirement 6) rather than throwing or showing zero-value charts.

### Requirement 2 — Header section

**User Story:** As a learner, I want a header that confirms which language I'm viewing and frames the page's purpose, so that I trust the numbers I'm about to see.

#### Acceptance Criteria

1. WHEN the page renders THEN the system SHALL display a `t-micro` eyebrow with the language label, current proficiency level from `userLanguageProfiles`, and weeks-since-first-exercise (e.g. "español · B2 · 6 weeks in"). If no exercises exist yet, the weeks-in segment SHALL be omitted.
2. WHEN the page renders THEN the system SHALL display the title "your progress." in `t-display-xl` and a `t-body-l` subtitle reading "honest skill numbers. no XP, no levels — just where you actually are."
3. WHEN the proficiency level is unknown for the active language THEN the system SHALL display the language label only, omitting the level segment.

### Requirement 3 — Tab navigation

**User Story:** As a learner, I want to toggle between Shape, Heatmap, and History views, so that I can look at my data from different angles without leaving the page.

#### Acceptance Criteria

1. WHEN the page renders THEN the system SHALL display three tabs labeled "shape", "practice heatmap", and "history" beneath the header, with the "shape" tab active by default.
2. WHEN the user clicks a tab THEN the system SHALL switch the rendered panel without a full page navigation and SHALL underline the active tab using `var(--ink)` (matching the prototype).
3. WHEN a tab is selected via the URL query param `?tab=heatmap` (or `?tab=history`) THEN the system SHALL render that tab on initial load. URL state is synchronised on tab change so the view is shareable and survives reload.
4. WHEN the user uses keyboard navigation THEN the tab list SHALL be focusable, navigable with left/right arrows, and activatable with Enter/Space (WAI-ARIA tab pattern).

### Requirement 4 — Shape tab: skill radar

**User Story:** As an intermediate learner, I want a 6-axis radar showing my mastery across enabling competencies, so that I can immediately see whether my input/output skills are balanced.

#### Acceptance Criteria

1. WHEN the Shape tab is active THEN the system SHALL render an SVG radar chart with **6 axes** for the active language: `listening`, `reading`, `speaking`, `writing`, `grammar`, `vocabulary`. (Note: this is a v1-collapsed set — the prototype's 8-axis mix of macro-skills and specific grammar topics, and `progress-tracking.md`'s richer Layer-2 taxonomy that separates vocabulary breadth/depth and grammar accuracy/range, are both intentionally flattened to these six aggregates so the data is computable from the existing schema. Later phases may expand the axis set.)
2. WHEN radar data is available THEN the system SHALL plot two polygons: a solid `accent`-filled polygon for **current mastery** and a dashed `ink-mute` outline for the **30-day-ago snapshot**. Each axis vertex SHALL be marked with a circle on the current-mastery polygon.
3. WHEN the user has no exercise history in the previous 30 days for an axis THEN the system SHALL render that vertex of the dashed polygon at the same value as the current polygon (i.e., no visible change), rather than collapsing it to zero.
4. WHEN the radar renders THEN the system SHALL include reference grid polygons at 25%, 50%, 75%, 100% drawn with the dashed `rule` stroke from the prototype.
5. WHEN any axis label collides with the chart at smaller viewport widths THEN the system SHALL keep the chart on a single SVG (no responsiveness beyond fixed `viewBox` scaling for v1) — but the SVG SHALL scale down to fit the column at viewports ≥ 1024px (the only supported breakpoint per the design system).
6. WHEN the radar is rendered THEN it SHALL be accessible: the SVG SHALL include a `<title>` and `<desc>` and an `aria-label` summarising the data ("Skill radar for [language]; strongest: [axis] at [value]%, weakest: [axis] at [value]%.").

### Requirement 5 — Shape tab: side cards

**User Story:** As a learner, I want narrative context next to the radar, so that I understand what the shape is telling me and what to do next.

#### Acceptance Criteria

1. WHEN the Shape tab renders THEN the system SHALL display a 2-column grid: radar on the left (1fr), a column of three cards on the right (320px). At viewports below the dashboard's `--max-w` (1100px) the layout MAY stack — out of scope for v1, all the dashboard already assumes ≥ desktop.
2. WHEN both current and 30-day-ago radar data are available THEN the system SHALL render an **observation card** (paper-2 background, accent-soft tint) that contrasts the strongest and weakest axis in plain language, e.g. _"you're strong at input (reading, listening) and weaker at production (speaking, writing). classic intermediate plateau shape."_ The exact wording for v1 is generated client-side from the radar data using a small rules table (no Claude call).
3. WHEN the radar renders THEN the system SHALL render a **legend card** explaining the two polygons ("you · now" / "you · 30 days ago"). The "avg learner @ B2" comparison from the prototype is **out of scope** for v1 (no peer data exists yet).
4. WHEN there is at least one axis below 0.5 mastery THEN the system SHALL render a **recommended drill card** that names the weakest axis, shows when it was last practised, and links to `/drill?focus=<axisKey>`. Implementation of the linked focus drill is out of scope for this spec — the link target SHALL exist and the drill page can ignore the param for now.
5. IF the user has fewer than 5 evaluated exercises **in the active language** THEN the system SHALL hide the observation and recommended-drill cards and SHALL replace them with a single "not enough data yet" card pointing to `/drill`. (Counted from `userExerciseHistory` joined to `exercises.language` for the active language only — other languages don't count.)

### Requirement 6 — Heatmap tab: topic × days grid

**User Story:** As a learner, I want a 30-day heatmap of which grammar/vocabulary topics I've practised, so that I can see what's gone cold.

#### Acceptance Criteria

1. WHEN the Heatmap tab is active THEN the system SHALL render a grid with **up to 8 topic rows** (the user's most-practised topics in the active language over the last 90 days) and **30 day columns** representing the last 30 calendar days, oldest on the left.
2. WHEN a cell is rendered THEN its background SHALL be one of four shades: `transparent` (no practice), `paper-2` (1 attempt), `accent-soft` (2–3 attempts), `accent` (4+ attempts), with thresholds documented in the API response so the client doesn't reinvent them.
3. WHEN a row is rendered THEN the system SHALL display the topic name on the left (170px, right-aligned) and the topic's current mastery percentage as `t-mono` text on the right (36px column).
4. WHEN the grid renders THEN the system SHALL render a "less / more" legend in the top-right of the card (matching the prototype's swatch row).
5. WHEN heatmap data exists THEN the system SHALL render summary cards below the grid: **🔥 hottest** (most-practised topic in last 14 days, hilite-soft tint) and **❄ coldest** (longest-untouched topic above 0.4 mastery — v1 tunable, pinned in `design.md`; `accent-soft` tint). If fewer than 2 topics qualify, the system SHALL hide whichever card cannot be populated.
6. WHEN the user has fewer than 3 distinct topics with any practice THEN the system SHALL hide the grid and summary cards and render a "build a topic history first" empty state inside the card.
7. WHEN the user hovers a heatmap cell THEN the system SHALL show a native `title` tooltip (no custom popover for v1) with the date and attempt count.

### Requirement 7 — History tab: stub

**User Story:** As a learner, I want to know the History view exists but is coming, so that I'm not surprised by an empty page when I click the third tab.

#### Acceptance Criteria

1. WHEN the History tab is active THEN the system SHALL render a centered card with the heading "history view" in `t-display-s` and the subline "(coming soon — sparkline trends per skill, 30/60/90/all)" in `t-small` and `ink-mute` colour.
2. WHEN the History tab renders THEN it SHALL NOT make any API calls — the stub must not regress page performance.

### Requirement 8 — Backend: GET /progress/radar

**User Story:** As the progress page, I want a single endpoint that returns the 6-axis radar data plus the 30-day-ago snapshot, so that the page can render without aggregating client-side.

#### Acceptance Criteria

1. WHEN `GET /progress/radar?language=ES` is called with a valid Clerk JWT THEN the system SHALL respond with `200` and a body of shape `{ language, axes: Array<{ key, label, currentMastery, previousMastery, lastPracticedAt, evidenceCount }> }` where mastery values are floats in `[0, 1]` and `key` is one of the six fixed enabling-competency keys.
2. WHEN the user has no exercise history for the language THEN the system SHALL return `200` with all axis values at `0` and `evidenceCount: 0` — the client uses `evidenceCount` (not the values) to decide whether to render the empty state.
3. WHEN the request omits or contains an invalid `language` query param THEN the system SHALL respond with `400 VALIDATION_ERROR`.
4. WHEN the request lacks a valid JWT THEN the system SHALL respond with `401` (handled by existing `authMiddleware`).
5. WHEN the response is computed THEN per-axis mastery SHALL be derived from `user_exercise_history.score` aggregated by exercise type → axis mapping (see `design.md`) and weighted by recency (most recent attempt counts most). For v1 the formula is a simple weighted average documented in code, not a Bayesian update — that's deferred to a later phase.
6. WHEN the response is computed THEN `previousMastery` SHALL be the same aggregate restricted to attempts more than 30 days old. If no such attempts exist for an axis, `previousMastery` SHALL equal `currentMastery`.

### Requirement 9 — Backend: GET /progress/heatmap

**User Story:** As the progress page, I want a single endpoint that returns the heatmap grid shape for the active language, so that the client doesn't have to query individual exercise rows.

#### Acceptance Criteria

1. WHEN `GET /progress/heatmap?language=ES` is called with a valid Clerk JWT THEN the system SHALL respond with `200` and a body of shape `{ language, days: 30, topics: Array<{ topicId, name, mastery, cells: number[30] }>, shadeThresholds: { paper2: 1, accentSoft: 2, accent: 4 } }`.
2. WHEN topics are returned THEN they SHALL be the up-to-8 most-practised topics in the last 90 days for `(userId, language)`, sorted by total attempt count descending. Topics with zero attempts SHALL NOT be included.
3. WHEN cell counts are computed THEN `cells[i]` SHALL be the number of attempts for that topic on `today − (29 − i)` (so index 29 = today). Day buckets use **UTC** for v1; a learner practising late-evening in CET may see attempts split across two UTC days. Timezone-awareness is explicitly deferred.
4. WHEN there are fewer than 3 qualifying topics THEN the system SHALL still respond `200` with whatever topics exist; the client renders the empty state based on `topics.length`.
5. WHEN the request omits or contains an invalid `language` query param THEN the system SHALL respond with `400 VALIDATION_ERROR`.

### Requirement 10 — Backend: header metadata

**User Story:** As the progress page header, I want the active language's proficiency level and weeks-active so that I can render the eyebrow without an extra round trip.

#### Acceptance Criteria

1. WHEN the page mounts THEN the proficiency level SHALL be read from the existing `useLanguageProfiles` hook — no new endpoint is added for the level.
2. WHEN the page mounts THEN weeks-active SHALL be derived from the radar response (the earliest `lastPracticedAt` across all axes minus today, rounded down). No new endpoint is added.
3. IF every axis returns `evidenceCount: 0` THEN the eyebrow SHALL render only the language label.

### Requirement 11 — API client hooks

**User Story:** As a frontend developer, I want typed TanStack Query hooks for the new endpoints, so that I don't hand-roll fetch logic in the page component.

#### Acceptance Criteria

1. WHEN the api-client package is built THEN it SHALL export `useProgressRadar({ fetchFn, language, enabled? })` and `useProgressHeatmap({ fetchFn, language, enabled? })`, each returning a `UseQueryResult` keyed by `['progressRadar', language]` / `['progressHeatmap', language]` and parsed through a Zod schema. The `enabled` parameter SHALL default to `true`, matching the existing `useLanguageProfiles` hook.
2. WHEN the active language changes THEN the query keys SHALL invalidate and a fresh fetch SHALL fire — the keying-by-language is the mechanism, no manual invalidation.
3. WHEN a hook is called with `enabled: false` THEN no fetch SHALL fire.
4. WHEN the API returns a malformed payload THEN the Zod schema SHALL throw and the error SHALL surface in `result.error` — matching the existing pattern in `useLanguageProfiles`.

## Non-Functional Requirements

### Performance

- Initial page render (Shape tab) SHALL fire at most **two parallel API requests**: `GET /progress/radar` and `GET /progress/heatmap` (the heatmap is prefetched so the user doesn't see a spinner when switching tabs).
- Each backend handler SHALL execute its DB queries in **a single round trip** to Neon (use a single SQL query per endpoint where possible). Aggregations SHALL run in SQL, not in Lambda memory.
- Each endpoint SHOULD respond in **p95 < 300ms** for the typical case (≤ 500 history rows in the last 90 days for the active language). Latency above that is a regression to investigate.
- The radar SVG SHALL render synchronously from the query cache on tab toggle — no recompute on tab change.

### Reliability

- Both endpoints SHALL gracefully handle the no-history case (return zero-value payloads, never throw).
- The page SHALL render a per-tab error boundary: if the radar request fails, the Heatmap tab SHALL still be usable, and vice versa.
- No new database tables are introduced in this spec — the design relies on existing `user_exercise_history`, `exercises`, `exercise_tags`, `skills`, `skill_topics` data. If exercises in the seed pool aren't yet tagged with `skill_topics`, the heatmap SHALL render a "no topic data yet" state rather than fail.

### Security

- Both endpoints SHALL be mounted behind `authMiddleware` (matching `/profiles/*`).
- Both endpoints SHALL filter by the authenticated `userId` from the JWT — never trust a `userId` query param.
- The `language` query param SHALL be validated against the `LearningLanguageEnum` (ES / DE / TR); EN SHALL be rejected with `400`.

### Usability

- The page SHALL match the visual language of Phases A and B: warm-paper background, Fraunces display type, Inter body, terracotta accents, no shadows on the radar SVG.
- All interactive elements (tabs, recommended-drill button) SHALL meet WCAG AA contrast against `paper`.
- The radar and heatmap SHALL each include an accessible text summary readable by a screen reader (visually hidden), so the page is usable without seeing the chart.
- No streak indicator, XP counter, or lesson-count metric SHALL appear anywhere on the page (hard rule from `CLAUDE.md`).
