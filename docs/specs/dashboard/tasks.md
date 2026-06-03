# Implementation Plan

## Task Overview

Implement the Phase D Dashboard in six layers, bottom-up so each task lands working code with co-located tests. Order: (1) api-client wire schema + hook, (2) Lambda lib (pure plan composition functions), (3) Lambda route, (4) page-scoped pure-function helpers, (5) UI components (leaves first, then orchestrators), (6) page wire-up. The page rewrite is the last commit-worthy task; everything before it is shippable in isolation.

## Steering Document Compliance

- **`tech.md`** — Hono route mounted via existing `authMiddleware` on `/sessions/*`, Drizzle for SQL, Zod for wire validation, TanStack Query for hooks, no new infra.
- **`CLAUDE.md`** — every UI task asserts the no-streaks/no-XP rule: tests check that no streak / lesson-count text appears.
- **Repo layout (`CLAUDE.md` §Monorepo Layout)** — Lambda lib in `infra/lambda/src/lib/`, route extension in `infra/lambda/src/routes/`, schemas in `packages/api-client/src/schemas/`, hooks in `packages/api-client/src/hooks/`, page-scoped helpers in `apps/web/app/(dashboard)/_lib/`, page-scoped UI in `apps/web/app/(dashboard)/_components/`.
- **Pre-push** — the final task runs `pnpm lint && pnpm typecheck && pnpm test` from repo root and must be green before this phase ships.

## Atomic Task Requirements

Each task touches 1–3 files, completes in 15–30 minutes, has a single testable outcome, and references specific files plus the requirements it satisfies.

## Tasks

### Layer 1 — Wire schema + hook (api-client)

- [x] 1. Create `TodayPlanResponse` Zod schema in `packages/api-client/src/schemas/today.ts`
  - File: `packages/api-client/src/schemas/today.ts` (new)
  - Export `TodayPlanItemStatusEnum = z.enum(['done', 'queued'])`
  - Export `TodayPlanItemSchema` matching Design §"Wire schema — TodayPlanResponse" (`index 1..5`, `type` via `z.nativeEnum(ExerciseType)`, `topicHint` nullable string, `difficulty` via `z.nativeEnum(CefrLevel)`, `itemCount` int ≥1, `estimatedMinutes` int ≥1, `status` via the enum)
  - Export `TodayPlanSummarySchema` (`itemCount`, `correctCount`, `durationMinutes`, all int ≥0)
  - Export `TodayPlanResponseSchema` with `language` via `LearningLanguageEnum`, `generatedAt` ISO datetime, `totalEstimatedMinutes` int ≥0, `items` array max 5, `summary` nullable, `code` `z.literal('INSUFFICIENT_POOL').nullable()`
  - Export inferred TS types: `TodayPlanItem`, `TodayPlanSummary`, `TodayPlanResponse`
  - Purpose: single typed contract between Lambda and web client
  - _Leverage: packages/api-client/src/schemas/preferences.ts (LearningLanguageEnum), packages/shared/src/index.ts (ExerciseType, CefrLevel)_
  - _Requirements: 8.1, 9.1_

- [x] 2. Write Zod schema unit tests in `packages/api-client/src/schemas/today.test.ts`
  - File: `packages/api-client/src/schemas/today.test.ts` (new)
  - Test: a happy-path payload (5 queued items, `summary: null`, `code: null`) parses
  - Test: all-done payload (5 done items, `summary` populated) parses
  - Test: insufficient-pool payload (`items: []`, `code: 'INSUFFICIENT_POOL'`, `summary: null`) parses
  - Test: rejects `items` length > 5
  - Test: rejects `language: 'EN'` (LearningLanguageEnum is ES/DE/TR only)
  - Test: rejects unknown `status` value
  - Purpose: pin the wire contract; catch drift before runtime
  - _Leverage: packages/api-client/src/schemas/preferences.test.ts (pattern), packages/api-client/src/schemas/today.ts_
  - _Requirements: 8.1, 9.1, 9.5_

- [x] 3. Re-export the today schemas from `packages/api-client/src/index.ts`
  - File: `packages/api-client/src/index.ts` (modify)
  - Add an export block for `TodayPlanResponseSchema`, `TodayPlanItemSchema`, `TodayPlanSummarySchema`, `TodayPlanItemStatusEnum`, plus the inferred types `TodayPlanResponse`, `TodayPlanItem`, `TodayPlanSummary`
  - Purpose: make the schemas importable from `@language-drill/api-client` (consumed by both the Lambda integration test and the web page)
  - _Leverage: packages/api-client/src/index.ts (existing export style for sessions/progress)_
  - _Requirements: 9.1_

- [x] 4. Create `useTodayPlan` hook in `packages/api-client/src/hooks/useTodayPlan.ts`
  - File: `packages/api-client/src/hooks/useTodayPlan.ts` (new)
  - Export `UseTodayPlanParams = { fetchFn: AuthenticatedFetch; language: LearningLanguage; enabled?: boolean }`
  - Export `useTodayPlan({ fetchFn, language, enabled = true })` returning `UseQueryResult<TodayPlanResponse, Error>`, queryKey `['todayPlan', language]`, `staleTime: 60 * 1000`, parse response via `TodayPlanResponseSchema.parse`
  - GET URL: `/sessions/today?language=${encodeURIComponent(language)}`
  - Purpose: typed React Query hook for the dashboard timeline
  - _Leverage: packages/api-client/src/hooks/useProgress.ts (template), packages/api-client/src/fetchClient.ts, packages/api-client/src/schemas/today.ts_
  - _Requirements: 9.1, 9.3, 9.4_

- [x] 5. Write `useTodayPlan` hook unit tests in `packages/api-client/src/hooks/useTodayPlan.test.ts`
  - File: `packages/api-client/src/hooks/useTodayPlan.test.ts` (new)
  - Test: fires `GET /sessions/today?language=ES` with a mocked `fetchFn`
  - Test: parses the response through Zod; throws when payload is malformed
  - Test: `enabled: false` does not fire a request (mocked `fetchFn` not called)
  - Test: query key changes when `language` changes (assert via `result.options.queryKey`)
  - Purpose: pin hook behaviour; mirrors `useProgress.test.ts` coverage
  - _Leverage: packages/api-client/src/hooks/useProgress.test.ts (pattern), @testing-library/react, @tanstack/react-query test utils_
  - _Requirements: 9.1, 9.3, 9.4, 9.5_

- [x] 6. Re-export `useTodayPlan` from `packages/api-client/src/index.ts`
  - File: `packages/api-client/src/index.ts` (modify)
  - Add `export { useTodayPlan, type UseTodayPlanParams } from './hooks/useTodayPlan';`
  - Purpose: importable from `@language-drill/api-client`
  - _Leverage: packages/api-client/src/index.ts (existing useProgress export pattern)_
  - _Requirements: 9.1_

### Layer 2 — Lambda lib (pure plan composition)

- [x] 7. Create plan-composition constants and types in `infra/lambda/src/lib/today-plan.ts`
  - File: `infra/lambda/src/lib/today-plan.ts` (new)
  - Export `ESTIMATED_MINUTES_BY_TYPE: Record<ExerciseType, number> = { CLOZE: 2, TRANSLATION: 4, VOCAB_RECALL: 2 }`
  - Export `PlanCompositionSlot` type and `V1_PLAN_SHAPE: readonly PlanCompositionSlot[]` exactly as Design §"Internal type — PlanCompositionSlot" specifies (cloze, cloze, translation, vocab_recall, cloze; prefixes warm-up, core, production, core, cool-down)
  - Export `PlanItem` type (the in-memory shape used by `composeFreshPlan` / `hydrateFromSession` before mapping to the wire schema)
  - Export `startOfUtcDay(now: Date): Date` returning a Date set to 00:00:00 UTC of the same calendar day
  - Purpose: single source of truth for slot mix, minute estimates, and date math
  - _Leverage: packages/shared/src/index.ts (ExerciseType)_
  - _Requirements: 8.3, 8.8_

- [x] 8. Add `composeFreshPlan` pure function to `infra/lambda/src/lib/today-plan.ts`
  - File: `infra/lambda/src/lib/today-plan.ts` (continue from task 7)
  - Add `type PoolDraw = { id: string; type: ExerciseType; topicHint: string | null; difficulty: CefrLevel }`
  - Add `composeFreshPlan(draws: PoolDraw[], _radarSnapshot?: unknown): { items: PlanItem[]; insufficient: boolean }` — when `draws.length < 5` return `{ items: [], insufficient: true }`; otherwise map each slot in `V1_PLAN_SHAPE` to the matching draw (preserving order), set `status: 'queued'`, `index` from the slot, `estimatedMinutes` from `ESTIMATED_MINUTES_BY_TYPE[draw.type]`, `itemCount` from a static lookup `{ CLOZE: 4, TRANSLATION: 1, VOCAB_RECALL: 6 }` exported alongside
  - The `_radarSnapshot` parameter is the deferred adaptive swap point; ignored in v1 but documented in a one-line comment
  - Purpose: compose the fresh-plan branch deterministically; testable without DB
  - _Leverage: today-plan.ts (task 7), packages/shared/src/index.ts (ExerciseType, CefrLevel)_
  - _Requirements: 8.3, 8.5, 8.8_

- [x] 9. Add `hydrateFromSession` pure function to `infra/lambda/src/lib/today-plan.ts`
  - File: `infra/lambda/src/lib/today-plan.ts` (continue from task 8)
  - Inputs: `{ session: { id, exerciseIds, exerciseCount, correctCount, startedAt, completedAt }, exercises: Map<string, { type, topicHint, difficulty }>, attemptedIds: Set<string> }`
  - Output: `{ items: PlanItem[]; summary: { itemCount: number; correctCount: number; durationMinutes: number } | null }`
  - Items are produced in `exerciseIds` order; `status: 'done'` if `attemptedIds.has(id)`, else `'queued'`; rows missing from the `exercises` map are dropped silently (defensive for a deleted exercise)
  - `summary` is non-null iff every `exerciseIds` resolves to a `done` item AND `completedAt` is non-null; otherwise `null`. `durationMinutes = Math.round((completedAt - startedAt) / 60000)`
  - Purpose: hydrate Path A deterministically; testable without DB
  - _Leverage: today-plan.ts (tasks 7–8)_
  - _Requirements: 8.2, 8.4, 4.1_

- [x] 10. Write `today-plan.ts` unit tests in `infra/lambda/src/lib/today-plan.test.ts`
  - File: `infra/lambda/src/lib/today-plan.test.ts` (new)
  - Test `startOfUtcDay`: midday input collapses to 00:00:00 UTC; year boundary preserved
  - Test `composeFreshPlan`: 5 draws → 5 items in `V1_PLAN_SHAPE` order, all queued; 4 draws → `insufficient: true`, `items: []`; `estimatedMinutes` and `itemCount` match the constant tables
  - Test `hydrateFromSession`: every id attempted + completedAt set → summary populated with correct durationMinutes; partial completion → `summary: null`; a `null` completedAt with all attempted → `summary: null`; missing exercise row drops the item; output preserves `exerciseIds` ordering
  - Purpose: lock the composition contract before SQL touches it
  - _Leverage: vitest, infra/lambda/src/lib/today-plan.ts_
  - _Requirements: 8.2, 8.3, 8.4, 8.5, 8.8_

### Layer 3 — Lambda route

- [x] 11a. Add `GET /sessions/today` skeleton + Path B (fresh plan) to `infra/lambda/src/routes/sessions.ts`
  - File: `infra/lambda/src/routes/sessions.ts` (modify — add the handler before `export default sessions`)
  - Define a local `LearningLanguageEnum = z.enum([Language.ES, Language.DE, Language.TR])` (or import from a shared place if one exists by then)
  - Validate `?language=` with Zod → 400 `VALIDATION_ERROR` on failure (also rejects `EN`)
  - Issue Query 1 (today-session lookup) + proficiency-level fetch in parallel via `Promise.all` (per Design §"Query 1"). Default `B1` when no profile row
  - **Path B only in this task**: when no today-session exists, run Query 2 (Path B) — UNION-ALL of 5 `LIMIT 1` selects keyed by slot type via `db.execute(sql`...`)`. Map to `PoolDraw[]` preserving UNION-ALL order. Call `composeFreshPlan(draws)`; if `insufficient` return the `INSUFFICIENT_POOL` shape; otherwise map `PlanItem[]` to the wire shape, compute `totalEstimatedMinutes`, and return `200`
  - For now, when a today-session row IS found, return `501 NOT_IMPLEMENTED` placeholder — Path A lands in task 11b
  - Mounts under the existing `sessions.use('/sessions/*', authMiddleware)` so 401 is automatic
  - Purpose: ship the larger of the two paths and the route surface in one focused commit
  - _Leverage: infra/lambda/src/routes/sessions.ts (existing handlers, db import, types), infra/lambda/src/lib/today-plan.ts, packages/db/src/schema/sessions.ts, packages/db/src/schema/users.ts (userLanguageProfiles), packages/db/src/schema/exercises.ts_
  - _Requirements: 8.1, 8.3, 8.5, 8.6, 8.7, 8.8, NFR-Performance, NFR-Security_

- [x] 11b. Implement Path A (hydrate from today's session) in `infra/lambda/src/routes/sessions.ts`
  - File: `infra/lambda/src/routes/sessions.ts` (continue from 11a — replace the 501 stub)
  - When a today-session row is present, run Query 2 (Path A) — `LEFT JOIN exercises × user_exercise_history ON (exerciseId, sessionId)` filtered by `inArray(exercises.id, session.exerciseIds)`. Project `(exerciseId, type, topicHint, difficulty, historyId)`
  - Build a `Map<string, {type, topicHint, difficulty}>` from the rows (preserving the `exerciseIds` order is the caller's job — done inside `hydrateFromSession`). Build the `attemptedIds: Set<string>` from rows where `historyId IS NOT NULL`
  - Call `hydrateFromSession({ session, exercises, attemptedIds })` to get `{ items, summary }`. Map `items` to the wire shape, set `totalEstimatedMinutes` and `generatedAt`, return `200`
  - Purpose: complete the route by wiring the hydrate path
  - _Leverage: 11a stub, infra/lambda/src/lib/today-plan.ts (hydrateFromSession), packages/db/src/schema/progress.ts (userExerciseHistory)_
  - _Requirements: 8.2, 8.4, 4.1_

- [x] 12. Add `GET /sessions/today` integration tests to `infra/lambda/src/routes/sessions.test.ts`
  - File: `infra/lambda/src/routes/sessions.test.ts` (modify — add a new `describe('GET /sessions/today', …)` block)
  - Mock the Drizzle layer using the existing `mockSelect / mockSelectAwait / mockWhere` scaffolding (mirrors how the file already mocks the POST handlers); add a parallel mock for `db.execute` to cover the UNION-ALL pool sample
  - Test: missing `language` → 400 `VALIDATION_ERROR`
  - Test: `language=EN` → 400
  - Test: Path A — today-session exists with all items attempted and `completedAt` set → response items every `status: 'done'`, `summary` populated, `totalEstimatedMinutes` matches sum of `ESTIMATED_MINUTES_BY_TYPE`
  - Test: Path A — today-session exists with partial attempts → mixed statuses, `summary: null`
  - Test: Path B — no today-session, pool returns 5 draws → 5 items in `V1_PLAN_SHAPE` order, every `status: 'queued'`
  - Test: Path B — pool returns < 5 draws → `items: []`, `code: 'INSUFFICIENT_POOL'`, 200 status
  - Test: 401 path — issue an `app.request('/sessions/today?language=ES')` with **no** auth header / no injected `userId` → expect status 401 (mirrors the `/profiles` 401 test pattern)
  - Purpose: pin the route's contract end-to-end
  - _Leverage: infra/lambda/src/routes/sessions.test.ts (existing scaffolding), vitest_
  - _Requirements: 8.1, 8.2, 8.3, 8.5, 8.6, 8.7_

### Layer 4 — Page-scoped pure-function helpers

- [x] 13. Create `_lib/greeting.ts` with `timeOfDayGreeting`, `lowercaseWeekday`, `isoWeekNumber`
  - File: `apps/web/app/(dashboard)/_lib/greeting.ts` (new)
  - Implement exactly the three functions from Design §"Greeting helpers"
  - All three accept a `Date` argument so they're testable; the page passes `new Date()` from a `useEffect`
  - Purpose: time-of-day greeting and ISO-week math without an SSR mismatch
  - _Leverage: none (pure stdlib)_
  - _Requirements: 10.1, 10.2_

- [x] 14. Write `greeting.ts` unit tests in `apps/web/app/(dashboard)/_lib/greeting.test.ts`
  - File: `apps/web/app/(dashboard)/_lib/greeting.test.ts` (new)
  - Test `timeOfDayGreeting` at boundaries `03:59`, `04:00`, `11:59`, `12:00`, `17:59`, `18:00`, `23:59`
  - Test `lowercaseWeekday` returns `'tuesday'` etc. for fixed dates; relies on the JS runtime's `en-US` locale being available (Node 18+)
  - Test `isoWeekNumber` for: 2024-01-01 → week 1, 2024-12-30 → week 1 of 2025, 2024-01-04 → week 1, 2026-05-04 (today's date) → its actual ISO week number
  - Purpose: lock the boundary cases that matter for the greeting
  - _Leverage: vitest, apps/web/app/(dashboard)/_lib/greeting.ts_
  - _Requirements: 10.1, 10.2_

- [x] 15. Create `_lib/timeline-labels.ts` with prefix lookup and type-label table
  - File: `apps/web/app/(dashboard)/_lib/timeline-labels.ts` (new)
  - Export `slotPrefixForIndex(index: number): 'warm-up' | 'core' | 'production' | 'cool-down'` — index 1→warm-up, 2→core, 3→production, 4→core, 5→cool-down; throws on out-of-range index
  - Export `typeLabel(type: ExerciseType): string` — `cloze` → `'cloze'`, `translation` → `'translation'`, `vocab_recall` → `'vocabulary recall'`
  - Export `composeTitle(index, type): string` — returns `${prefix} · ${typeLabel}` (e.g. `'core · cloze'`)
  - Export `composeSubtitle(topicHint: string | null, type: ExerciseType, itemCount: number): string` — when `topicHint` exists → `${topicHint} · ${itemCount} items`, otherwise → `${typeLabel(type)} · ${itemCount} items` (Req 3.5 fallback)
  - Purpose: pin the timeline copy in one testable place
  - _Leverage: packages/shared/src/index.ts (ExerciseType)_
  - _Requirements: 3.1, 3.5_

- [x] 16. Create `_lib/framing-rules.ts` with `pickWeakestAxis` and `computeFraming`
  - File: `apps/web/app/(dashboard)/_lib/framing-rules.ts` (new)
  - Export `pickWeakestAxis(axes: RadarAxis[] | undefined): RadarAxis | null` — filter to `evidenceCount >= 1`, return the min-`currentMastery` axis (with `key.localeCompare` tie-break), `null` if no qualifying axis or `axes` undefined
  - Export `FramingResult = { paragraph: string; isGeneric?: true }` and `computeFraming(axes: RadarAxis[] | undefined): FramingResult` exactly as Design §"Framing rules table" specifies — generic line for undefined/no-evidence; weakest < 0.5 line; weakest [0.5, 0.7) line; all ≥ 0.7 maintenance line
  - Purpose: deterministic copy generator; no Claude call
  - _Leverage: packages/api-client/src/schemas/progress.ts (RadarAxis type)_
  - _Requirements: 2.3, 2.4_

- [x] 17. Write `framing-rules.ts` unit tests in `apps/web/app/(dashboard)/_lib/framing-rules.test.ts`
  - File: `apps/web/app/(dashboard)/_lib/framing-rules.test.ts` (new)
  - Test `pickWeakestAxis`: `undefined` → null; all `evidenceCount: 0` → null; mixed → returns the lowest-mastery qualifying axis; tie → `key.localeCompare` order
  - Test `computeFraming` for each branch: undefined input, no evidence anywhere, weakest < 0.5, weakest [0.5, 0.7), all ≥ 0.7
  - Test that the paragraph includes the axis label when one is selected (e.g. `expect(result.paragraph).toContain('grammar')`)
  - Purpose: guarantee the four branches are stable and testable as data
  - _Leverage: vitest, apps/web/app/(dashboard)/_lib/framing-rules.ts_
  - _Requirements: 2.3, 2.4_

### Layer 5 — UI components (leaves first)

- [x] 18. Create `GreetingBlock` component in `apps/web/app/(dashboard)/_components/greeting-block.tsx`
  - File: `apps/web/app/(dashboard)/_components/greeting-block.tsx` (new)
  - `'use client'`. Props: `{ language: LearningLanguage; firstName: string | null }`
  - `useEffect` sets a `mounted` boolean; before mount returns a placeholder `<div className="h-[…] aria-hidden />` matching the final block's height (use a fixed `min-h` matching the eyebrow + title rows)
  - After mount, renders: eyebrow `t-micro` line `${weekday} · week ${isoWeek} · ${LANGUAGE_NAMES[language].toLowerCase()}` and title `t-display-xl` `${greeting}${firstName ? ', ' + firstName : ''}.`
  - Purpose: time-dependent strings rendered post-mount to avoid hydration mismatch
  - _Leverage: apps/web/app/(dashboard)/_lib/greeting.ts, packages/shared/src/index.ts (LANGUAGE_NAMES)_
  - _Requirements: 2.1, 2.2, 10.1, 10.2, 10.3_

- [x] 19. Write `GreetingBlock` tests in `apps/web/app/(dashboard)/_components/__tests__/greeting-block.test.tsx`
  - File: `apps/web/app/(dashboard)/_components/__tests__/greeting-block.test.tsx` (new)
  - Test: server render (`renderToString`) does NOT contain "good morning" / "good afternoon" / "good evening" — i.e., the placeholder is empty
  - Test: after `render` + `act`, the heading contains the appropriate greeting and the first name when provided
  - Test: omits the comma + name when `firstName` is null (`/^good (morning|afternoon|evening)\.$/`)
  - Test: eyebrow contains the lowercased language name
  - Purpose: lock the no-mismatch behaviour and the firstName fallback
  - _Leverage: @testing-library/react, react-dom/server, apps/web/app/(dashboard)/_components/greeting-block.tsx_
  - _Requirements: 2.1, 2.2, 10.3_

- [x] 20. Create `DashboardHeader` component in `apps/web/app/(dashboard)/_components/dashboard-header.tsx`
  - File: `apps/web/app/(dashboard)/_components/dashboard-header.tsx` (new)
  - `'use client'`. Props: `{ language: LearningLanguage; firstName: string | null; axes: RadarAxis[] | undefined; totalEstimatedMinutes: number | null }`
  - **Note:** the design's earlier sketch typed this prop as `weakestAxis: RadarAxis | null`; we pass the full `axes` array instead so the component can call `computeFraming(axes)` directly. The page passes `axes={radar.data?.axes}` (which task 33 already does).
  - Renders: `<GreetingBlock>`, an italic `t-display-l` subline `here's today's plan.`, the framing paragraph from `computeFraming(axes)`
  - Top-right of the title row: `~${totalEstimatedMinutes} min planned` in `t-mono`, or a skeleton when `null`
  - Purpose: the page's editorial header; stable text region above the timeline
  - _Leverage: apps/web/app/(dashboard)/_lib/framing-rules.ts, apps/web/app/(dashboard)/_components/greeting-block.tsx_
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

- [x] 21. Write `DashboardHeader` tests in `apps/web/app/(dashboard)/_components/__tests__/dashboard-header.test.tsx`
  - File: `apps/web/app/(dashboard)/_components/__tests__/dashboard-header.test.tsx` (new)
  - Test: renders the framing paragraph for a weakest-< 0.5 axes array
  - Test: renders the generic line when `axes` is `undefined`
  - Test: shows `~12 min planned` when `totalEstimatedMinutes = 12`; shows a skeleton placeholder when `null`
  - Test: includes `here's today's plan.` subline
  - Test: the page contains NO streak / XP / lesson count text (regex: `/streak|xp|lesson/i`)
  - Purpose: header copy is the most user-visible deliverable; pin every branch
  - _Leverage: @testing-library/react, apps/web/app/(dashboard)/_components/dashboard-header.tsx, RadarAxis fixture builder_
  - _Requirements: 2.3, 2.4, 2.5, NFR-Usability_

- [x] 22. Create `TimelineItem` component in `apps/web/app/(dashboard)/_components/timeline-item.tsx`
  - File: `apps/web/app/(dashboard)/_components/timeline-item.tsx` (new)
  - Props: `{ index: number; type: ExerciseType; topicHint: string | null; itemCount: number; estimatedMinutes: number; status: 'done' | 'queued' | 'next-up'; isLast: boolean; href: string | null }`
  - Renders the rail circle (number `01`–`05`, or `✓` when done; `accent` background + `accent-soft` halo for `next-up`; `ok` background for `done`), the title via `composeTitle`, the subtitle via `composeSubtitle`, the status `Chip` (`accent` for next-up, `ok` for done, none for queued), the `${estimatedMinutes} min` in `t-mono`, and a primary `start →` `Button` only when `status === 'next-up'` and `href` is non-null
  - Connecting line below the circle when `!isLast`
  - Done items render with `line-through` on the title and `opacity-55` on the row
  - `aria-label` on the row: `${index}. ${title}, ${status}`
  - Purpose: one row of the timeline; the only complex layout in the page
  - _Leverage: apps/web/components/ui (Chip, Button), apps/web/app/(dashboard)/_lib/timeline-labels.ts, packages/shared/src/index.ts_
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 23. Write `TimelineItem` tests in `apps/web/app/(dashboard)/_components/__tests__/timeline-item.test.tsx`
  - File: `apps/web/app/(dashboard)/_components/__tests__/timeline-item.test.tsx` (new)
  - Test: `next-up` renders the chip and the `start →` button with the supplied `href`
  - Test: `done` renders `✓`, the `done` chip, line-through on the title
  - Test: `queued` renders no chip and no button
  - Test: missing `topicHint` falls back to the type label in the subtitle (Req 3.5)
  - Test: aria-label contains the index, title, and status
  - Test: connecting line absent when `isLast: true`
  - Purpose: every status branch and the topicHint fallback
  - _Leverage: @testing-library/react, apps/web/app/(dashboard)/_components/timeline-item.tsx_
  - _Requirements: 3.1, 3.2, 3.5, 3.6_

- [x] 24. Create non-success state cards in `apps/web/app/(dashboard)/_components/state-cards.tsx`
  - File: `apps/web/app/(dashboard)/_components/state-cards.tsx` (new — single file exporting three small cards)
  - **Note:** the design originally listed `all-done-card.tsx`, `pool-not-ready-card.tsx`, and `timeline-error-card.tsx` as three separate files; consolidated here because each is < 30 lines and they're never reused outside the timeline. Functionally equivalent — the design's component contracts are preserved verbatim.
  - Export `AllDoneCard({ summary, href })` — heading `you're done for today.`, body `${itemCount} of ${itemCount} · ${durationMinutes} minutes`, secondary `Button` linking to `href` with text `start a fresh session →`
  - Export `PoolNotReadyCard({ language })` — body `your ${LANGUAGE_NAMES[language].toLowerCase()} pool isn't ready yet — check back tomorrow.`
  - Export `TimelineErrorCard({ error, onRetry })` — body the error message, a `retry` button calling `onRetry`
  - All three reuse `Card` and the design tokens; no shared layout beyond that
  - Purpose: keeps the timeline switch-logic tiny by isolating each non-success state
  - _Leverage: apps/web/components/ui (Card, Button), packages/shared/src/index.ts (LANGUAGE_NAMES)_
  - _Requirements: 4.1, 4.3, 4.4, 7.2_

- [x] 25. Write state-cards tests in `apps/web/app/(dashboard)/_components/__tests__/state-cards.test.tsx`
  - File: `apps/web/app/(dashboard)/_components/__tests__/state-cards.test.tsx` (new)
  - Test `AllDoneCard`: renders the summary string `5 of 5 · 18 minutes`, button href is `/drill?language=ES`, no streak/XP text
  - Test `PoolNotReadyCard`: renders the language name lowercased
  - Test `TimelineErrorCard`: clicking `retry` calls the supplied `onRetry`
  - Purpose: pin each card's copy + interaction
  - _Leverage: @testing-library/react, apps/web/app/(dashboard)/_components/state-cards.tsx_
  - _Requirements: 4.1, 4.3, 4.4_

- [x] 26. Create `TodayTimeline` orchestrator in `apps/web/app/(dashboard)/_components/today-timeline.tsx`
  - File: `apps/web/app/(dashboard)/_components/today-timeline.tsx` (new)
  - Props: `{ data: TodayPlanResponse | undefined; isLoading: boolean; error: Error | null; onRetry: () => void; language: LearningLanguage }`
  - Renders, in order: skeleton (5 rows of `h-[68px]` neutral blocks) when `isLoading`; `<TimelineErrorCard>` when `error`; `<PoolNotReadyCard>` when `data.code === 'INSUFFICIENT_POOL'`; `<AllDoneCard>` when every item is `done` AND `data.summary` is non-null; otherwise the timeline — items mapped to `<TimelineItem>` with the first non-`done` item flagged as `next-up`
  - Build the primary item's `href`: `/drill?language=${language}` (no `difficulty` param — the drill page uses its own default)
  - Includes a visually-hidden `<ol>` summary of the 5 items for screen readers (Req 3.6, NFR Usability)
  - Purpose: the only place the page-level switch logic lives
  - _Leverage: apps/web/app/(dashboard)/_components/{timeline-item,state-cards}.tsx_
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 4.1, 4.3, 7.1, 7.2, 7.4_

- [x] 27. Write `TodayTimeline` tests in `apps/web/app/(dashboard)/_components/__tests__/today-timeline.test.tsx`
  - File: `apps/web/app/(dashboard)/_components/__tests__/today-timeline.test.tsx` (new)
  - Test: `isLoading` → 5 skeleton rows
  - Test: `error` → renders `TimelineErrorCard`; `onRetry` called when retry clicked
  - Test: `code: 'INSUFFICIENT_POOL'` → renders `PoolNotReadyCard`
  - Test: all items done + summary present → renders `AllDoneCard`
  - Test: 5 queued items → first item is `next-up` (chip + button); others queued
  - Test: 2 done + 3 queued → 3rd item is `next-up`; first two have done chip
  - Test: visually-hidden ordered list contains 5 `<li>` summarising each item
  - Purpose: orchestrator branch coverage
  - _Leverage: @testing-library/react, apps/web/app/(dashboard)/_components/today-timeline.tsx, fixture builders_
  - _Requirements: 3.1, 3.2, 3.4, 4.1, 4.3, 7.1, 7.2_

- [x] 28. Create `SkillRow` component in `apps/web/app/(dashboard)/_components/skill-row.tsx`
  - File: `apps/web/app/(dashboard)/_components/skill-row.tsx` (new)
  - Props: `{ axis: RadarAxis }`
  - Renders: lowercased label, `${Math.round(currentMastery * 100)}%` in `t-mono` (in `accent` colour when `currentMastery < 0.5`, else `ink-soft`); `<Bar value={currentMastery * 100} color={currentMastery < 0.5 ? 'accent' : 'ink'} />`; delta column `${sign}${Math.abs(rounded)}` or `—`
  - Delta logic: `delta = Math.round((current - previous) * 100)`; `0` → `'—'` (em dash), positive → `'+N'`, negative → `'−N'` (true minus character)
  - Purpose: one row of the snapshot grid
  - _Leverage: apps/web/components/ui (Bar), packages/api-client/src/schemas/progress.ts (RadarAxis)_
  - _Requirements: 5.2, 5.3_

- [x] 29. Create `SkillSnapshotGrid` orchestrator + `EmptySnapshotCard` in `apps/web/app/(dashboard)/_components/skill-snapshot-grid.tsx`
  - File: `apps/web/app/(dashboard)/_components/skill-snapshot-grid.tsx` (new)
  - Export `SkillSnapshotGrid({ data, isLoading, error, onRetry, language })` and `EmptySnapshotCard({ language })`
  - `SkillSnapshotGrid`:
    - When `isLoading`: render section header (eyebrow + title + `see full progress →` ghost button) + 6 skeleton rows
    - When `error`: render the section header + an error card with `retry`
    - When `data.axes.every(a => a.evidenceCount === 0)`: render the section header + `EmptySnapshotCard`
    - Otherwise: section header + 2-column 6-row grid of `<SkillRow>`s sorted by `(currentMastery asc, key.localeCompare)` (Req 5.4)
  - Section header: eyebrow `your ${language.toLowerCase()} · weakest first`, `t-display-m` `skill snapshot`, top-right ghost-`Button` `see full progress →` linking to `/progress`
  - `EmptySnapshotCard`: `Card` with copy `practice a few exercises and your skill snapshot will appear here.` and a primary `Button` `start a session →` linking to `/drill?language=${language}`
  - Purpose: the snapshot section in one self-contained file
  - _Leverage: apps/web/app/(dashboard)/_components/skill-row.tsx, apps/web/components/ui (Card, Button), packages/api-client/src/schemas/progress.ts, packages/shared/src/index.ts (LANGUAGE_NAMES)_
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 7.2_

- [x] 30. Write `SkillRow` + `SkillSnapshotGrid` tests in `apps/web/app/(dashboard)/_components/__tests__/skill-snapshot.test.tsx`
  - File: `apps/web/app/(dashboard)/_components/__tests__/skill-snapshot.test.tsx` (new)
  - Test `SkillRow`: under-50% renders accent colour on label and bar; ≥ 50% renders default
  - Test `SkillRow`: delta `0` → `—`; `+4` → `+4`; `-2` → `−2` (assert via the actual minus char in the rendered text)
  - Test `SkillSnapshotGrid`: rows are sorted weakest-first with stable key tiebreak (use two axes with identical mastery and assert order)
  - Test `SkillSnapshotGrid`: `error` → error card with `retry` calling `onRetry`
  - Test `SkillSnapshotGrid`: all `evidenceCount === 0` → renders `EmptySnapshotCard` with the `start a session →` link to `/drill?language=ES`
  - Test: page-section contains no streak/XP/lesson text
  - Purpose: snapshot grid is the second-most-visible deliverable; pin every state
  - _Leverage: @testing-library/react, fixture builder for RadarAxis_
  - _Requirements: 5.2, 5.3, 5.4, 5.5, NFR-Usability_

- [x] 31. Create `ReadCollectCard` in `apps/web/app/(dashboard)/_components/read-collect-card.tsx`
  - File: `apps/web/app/(dashboard)/_components/read-collect-card.tsx` (new)
  - Static component (no props beyond the implicit `Link` dependency)
  - 44×44 `r-md` icon tile (book SVG inline, `accent-soft` background, `accent-2` foreground), title `reading something this week?` in `t-display-s`, `Chip` `new` (`accent` variant), subtitle `paste a paragraph — i'll mark words above your level and weave them into your next session.` in `t-small`, primary `Button` `open reader →` linking to `/read`
  - Layout matches the prototype reference at `design_handoff_language_drill/prototypes/web/hifi/dashboard.jsx` lines 117–136
  - Purpose: the only promotional element on the page; static and stable
  - _Leverage: apps/web/components/ui (Card, Chip, Button), next/link_
  - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [x] 32. Write `ReadCollectCard` tests in `apps/web/app/(dashboard)/_components/__tests__/read-collect-card.test.tsx`
  - File: `apps/web/app/(dashboard)/_components/__tests__/read-collect-card.test.tsx` (new)
  - Test: link target is `/read`
  - Test: contains the `new` chip and the prescribed copy
  - Test: contains no streak/XP text
  - Purpose: pin the static card
  - _Leverage: @testing-library/react_
  - _Requirements: 6.1, 6.2_

### Layer 6 — Page wire-up

- [x] 33. Rewrite `apps/web/app/(dashboard)/page.tsx` as the new dashboard
  - File: `apps/web/app/(dashboard)/page.tsx` (rewrite)
  - `'use client'`. Read `activeLanguage` from `useActiveLanguage`; build `fetchFn` via `useMemo(() => createAuthenticatedFetch(getToken), [getToken])`; read Clerk `useUser().firstName`
  - Fire `useTodayPlan({ fetchFn, language })` and `useProgressRadar({ fetchFn, language })` in parallel (TanStack Query handles parallelism naturally — both hooks called at top level)
  - Wire `<DashboardHeader>` with `axes={radar.data?.axes}`, `firstName={user?.firstName ?? null}`, `totalEstimatedMinutes={todayPlan.data?.totalEstimatedMinutes ?? null}`, `language={activeLanguage}`
  - Wire `<TodayTimeline>`, `<hr className="border-rule" />`, `<SkillSnapshotGrid>`, `<ReadCollectCard>` in that order
  - Container: `<div className="space-y-s-7">…</div>`
  - Purpose: the only page-level wiring; everything else is a leaf
  - _Leverage: @clerk/nextjs (useAuth, useUser), @language-drill/api-client (useTodayPlan, useProgressRadar, createAuthenticatedFetch), apps/web/components/shell (useActiveLanguage), apps/web/app/(dashboard)/_components/*_
  - _Requirements: 1.1, 1.2, 1.3, 9.2_

- [x] 34. Write page integration tests in `apps/web/app/(dashboard)/page.test.tsx`
  - File: `apps/web/app/(dashboard)/page.test.tsx` (new)
  - Mock `useActiveLanguage` to return `Language.ES`, `useAuth` and `useUser` from Clerk, `useTodayPlan` and `useProgressRadar` from the api-client
  - Test: happy path — both queries succeed → renders header, timeline (5 items), snapshot grid (6 rows), Read & Collect card
  - Test: timeline error + radar success → `TimelineErrorCard` rendered, snapshot grid still rendered with rows
  - Test: timeline success + radar error → timeline rendered, snapshot grid renders error card
  - Test: all-done plan → `AllDoneCard` rendered in place of the timeline
  - Test: insufficient pool → `PoolNotReadyCard` rendered in place of the timeline
  - Test: empty radar (every `evidenceCount === 0`) → `EmptySnapshotCard` rendered in place of the grid
  - Test: page contains NO streak / XP / lesson count text (regex against the full DOM)
  - Test: header total minutes reflects `todayPlan.data.totalEstimatedMinutes`
  - Test: switching the mocked `useActiveLanguage` value from `ES` to `DE` causes both query keys to change (assert via the queryClient cache or the spy on `fetchFn`) — covers Req 1.3 + Req 11.2 (language-keyed cache invalidation)
  - Purpose: prove every section's branch holds in composition
  - _Leverage: @testing-library/react, vitest, mock factories for useTodayPlan / useProgressRadar / useAuth / useUser_
  - _Requirements: 1.1, 1.3, 4.1, 4.3, 5.5, 7.2, 7.3, 11.2, NFR-Usability_

### Layer 7 — Pre-push gate

- [x] 35. Run pre-push checks from repo root
  - Command: `pnpm lint && pnpm typecheck && pnpm test`
  - Fix any failures before merging
  - Purpose: enforce the project's pre-push contract from `CLAUDE.md`
  - _Leverage: CLAUDE.md (Pre-Push Checks)_
  - _Requirements: All_
