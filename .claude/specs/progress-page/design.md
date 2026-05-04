# Design Document

## Overview

The Progress page replaces the placeholder at `apps/web/app/(dashboard)/progress/page.tsx` with a tabbed dashboard for the active learning language. It is a **read-only** view backed by two new GET endpoints that aggregate `user_exercise_history` into shapes the UI can render directly:

- **`GET /progress/radar`** — six skill-axis aggregates with current and 30-day-ago mastery values
- **`GET /progress/heatmap`** — topic × day attempt grid for the last 30 days, with per-topic mastery rollups

The page reuses Phase A design tokens (`globals.css`), Phase A UI primitives (`Card`, `Chip`, `Bar`, `Button`), Phase B's `ActiveLanguageProvider`, and the existing TanStack Query / Zod / `createAuthenticatedFetch` plumbing. No new database tables or migrations are introduced — all aggregations run as SQL queries over existing tables.

## Steering Document Alignment

### Technical Standards (tech.md)

- **Stack adherence**: Next.js App Router + TypeScript on the client, Hono + Drizzle on the Lambda, Zod for wire validation, TanStack Query for caching. No new tooling.
- **Serverless aggregation**: per `tech.md` §2 (Database) and §7 (AI Strategy), aggregation runs in SQL, not in Lambda memory. Each endpoint executes one Drizzle query against Neon and shapes the result.
- **Auth**: both endpoints sit behind the existing `authMiddleware` (Clerk JWT validated by API Gateway in production, dev-injected `userId` locally — see `infra/lambda/src/middleware/auth.ts`).
- **No new infra**: no S3, no Polly, no Claude calls, no SQS. The only dependency added is the `topicHint` extraction from the existing `exercises.content_json` JSONB.
- **Validation discipline**: query params validated with Zod, `language` constrained to `LearningLanguageEnum` (ES/DE/TR — matches `packages/api-client/src/schemas/preferences.ts`).

### Project Structure (structure.md)

The repo follows the layout in `CLAUDE.md` (no separate `structure.md`). New files land in their idiomatic homes:

| Concern | Location |
|---|---|
| DB types reused | `packages/db/src/schema/{progress,skills,exercises}.ts` (no changes) |
| API routes | `infra/lambda/src/routes/progress.ts` (new file) + register in `infra/lambda/src/index.ts` |
| Wire schemas | `packages/api-client/src/schemas/progress.ts` (new file) |
| Query hooks | `packages/api-client/src/hooks/useProgress.ts` (new file, exports two hooks) |
| Page | `apps/web/app/(dashboard)/progress/page.tsx` (rewrite of placeholder) |
| Page sub-components | `apps/web/app/(dashboard)/progress/_components/*.tsx` (co-located, route-scoped) |
| Mastery formula | `infra/lambda/src/lib/progress-aggregation.ts` (new file, pure functions) |
| Observation rules | `apps/web/app/(dashboard)/progress/_lib/observation-rules.ts` (deterministic, no AI) |

The `_components/` and `_lib/` folder convention matches Phase H (`apps/web/app/(dashboard)/drill/_components/`) — Next.js convention: a leading underscore opts the folder out of the router so these subfolders are **not** child routes of `/progress`.

`LearningLanguageEnum` is imported from `packages/api-client/src/schemas/preferences.ts` (existing) — both the new client schema file and Lambda route share its definition (Lambda has its own copy in `infra/lambda/src/routes/profiles.ts` per the existing convention to avoid an api-client → infra dependency; see the comment block in `profiles.ts`).

## Code Reuse Analysis

### Existing Components to Leverage

- **`Card`** (`apps/web/components/ui/card.tsx`) — observation, recommendation, summary cards.
- **`Chip`** (`apps/web/components/ui/chip.tsx`) — CEFR level chip in the header eyebrow.
- **`Bar`** (`apps/web/components/ui/bar.tsx`) — already used on the dashboard placeholder; reused for the per-axis mastery summary if needed for the empty-state side card.
- **`Button`** (`apps/web/components/ui/button.tsx`) — recommended-drill CTA.
- **`ActiveLanguageProvider` + `useActiveLanguage`** (`apps/web/components/shell/active-language-provider.tsx`) — single source of truth for the current language.
- **`useLanguageProfiles`** (`packages/api-client/src/hooks/useLanguageProfiles.ts`) — already cached in the dashboard layout; the progress page reads the proficiency level for the active language from this cache rather than refetching.
- **`createAuthenticatedFetch`** (`packages/api-client/src/fetchClient.ts`) — built once in `(dashboard)/layout.tsx`; the page receives it via the same pattern as `useLanguageProfiles`.
- **Design tokens in `globals.css`** — every colour and type utility used in the prototype is already defined: `--color-paper`, `--color-paper-2`, `--color-accent`, `--color-accent-soft`, `--color-hilite-soft`, `--color-rule`, `--color-ink-mute`, `.t-display-xl`, `.t-display-s`, `.t-micro`, `.t-mono`, `.t-body-l`.

### Integration Points

- **`user_exercise_history`** (`packages/db/src/schema/progress.ts`) — primary signal source. Index `(userId, evaluatedAt DESC)` already exists.
- **`exercises`** (`packages/db/src/schema/exercises.ts`) — joined for `type`, `difficulty`, `language`, and `content_json->>'topicHint'`.
- **`userLanguageProfiles`** — read-only via the existing hook for the eyebrow CEFR chip.
- **`ActiveLanguageProvider`** — page reads `activeLanguage` from context; no language picker on this page.
- **No new tables** — `exercise_tags` and `skill_topics` exist but the seed pool doesn't populate `exercise_tags` yet. v1 derives the heatmap topic from `exercises.content_json->>'topicHint'` (already populated for cloze / translation / vocab seeds and used by Phase H's theory panel via `apps/web/lib/theory-topic-map.ts`).

## Architecture

```mermaid
graph TD
    User[User clicks /progress] --> Layout[("(dashboard)/layout.tsx<br/>provides ActiveLanguageProvider")]
    Layout --> Page[ProgressPage<br/>app/(dashboard)/progress/page.tsx]
    Page --> Header[ProgressHeader]
    Page --> Tabs[ProgressTabs]
    Tabs --> Shape[ShapeTab]
    Tabs --> Heat[HeatmapTab]
    Tabs --> History[HistoryTab<br/>stub]

    Shape --> Radar[RadarChart SVG]
    Shape --> Side[Side cards]

    Page -.useProgressRadar.-> Radar
    Page -.useProgressHeatmap.-> Heat
    Heat --> Grid[HeatmapGrid]
    Heat --> Summary[Hot/Cold cards]

    Radar -.HTTP GET.-> RadarAPI["GET /progress/radar?language=ES<br/>(infra/lambda/src/routes/progress.ts)"]
    Heat  -.HTTP GET.-> HeatAPI["GET /progress/heatmap?language=ES"]

    RadarAPI --> Agg[progress-aggregation.ts<br/>radarAggregate()]
    HeatAPI  --> Agg2[progress-aggregation.ts<br/>heatmapAggregate()]
    Agg --> DB[(Neon: user_exercise_history<br/>JOIN exercises)]
    Agg2 --> DB
```

**Page lifecycle.** When `ProgressPage` mounts, it reads `activeLanguage` from context, builds the authenticated `fetchFn` (mirroring the dashboard layout), and fires both queries in parallel via TanStack Query. The Shape tab renders against the radar query; the Heatmap tab renders against the heatmap query (still prefetched on mount so tab switching is instant). The History tab is a static stub.

**Cache keys.** `['progressRadar', language]` and `['progressHeatmap', language]`. When the user switches language via the rail (which triggers `window.location.reload()` per the existing provider), both caches are naturally invalidated. `staleTime: 5 * 60 * 1000` (5 minutes) matches `useLanguageProfiles`.

## Components and Interfaces

### Component 1 — `ProgressPage` (page.tsx)

- **Purpose:** orchestrate header + tabs, gate on language presence, fan out queries.
- **Type:** `'use client'` — needs `useActiveLanguage`, `useAuth().getToken`, `useSearchParams`/`useRouter` for tab URL state.
- **Interfaces:** none exported (Next.js page).
- **Dependencies:** `useActiveLanguage`, `useLanguageProfiles`, `useProgressRadar`, `useProgressHeatmap`, `createAuthenticatedFetch`.
- **Reuses:** `Card`, design tokens.
- **Behaviour:** picks the URL `?tab` param (defaulting to `shape`); uses `router.replace` (not push) to keep the back button clean when a user toggles tabs.

### Component 2 — `ProgressHeader` (`_components/progress-header.tsx`)

- **Purpose:** render eyebrow, title, subtitle.
- **Props:** `{ language: LearningLanguage; proficiencyLevel: CefrLevel | null; weeksActive: number | null }`.
- **Reuses:** `LANGUAGE_NAMES` from `@language-drill/shared`, `t-micro`, `t-display-xl`, `t-body-l`.

### Component 3 — `ProgressTabs` (`_components/progress-tabs.tsx`)

- **Purpose:** WAI-ARIA tablist around three buttons; manages active tab + URL sync.
- **Props:** `{ active: 'shape' | 'heatmap' | 'history'; onChange: (id) => void; children: ReactNode }` — children is the rendered panel (page wires this).
- **Behaviour:** `role="tablist"`, each button `role="tab"` with `aria-selected`, `aria-controls`. Left/right arrow keys cycle; Enter/Space activate.

### Component 4 — `ShapeTab` (`_components/shape-tab.tsx`)

- **Purpose:** render the 6-axis radar plus three side cards.
- **Props:** `{ data: ProgressRadarResponse | undefined; isLoading: boolean; error: Error | null }`.
- **Children:** `RadarChart`, `ObservationCard`, `LegendCard`, `RecommendedDrillCard`, `EmptyStateCard`.

### Component 5 — `RadarChart` (`_components/radar-chart.tsx`)

- **Purpose:** pure-SVG radar with current and 30-day-ago polygons.
- **Props:** `{ axes: RadarAxis[] }`.
- **Implementation:** hand-rolled SVG (no charting library — the only computation is sin/cos for vertices, ~30 lines, matches the prototype). Adding `recharts`/`visx` would inflate the bundle for one chart.
- **Accessibility:** `role="img"`, `<title>` ("Skill radar for {language}"), `<desc>` and an `aria-label` of the form _"Skill radar for {language}; strongest: {strongestLabel} at {pct}%, weakest: {weakestLabel} at {pct}%."_ (matches R4.6). A visually-hidden `<ul>` with one `<li>` per axis (`{label}: {Math.round(currentMastery * 100)}% mastery`) supplies the per-axis numbers to screen-reader users.
- **Sizing:** fixed 440 × 440 `viewBox`; renders inside a flex-centered card; scales with the parent column width via `width="100%" height="auto"`.

### Component 6 — `HeatmapTab` (`_components/heatmap-tab.tsx`)

- **Purpose:** topic × day grid plus hot/cold summary cards.
- **Props:** `{ data: ProgressHeatmapResponse | undefined; isLoading: boolean; error: Error | null }`.
- **Children:** `HeatmapGrid`, `HotColdSummary`.
- **Empty states:** `topics.length < 3` → "build a topic history first" card.

### Component 7 — `HeatmapGrid` (`_components/heatmap-grid.tsx`)

- **Purpose:** CSS Grid of cells (no SVG, no library — matches the prototype's div approach).
- **Props:** `{ topics: HeatmapTopic[]; shadeThresholds: ShadeThresholds }`.
- **Cell rendering:** `<div title="{date}: {count} attempt(s)">` for the native tooltip; background colour decided by `pickShade(count, thresholds)`.

### Component 8 — `HistoryTab` (`_components/history-tab.tsx`)

- **Purpose:** static "coming soon" card. No data fetching, no props.

### Component 9 — `ProgressEmptyState` (`_components/progress-empty-state.tsx`)

- **Purpose:** shared empty card shown when the user has no history at all in the active language. Routes user to `/drill`.
- **Props:** `{ language: LearningLanguage }`.

### API hooks (`packages/api-client/src/hooks/useProgress.ts`)

```ts
export function useProgressRadar({
  fetchFn,
  language,
  enabled = true,
}: { fetchFn: AuthenticatedFetch; language: LearningLanguage; enabled?: boolean }): UseQueryResult<ProgressRadarResponse, Error>;

export function useProgressHeatmap({
  fetchFn,
  language,
  enabled = true,
}: { fetchFn: AuthenticatedFetch; language: LearningLanguage; enabled?: boolean }): UseQueryResult<ProgressHeatmapResponse, Error>;
```

Both follow the `useLanguageProfiles` template: `staleTime: 5 * 60 * 1000`, response parsed through Zod, query key includes the language so a switch invalidates correctly.

## Data Models

### Wire schema 1 — `ProgressRadarResponse`

```ts
const RadarAxisKey = z.enum([
  'listening',
  'reading',
  'speaking',
  'writing',
  'grammar',
  'vocabulary',
]);

const RadarAxisSchema = z.object({
  key: RadarAxisKey,
  label: z.string(),                    // human-readable, server-decided ('listening', 'reading', ...)
  currentMastery: z.number().min(0).max(1),
  previousMastery: z.number().min(0).max(1),  // 30-day-ago snapshot, falls back to currentMastery if no old data
  lastPracticedAt: z.string().datetime().nullable(),  // ISO; null if never practiced
  evidenceCount: z.number().int().min(0),     // total contributing rows in user_exercise_history
});

export const ProgressRadarResponseSchema = z.object({
  language: LearningLanguageEnum,
  axes: z.array(RadarAxisSchema).length(6),  // always 6, in fixed order
});
```

### Wire schema 2 — `ProgressHeatmapResponse`

```ts
const HeatmapTopicSchema = z.object({
  topicId: z.string(),                       // lowercased topicHint, e.g. 'subjunctive'
  name: z.string(),                          // display name, e.g. 'subjunctive'
  mastery: z.number().min(0).max(1),         // recency-weighted average over the last 90 days
  cells: z.array(z.number().int().min(0)).length(30),  // attempt counts per day, oldest at [0]
});

export const ProgressHeatmapResponseSchema = z.object({
  language: LearningLanguageEnum,
  days: z.literal(30),
  topics: z.array(HeatmapTopicSchema).max(8),
  shadeThresholds: z.object({
    paper2: z.number().int().min(1),         // count >= this → paper-2 shade
    accentSoft: z.number().int().min(1),     // count >= this → accent-soft shade
    accent: z.number().int().min(1),         // count >= this → accent shade
  }),
});
```

Default thresholds for v1: `{ paper2: 1, accentSoft: 2, accent: 4 }` — matches the prototype's bucketing.

## Aggregation logic

### Exercise type → axis mapping (v1)

Stored as a constant table in `infra/lambda/src/lib/progress-aggregation.ts`. **Each row contributes to exactly one axis.**

| `exercises.type` | Axis | Rationale |
|---|---|---|
| `cloze` | `grammar` | Cloze items in the seed pool target grammar points |
| `translation` | `writing` | User produces target-language text — production signal |
| `vocab_recall` | `vocabulary` | Direct vocabulary recall |
| `listening` | `listening` | Reserved (no seed exercises yet — axis will read 0) |
| `speaking` | `speaking` | Reserved (no seed exercises yet — axis will read 0) |
| `reading_mc` / `reading_*` | `reading` | Reserved (no seed exercises yet — axis will read 0) |

The `listening`, `reading`, `speaking` axes still appear in the response with `evidenceCount: 0` and `currentMastery: 0` — the empty radar shape itself is informative ("strong reader / non-existent speaker" reads correctly).

### Mastery formula (v1)

A pure function `aggregateAxisMastery(rows: { score: number; difficulty: CefrLevel; evaluatedAt: Date }[], now: Date): number`:

```
mastery = sum(score_i * w_i) / sum(w_i)
where w_i = difficultyWeight(difficulty_i) * exp(-daysAgo_i / 30)

difficultyWeight: A1=0.5, A2=0.7, B1=0.9, B2=1.1, C1=1.3, C2=1.5
daysAgo_i = (now - evaluatedAt_i) / 86_400_000
```

If `rows.length === 0`, return `0`. The result is clamped to `[0, 1]`.

`previousMastery` runs the same formula over rows where `evaluatedAt < now - 30 days`, drawn from **the same 90-day rolling window** as `currentMastery` (so it represents "your shape between 90 and 30 days ago"). If that subset is empty, `previousMastery = currentMastery` (so the dashed polygon overlaps the solid one — communicates "no change" rather than "collapsed to zero").

### Heatmap topic extraction

Topics are derived from `exercises.content_json->>'topicHint'`. The SQL extracts it with Drizzle's `sql<string>` template and groups on the lowercased value. Rows where `topicHint` is NULL or empty are excluded — they don't contribute to any heatmap row but still count toward radar aggregates.

### Heatmap mastery (per topic)

Same formula as the radar, but the row set is "all attempts with this `topicHint` in the last 90 days for the active language". Stored on `HeatmapTopic.mastery`.

### Cell counts

For day `i` (0 = 29 days ago, 29 = today), `cells[i] = COUNT(*)` of attempts on that UTC day. Computed as `date_trunc('day', evaluatedAt AT TIME ZONE 'UTC')` matched against the day window.

### Shade picker (client)

```ts
function pickShade(count: number, t: ShadeThresholds): 'transparent' | 'paper-2' | 'accent-soft' | 'accent' {
  if (count >= t.accent) return 'accent';
  if (count >= t.accentSoft) return 'accent-soft';
  if (count >= t.paper2) return 'paper-2';
  return 'transparent';
}
```

### Observation rules table (deterministic, no Claude)

`apps/web/app/(dashboard)/progress/_lib/observation-rules.ts` exports:

```ts
export function computeObservation(axes: RadarAxis[]): {
  observation: string;
  highlightedAxes: { strongest: RadarAxisKey; weakest: RadarAxisKey };
} | null;
```

Logic for v1:

1. Strongest axis = max `currentMastery`; weakest axis = min `currentMastery` (with `evidenceCount > 0`).
2. Categorise each axis: `input = { listening, reading }`, `output = { speaking, writing }`, `core = { grammar, vocabulary }`.
3. If `avg(input) - avg(output) >= 0.15` and both have at least one axis with `evidenceCount > 0` → `"you're strong at input ({inputAxes}) and weaker at production ({outputAxes}). classic intermediate plateau shape."`
4. Else if `avg(output) - avg(input) >= 0.15` → `"unusual shape — your production is ahead of your comprehension. {weakest} is your sharpest gap."`
5. Else if `weakestValue < 0.4` → `"{weakest} is dragging the shape — that's where the next jump is."`
6. Otherwise → `null` (the observation card is hidden).

This is the "small rules table" the requirements call out. Tests pin each branch.

### Recommended drill card

Renders **only** when there is at least one axis with `currentMastery < 0.5` AND `evidenceCount > 0` (matches R5.4). Picks the qualifying axis with the lowest `currentMastery`, formatted as:

> **{weakest axis name}** — _weakest skill, last practised {N} days ago._  [start drill →]

The button links to `/drill?focus={weakestKey}`. The `/drill` page may ignore the param for now; that's acceptable. If no axis qualifies (every practised axis is ≥ 0.5), the card is hidden.

## SQL queries (sketches)

Drizzle queries; final code in `progress-aggregation.ts`. Both run in a single round trip.

### Radar query

```ts
// Pull all relevant rows for the active language in one shot,
// aggregate per-axis in JS (cheap — typical volume is <500 rows over 90 days).
const rows = await db
  .select({
    score: userExerciseHistory.score,
    difficulty: exercises.difficulty,
    type: exercises.type,
    evaluatedAt: userExerciseHistory.evaluatedAt,
  })
  .from(userExerciseHistory)
  .innerJoin(exercises, eq(userExerciseHistory.exerciseId, exercises.id))
  .where(
    and(
      eq(userExerciseHistory.userId, userId),
      eq(exercises.language, language),
      gte(userExerciseHistory.evaluatedAt, ninetyDaysAgo),
      isNotNull(userExerciseHistory.score),
    ),
  );
```

90 days is the rolling window we score; the 30-day-ago snapshot reuses the same rows with a date filter.

### Heatmap query

Two queries (still one round trip, parallelised with `Promise.all` if needed; v1 ships them sequentially since both are sub-100ms locally):

1. **Top topics over 90 days** (`SELECT topicHint, COUNT(*) FROM ... GROUP BY topicHint ORDER BY count DESC LIMIT 8`).
2. **Per-topic per-day cells over 30 days** for the topics from step 1.

In Drizzle:

```ts
const topicHintSql = sql<string>`lower(${exercises.contentJson}->>'topicHint')`;

// Query 1
const topTopics = await db
  .select({
    topic: topicHintSql,
    attempts: count(),
    avgScore: avg(userExerciseHistory.score),
  })
  .from(userExerciseHistory)
  .innerJoin(exercises, eq(userExerciseHistory.exerciseId, exercises.id))
  .where(/* userId, language, last 90 days, topicHint IS NOT NULL */)
  .groupBy(topicHintSql)
  .orderBy(desc(count()))
  .limit(8);

// Query 2 — per-day cells for those topics over the last 30 days
// Returns rows of { topic, day, count } that the JS layer pivots into the cells array.
```

Mastery per topic is computed in JS from a third pass (reusing rows already loaded for query 1, fetching `score + evaluatedAt + difficulty` if not already in the projection). For v1 simplicity we run a third lightweight `select` — still a single endpoint round trip from the client's POV.

## Page wiring

```tsx
// apps/web/app/(dashboard)/progress/page.tsx
'use client';

export default function ProgressPage() {
  const { activeLanguage } = useActiveLanguage();
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);

  const radar = useProgressRadar({ fetchFn, language: activeLanguage });
  const heatmap = useProgressHeatmap({ fetchFn, language: activeLanguage });

  const profiles = useLanguageProfiles({ fetchFn });
  const profile = profiles.data?.profiles.find((p) => p.language === activeLanguage);
  const proficiencyLevel = profile?.proficiencyLevel ?? null;
  const weeksActive = computeWeeksActive(radar.data);

  const { tab, setTab } = useTabUrlState(); // syncs ?tab= and useState

  return (
    <div>
      <ProgressHeader
        language={activeLanguage}
        proficiencyLevel={proficiencyLevel}
        weeksActive={weeksActive}
      />
      <ProgressTabs active={tab} onChange={setTab}>
        {tab === 'shape'   && <ShapeTab   data={radar.data}   isLoading={radar.isLoading}   error={radar.error} />}
        {tab === 'heatmap' && <HeatmapTab data={heatmap.data} isLoading={heatmap.isLoading} error={heatmap.error} />}
        {tab === 'history' && <HistoryTab />}
      </ProgressTabs>
    </div>
  );
}
```

`useTabUrlState` is a tiny custom hook — uses `useSearchParams` + `router.replace(\`?tab=\${id}\`)`.

## Error Handling

### Error Scenarios

1. **Radar query fails (5xx, network, JWT expired)**
   - **Handling:** the Shape tab's per-tab error boundary renders `<ErrorCard message={error.message} onRetry={radar.refetch} />`. The Heatmap tab continues to work because its hook is independent.
   - **User Impact:** sees an error card on Shape only; can switch to Heatmap or click retry.

2. **Heatmap query fails**
   - **Handling:** symmetric — only the Heatmap tab shows the error card.
   - **User Impact:** Shape tab still works.

3. **User has zero exercise history in the active language**
   - **Handling:** both endpoints return `200` with empty data (radar axes all zero with `evidenceCount: 0`, heatmap `topics: []`). The page detects `radar.data.axes.every(a => a.evidenceCount === 0)` and renders `ProgressEmptyState` for the whole page (with all tabs hidden).
   - **User Impact:** sees a "do your first drill to build your shape" card with a CTA to `/drill`.

4. **User has 1–4 exercises** (per-language threshold from R5.5)
   - **Handling:** Shape tab renders the radar but hides observation + recommended-drill cards, replaces them with the "not enough data yet" card. Heatmap tab follows its own `topics.length < 3` rule.

5. **Exercise has missing `topicHint`**
   - **Handling:** that row contributes to the radar (via its `type` → axis mapping) but **not** to the heatmap. If all rows for the user lack `topicHint`, the Heatmap tab shows "build a topic history first".

6. **Invalid query param (e.g. `language=EN`)**
   - **Handling:** server returns `400 VALIDATION_ERROR`. Zod parse on the client throws → TanStack Query surfaces as `error`. The error card renders.
   - **User Impact:** shouldn't happen in practice (the active language is constrained at the provider level), but the failure mode is contained per-tab.

7. **Schema mismatch (server returns malformed JSON)**
   - **Handling:** Zod `.parse()` throws → identical to scenario 1. Logged client-side via the existing query error logger (if any).

## Testing Strategy

### Unit Testing

- **`progress-aggregation.ts`** — Vitest tests for:
  - `aggregateAxisMastery` empty input → 0
  - Difficulty weighting: same score on B2 outweighs same score on A1
  - Recency weighting: a 60-day-old correct answer is weighted < a same-day correct answer
  - `axisForExerciseType` covers all 3 implemented types and falls through deterministically for unknown types
  - 30-day-ago snapshot returns `currentMastery` when no qualifying rows
  - Cell pivot logic produces a 30-element array, oldest day at index 0
- **`observation-rules.ts`** — one test per branch (input-strong, output-strong, weakest-low, balanced/null).
- **Component tests** (Vitest + Testing Library):
  - `RadarChart` renders 6 axis labels and the screen-reader list with the right values
  - `HeatmapGrid` colours a cell `accent` when count crosses the threshold
  - `ProgressTabs` cycles tabs on left/right arrow and updates `aria-selected`
  - `ProgressHeader` omits the level segment when `proficiencyLevel === null`
- **Schema tests** (`progress.test.ts` in `packages/api-client/src/schemas/`):
  - Round-trips a valid response payload
  - Rejects mastery > 1 and `axes.length !== 6`
  - Rejects `language: 'EN'`
- **Hook tests** (`useProgress.test.ts`):
  - Mocks `fetchFn` and asserts query key, URL, and Zod parsing path.

### Integration Testing

- **Lambda routes** (`progress.test.ts` in `infra/lambda/src/routes/`):
  - Seeds a user + exercises + history into the test DB; asserts the radar response shape end-to-end.
  - Asserts language scoping: a user with both ES and DE history sees only ES rows when `?language=ES`.
  - Asserts auth: missing JWT → 401 (in production mode), dev-injected user → 200.
  - Asserts the 90-day window: an attempt 100 days old is excluded.
  - Asserts heatmap topic ordering: most-attempted topic first, max 8.
  - Asserts the `language=EN` rejection.
- **Page-level test** (`progress/page.test.tsx`):
  - Renders the page with mocked hooks; switches tabs via click and arrow keys; asserts URL updates via `?tab=`.
  - Renders the empty state when `evidenceCount` is zero across all axes.

### End-to-End Testing

Out of scope for this spec — the project doesn't currently run Playwright/Cypress in CI. The integration + unit tests above provide adequate coverage.
