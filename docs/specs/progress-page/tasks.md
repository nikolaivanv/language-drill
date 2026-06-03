# Implementation Plan

## Task Overview

Implement the Phase I Progress page in five layers, bottom-up, so each task can be verified before the next. Order: (1) pure aggregation library, (2) Lambda routes, (3) api-client schemas + hooks, (4) UI primitives + shared lib, (5) tab orchestrators + page wire-up. Every task lands working code with co-located tests; no half-finished modules.

## Steering Document Compliance

- **`tech.md`** — Hono routes mounted via existing `authMiddleware` pattern, Drizzle for SQL aggregation, Zod for wire validation, TanStack Query for hooks, no new infra.
- **`CLAUDE.md`** — every UI task asserts the no-streaks/no-XP rule: tests check that no streak / lesson-count text appears.
- **Repo layout (`CLAUDE.md` §Monorepo Layout)** — backend lib in `infra/lambda/src/lib/`, route in `infra/lambda/src/routes/`, schemas in `packages/api-client/src/schemas/`, hooks in `packages/api-client/src/hooks/`, page-scoped helpers in `apps/web/app/(dashboard)/progress/_lib/`, page-scoped UI in `_components/`.
- **Pre-push** — the final task runs `pnpm lint && pnpm typecheck && pnpm test` from repo root and must be green before this phase ships.

## Atomic Task Requirements

Each task touches 1–3 files, completes in 15–30 minutes, has a single testable outcome, and references specific files plus the requirements it satisfies.

## Tasks

### Layer 1 — Backend aggregation library (pure functions)

- [x] 1. Create progress-aggregation core types and axis mapping in `infra/lambda/src/lib/progress-aggregation.ts`
  - File: `infra/lambda/src/lib/progress-aggregation.ts`
  - Export types: `RadarAxisKey` (union of the 6 fixed keys), `RadarAxis`, `ContributingRow` (`{ score, difficulty, type, evaluatedAt }`)
  - Export `RADAR_AXIS_ORDER: readonly RadarAxisKey[]` (fixed order: listening, reading, speaking, writing, grammar, vocabulary)
  - Export `axisForExerciseType(type: string): RadarAxisKey | null` — returns `'grammar'` for cloze, `'writing'` for translation, `'vocabulary'` for vocab_recall, `'listening' | 'speaking' | 'reading'` for the reserved types, `null` for unknown
  - Purpose: single source of truth for the type→axis mapping cited by Design §"Exercise type → axis mapping (v1)"
  - _Leverage: packages/shared/src/index.ts (ExerciseType, CefrLevel)_
  - _Requirements: 4.1, 8.5_

- [x] 2. Add weighting and per-axis aggregation to `infra/lambda/src/lib/progress-aggregation.ts`
  - File: `infra/lambda/src/lib/progress-aggregation.ts` (continue from task 1)
  - Add `difficultyWeight(level: CefrLevel): number` with values A1=0.5, A2=0.7, B1=0.9, B2=1.1, C1=1.3, C2=1.5
  - Add `recencyWeight(evaluatedAt: Date, now: Date): number` returning `Math.exp(-daysAgo / 30)`
  - Add `aggregateAxisMastery(rows: ContributingRow[], now: Date): number` returning the weighted average score clamped to `[0, 1]`; returns `0` on empty input
  - Purpose: pure, deterministic, unit-testable mastery formula (Design §"Mastery formula")
  - _Leverage: packages/shared/src/index.ts (CefrLevel)_
  - _Requirements: 8.5_

- [x] 3. Add `aggregateRadar` orchestrator to `infra/lambda/src/lib/progress-aggregation.ts`
  - File: `infra/lambda/src/lib/progress-aggregation.ts` (continue from task 2)
  - Add `aggregateRadar(rows: ContributingRow[], now: Date): RadarAxis[]` that buckets rows by `axisForExerciseType`, computes `currentMastery` over all rows in the bucket, computes `previousMastery` over rows where `evaluatedAt < now − 30d` (falling back to `currentMastery` when empty), tracks `lastPracticedAt` (max evaluatedAt per axis or `null`) and `evidenceCount`
  - Output array order MUST match `RADAR_AXIS_ORDER`; missing axes appear with all-zero values and `evidenceCount: 0`
  - Purpose: produces the `axes` payload for `GET /progress/radar`
  - _Leverage: progress-aggregation.ts (tasks 1–2)_
  - _Requirements: 4.1, 4.2, 8.1, 8.5, 8.6_

- [x] 4. Add heatmap aggregation helpers to `infra/lambda/src/lib/progress-aggregation.ts`
  - File: `infra/lambda/src/lib/progress-aggregation.ts` (continue from task 3)
  - Add `pivotCells(rows: { evaluatedAt: Date }[], now: Date, days = 30): number[]` returning a fixed-length array (length 30) of UTC-day attempt counts, oldest at index 0, today at index 29
  - Add `aggregateTopicMastery(rows: ContributingRow[], now: Date): number` — alias for `aggregateAxisMastery`, exported separately for readability
  - Export `DEFAULT_SHADE_THRESHOLDS = { paper2: 1, accentSoft: 2, accent: 4 } as const`
  - Purpose: shared helpers used by the heatmap route to shape its response
  - _Leverage: progress-aggregation.ts (tasks 1–3)_
  - _Requirements: 6.2, 9.1, 9.3_

- [x] 5. Write progress-aggregation unit tests in `infra/lambda/src/lib/progress-aggregation.test.ts`
  - File: `infra/lambda/src/lib/progress-aggregation.test.ts`
  - Test `axisForExerciseType` for all 3 implemented types + reserved types + unknown → null
  - Test `aggregateAxisMastery`: empty → 0; same score on B2 outweighs A1; 60-day-old correct < same-day correct; clamps to [0,1]
  - Test `aggregateRadar`: returns exactly 6 axes in `RADAR_AXIS_ORDER`; missing axes have `evidenceCount: 0`; `previousMastery` falls back to `currentMastery` when no rows older than 30d; `lastPracticedAt` is max evaluatedAt or null
  - Test `pivotCells`: returns length 30, today at index 29, two attempts on the same UTC day yield count 2
  - Purpose: lock the aggregation contract before SQL touches it
  - _Leverage: vitest, infra/lambda/src/lib/progress-aggregation.ts_
  - _Requirements: 4.1, 4.2, 8.5, 8.6, 9.3_

### Layer 2 — Lambda routes

- [x] 6. Create `/progress/radar` handler in `infra/lambda/src/routes/progress.ts`
  - File: `infra/lambda/src/routes/progress.ts` (new)
  - Mount `authMiddleware` on `/progress/*` (mirrors `profiles.ts`)
  - Define a local `LearningLanguageEnum = z.enum([Language.ES, Language.DE, Language.TR])` (same pattern as `profiles.ts` lines 25-29 — Lambda owns its copy to avoid api-client → infra dependency)
  - Implement `GET /progress/radar`: parse `language` query with Zod (400 on failure), run a single Drizzle `select` joining `userExerciseHistory` and `exercises` filtered by `userId + language + evaluatedAt >= now-90d + score IS NOT NULL`, pass rows to `aggregateRadar`, return `{ language, axes }`
  - Purpose: implement Requirement 8 in one handler with one round trip
  - _Leverage: infra/lambda/src/middleware/auth.ts, infra/lambda/src/db.ts, infra/lambda/src/routes/profiles.ts (pattern), infra/lambda/src/lib/progress-aggregation.ts, packages/db/src/schema/progress.ts, packages/db/src/schema/exercises.ts_
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, NFR-Security_

- [x] 7. Add `/progress/heatmap` handler to `infra/lambda/src/routes/progress.ts`
  - File: `infra/lambda/src/routes/progress.ts` (continue from task 6)
  - Implement `GET /progress/heatmap`: parse `language` query (400 on failure)
  - Pull rows projecting `score, difficulty, type, evaluatedAt, topicHint = lower(exercises.contentJson->>'topicHint')` filtered by `userId + language + evaluatedAt >= now-90d + topicHint IS NOT NULL + score IS NOT NULL`
  - In Node: group by `topicHint`, take the top 8 by row count over the 90-day window, compute `mastery` via `aggregateTopicMastery`, compute `cells` via `pivotCells` over the row subset filtered to the last 30 days
  - Return `{ language, days: 30, topics, shadeThresholds: DEFAULT_SHADE_THRESHOLDS }`
  - Purpose: implement Requirement 9 in one handler with one round trip
  - _Leverage: progress.ts (task 6), progress-aggregation.ts (tasks 1–4), drizzle-orm sql template_
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, NFR-Performance, NFR-Security_

- [x] 8. Register the progress router in `infra/lambda/src/index.ts`
  - File: `infra/lambda/src/index.ts`
  - Import `progress from './routes/progress'`
  - Add `app.route('/', progress);` next to the existing `app.route('/', profiles)` line
  - Purpose: expose both endpoints to API Gateway
  - _Leverage: infra/lambda/src/index.ts (existing route registrations)_
  - _Requirements: 8.1, 9.1_

- [x] 9. Write progress-route integration tests in `infra/lambda/src/routes/progress.test.ts`
  - File: `infra/lambda/src/routes/progress.test.ts`
  - Mirror the patterns in `profiles.test.ts` and `exercises.test.ts` (test DB seed + Hono `app.request`)
  - Cover: empty user → 200 with all axes zero/`evidenceCount: 0`; ES history doesn't leak into a `?language=DE` request; row 100 days old is excluded; `?language=EN` → 400; missing `language` → 400; heatmap returns up-to-8 topics ordered by attempt count; rows missing `topicHint` are excluded from heatmap but still count toward radar
  - Purpose: lock the wire contract end-to-end
  - _Leverage: infra/lambda/src/routes/profiles.test.ts, infra/lambda/src/routes/exercises.test.ts (test patterns)_
  - _Requirements: 8.1–8.6, 9.1–9.5, 1.5, 6.6_

### Layer 3 — API client

- [x] 10. Create wire schemas in `packages/api-client/src/schemas/progress.ts`
  - File: `packages/api-client/src/schemas/progress.ts`
  - Define `RadarAxisKeyEnum`, `RadarAxisSchema` (with `length` + value constraints from Design §"Wire schema 1"), `ProgressRadarResponseSchema` (axes `.length(6)`)
  - Define `HeatmapTopicSchema` (`cells.length(30)`), `ProgressHeatmapResponseSchema` (`days: z.literal(30)`, `topics.max(8)`, `shadeThresholds`)
  - Re-use `LearningLanguageEnum` from `./preferences`
  - Export inferred types `ProgressRadarResponse`, `ProgressHeatmapResponse`
  - Purpose: typed wire contract for both endpoints
  - _Leverage: packages/api-client/src/schemas/preferences.ts (LearningLanguageEnum), packages/api-client/src/schemas/exercise.ts (schema pattern)_
  - _Requirements: 11.4_

- [x] 11. Write schema tests in `packages/api-client/src/schemas/progress.test.ts`
  - File: `packages/api-client/src/schemas/progress.test.ts`
  - Round-trip a valid radar payload; reject `axes.length !== 6`; reject `currentMastery > 1`
  - Round-trip a valid heatmap payload; reject `days: 31`; reject `cells.length !== 30`; reject `topics.length > 8`; reject `language: 'EN'`
  - Purpose: lock the schemas before hooks consume them
  - _Leverage: vitest, packages/api-client/src/schemas/preferences.test.ts (test pattern)_
  - _Requirements: 11.4, NFR-Security_

- [x] 12. Create query hooks in `packages/api-client/src/hooks/useProgress.ts`
  - File: `packages/api-client/src/hooks/useProgress.ts`
  - Export `useProgressRadar({ fetchFn, language, enabled = true })` and `useProgressHeatmap({ fetchFn, language, enabled = true })`, both returning `UseQueryResult<…, Error>`
  - Query keys: `['progressRadar', language]` / `['progressHeatmap', language]`
  - `staleTime: 5 * 60 * 1000` (matches `useLanguageProfiles`)
  - Use `LearningLanguage` from `@language-drill/shared` for the `language` param type
  - URLs: `/progress/radar?language=${language}` and `/progress/heatmap?language=${language}`
  - Parse response through the matching Zod schema
  - Purpose: implement Requirement 11
  - _Leverage: packages/api-client/src/hooks/useLanguageProfiles.ts (template), packages/api-client/src/fetchClient.ts, packages/api-client/src/schemas/progress.ts_
  - _Requirements: 11.1, 11.2, 11.3, 11.4_

- [x] 13. Write hook tests in `packages/api-client/src/hooks/useProgress.test.ts`
  - File: `packages/api-client/src/hooks/useProgress.test.ts`
  - Mock `fetchFn`; assert each hook calls the right URL with the language query, and returns parsed data
  - Assert `enabled: false` blocks the fetch
  - Assert that switching `language` produces a fresh fetch (new query key)
  - Purpose: lock hook behaviour
  - _Leverage: packages/api-client/src/hooks/useLanguageProfiles.test.ts (test pattern)_
  - _Requirements: 11.1, 11.2, 11.3_

- [x] 14. Export new symbols from `packages/api-client/src/index.ts`
  - File: `packages/api-client/src/index.ts`
  - Re-export the schemas, types, and both hooks from `./schemas/progress` and `./hooks/useProgress`
  - Purpose: make the new API surface available to `apps/web`
  - _Leverage: packages/api-client/src/index.ts (existing exports)_
  - _Requirements: 11.1_

### Layer 4 — Frontend shared lib

- [x] 15. Create observation-rules in `apps/web/app/(dashboard)/progress/_lib/observation-rules.ts` (+ tests)
  - Files: `apps/web/app/(dashboard)/progress/_lib/observation-rules.ts`, `apps/web/app/(dashboard)/progress/_lib/observation-rules.test.ts`
  - Export `computeObservation(axes: RadarAxis[]): { observation: string; highlightedAxes: { strongest, weakest } } | null`
  - Implement the four branches from Design §"Observation rules table" (input-strong, output-strong, weakest-low, otherwise-null)
  - Tests cover each branch + the "all evidenceCount=0" case returning `null`
  - Purpose: deterministic narrative for the observation card; no Claude call
  - _Leverage: @language-drill/api-client (RadarAxis types from task 10)_
  - _Requirements: 5.2, 5.5_

- [x] 16. Create `useTabUrlState` hook in `apps/web/app/(dashboard)/progress/_lib/use-tab-url-state.ts` (+ tests)
  - Files: `apps/web/app/(dashboard)/progress/_lib/use-tab-url-state.ts`, `.../_lib/use-tab-url-state.test.ts`
  - Reads `?tab=` from `useSearchParams`, defaults to `'shape'`, narrows to the literal union `'shape' | 'heatmap' | 'history'`
  - Returns `{ tab, setTab }` where `setTab` calls `router.replace(\`?tab=\${id}\`, { scroll: false })`
  - Test: invalid `?tab=garbage` falls back to `'shape'`; calling `setTab` invokes `router.replace` with the right URL
  - Purpose: shareable, reload-safe tab state for Requirement 3.3
  - _Leverage: next/navigation (useRouter, useSearchParams)_
  - _Requirements: 3.1, 3.3_

### Layer 5 — UI primitives (each independently testable)

- [x] 17. Build `ProgressHeader` in `apps/web/app/(dashboard)/progress/_components/progress-header.tsx` (+ test)
  - Files: `_components/progress-header.tsx`, `_components/__tests__/progress-header.test.tsx`
  - Props: `{ language: LearningLanguage; proficiencyLevel: CefrLevel | null; weeksActive: number | null }`
  - Renders eyebrow `{LANGUAGE_NAMES[language].toLowerCase()} · {level} · {weeksActive} weeks in` (each segment omitted independently when its value is null), then `t-display-xl` title, then `t-body-l` subtitle
  - Test: omits the level segment when `proficiencyLevel === null`; omits weeks segment when `weeksActive === null`; never renders streaks/XP text
  - _Leverage: packages/shared/src/index.ts (LANGUAGE_NAMES, CefrLevel), apps/web/app/globals.css tokens_
  - _Requirements: 2.1, 2.2, 2.3_

- [x] 18. Build `ProgressTabs` in `apps/web/app/(dashboard)/progress/_components/progress-tabs.tsx` (+ test)
  - Files: `_components/progress-tabs.tsx`, `_components/__tests__/progress-tabs.test.tsx`
  - Props: `{ active: 'shape' | 'heatmap' | 'history'; onChange: (id) => void; children: ReactNode }`
  - WAI-ARIA tablist: `role="tablist"`, each button `role="tab"`, `aria-selected`, `aria-controls`; left/right arrows cycle, Home/End jump to ends, Enter/Space activate
  - Underline active tab with `var(--color-ink)`, others with `transparent`
  - Test: arrow keys move focus and activation; `aria-selected` flips on click; only the active panel renders
  - _Leverage: apps/web/app/globals.css tokens_
  - _Requirements: 3.1, 3.2, 3.4_

- [x] 19. Build `ProgressEmptyState` in `apps/web/app/(dashboard)/progress/_components/progress-empty-state.tsx`
  - File: `_components/progress-empty-state.tsx`
  - Props: `{ language: LearningLanguage }`
  - Renders a single Card with copy "do your first drill to build your shape" + a Link/Button to `/drill`
  - No test (trivial render); covered by the page-level test in task 28
  - _Leverage: apps/web/components/ui/card.tsx, apps/web/components/ui/button.tsx, next/link_
  - _Requirements: 1.5_

- [x] 20. Build `RadarChart` in `apps/web/app/(dashboard)/progress/_components/radar-chart.tsx` (+ test)
  - Files: `_components/radar-chart.tsx`, `_components/__tests__/radar-chart.test.tsx`
  - Props: `{ axes: RadarAxis[] }`
  - Pure SVG (`viewBox="0 0 440 440"`, `width="100%" height="auto"`), 4 dashed grid polygons at 25/50/75/100%, axis spokes, dashed `previousMastery` polygon, solid `accent`-fill `currentMastery` polygon, vertex circles, axis labels (Inter 12px, `var(--color-ink-soft)`)
  - Accessibility: `role="img"`, `aria-label="Skill radar for {language}; strongest: {label} at {pct}%, weakest: {label} at {pct}%."`, `<title>` and `<desc>` children, plus a visually-hidden `<ul>` with one `<li>` per axis
  - Test: renders 6 axis labels and 6 list items with the right percentages; `aria-label` cites the correct strongest/weakest from the input
  - _Leverage: @language-drill/api-client (RadarAxis), apps/web/app/globals.css tokens_
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

- [x] 21. Build `HeatmapGrid` in `apps/web/app/(dashboard)/progress/_components/heatmap-grid.tsx` (+ test)
  - Files: `_components/heatmap-grid.tsx`, `_components/__tests__/heatmap-grid.test.tsx`
  - Props: `{ topics: HeatmapTopic[]; shadeThresholds: ShadeThresholds }`
  - Layout: legend swatch row top-right; per-topic row with 170px right-aligned label, 30 cells via flex (with `aspectRatio: 1, maxHeight: 22`), 36px `t-mono` mastery percent on the right
  - Implement `pickShade(count, t)` per Design §"Shade picker (client)"
  - Each cell renders a `title` attribute with the date and attempt count (UTC date stringified, e.g. `2026-04-15: 2 attempts`)
  - Test: a count crossing the `accent` threshold renders with `--color-accent` background; the `title` matches the expected date for the cell index
  - _Leverage: @language-drill/api-client (HeatmapTopic), apps/web/app/globals.css tokens_
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.7_

- [x] 22a. Build `ObservationCard` and `LegendCard` in `apps/web/app/(dashboard)/progress/_components/shape-side-cards.tsx` (+ test)
  - Files: `_components/shape-side-cards.tsx`, `_components/__tests__/shape-side-cards.test.tsx`
  - Export `ObservationCard({ axes })` — calls `computeObservation(axes)`; renders only when it returns a non-null result, with `accent-soft` background and `accent-2` eyebrow text
  - Export `LegendCard()` — static, two swatches matching the radar ("you · now" / "you · 30 days ago"); the prototype's "avg learner @ B2" line is omitted
  - Test: `ObservationCard` returns `null` when `computeObservation` does; renders the observation copy when it doesn't
  - _Leverage: apps/web/components/ui/card.tsx, _lib/observation-rules.ts (task 15)_
  - _Requirements: 5.2, 5.3_

- [x] 22b. Build `RecommendedDrillCard` and `NotEnoughDataCard` in the same file (+ test additions)
  - Files: `_components/shape-side-cards.tsx` (continue from task 22a), `_components/__tests__/shape-side-cards.test.tsx` (extend)
  - Export `RecommendedDrillCard({ axes })` — picks the lowest-mastery axis with `evidenceCount > 0` AND `currentMastery < 0.5`; renders `null` if no axis qualifies; CTA links to `/drill?focus={axisKey}`
  - Export `NotEnoughDataCard()` — static `<5 evidence` placeholder pointing to `/drill`
  - Test: `RecommendedDrillCard` returns `null` when every practised axis is ≥ 0.5; picks the lowest qualifying axis when one is below threshold
  - _Leverage: apps/web/components/ui/card.tsx, apps/web/components/ui/button.tsx, next/link_
  - _Requirements: 5.4, 5.5_

- [x] 23. Build `HotColdSummary` in `apps/web/app/(dashboard)/progress/_components/hot-cold-summary.tsx` (+ test)
  - Files: `_components/hot-cold-summary.tsx`, `_components/__tests__/hot-cold-summary.test.tsx`
  - Props: `{ topics: HeatmapTopic[] }`
  - "Hottest" picks the topic with the most attempts in the last 14 days (sum of `cells.slice(-14)`); shows `t-display-s` name + `t-small` "X of last 14 days · paying off"; `hilite-soft` background
  - "Coldest" picks the topic with `mastery > 0.4` AND the largest gap since its last non-zero cell (≥ 7 days untouched); shows "untouched N days"; `accent-soft` background
  - Hides whichever card cannot be populated (R6.5)
  - Renders side-by-side in a 1fr 1fr grid below the heatmap card
  - Test: hot/cold selection logic — given crafted `topics` data, the right name appears in each card; both cards hide when no topic qualifies
  - _Leverage: apps/web/components/ui/card.tsx, @language-drill/api-client (HeatmapTopic)_
  - _Requirements: 6.5_

- [x] 24. Build `HistoryTab` stub in `apps/web/app/(dashboard)/progress/_components/history-tab.tsx`
  - File: `_components/history-tab.tsx`
  - Static component — single centered Card with `t-display-s` "history view" + `t-small` "(coming soon — sparkline trends per skill, 30/60/90/all)"
  - No data fetching, no hooks, no props
  - _Leverage: apps/web/components/ui/card.tsx_
  - _Requirements: 7.1, 7.2_

- [x] 25. Build `ShapeTab` orchestrator in `apps/web/app/(dashboard)/progress/_components/shape-tab.tsx` (+ test)
  - Files: `_components/shape-tab.tsx`, `_components/__tests__/shape-tab.test.tsx`
  - Props: `{ data: ProgressRadarResponse | undefined; isLoading: boolean; error: Error | null; totalEvidence: number }`
  - States: loading skeleton (centered spinner inside a Card); error card with retry hook; if `totalEvidence < 5` → render radar + `NotEnoughDataCard` only; else render radar + `ObservationCard` + `LegendCard` + `RecommendedDrillCard`
  - 2-column grid (1fr / 320px) per Design
  - Test: shows `NotEnoughDataCard` when `totalEvidence < 5`; shows `ObservationCard` only when `computeObservation` returns non-null
  - _Leverage: tasks 20, 22a, 22b, ./shape-side-cards, ./radar-chart_
  - _Requirements: 4.1, 5.1, 5.2, 5.5_

- [x] 26. Build `HeatmapTab` orchestrator in `apps/web/app/(dashboard)/progress/_components/heatmap-tab.tsx` (+ test)
  - Files: `_components/heatmap-tab.tsx`, `_components/__tests__/heatmap-tab.test.tsx`
  - Props: `{ data: ProgressHeatmapResponse | undefined; isLoading: boolean; error: Error | null }`
  - States: loading skeleton; error card; if `topics.length < 3` → "build a topic history first" empty card; else render `HeatmapGrid` + `HotColdSummary`
  - Test: renders the empty card when `topics.length < 3`
  - _Leverage: tasks 21, 23, ./heatmap-grid, ./hot-cold-summary_
  - _Requirements: 6.1, 6.5, 6.6_

### Layer 6 — Page wire-up

- [x] 27. Rewrite `apps/web/app/(dashboard)/progress/page.tsx` to compose all the pieces
  - File: `apps/web/app/(dashboard)/progress/page.tsx` (replace placeholder)
  - `'use client'` page; reads `activeLanguage` via `useActiveLanguage`; builds `fetchFn` with `createAuthenticatedFetch(getToken)`; calls `useProgressRadar` and `useProgressHeatmap` (both prefetch even when their tab isn't active so toggling is instant)
  - Reads proficiency level from the cached `useLanguageProfiles({ fetchFn })` result
  - Computes `weeksActive` from `min(radar.data.axes[*].lastPracticedAt)`
  - Computes `totalEvidence = sum(axes[*].evidenceCount)` and renders the page-wide `ProgressEmptyState` if it equals 0
  - Otherwise renders `ProgressHeader` + `ProgressTabs` containing `ShapeTab` / `HeatmapTab` / `HistoryTab`
  - Tab state from `useTabUrlState`
  - _Leverage: tasks 12, 15, 16, 17, 18, 19, 24, 25, 26; apps/web/components/shell/active-language-provider.tsx; packages/api-client (createAuthenticatedFetch, useLanguageProfiles, useProgressRadar, useProgressHeatmap)_
  - _Requirements: 1.1, 1.2, 1.3, 1.5, 2.1, 2.2, 2.3, 3.1, 3.3, 10.1, 10.2, 10.3, NFR-Performance, NFR-Reliability_

- [x] 28. Write page integration test in `apps/web/app/(dashboard)/progress/page.test.tsx`
  - File: `apps/web/app/(dashboard)/progress/page.test.tsx`
  - Mock `useProgressRadar`, `useProgressHeatmap`, `useLanguageProfiles`, `useActiveLanguage`, and `next/navigation`
  - Test: renders `ProgressEmptyState` when every axis has `evidenceCount: 0`
  - Test: renders the Shape tab by default
  - Test: clicking the Heatmap tab updates `?tab=heatmap` via `router.replace` and renders the heatmap panel
  - Test: an error from the radar query renders only the Shape error state — Heatmap tab still works (per-tab error boundaries from R-NFR Reliability)
  - Test: page renders no element containing the words "streak", "XP", "lessons completed" (asserts hard rule from CLAUDE.md)
  - _Leverage: vitest, @testing-library/react, apps/web/app/(dashboard)/drill/page.test.tsx (mock pattern)_
  - _Requirements: 1.1, 1.5, 3.1, 3.3, NFR-Reliability, NFR-Usability_

### Layer 7 — Pre-push verification

- [x] 29. Run the full pre-push suite from repo root
  - Files: none modified (verification only)
  - Run `pnpm lint && pnpm typecheck && pnpm test`
  - Resolve any failures before considering Phase I complete; do not skip or `--no-verify`
  - Purpose: enforce CLAUDE.md §"Pre-Push Checks" before opening the PR
  - _Requirements: All_
