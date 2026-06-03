# Design Document

## Overview

The Dashboard replaces the placeholder at `apps/web/app/(dashboard)/page.tsx` with the editorial v1 landing page. It is a **read-mostly** view backed by:

- **One new GET endpoint** — `GET /sessions/today` — that returns either a hydrated view of today's existing session for the active language, or a freshly composed 5-item plan drawn from the existing exercise pool. Composition is a deterministic v1 heuristic (no Claude call, no new persistence).
- **An existing GET endpoint** — `GET /progress/radar` — reused unchanged for the skill snapshot grid (`useProgressRadar` already returns the six axes the snapshot needs).

The page reuses Phase A design tokens (`globals.css`), Phase A UI primitives (`Card`, `Chip`, `Bar`, `Button`), Phase B's `ActiveLanguageProvider` + `AppShell`, and the existing TanStack Query / Zod / `createAuthenticatedFetch` plumbing. **No new database tables, migrations, or third-party libraries are introduced.** The page mounts inside the dashboard layout that already runs `useLanguageProfiles`, so the proficiency level required by the today-plan endpoint is already cached client-side.

## Steering Document Alignment

### Technical Standards (tech.md)

- **Stack adherence** (`tech.md` §2): Next.js App Router + TypeScript on the client, Hono + Drizzle on the Lambda, Zod for wire validation, TanStack Query for caching. No new tooling.
- **Serverless aggregation** (`tech.md` §2 Database, §7 AI Strategy): the today-plan handler runs at most two SQL round trips against Neon (one to look up today's session for `(userId, language)`, one to draw the pool sample). The plan composition heuristic runs in Lambda memory but only over the small `(language, difficulty)` slice already loaded.
- **No Claude calls** (`tech.md` §7): the dashboard renders nothing AI-generated. The framing paragraph is generated client-side from the radar data via a deterministic rules table (mirrors the progress-page observation pattern).
- **Auth** (`tech.md` §12): the new endpoint sits behind the existing `authMiddleware` (Clerk JWT validated by API Gateway in production, dev-injected `userId` locally — see `infra/lambda/src/middleware/auth.ts`). The endpoint is mounted on the existing `/sessions/*` Hono router so it picks up the same middleware automatically.
- **Validation discipline** (`tech.md` §12): the `language` query param is validated against the existing `LearningLanguageEnum` (ES/DE/TR — matches `packages/api-client/src/schemas/preferences.ts`); EN is rejected with `400`.
- **No streaks / XP / lesson-count** (`product.md` §2.2, `CLAUDE.md`): hard rule honoured — the prototype's "🔥 12-day streak" card from `design_handoff_language_drill/prototypes/web/hifi/dashboard.jsx` lines 107–113 is **not** ported.

### Project Structure (structure.md)

The repo follows the layout in `CLAUDE.md` (no separate `structure.md`). New files land in their idiomatic homes, mirroring the Phase I (progress-page) layout:

| Concern | Location |
|---|---|
| DB types reused | `packages/db/src/schema/{sessions,users,exercises}.ts` (no changes) |
| API route | `infra/lambda/src/routes/sessions.ts` (extended — adds the `GET /sessions/today` handler) |
| Plan composition logic | `infra/lambda/src/lib/today-plan.ts` (new file, pure functions + `ESTIMATED_MINUTES_BY_TYPE` constant) |
| Wire schemas | `packages/api-client/src/schemas/today.ts` (new file) |
| Query hook | `packages/api-client/src/hooks/useTodayPlan.ts` (new file) |
| Page | `apps/web/app/(dashboard)/page.tsx` (rewrite of placeholder) |
| Page sub-components | `apps/web/app/(dashboard)/_components/*.tsx` (co-located, route-scoped) |
| Framing rules | `apps/web/app/(dashboard)/_lib/framing-rules.ts` (deterministic, no AI) |
| Greeting helpers | `apps/web/app/(dashboard)/_lib/greeting.ts` (pure functions for time-of-day, weekday, ISO week) |
| Timeline label table | `apps/web/app/(dashboard)/_lib/timeline-labels.ts` |

The `_components/` and `_lib/` underscore-prefix convention matches Phases F (`drill/_components/`), I (`progress/_components/`, `progress/_lib/`), and H — Next.js convention: a leading underscore opts the folder out of the router so these subfolders are **not** child routes of `/`. Index-route co-location places these under `app/(dashboard)/_components/` (parallel to `page.tsx`), not under a `dashboard/` subdirectory — `(dashboard)` is itself a route group, not a path segment.

`LearningLanguageEnum` is imported from `packages/api-client/src/schemas/preferences.ts` for the wire schema; the Lambda has its own copy in `infra/lambda/src/routes/profiles.ts` (existing convention to avoid an api-client → infra dependency).

## Code Reuse Analysis

### Existing Components to Leverage

- **`Card`** (`apps/web/components/ui/card.tsx`) — the all-done card, the empty-skill-snapshot card, the no-pool card, the Read & Collect card, and per-section error cards.
- **`Chip`** (`apps/web/components/ui/chip.tsx`) — `done` (`ok` variant) and `next up` (`accent` variant) status chips on timeline items, the `new` chip on the Read & Collect card.
- **`Bar`** (`apps/web/components/ui/bar.tsx`) — already supports `color: 'ink' | 'accent'`, the exact two states the skill snapshot needs (under-50% rows render `accent`, others `ink`). No changes needed.
- **`Button`** (`apps/web/components/ui/button.tsx`) — the timeline `start →` primary button, the `see full progress →` ghost button, the `open reader →` primary button, retry buttons.
- **`ActiveLanguageProvider` + `useActiveLanguage`** (`apps/web/components/shell/active-language-provider.tsx`) — single source of truth for the current language.
- **`useLanguageProfiles`** (`packages/api-client/src/hooks/useLanguageProfiles.ts`) — already cached in the dashboard layout; the dashboard reads the proficiency level for the active language from this cache rather than refetching.
- **`useProgressRadar`** (`packages/api-client/src/hooks/useProgress.ts`) — reused for the skill snapshot grid. The hook's `staleTime` of 5 min and language-keyed cache fit the dashboard's needs verbatim.
- **`createAuthenticatedFetch`** (`packages/api-client/src/fetchClient.ts`) — built once via `useMemo` in the page, mirroring the progress-page pattern (the dashboard layout doesn't pre-build it because each page builds its own to avoid prop drilling).
- **Design tokens in `globals.css`** — every colour and type utility used in the prototype is already defined: `--color-paper`, `--color-paper-2`, `--color-accent`, `--color-accent-soft`, `--color-rule`, `--color-ink-mute`, `.t-display-xl`, `.t-display-l`, `.t-display-s`, `.t-display-m`, `.t-micro`, `.t-mono`, `.t-body-l`, `.hilite`. No new tokens are added.
- **`@clerk/nextjs` `useUser`** — for the first-name greeting. Already initialised in `apps/web/app/providers.tsx`.

### Integration Points

- **`practice_sessions`** (`packages/db/src/schema/sessions.ts`) — primary signal for the "today already done" path. `(userId, startedAt)` index already exists for fast lookups by today's UTC day.
- **`user_exercise_history`** (`packages/db/src/schema/progress.ts`) — joined to `practice_sessions.id` via `sessionId` (FK already exists with `ON DELETE SET NULL`) to compute which items in today's session are `done`.
- **`exercises`** (`packages/db/src/schema/exercises.ts`) — sampled for fresh plan composition. Uses the existing `(language, difficulty)` filter and `content_json->>'topicHint'` extraction already used by `/progress/heatmap`.
- **`user_language_profiles`** — read-only via the existing `useLanguageProfiles` hook for the proficiency-level → difficulty mapping. The Lambda also reads it directly for the same purpose (it can't trust a client-supplied difficulty for the today-plan composition).
- **`POST /sessions`** — the timeline's `start →` button does not invoke this directly. It navigates to `/drill?language=<active>` and the existing drill page calls `POST /sessions` with the same `(language, difficulty)` parameters. The today-plan endpoint is therefore **read-only**: it never inserts a `practice_sessions` row. (This is the key invariant that keeps it cheap and idempotent.)
- **`ActiveLanguageProvider`** — page reads `activeLanguage` from context; no language picker on this page.

## Architecture

```mermaid
graph TD
    User[User loads /] --> Layout[("(dashboard)/layout.tsx<br/>ActiveLanguageProvider + AppShell")]
    Layout --> Page[DashboardPage<br/>app/(dashboard)/page.tsx]
    Page --> Header[DashboardHeader]
    Page --> Timeline[TodayTimeline]
    Page --> Snapshot[SkillSnapshotGrid]
    Page --> Read[ReadCollectCard<br/>static]

    Header --> GreetingBlock[GreetingBlock<br/>client-only, post-mount]

    Page -.useTodayPlan.-> Timeline
    Page -.useProgressRadar.-> Snapshot
    Page -.useProgressRadar.-> Header

    Timeline -.HTTP GET.-> TodayAPI["GET /sessions/today?language=ES<br/>(infra/lambda/src/routes/sessions.ts)"]
    Snapshot -.HTTP GET.-> RadarAPI["GET /progress/radar?language=ES<br/>(unchanged)"]
    Header   -.HTTP GET.-> RadarAPI

    TodayAPI --> Compose[today-plan.ts<br/>composeFreshPlan() / hydrateFromSession()]
    Compose --> DB[(Neon: practice_sessions JOIN<br/>user_exercise_history JOIN exercises)]
```

**Page lifecycle.** When `DashboardPage` mounts:

1. It reads `activeLanguage` from `useActiveLanguage()`.
2. It builds the authenticated `fetchFn` via `useMemo(() => createAuthenticatedFetch(getToken), [getToken])`.
3. It fires two queries in parallel via TanStack Query: `useTodayPlan({ fetchFn, language })` and `useProgressRadar({ fetchFn, language })`.
4. It reads the user's `firstName` from Clerk's `useUser()` for the greeting.
5. It renders the static parts of the page (header skeleton + Read & Collect card) immediately, and progressively fills the timeline and skill snapshot as their queries resolve.

**Cache keys.**
- `['todayPlan', language]` — `staleTime: 60 * 1000` (1 minute). Short enough that completing a session and returning to `/` shows fresh `done` chips; long enough to avoid refetching on every tab focus.
- `['progressRadar', language]` — `staleTime: 5 * 60 * 1000` (5 minutes, unchanged). The radar shape moves slowly; refetching at the dashboard's cadence would be wasteful.

When the user switches language via the rail, the existing `ActiveLanguageProvider` triggers a `window.location.reload()` and both caches are naturally invalidated. The keying-by-language ensures forward compatibility with a future in-memory switch.

**Time-of-day greeting.** To avoid a hydration mismatch (server clock ≠ browser clock at midnight boundaries), the greeting and weekday strings render as `null` server-side and are filled in by a client-only effect after mount. This matches the established Next.js pattern.

## Components and Interfaces

### Component 1 — `DashboardPage` (`page.tsx`)

- **Purpose:** orchestrate the four sections (header, timeline, skill snapshot, Read & Collect), gate on language presence, fan out the two queries.
- **Type:** `'use client'` — needs `useActiveLanguage`, `useAuth().getToken`, `useUser`, `useState` for mount-only flag.
- **Interfaces:** none exported (Next.js page).
- **Dependencies:** `useActiveLanguage`, `useLanguageProfiles`, `useTodayPlan`, `useProgressRadar`, `createAuthenticatedFetch`, `useUser`.
- **Reuses:** `Card`, design tokens.
- **Behaviour:** because the layout already redirects users without profiles to `/onboarding`, the page can assume `data.profiles.length > 0`. No defensive redirect here.

### Component 2 — `DashboardHeader` (`_components/dashboard-header.tsx`)

- **Purpose:** render the eyebrow line, greeting heading, "here's today's plan." subline, framing paragraph, and `~XX min planned` total.
- **Props:** `{ language: LearningLanguage; firstName: string | null; weakestAxis: RadarAxis | null; totalEstimatedMinutes: number | null }`.
- **Reuses:** `LANGUAGE_NAMES` from `@language-drill/shared`, `t-micro`, `t-display-xl`, `t-display-l`, `t-body-l`, `t-mono`.
- **Children:** `GreetingBlock` (the time-dependent strings, post-mount).
- **Framing copy:** generated by `framing-rules.ts` — see "Framing rules table" below.

### Component 3 — `GreetingBlock` (`_components/greeting-block.tsx`)

- **Purpose:** render the time-dependent eyebrow (`tuesday · week 6 · spanish`) and the greeting (`good morning, juno.`) without an SSR mismatch.
- **Behaviour:** `useEffect`-gated — renders an `aria-hidden` empty placeholder of the same height server-side, fills in the strings after mount.
- **Props:** `{ language: LearningLanguage; firstName: string | null }`.
- **Reuses:** `LANGUAGE_NAMES`, helpers from `_lib/greeting.ts`.

### Component 4 — `TodayTimeline` (`_components/today-timeline.tsx`)

- **Purpose:** render the 5-item vertical rail or, in the all-done / insufficient-pool / error states, the appropriate single card replacement.
- **Props:** `{ data: TodayPlanResponse | undefined; isLoading: boolean; error: Error | null; onRetry: () => void; language: LearningLanguage }`.
- **Children:** `TimelineItem` (one per plan item) drawn against a shared rail (the connecting line + circles is rendered inline per row, matching the prototype's flex layout). The all-done state renders an `AllDoneCard`; the insufficient-pool state renders a `PoolNotReadyCard`; the error state renders an inline `ErrorCard` with `retry`.
- **Loading state:** 5 skeleton rows of the same height (`h-[68px]`) to avoid CLS.

### Component 5 — `TimelineItem` (`_components/timeline-item.tsx`)

- **Purpose:** render a single row of the timeline — circle, body, status chip, time, optional primary button.
- **Props:** `{ index: number; type: ExerciseType; topicHint: string | null; itemCount: number; estimatedMinutes: number; status: 'done' | 'queued' | 'next-up'; isLast: boolean; href: string | null }`.
- **Notes:**
  - The `status` value is derived client-side: the API returns `done | queued`; the timeline component flags the first non-`done` item as `next-up` for rendering. Keeping `next-up` out of the wire response simplifies the API contract — the position is purely a render concern.
  - Title is composed as `${prefix} · ${typeLabel}` (e.g. `core · subjunctive cloze`); subtitle is `${topicHint ?? typeFallback} · ${itemCount} items`. The prefix (`warm-up`, `core`, `production`, `cool-down`) is chosen by `index` from `_lib/timeline-labels.ts`.

### Component 6 — `AllDoneCard` (`_components/all-done-card.tsx`)

- **Purpose:** render the end-of-rail "you're done for today" card when every item is `done`.
- **Props:** `{ summary: { itemCount: number; correctCount: number; durationMinutes: number }; href: string }`.
- **Reuses:** `Card`, `Button`.

### Component 7 — `PoolNotReadyCard` and `TimelineErrorCard` (`_components/pool-not-ready-card.tsx`, `timeline-error-card.tsx`)

- **Purpose:** dedicated cards for the two non-success states. Separate components keep the `TodayTimeline` switch logic readable and the test surface granular.

### Component 8 — `SkillSnapshotGrid` (`_components/skill-snapshot-grid.tsx`)

- **Purpose:** render the 6-row weakest-first grid of skill axes plus the "see full progress →" ghost button. Handles three states: data, empty (zero evidence across all axes), error.
- **Props:** `{ data: ProgressRadarResponse | undefined; isLoading: boolean; error: Error | null; onRetry: () => void; language: LearningLanguage }`.
- **Sorting:** `axes.slice().sort((a, b) => a.currentMastery - b.currentMastery || a.key.localeCompare(b.key))` — stable across renders thanks to the `key` tie-breaker.
- **Loading state:** 6 skeleton rows.
- **Empty state:** `EmptySnapshotCard` with `start a session →` linking to `/drill?language=<active>`.

### Component 9 — `SkillRow` (`_components/skill-row.tsx`)

- **Purpose:** one row of the snapshot grid — label, percentage, `Bar`, delta.
- **Props:** `{ axis: RadarAxis }`.
- **Behaviour:** `currentMastery < 0.5` toggles the `accent` colour on both the percentage and the bar. The delta column shows `+N`, `−N`, or `—` (em dash) for `Math.round((current − previous) × 100)` with `0` rendered as `—`.

### Component 10 — `ReadCollectCard` (`_components/read-collect-card.tsx`)

- **Purpose:** static horizontal card linking to `/read`. No data fetching, no props.
- **Reuses:** `Card`, `Chip` (`accent` variant for the `new` chip), `Button`. Inline SVG for the book icon (no new icon dependency).

### API hook — `useTodayPlan` (`packages/api-client/src/hooks/useTodayPlan.ts`)

```ts
export type UseTodayPlanParams = {
  fetchFn: AuthenticatedFetch;
  language: LearningLanguage;
  enabled?: boolean;
};

export function useTodayPlan({
  fetchFn,
  language,
  enabled = true,
}: UseTodayPlanParams): UseQueryResult<TodayPlanResponse, Error>;
```

Mirrors the `useProgressRadar` template: `staleTime: 60 * 1000`, response parsed through Zod, query key includes the language so a switch invalidates correctly. Exported from `packages/api-client/src/index.ts` alongside the existing hooks.

## Data Models

### Wire schema — `TodayPlanResponse`

```ts
import { z } from 'zod';
import { ExerciseType, CefrLevel } from '@language-drill/shared';
import { LearningLanguageEnum } from './preferences';

export const TodayPlanItemStatusEnum = z.enum(['done', 'queued']);

export const TodayPlanItemSchema = z.object({
  index: z.number().int().min(1).max(5),       // 1-based plan position
  type: z.nativeEnum(ExerciseType),            // cloze | translation | vocab_recall
  topicHint: z.string().nullable(),            // from exercises.content_json->>'topicHint'
  difficulty: z.nativeEnum(CefrLevel),
  itemCount: z.number().int().min(1),          // size of the underlying drill (e.g. cloze=4 items)
  estimatedMinutes: z.number().int().min(1),
  status: TodayPlanItemStatusEnum,
});

export const TodayPlanSummarySchema = z.object({
  itemCount: z.number().int().min(0),
  correctCount: z.number().int().min(0),
  durationMinutes: z.number().int().min(0),
});

export const TodayPlanResponseSchema = z.object({
  language: LearningLanguageEnum,
  generatedAt: z.string().datetime(),
  totalEstimatedMinutes: z.number().int().min(0),
  items: z.array(TodayPlanItemSchema).max(5),
  // Present only when every item is done — drives the AllDoneCard.
  summary: TodayPlanSummarySchema.nullable(),
  // Present only when items.length < 5 because the pool is empty/insufficient.
  code: z.literal('INSUFFICIENT_POOL').nullable(),
});

export type TodayPlanResponse = z.infer<typeof TodayPlanResponseSchema>;
```

The discriminated nullables (`summary`, `code`) keep the wire shape flat and easy to validate. The client decides the render branch:

| Server returns | Client renders |
|---|---|
| `items.length === 5` and every `status === 'queued'` | Standard timeline, item 1 highlighted as `next-up` |
| `items.length === 5`, mixed statuses, at least one `queued` | Standard timeline, first `queued` item highlighted |
| `items.length === 5`, every `status === 'done'`, `summary != null` | `AllDoneCard` |
| `items.length === 0`, `code === 'INSUFFICIENT_POOL'` | `PoolNotReadyCard` |

### Internal type — `EstimatedMinutesByType`

```ts
// infra/lambda/src/lib/today-plan.ts
export const ESTIMATED_MINUTES_BY_TYPE: Record<ExerciseType, number> = {
  [ExerciseType.CLOZE]: 2,
  [ExerciseType.TRANSLATION]: 4,
  [ExerciseType.VOCAB_RECALL]: 2,
};
```

These are integer minutes (matching the wire schema). The Lambda computes `totalEstimatedMinutes` as the rounded sum across `items`. The authoritative source is the server response.

### Internal type — `PlanCompositionSlot`

```ts
type PlanCompositionSlot = {
  index: number;             // 1..5
  prefix: 'warm-up' | 'core' | 'production' | 'cool-down';  // for the title
  type: ExerciseType;
};

// v1 fixed mix — placeholder until adaptive logic lands.
export const V1_PLAN_SHAPE: readonly PlanCompositionSlot[] = [
  { index: 1, prefix: 'warm-up',    type: ExerciseType.CLOZE },
  { index: 2, prefix: 'core',       type: ExerciseType.CLOZE },
  { index: 3, prefix: 'production', type: ExerciseType.TRANSLATION },
  { index: 4, prefix: 'core',       type: ExerciseType.VOCAB_RECALL },
  { index: 5, prefix: 'cool-down',  type: ExerciseType.CLOZE },
];
```

This satisfies the requirement that "the exact type-mix is documented in design.md" (Req 8 §3) — five items composed `cloze, cloze, translation, vocab_recall, cloze`. The reasoning: warm-up + cool-down on the simplest production type (cloze) bookend a denser core block; one production rep (translation) and one vocabulary rep land in the middle. Adaptive weighting that prefers the user's weakest axis is explicitly deferred — the `Plan composition heuristic` section below documents the swap point for that future change.

The `prefix` is a label-only concern; it doesn't affect the SQL or pool draw. The wire schema doesn't carry it because the client can derive it deterministically from `index` (mirrored in `apps/web/app/(dashboard)/_lib/timeline-labels.ts`). Keeping the prefix off the wire avoids version-skew if we change the labelling later.

## Plan composition heuristic (v1)

The today-plan endpoint implements two paths.

### Path A — hydrate from today's session

If a row in `practice_sessions` exists for `(userId, language)` with `started_at >= start-of-UTC-day(now)`:

1. Pull that row (most recent if multiple — should not happen, but defensive).
2. Pull the matching `exercises` rows by `id IN (session.exerciseIds)` joined left to `user_exercise_history` on `(exerciseId, sessionId)`. A non-null history row for an exercise → `status: 'done'`; a null history row → `status: 'queued'`.
3. Build the response:
   - `items[i].status` matches the per-exercise hydration above.
   - `summary` is set iff every item is `done` AND `practice_sessions.completed_at IS NOT NULL`; computed as `{ itemCount: exerciseCount, correctCount: practice_sessions.correct_count, durationMinutes: round((completed_at - started_at) / 60_000) }`. If the session has all items attempted but no `completed_at` (transient state during finalisation), `summary` stays `null` and the timeline still highlights the last `done` item — the `POST /sessions/:id/complete` call from the drill page will resolve this on the next refetch.
   - `totalEstimatedMinutes` is the sum of `ESTIMATED_MINUTES_BY_TYPE[item.type]` over the session's items.
   - **Note on the two minute fields:** `summary.durationMinutes` is wall-clock time the user actually spent (used by `AllDoneCard`); `totalEstimatedMinutes` is the planned-time estimate (used by the header's `~XX min planned`). They are intentionally independent — the header keeps showing the plan estimate even after completion so the user sees a stable framing of "what today's session was about".
4. Return `200`. Two SQL round trips total (sessions lookup + items+history join) — **the budgeted "two SQL round trips" in NFR Performance**.

### Path B — compose a fresh plan

If no today-session exists for `(userId, language)`:

1. Look up the user's proficiency level via `userLanguageProfiles` for the active language. Fallback: `B1`. **This lookup is folded into Query 1 below as a `LEFT JOIN` so it doesn't count as an additional round trip.**
2. Draw 5 exercises from the pool, one per slot in `V1_PLAN_SHAPE`, in a single SQL query using `UNION ALL` of five `LIMIT 1` selects (each constrained to that slot's `type`). See the SQL sketch below.
3. If any slot fails to draw (the pool has fewer than 1 exercise of that type at the chosen difficulty), return `200` with `items: []` and `code: 'INSUFFICIENT_POOL'`. Two SQL round trips total (today-session lookup + pool sample).
4. Otherwise, build the response items in slot order with `status: 'queued'` and `summary: null`.

The same draw is **not** persisted — the dashboard preview is read-only. When the user clicks `start →` the drill page invokes `POST /sessions`, which redraws (also random) and creates the persistent row. v1 accepts that the items previewed and the items actually drilled may differ; later phases can persist the preview if needed.

### Adaptive swap point (deferred)

`composeFreshPlan(userId, language, level, radarSnapshot?)` is the function that owns slot → exercise mapping. The signature accepts an optional `radarSnapshot` in v1 but ignores it — it's the integration point for the future adaptive heuristic that weights the type mix by the user's weakest axis. v1 does not call `/progress/radar` server-side; the radar is fetched client-side for the framing paragraph and skill snapshot only.

## Framing rules table (deterministic, no Claude)

`apps/web/app/(dashboard)/_lib/framing-rules.ts` exports:

```ts
export type FramingResult = { paragraph: string; isGeneric?: true };

export function computeFraming(axes: RadarAxis[] | undefined): FramingResult;

// Also exported from the same module — the page wiring section imports it.
// Returns null when no axis qualifies (every axis evidenceCount === 0).
export function pickWeakestAxis(axes: RadarAxis[] | undefined): RadarAxis | null;
```

Logic for v1:

1. If `axes` is undefined (radar query in flight) or every axis has `evidenceCount === 0` → return `{ paragraph: 'a balanced session — production first, then a vocabulary rep.', isGeneric: true }` (Req 2 §4 generic line).
2. Pick the weakest axis with `evidenceCount >= 1`. If none qualifies (only listening/speaking have evidence which is impossible in v1, but defensive) → also return the generic line.
3. If `weakest.currentMastery < 0.5` → return `{ paragraph: \`your ${weakest.label} is the weakest right now. today's plan leans into production, not recognition — a few reps where you have to type, not pick.\` }`.
4. Else if `weakest.currentMastery < 0.7` → return `{ paragraph: \`your ${weakest.label} is the soft spot. we'll squeeze in one extra rep there today.\` }`.
5. Else (every practised axis is ≥ 0.7) → return `{ paragraph: 'a maintenance session — your shape is in good order, today is just to keep it that way.' }`.

The exact strings are pinned here so they're testable as data. No Claude call. Tests cover each branch and the edge case where the weakest axis is `speaking` or `listening` (which currently have `evidenceCount: 0` for all users — those axes never qualify in v1).

## Greeting helpers

`apps/web/app/(dashboard)/_lib/greeting.ts`:

```ts
export function timeOfDayGreeting(now: Date): 'good morning' | 'good afternoon' | 'good evening' {
  const h = now.getHours();
  if (h >= 4 && h < 12) return 'good morning';
  if (h >= 12 && h < 18) return 'good afternoon';
  return 'good evening';
}

export function lowercaseWeekday(now: Date): string {
  return now.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
}

export function isoWeekNumber(now: Date): number {
  // Standard ISO 8601 week-of-year. Inlined to avoid the date-fns dep.
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}
```

All three are pure functions; tests pin each branch and the year-boundary edge cases for `isoWeekNumber` (Dec 29 / Jan 1 / Jan 4 cases).

## Page wiring

```tsx
// apps/web/app/(dashboard)/page.tsx
'use client';

export default function DashboardPage() {
  const { activeLanguage } = useActiveLanguage();
  const { getToken } = useAuth();
  const { user } = useUser();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);

  const todayPlan = useTodayPlan({ fetchFn, language: activeLanguage });
  const radar = useProgressRadar({ fetchFn, language: activeLanguage });

  const weakest = useMemo(() => pickWeakestAxis(radar.data?.axes), [radar.data]);
  const totalMinutes = todayPlan.data?.totalEstimatedMinutes ?? null;
  const firstName = user?.firstName ?? null;

  return (
    <div className="space-y-s-7">
      <DashboardHeader
        language={activeLanguage}
        firstName={firstName}
        weakestAxis={weakest}
        totalEstimatedMinutes={totalMinutes}
      />
      <TodayTimeline
        data={todayPlan.data}
        isLoading={todayPlan.isLoading}
        error={todayPlan.error}
        onRetry={todayPlan.refetch}
        language={activeLanguage}
      />
      <hr className="border-rule" />
      <SkillSnapshotGrid
        data={radar.data}
        isLoading={radar.isLoading}
        error={radar.error}
        onRetry={radar.refetch}
        language={activeLanguage}
      />
      <ReadCollectCard />
    </div>
  );
}
```

The page is short (~60 lines) — all rendering complexity lives in the leaf components. Nothing in this file is conditional on data presence: the leaves handle their own loading / empty / error branches.

## SQL queries (sketches)

All Drizzle queries; final code lives in `infra/lambda/src/lib/today-plan.ts`.

### Query 1 — today's session lookup

```ts
const dayStart = startOfUtcDay(new Date());

const todayRows = await db
  .select({
    sessionId: practiceSessions.id,
    exerciseIds: practiceSessions.exerciseIds,
    exerciseCount: practiceSessions.exerciseCount,
    correctCount: practiceSessions.correctCount,
    startedAt: practiceSessions.startedAt,
    completedAt: practiceSessions.completedAt,
    proficiencyLevel: userLanguageProfiles.proficiencyLevel,
  })
  .from(practiceSessions)
  .leftJoin(
    userLanguageProfiles,
    and(
      eq(userLanguageProfiles.userId, practiceSessions.userId),
      eq(userLanguageProfiles.language, language),
    ),
  )
  .where(
    and(
      eq(practiceSessions.userId, userId),
      eq(practiceSessions.language, language),
      gte(practiceSessions.startedAt, dayStart),
    ),
  )
  .orderBy(desc(practiceSessions.startedAt))
  .limit(1);
```

Uses the existing `(userId, startedAt)` index. The `LEFT JOIN` to `userLanguageProfiles` is free (single row by unique `(userId, language)` index) and folds the proficiency lookup into this round trip — so when there's no today-session, we still return with the proficiency level needed for Path B's draw query.

If `todayRows.length === 0`, also issue a separate proficiency-level fetch (since the LEFT JOIN above was anchored on `practiceSessions`, which doesn't exist in that case). Implementation note: dispatch the proficiency fetch in parallel with Query 1 via `Promise.all` so the two queries share a single round-trip latency budget — **the NFR Performance claim of "≤ 2 SQL round trips" counts wall-clock RTTs, and parallel queries collapse to one**. The pure-function signature in `today-plan.ts` accepts the level as an argument so the route can pick whichever flavour Drizzle makes easiest in implementation.

### Query 2 (Path A) — hydrate items + history

If `todayRows[0]` exists, fetch the items via a single batched query that joins `exercises` and left-joins `user_exercise_history` on `sessionId`:

```ts
const items = await db
  .select({
    exerciseId: exercises.id,
    type: exercises.type,
    topicHint: sql<string | null>`${exercises.contentJson}->>'topicHint'`,
    difficulty: exercises.difficulty,
    historyId: userExerciseHistory.id, // null = not yet attempted
  })
  .from(exercises)
  .leftJoin(
    userExerciseHistory,
    and(
      eq(userExerciseHistory.exerciseId, exercises.id),
      eq(userExerciseHistory.sessionId, todayRows[0].sessionId),
    ),
  )
  .where(inArray(exercises.id, todayRows[0].exerciseIds));
```

The `inArray` clause is bounded by `practiceSessions.exerciseCount`, capped at 20 per the existing schema. Items are then re-ordered in JS to match `exerciseIds` order (which the row preserves).

### Query 2 (Path B) — pool sample

For a fresh plan, draw 5 exercises one per type using `UNION ALL` to keep the round trip count at 1:

```ts
const draws = await db.execute(sql`
  (SELECT id, type, content_json->>'topicHint' AS topic_hint, difficulty FROM exercises
    WHERE language = ${language} AND difficulty = ${difficulty} AND type = 'cloze'
    ORDER BY random() LIMIT 1)
  UNION ALL
  (SELECT id, type, content_json->>'topicHint' AS topic_hint, difficulty FROM exercises
    WHERE language = ${language} AND difficulty = ${difficulty} AND type = 'cloze'
    ORDER BY random() LIMIT 1)
  UNION ALL
  (SELECT id, type, content_json->>'topicHint' AS topic_hint, difficulty FROM exercises
    WHERE language = ${language} AND difficulty = ${difficulty} AND type = 'translation'
    ORDER BY random() LIMIT 1)
  UNION ALL
  (SELECT id, type, content_json->>'topicHint' AS topic_hint, difficulty FROM exercises
    WHERE language = ${language} AND difficulty = ${difficulty} AND type = 'vocab_recall'
    ORDER BY random() LIMIT 1)
  UNION ALL
  (SELECT id, type, content_json->>'topicHint' AS topic_hint, difficulty FROM exercises
    WHERE language = ${language} AND difficulty = ${difficulty} AND type = 'cloze'
    ORDER BY random() LIMIT 1)
`);
```

If `draws.rows.length < 5`, the slot couldn't be filled — return `INSUFFICIENT_POOL`. Mapping draws to slots is straightforward because the UNION-ALL preserves order.

**Topic diversity** is best-effort in v1: the three cloze slots (1, 2, 5) may collide on `topicHint`. Real diversity (filtering with `WHERE topic_hint <> $previous_topic_hint`) is deferred — it adds query complexity for a low-value improvement at v1 pool sizes.

## Error Handling

### Error Scenarios

1. **`useTodayPlan` query fails (5xx, network, JWT expired)**
   - **Handling:** the `TodayTimeline` renders `<TimelineErrorCard message={error.message} onRetry={todayPlan.refetch} />` (per-section error boundary). Header, skill snapshot, and Read & Collect remain interactive.
   - **User Impact:** sees an error card on the timeline only; can click `retry` or scroll past to other sections.

2. **`useProgressRadar` query fails**
   - **Handling:** the `SkillSnapshotGrid` renders an `ErrorCard` with `retry`. The header's framing paragraph falls back to the generic line (Req 2 §4) since `weakestAxis` is `null`. Timeline and Read & Collect unaffected.
   - **User Impact:** weakest-first grid replaced by the error card; the rest of the dashboard works.

3. **Both queries fail**
   - **Handling:** two stacked error cards (timeline first, snapshot second) — no redirect, no sign-out. The header still renders (generic framing line). The Read & Collect card still renders. The user can always click it or wait and retry.
   - **User Impact:** clearly degraded but never broken.

4. **Pool is empty for `(language, difficulty)` (`code: 'INSUFFICIENT_POOL'`)**
   - **Handling:** `TodayTimeline` renders `PoolNotReadyCard` with the language name. The skill snapshot and Read & Collect render normally (the skill snapshot will likely be in its empty state too, which is acceptable).
   - **User Impact:** explicit message that the pool isn't seeded for this language; no broken UI.

5. **All-done state (every item `status: 'done'`, `summary != null`)**
   - **Handling:** `TodayTimeline` renders `AllDoneCard` with the session summary and a `start a fresh session →` button. Skill snapshot and Read & Collect render normally.
   - **User Impact:** the user sees the session they just finished celebrated, with a clear opt-in to do another.

6. **Hydration mismatch on greeting/eyebrow**
   - **Handling:** `GreetingBlock` returns `null` server-side and fills in via `useEffect`. The header's other strings (the subline `here's today's plan.`, the framing paragraph, the minute total) render server-side as normal — they are not time-dependent.
   - **User Impact:** the heading flashes from blank to filled within the first frame after mount.

7. **`useUser()` returns no `firstName`**
   - **Handling:** the heading omits the name — `good morning.` / `good afternoon.` / `good evening.`. No trailing space before the period (the comma + name segment is conditionally rendered).
   - **User Impact:** trivial; the page still feels personalised by the time-of-day phrase.

8. **Active language has no profile (transient during a switch)**
   - **Handling:** `useLanguageProfiles` is already in flight from the layout; if `profile === undefined`, the header renders skeleton placeholders for the eyebrow's level segment and the framing paragraph. The other sections render unchanged because their data is keyed by `language` directly, not by `proficiencyLevel`.
   - **User Impact:** brief skeleton flash during a language switch reload — same as every other page.

## Testing Strategy

### Unit Testing

**Aggregation / pure functions**

- `infra/lambda/src/lib/today-plan.ts`:
  - `composeFreshPlan` — pinned-data tests for: full pool draws all 5, pool short on translation returns `INSUFFICIENT_POOL`, slot ordering matches `V1_PLAN_SHAPE`, draw randomness mocked via a seeded RNG.
  - `hydrateFromSession` — pinned-data tests for: every item attempted + `completedAt` set → `summary` populated; partial completion → `summary: null`; item lookup preserves `exerciseIds` order; missing exercise row drops the item gracefully.
  - `ESTIMATED_MINUTES_BY_TYPE` — typecheck only; the constant is the single source of truth.

- `apps/web/app/(dashboard)/_lib/framing-rules.ts`:
  - one test per branch (axes undefined, all `evidenceCount === 0`, weakest < 0.5, weakest in [0.5, 0.7), all ≥ 0.7); also covers the case where `weakest` is `speaking`/`listening` (`evidenceCount: 0` filter).

- `apps/web/app/(dashboard)/_lib/greeting.ts`:
  - branch tests for `timeOfDayGreeting` at `03:59`, `04:00`, `11:59`, `12:00`, `17:59`, `18:00`, `23:59`.
  - `isoWeekNumber` boundary tests for Dec 29 / Jan 1 / Jan 4 cases that flip year.

**Components (RTL)**

- `TimelineItem` — renders the `next-up` chip + button for `next-up`, the `done` chip + strike-through for `done`, no chip for `queued`. Accessible label includes the position and status.
- `SkillRow` — `currentMastery < 0.5` flips both label and bar to `accent`; `delta === 0` renders `—`; `delta > 0` renders `+N`; `delta < 0` renders `−N`.
- `AllDoneCard` — renders the summary correctly; `start a fresh session →` href is `/drill?language=<lang>` exactly.
- `ReadCollectCard` — link target is `/read`; the `new` chip is rendered.
- `GreetingBlock` — renders nothing server-side (test via `renderToString`), renders the greeting after a `useEffect` flush.
- `DashboardHeader` — framing paragraph follows the rule branches; total minute string includes the `~` prefix and `min planned` suffix.

**Page (RTL)**

- `DashboardPage` — happy path renders all four sections with mocked TanStack Query data; per-section error states render their error cards independently; all-done state renders `AllDoneCard`; insufficient-pool state renders `PoolNotReadyCard`; empty-radar state renders `EmptySnapshotCard`.

### Integration Testing

**Lambda route — `infra/lambda/src/routes/sessions.test.ts`**

Add a `describe('GET /sessions/today', …)` block alongside the existing tests. Mock the Drizzle query layer the same way the existing block does. Cover:

- 401 without JWT (handled by `authMiddleware` — assert it's mounted on the route).
- 400 for missing/invalid `language` query param; 400 for `language=EN`.
- Path A: today-session exists → returns hydrated items, correct `status` per item, `summary` populated when all done AND `completedAt` set.
- Path B: no today-session → returns 5 fresh items in `V1_PLAN_SHAPE` order.
- Pool short → returns `items: []` with `code: 'INSUFFICIENT_POOL'`.
- 500 path — DB throws during the today-session lookup → bubble to error handler (Hono's default is `500`; assert that the route doesn't catch and rethrow).

### End-to-End Testing

Out of scope for v1 — the project doesn't yet run Playwright or Cypress. The unit + integration coverage above is sufficient for the design's risk surface. A future Phase G (debrief) is the natural place to introduce a session-start-to-debrief E2E walkthrough, at which point the dashboard becomes the entry point and gets E2E coverage transitively.
