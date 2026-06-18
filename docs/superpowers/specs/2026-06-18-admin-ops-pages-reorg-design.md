# Admin ops-pages reorganization — design

**Date:** 2026-06-18
**Status:** Approved (design); pending implementation plan

## Problem

Three admin pages — `/admin/generation` (nav "Pool"), `/admin/theory`, and
`/admin/capacity` — are confusing and inconsistent:

- `/admin/generation` mixes two unrelated concerns: **cost/ops** (generation
  spend this week/month, job counts) and **content health** (per-cell pool
  coverage). It is also completely unstyled (raw `<h2>`/`<table>`).
- `/admin/theory` shows the same "content health" idea but only as a
  language×CEFR aggregate matrix — no per-grammar-point detail, no deeplinks.
  Too aggregated to be actionable.
- `/admin/capacity` ("Usage & capacity") is about **end-user AI consumption**
  (kill switch, 24h events, top consumers) — a different axis from pool
  replenishment — and lacks visual hierarchy.

The underlying confusion: pages are grouped by the accident of how they were
built, not by concern. The right split is **content fill-health** vs.
**cost/consumption ops**.

## Goals

- One **Pool** page covering exercise + theory fill-health as `Exercises` /
  `Theory` tabs (mirroring `/admin/content`).
- Pool page is filterable and styled consistently with the newer admin pages.
- Theory becomes per-grammar-point and actionable (deeplinks), not just a matrix.
- A coherent **Usage & cost** page that owns all AI cost + consumption + brakes.
- Clear conceptual separation; Curriculum (the authoring catalog) stays separate.

## Non-goals

- Theory refill/revalidate from the UI (no theory generate/revalidate HTTP
  endpoint exists; theory generation is scheduler-only). Out of scope this pass.
- Merging Curriculum into Pool. They serve different modes (authoring vs. ops)
  and already cross-link.
- A UI toggle for the kill switch / global cap (still deploy-time env, as today).

## Backend inventory (verified)

EXISTS:
- `GET /admin/pool-status` — per-`(language, level, type, grammarPoint)` rows
  (`PoolStatusItemSchema`); accepts `language?`, `level?`.
- `GET /admin/generation-stats` — `{ costThisWeekUsd, costThisMonthUsd,
  jobsThisWeek{succeeded,failed,running,queued}, approvalRates[] }`
  (`GenerationStatsSchema`).
- `GET /admin/pool-cell`, `POST /admin/generate`, `POST /admin/revalidate`
  (exercises only) + hooks `usePoolCell` / `useGenerateCell` / `useRevalidateCell`.
- `GET /admin/theory/coverage` — 12 fixed `(language, level)` aggregate rows
  (`TheoryCoverageResponseSchema`).
- `GET /admin/content/theory` — theory content listing; filters `language?`,
  `level?`, `grammarPoint?`, `q?`, `limit?`, `offset?` (`useContentTheory`).

MISSING (drives the one new endpoint below):
- Per-grammar-point theory status. Theory DB grain is
  `(language, grammarPointKey)` with `cefrLevel` — one approved row per grammar
  point (`packages/db/src/schema/theory.ts`).
- Theory generate / revalidate HTTP endpoints (intentionally out of scope).

## Design

### 1. Nav & routes

- Rename `/admin/generation` → **`/admin/pool`**; nav label stays **"Pool"**.
  Add a redirect `/admin/generation` → `/admin/pool`.
- Remove the standalone `/admin/theory` page; fold into the Pool page as a tab.
  Add a redirect `/admin/theory` → `/admin/pool?tab=theory`.
- `/admin/capacity` keeps its route; nav label **"Capacity" → "Usage & cost"**.
- Resulting `ADMIN_NAV` order: Moderation · User flags · Content · **Pool** ·
  Invites · Audit · **Usage & cost** · Curriculum. (Theory entry removed.)

### 2. Pool page — shared shell + Exercises tab

- Convert from a server component to a **client** page (pattern: `/admin/content`).
  Title "Pool"; `Exercises | Theory` tablist; `?tab=` deep-linkable; tab state
  resets filters/offset as in Content.
- **Filters** reuse `components/admin/filter-select.tsx` (`FilterSelect`) and
  `GrammarPointCombobox`: language, level, type, grammar point. `pool-status`
  takes `language`/`level` server-side; type + grammar point filter client-side.
  Add a "clear filters" affordance consistent with Content/Moderation.
- **Coverage table**: the existing `PoolCoverageTable` + `PoolCellDetail`
  (per-cell drill-down: diversity-vs-floors, rejection reasons, refill,
  revalidate, content deeplink, Langfuse link). Apply the newer table styling
  (`text-[13px]`, sentence-case headers, coverage row tints retained). Behavior
  unchanged; this is a styling + filtering pass.
- **"Generation quality (30d)"** section below coverage = today's approval-rates
  table (`approvalRates` from `generation-stats`): approved / flagged / rejected /
  dedup / rate %. Cost + job counts are NOT shown here — they move to Usage & cost.
- `generation-stats` stays a single endpoint; Pool reads only `approvalRates`,
  Usage & cost reads only `cost*` + `jobsThisWeek`. No endpoint split needed.

### 3. Pool page — Theory tab (one new endpoint)

- New **`GET /admin/theory/pool-status`** returning per-`(language, level,
  grammarPoint)` rows:
  `{ language, level, grammarPointKey, name, hasApproved, flaggedCount,
  lastGeneratedAt }`. Built by joining `theory_topics` to the curriculum grammar
  points so **missing** grammar points appear (not just ones that have a row).
  Accepts `language?`, `level?`. New `PoolStatusTheoryItemSchema` +
  `useTheoryPoolStatus` hook in `packages/api-client`.
- **Top roll-up**: keep the language×CEFR summary matrix (from
  `/admin/theory/coverage`) as the at-a-glance header.
- **Per-point list**: filter by language, level, grammar point. Each row shows a
  badge — **✓ approved** / **⚠ N flagged** / **✗ missing** — and a deeplink to
  `/admin/content?tab=theory&language=…&level=…&grammarPoint=…`.
- No refill/revalidate buttons (see non-goals).

### 4. Usage & cost page (rebuilt `/admin/capacity`)

Three stacked, clearly-labeled blocks (top → bottom):

1. **Cost & generation** (moved from the generation page): a stat row —
   `This week $ · This month $ · Jobs: ✓ succeeded / ✗ failed / running /
   queued`. Reads `generation-stats` (`cost*`, `jobsThisWeek`).
2. **Brakes**: kill switch + global cap, presented as a labeled block (still
   read-only / deploy-time, as today).
3. **Consumption (24h)**: events-by-type table + top-consumers table (today's
   capacity data), restyled with real table headers and hierarchy instead of the
   current floating columns.

Page title "Usage & cost". Reuses `useCapacity` + `generation-stats`.

### 5. Workstreams (separate PRs)

- **PR-A — Pool shell + Exercises tab**: route rename + redirect, client
  conversion, tabs, filters, table styling, "Generation quality" section. No
  backend.
- **PR-B — Theory tab**: new `/admin/theory/pool-status` endpoint + schema +
  hook; Theory tab UI (summary matrix + per-point list + deeplinks). Backend + UI.
- **PR-C — Usage & cost**: move cost/jobs blocks off Pool, rebuild capacity page
  with the three-block hierarchy, nav label rename. No backend.

PRs are independent and can land in any order, except PR-A introduces the Pool
shell that PR-B's Theory tab plugs into, so A precedes B.

## Testing

- **Lambda** (`@language-drill/lambda`): unit test for `/admin/theory/pool-status`
  — correct grain, **missing grammar points included**, `flaggedCount` and
  `hasApproved` derived correctly, language/level filtering.
- **Web** (`@language-drill/web`):
  - Pool Exercises tab: filter wiring (FilterSelect + combobox), coverage rows
    render, drill-down opens, deeplink hrefs correct.
  - Pool Theory tab: badge states (approved / flagged / missing), deeplink hrefs,
    summary matrix renders, filter wiring.
  - Usage & cost: three blocks render with their data; cost/jobs present, brakes,
    consumption tables.
  - Nav: "Pool" + "Usage & cost" labels; redirects from old routes.
- Pre-push gate per CLAUDE.md: `pnpm lint`, `pnpm typecheck`,
  `pnpm turbo run test --concurrency=1`.

## Risks / notes

- Route rename: ensure redirects so admin bookmarks and the existing
  `PoolCellDetail` → `/admin/content` deeplinks (unchanged target) keep working.
- Converting Pool to a client component changes data fetching from server
  `apiFetch` to client hooks; add `usePoolStatus` + `useGenerationStats` hooks
  (currently direct `apiFetch` in the server page).
- `field-sizing: content` on `FilterSelect` is Chrome 123+ (admin-only,
  acceptable; already shipped on Content/Moderation).
