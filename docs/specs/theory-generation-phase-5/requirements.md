# Requirements Document — theory-generation-phase-5

## Introduction

Phase 5 closes the theory pipeline: it wires the DB-stored `theory_topics` rows produced by Phases 1–4 into the user-facing Theory Panel, and adds an admin coverage tile so the operator can see DE/TR rollout at a glance. Today (post-Phase 4 merge) the panel still only resolves three hand-authored ES TSX files; every Claude-generated row sitting in `theory_topics` is invisible to learners. Phase 5 closes that gap with three additive pieces and zero changes to the panel's visual design:

1. **Two read-only backend routes** (`GET /theory/:lang`, `GET /theory/:lang/:topicId`) behind the existing JWT authorizer at `infra/lambda/src/routes/theory.ts`, returning approved-only rows from `theory_topics`.
2. **A TanStack Query hook pair** (`useTheoryTopic`, `useTheoryTopics`) in `packages/api-client/src/hooks/` that short-circuits on a static TSX hit and falls through to the DB otherwise.
3. **A registry-fallback refactor** of `apps/web/content/theory/index.ts` plus a small change to `theory-panel.tsx` / `theory-trigger.tsx` / `theory-toc.tsx` / `theory-empty.tsx` to consume the async hook instead of the sync `getTheoryTopic` / `listTheoryTopics` they call today.
4. **An admin coverage page** at `/admin/theory` with a backing route `GET /admin/theory/coverage` that mirrors `/admin/generation`'s shape but counts 0-or-1 cells (one approved row per `(language, grammarPointKey)` is the ceiling) and joins curriculum size against `theory_topics`.

Phase 5 ships only after the pre-push gate is green (`pnpm lint && pnpm typecheck && pnpm test`) and a manual smoke confirms two round-trips on the dev branch: (a) seed a row via `pnpm generate:theory --lang es --grammar-point <key>`, open the panel for that topic in the web app, see the generated content render; (b) open `/admin/theory`, see the cell flip from `0/N` to `1/N`.

**The hand-authored TSX path is the override forever.** The three ES TSX files (`subjunctive`, `preterite-imperfect`, `conditional`) keep precedence over DB rows for the same `topicId` — they ship the editorial polish that the generator can't yet match and they double as the validator's calibration corpus (resolved decision #11 in `docs/theory-generation-plan.md`). The hook checks the static registry first and only queries the API if there's no static hit.

**Intentionally deferred:**
- **Cache-Control via Upstash Redis.** The plan names a 5-minute TTL with `redis.del(...)` invalidation from the review CLI. Upstash secrets are already injected into the API Lambda (`infra/lib/constructs/lambda.ts:41-47`) but no route consumes them yet. Phase 5 ships **without** Upstash because: (a) the `theory_topics_panel_idx` partial index makes the query cheap (single index scan, < 5 ms), (b) introducing Upstash requires also patching the Phase 3 review CLI to invalidate on edit, which broadens scope, (c) Next.js fetch caching + browser HTTP cache + the TanStack Query in-tab cache cover the same hot-path workload at zero infra cost. The Upstash cache layer is a follow-up if the live latency dashboard ever shows the route as a hot spot.
- **`POST /admin/theory/regenerate`.** The admin tile is read-only in Phase 5 — operators trigger regeneration via the CLI (`pnpm generate:theory`) or wait for the weekly scheduler. Adding an admin-triggered SQS dispatch would re-open the auth surface and double the route count for marginal value while DE/TR are still empty.
- **Cache-revalidation on review CLI approve/edit.** Because Phase 5 ships without Upstash, the review CLI also stays unchanged. Approving a flagged row makes it visible to learners on the next panel open (no TTL to wait out).
- **Moving the three ES TSX files into the DB.** Resolved decision #11 — they stay as TSX. Phase 5's lookup order preserves this.
- **DE / TR generation runs.** Phase 5 ships the *plumbing*; the actual content generation against Claude is a separate operator task tracked in `docs/theory-generation-plan.md` §7 step 5 ("generate ES first, then DE + TR if approval >85%").

## Alignment with Product Vision

`product.md` positions the app for the **intermediate plateau** — learners at B1/C1 who need accurate, complete reference material when they hit a wall mid-drill. The Theory Panel is the in-product surface for that material; today it answers only three Spanish topics because every other curriculum entry has no hand-authored TSX file behind it. Phase 5 is the moment generated theory becomes visible. Without it, the Phases 1–4 spend (~$17 round-1 cost projected in `docs/theory-generation-plan.md` §5) yields rows that never reach a learner's screen.

`tech.md` §7 (Content & AI Strategy) commits to **pre-generated content served from the DB**; Phase 5 finishes that promise for theory. §8 lists the Theory Panel as part of the rendering layer, and the panel registry's fallthrough to DB-stored content is named in `web-implementation-plan.md` §H as the v2 evolution — Phase 5 *is* that v2.

`docs/theory-generation-plan.md` §4 names Phase 5 as the gate between "generated rows exist" (Phase 4) and "generated rows ship to learners". Without Phase 5 the entire theory pipeline is operator-only. With it, opening the panel for any approved cell in any of ES/DE/TR works.

## Requirements

### Requirement 1 — Backend route `GET /theory/:lang/:topicId`

**User Story:** As the web client (and later the mobile client) I want to fetch one rendered theory topic by language and panel-facing slug, so that the Theory Panel can render approved DB-stored content without bundling it into the Next.js build.

#### Acceptance Criteria

1. WHEN the route is mounted via `app.route('/', theory)` in `infra/lambda/src/index.ts` THEN it SHALL live at `infra/lambda/src/routes/theory.ts` and re-use the existing `authMiddleware` (`theory.use('/theory/*', authMiddleware)`) so every request carries a verified Clerk JWT — same pattern as `routes/exercises.ts:44`.
2. WHEN the `:lang` path parameter is not one of `'ES' | 'DE' | 'TR'` THEN the handler SHALL return `{ error: 'Invalid language', code: 'VALIDATION_ERROR' }` with HTTP 400. EN is rejected at the boundary (theory is L2-only — resolved decision #5).
3. WHEN `:topicId` does not match `/^[a-z0-9-]+$/` THEN the handler SHALL return `{ error: 'Invalid topicId', code: 'VALIDATION_ERROR' }` with HTTP 400 — input sanitization before the DB lookup, even though Drizzle parameterizes the query.
4. WHEN the request parameters are valid THEN the handler SHALL `SELECT content_json FROM theory_topics WHERE language = :lang AND topic_id = :topicId AND review_status IN ('auto-approved', 'manual-approved') LIMIT 1` — the predicate matches `theory_topics_panel_idx` so the lookup is index-only.
5. WHEN the query returns zero rows THEN the handler SHALL respond `{ error: 'Topic not found', code: 'TOPIC_NOT_FOUND' }` with HTTP 404.
6. WHEN the query returns one row THEN the handler SHALL respond with the `content_json` value (a `TheoryTopicJson` payload) as the entire JSON body — no envelope, no metadata leakage. The shape MUST validate against `TheoryTopicJsonSchema` (Req 2).
7. WHEN multiple `(language, topic_id)` rows somehow exist (shouldn't, but the partial unique index is on `(language, grammar_point_key)` — `topic_id` is enforced by the generator's derivation rule, not by the DB) THEN the handler SHALL `LIMIT 1` deterministically by `ORDER BY generated_at DESC NULLS LAST` and emit a `warn`-level log line carrying both ids.
8. WHEN the DB query throws THEN the handler SHALL log `error`-level and respond `{ error: 'Internal error', code: 'INTERNAL_ERROR' }` with HTTP 500 — never leak the underlying error message.

### Requirement 2 — Wire-format Zod schema for `TheoryTopicJson`

**User Story:** As both the API route and the API client I want a single Zod schema for the `TheoryTopicJson` shape, so that the route can validate before responding and the client can `safeParse` after receiving — same contract on both sides, defined once.

#### Acceptance Criteria

1. WHEN `packages/api-client/src/schemas/theory.ts` is created THEN it SHALL export `TheoryTopicJsonSchema`, `TheorySectionJsonSchema`, `TheoryBlockJsonSchema`, `TheoryInlineJsonSchema`, and the inferred TS types — same `z.discriminatedUnion('kind', […])` shape the runtime taxonomy uses in `packages/shared/src/theory.ts`.
2. WHEN the schema is reviewed against `packages/shared/src/theory.ts` THEN it SHALL cover every block kind (`paragraph`, `callout`, `example`, `list`, `conjugation-table`) and every inline kind (`text`, `strong`, `em`, `hilite`, `mono`) — full parity, no subset, no superset.
3. WHEN `paragraph.text` is `[]` (empty inline array) THEN `safeParse` SHALL fail with a non-empty error — matches the parser strictness rule from Phase 2 (resolved decision #12: empty content is rejected at parse time, never silently rendered).
4. WHEN `section.body` is `[]` or `topic.sections` is `[]` THEN `safeParse` SHALL fail — same rationale.
5. WHEN the API route handler is implemented THEN it SHALL `safeParse` the row's `content_json` against `TheoryTopicJsonSchema` before responding; on parse failure it SHALL log `error`-level (a row that violates the schema means a parser regression upstream) and return HTTP 500 — protect the client from corrupted rows.
6. WHEN the schemas live in `packages/api-client` THEN they SHALL be re-exported from `packages/api-client/src/index.ts` (`TheoryTopicJsonSchema`, `type TheoryTopicJsonResponse`, etc.) so both the server route and the web hooks can `import { TheoryTopicJsonSchema } from '@language-drill/api-client'`.

### Requirement 3 — Backend route `GET /theory/:lang`

**User Story:** As the web client I want to fetch the list of available theory topics for a language (id + title + cefr), so that the panel's table-of-contents and the "no theory yet — try another" empty state can surface DB-backed topics in addition to the three hand-authored ES ones.

#### Acceptance Criteria

1. WHEN `:lang` validates THEN the handler SHALL `SELECT topic_id, content_json->>'title' AS title, content_json->>'cefr' AS cefr FROM theory_topics WHERE language = :lang AND review_status IN ('auto-approved', 'manual-approved') ORDER BY content_json->>'title' ASC` — surfaces titles via JSON path access rather than denormalizing `title`/`cefr` into separate columns (a denormalization would require a Phase 1 migration revision and gains nothing for this hot path that's called ≤ once per panel open).
2. WHEN the result is shaped THEN the response SHALL be `{ topics: Array<{ id: string; title: string; cefr: string }> }` — wrapped in a `topics` envelope (unlike the single-topic route) so we can add cursor pagination later without a breaking shape change.
3. WHEN no rows exist for the language THEN the handler SHALL respond `{ topics: [] }` with HTTP 200 — empty is a valid state (DE / TR start empty until generation runs).
4. WHEN any row has `content_json->>'title'` or `content_json->>'cefr'` returning `NULL` (corrupt row) THEN the handler SHALL filter that row out of the response and log `warn`-level with the row's `id` — degrade gracefully, never let one bad row 500 the list.
5. WHEN `TheoryListResponseSchema` is exported from `packages/api-client/src/schemas/theory.ts` THEN it SHALL match the route's response shape and be the same `safeParse` target the client uses.

### Requirement 4 — TanStack Query hook `useTheoryTopic`

**User Story:** As `TheoryPanel` and `TheoryTrigger` I want a hook that returns a single rendered `TheoryTopic`, given a language and topic id, that transparently resolves from the static TSX registry first and the API second, so that the panel renders hand-authored content for the three ES topics and DB-backed content for everything else without per-call branching at the call site.

#### Acceptance Criteria

1. WHEN `useTheoryTopic({ language, topicId, fetchFn })` is called THEN it SHALL first look up `(language, topicId)` in the **static** `theoryRegistry` (the rename of the current `theoryRegistry` from `apps/web/content/theory/index.ts`). If the static lookup hits, the hook SHALL return `{ topic: TheoryTopic, isLoading: false, isError: false, error: null }` synchronously on first render — no network call, no `useQuery` execution.
2. WHEN the static lookup misses THEN the hook SHALL drive a `useQuery({ queryKey: ['theory', 'topic', language, topicId], queryFn, enabled: true, staleTime: 5 * 60 * 1000 })` against `GET /theory/:lang/:topicId`, pass the JSON through `TheoryTopicJsonSchema.parse`, run `renderTheoryTopicJson` (from `apps/web/components/theory/render-json.tsx`), and return the resulting `TheoryTopic` — that is, the runtime `TheoryTopic` type that `TheoryPanel` already consumes, not the JSON.
3. WHEN the API returns 404 THEN the hook SHALL return `{ topic: null, isLoading: false, isError: false, error: null }` — 404 is "no topic for this slug yet", not an error worth surfacing in the UI. The `TheoryEmpty` fallback (Req 7) handles `topic === null`.
4. WHEN the API returns 401 / 403 / 500 THEN the hook SHALL return `{ topic: null, isLoading: false, isError: true, error: Error }` — let the panel's existing error surface render something meaningful.
5. WHEN the language changes THEN the hook SHALL invalidate the prior query (TanStack Query handles this automatically via the queryKey change). The hook MUST NOT cache across users (the per-user Clerk token is in the `Authorization` header — that's the natural cache key boundary anyway because of the `fetchFn` closure).
6. WHEN the hook is invoked during SSR / before the Clerk token is hydrated THEN it SHALL return `{ topic: null, isLoading: true, ... }` so the panel can render its skeleton — the existing panel mount-on-demand behavior means this branch is mostly defensive, but the contract is explicit.
7. WHEN `staleTime` is set to 5 minutes THEN the hook SHALL skip re-fetching within that window when the panel reopens for the same `(language, topicId)` — the in-memory tab-scoped cache is the Phase 5 replacement for the deferred Upstash cache.

### Requirement 5 — TanStack Query hook `useTheoryTopics`

**User Story:** As `TheoryToc` (the in-panel jump list of *other* topics) and `TheoryEmpty` (the "try one of these instead" state) I want a list hook that returns the union of static-TSX topics and DB topics for a language, deduplicated by id and sorted by title, so that the toc/empty surfaces stay coherent as the pool fills.

#### Acceptance Criteria

1. WHEN `useTheoryTopics({ language, fetchFn })` is called THEN it SHALL compute the static list synchronously (`listTheoryTopics(language)` from `apps/web/content/theory/index.ts` after rename to `listStaticTheoryTopics`) and run a `useQuery({ queryKey: ['theory', 'list', language], queryFn, staleTime: 5 * 60 * 1000 })` against `GET /theory/:lang` in parallel.
2. WHEN both lists are available THEN the hook SHALL merge them with **static taking precedence on id collision** — if a topic id appears in both lists (e.g. someone generates `subjunctive` into the DB), the static version wins. Resolved decision #3.
3. WHEN the merged list is sorted THEN it SHALL sort by `title.localeCompare(otherTitle)` — same comparator as the current `listTheoryTopics` so `TheoryToc` ordering doesn't drift.
4. WHEN the DB list is still loading THEN the hook SHALL return `{ topics: staticOnly, isLoading: true, isError: false }` — render what's known, badge the rest as pending.
5. WHEN the DB query errors THEN the hook SHALL return `{ topics: staticOnly, isLoading: false, isError: true, error: Error }` — never surface an empty list when the static fallback is present.

### Requirement 6 — Panel consumer refactor (sync → hook)

**User Story:** As a developer reading `TheoryPanel` / `TheoryTrigger` / `TheoryToc` / `TheoryEmpty` I want all four to read from the new hooks rather than calling `getTheoryTopic` / `listTheoryTopics` sync at module-import time, so that DB-backed topics render without each component having to branch on "is this static or not."

#### Acceptance Criteria

1. WHEN `apps/web/components/theory/theory-panel.tsx` is refactored THEN the call to `getTheoryTopic(language, internalTopicId)` at line 36 SHALL be replaced with `const { topic, isLoading, isError } = useTheoryTopic({ language, topicId: internalTopicId, fetchFn })` — the existing `topic` shape stays identical, the four downstream consumers (sectionIds, useScrollSpy, the title chip, `TheoryToc`/`TheoryContent`) keep working with zero changes once `topic` is non-null.
2. WHEN `topic` is `null` AND `isLoading` is `true` THEN the panel SHALL render a skeleton (`<div className="theory-loading">loading theory…</div>` or equivalent — use existing `t-small` typography class for consistency with `TheoryEmpty`) — never blank screen, never the empty state (which would be confusing while the fetch is in flight).
3. WHEN `topic` is `null` AND `isLoading` is `false` AND `isError` is `false` THEN the panel SHALL render the existing `<TheoryEmpty>` (this is the 404 / "no theory written yet" branch — unchanged behavior from today, just routed via the hook).
4. WHEN `topic` is `null` AND `isError` is `true` THEN the panel SHALL render an error fallback (`<div className="theory-error">couldn't load theory — try again</div>` or equivalent — use existing typography classes). Error fallback styling MUST NOT introduce new CSS rules; reuse existing classes only.
5. WHEN `apps/web/components/theory/theory-trigger.tsx` is refactored THEN the call to `getTheoryTopic(language, topicId)` at line 21 SHALL be replaced with the same hook. The trigger SHALL NOT render its pill while `isLoading` is true (avoid the flash-of-empty-trigger that would happen if a learner is in mid-drill and the API is slow). If `topic` is null after load, the trigger renders nothing (preserves current `FR-1.2` behavior).
6. WHEN `apps/web/components/theory/theory-toc.tsx` is refactored THEN `listTheoryTopics(language)` at line 24 SHALL be replaced with `const { topics } = useTheoryTopics({ language, fetchFn })`. The downstream `.filter((t) => t.id !== topic.id)` stays unchanged.
7. WHEN `apps/web/components/theory/theory-empty.tsx` is refactored THEN `listTheoryTopics(language)` at line 18 SHALL be replaced with the same hook. The `others.length > 0` branch stays unchanged.
8. WHEN `apps/web/lib/theory-topic-map.ts` (the `topicIdForHint` helper at line 20) is refactored THEN `getTheoryTopic` SHALL be replaced with `getStaticTheoryTopic` (the rename of the old sync function) — `topicIdForHint` is called from the drill page's sync render path and MUST stay synchronous. It only validates that a topic *could* be loaded against the static registry; the actual load is done by the hook on panel open. This means `topicIdForHint` may return an id for a topic that turns out to be a 404 at fetch time — that is intentional, because the panel's `null`-topic branch (Req 6.3) renders `<TheoryEmpty>` for both "no static entry" and "DB 404", giving the learner a consistent recovery surface.

### Requirement 7 — `apps/web/content/theory/index.ts` registry refactor

**User Story:** As the codebase I want the registry module to expose a clear split between the *static* registry (always synchronous, the override path) and the *hooks* (the consumer interface), so that no one accidentally adds a new sync call that bypasses the DB layer.

#### Acceptance Criteria

1. WHEN the file is refactored THEN the existing exports `theoryRegistry` and `TheoryTopicId` SHALL remain — those are used by `theory-topic-map.ts` and the `topicId` prop type, both of which need to stay sync.
2. WHEN `getTheoryTopic` is touched THEN it SHALL be **renamed** to `getStaticTheoryTopic` (same signature, same behavior — returns `TheoryTopic | null` from the in-memory registry only). Every existing call site (`theory-panel.tsx`, `theory-trigger.tsx`, `theory-topic-map.ts`) SHALL be updated to call the renamed function OR (where the call is moving to a hook) deleted.
3. WHEN `listTheoryTopics` is touched THEN it SHALL be **renamed** to `listStaticTheoryTopics` — same rationale, same shape. The new hooks build on top.
4. WHEN the rename is complete THEN there SHALL be no remaining call site for `getTheoryTopic` / `listTheoryTopics` (the old names) anywhere in `apps/web/` or `packages/`. A grep for the old names returns zero hits — verified by the pre-push gate.
5. WHEN a developer reads the renamed module THEN it SHALL carry a docstring at the top: `"Static theory registry. Hand-authored TSX topics take precedence over DB-stored rows; for DB-backed access use useTheoryTopic / useTheoryTopics from @language-drill/api-client."` — single source of truth on the lookup order, prevents future confusion.

### Requirement 8 — Admin coverage page `/admin/theory`

**User Story:** As the operator I want a single admin page that shows per-language, per-CEFR-level theory coverage (count of approved rows / total grammar points), so that I can tell at a glance which cells need a generation run before learners land on them.

#### Acceptance Criteria

1. WHEN the page lives at `apps/web/app/(dashboard)/admin/theory/page.tsx` THEN it SHALL be a server component (RSC) that calls `apiFetch('/admin/theory/coverage')` in a `Promise.all` parallel with any other panels it grows over time — mirrors `admin/generation/page.tsx:31-34`.
2. WHEN the data is fetched THEN the page SHALL render a `<table>` with columns `Language | A1 | A2 | B1 | B2` and rows for `ES`, `DE`, `TR`. Each cell shows `approved/total` (e.g. `12/15`) with an indicator badge: `✓` for 100%, `⚠` for ≥ 50%, `✗` for 0% — same Tailwind utility classes the exercise coverage table uses (`bg-red-100`, `bg-amber-100`, `bg-green-100`) for the cell background. No new CSS rules.
3. WHEN a cell has zero curriculum entries at that `(language, level)` THEN it SHALL render `—` (em dash) instead of `0/0` — visual distinction between "no curriculum" and "all empty" matters for prioritization. (See `packages/db/src/curriculum/index.ts:40-44` — most levels are currently 0 by design.)
4. WHEN any of the 12 cells has `approved > 0` AND `flagged > 0` (i.e. some rows landed approved, some flagged) THEN a subtle "+N flagged" annotation SHALL appear under the cell count. Surfaces the existence of flagged rows for the operator to triage via `pnpm review:flagged-theory`.
5. WHEN the page is reached by a non-admin Clerk user THEN it SHALL redirect to `/` via the existing `apps/web/app/(dashboard)/admin/layout.tsx` gate — no new auth code, gate is inherited.
6. WHEN the API returns a 403 (admin middleware vetoed the call) THEN the RSC SHALL also redirect to `/` — mirrors `admin/generation/page.tsx:36-38`.
7. WHEN the API errors (500 / network) THEN the page SHALL render a visible error message `Failed to load: <message>` in the same red text the generation dashboard uses (`text-red-600`). Never blank screen.
8. WHEN a navigation link to `/admin/theory` is needed THEN it SHALL be added next to the existing `/admin/generation` link in whichever shared header / nav component the `(dashboard)/admin/layout.tsx` renders (if any — verify during implementation; if no shared nav exists today, defer this sub-task to a one-line follow-up in the same task).

### Requirement 9 — Backend route `GET /admin/theory/coverage`

**User Story:** As the admin coverage page I want one API call that returns per-cell counts of approved/flagged rows joined against the curriculum size, so that the page renders 12 cells from one query rather than fanning out per language.

#### Acceptance Criteria

1. WHEN the route is mounted THEN it SHALL live in `infra/lambda/src/routes/admin.ts` (or a new `infra/lambda/src/routes/admin-theory.ts` if the file is getting unwieldy — implementer's call). It SHALL use the existing `admin.use('/admin/*', authMiddleware, adminMiddleware)` pattern — no new middleware.
2. WHEN the handler runs THEN it SHALL execute a single query: `SELECT language, cefr_level, COUNT(*) FILTER (WHERE review_status IN ('auto-approved', 'manual-approved')) AS approved, COUNT(*) FILTER (WHERE review_status = 'flagged') AS flagged FROM theory_topics GROUP BY language, cefr_level` and join it in-memory against `enumerateCurriculumCells(ALL_CURRICULA)` filtered to `kind === 'grammar'` and grouped by `(language, cefr_level)` to get the totals.
3. WHEN the response is shaped THEN it SHALL be: `{ rows: Array<{ language: 'ES' | 'DE' | 'TR'; level: 'A1' | 'A2' | 'B1' | 'B2'; approved: number; flagged: number; total: number }> }` — `total` is the curriculum count (the denominator), `approved` is the numerator, `flagged` is the triage indicator. 12 rows always (3 languages × 4 levels), even when `total === 0` (no curriculum entries) — the client decides how to render zero-total cells.
4. WHEN `TheoryCoverageResponseSchema` is exported from `packages/api-client/src/schemas/theory.ts` THEN it SHALL match the route's shape and be the safeParse target for the RSC.
5. WHEN the curriculum's `kind === 'grammar'` filter is applied THEN vocab umbrellas SHALL NOT count toward the denominator — theory cells are grammar-only in round 1 (resolved decision #6).
6. WHEN the language enum widens past `ES/DE/TR` in the future THEN this route SHALL NOT need changes — it iterates the curriculum, not a hardcoded list.

### Requirement 10 — Test coverage

**User Story:** As the project I want every new module to ship with tests sized to its surface, so that the Phase 5 PR can pass the pre-push gate (`pnpm lint && pnpm typecheck && pnpm test`) without manual smoke-testing being the only safety net.

#### Acceptance Criteria

1. WHEN `infra/lambda/src/routes/theory.ts` is created THEN it SHALL have `infra/lambda/src/routes/theory.test.ts` covering: (a) valid `(lang, topicId)` returns 200 + JSON body, (b) invalid `:lang` returns 400, (c) invalid `:topicId` pattern returns 400, (d) no matching row returns 404, (e) flagged-only rows return 404 (the partial index predicate excludes them), (f) the list endpoint returns sorted titles, (g) corrupt `content_json` row is filtered with a warn log on the list endpoint and 500 on the single-topic endpoint. Uses the same Hono test harness `routes/exercises.test.ts` uses.
2. WHEN `packages/api-client/src/hooks/useTheoryTopic.ts` is created THEN it SHALL have `packages/api-client/src/hooks/useTheoryTopic.test.ts` covering: (a) static-hit returns sync without firing `useQuery`, (b) static-miss + DB hit returns the rendered topic, (c) static-miss + 404 returns `{ topic: null, isError: false }`, (d) static-miss + 500 returns `{ topic: null, isError: true }`, (e) `staleTime` is honored (re-render within window does not re-fetch). Uses MSW or the existing `fetchClient` test pattern.
3. WHEN `useTheoryTopics.ts` is created THEN it SHALL have a sibling test file covering: (a) static-only when DB empty, (b) DB-only when static empty (DE/TR), (c) merge with static-precedence on id collision, (d) sort by title, (e) DB-error fallback to static-only with `isError: true`.
4. WHEN `apps/web/app/(dashboard)/admin/theory/page.tsx` is created THEN it SHALL have at least one rendering test in `apps/web/app/(dashboard)/admin/theory/page.test.tsx` covering: (a) page renders the 12-cell table given a known coverage payload, (b) zero-curriculum cells render `—` instead of `0/0` (Req 8.3), (c) a cell with `approved > 0 AND flagged > 0` renders the `+N flagged` annotation (Req 8.4). The existing `admin/generation/page.tsx` has no test today — Phase 5 raises the bar here.
5. WHEN the new schemas (`packages/api-client/src/schemas/theory.ts`) are created THEN they SHALL have a `theory.test.ts` covering: (a) every block kind round-trips through `safeParse`, (b) empty inline array fails, (c) empty section body fails, (d) zero-section topic fails — same strictness contract as the Phase 2 parser.
6. WHEN the registry-fallback rename in `apps/web/content/theory/index.ts` is made THEN the change SHALL be verified by a grep-based test (or simply a typecheck pass — since the old names no longer exist, any stale call site fails compilation).
7. WHEN the panel refactor is made THEN no UI snapshot tests are added in Phase 5 (the existing panel has none). A manual smoke-test note is added to the spec's task list instead — open the panel for one ES generated topic on the dev branch, confirm it renders.

## Non-Functional Requirements

### Performance

- **Single-topic route latency**: p95 under 150 ms for an authenticated request against the dev Neon branch. The `theory_topics_panel_idx` partial index makes this an index-only scan; the round-trip is dominated by Clerk JWT verification (< 50 ms) and Hono routing (negligible). No new caching layer.
- **List route latency**: p95 under 200 ms — same index hit but with JSON-path extraction on `content_json->>'title'` and `content_json->>'cefr'`. If a profile run during dev smoke-test shows the JSON-path cost dominating, the design's open question on denormalizing `title`/`cefr` into columns (see Open Question 1) gets escalated to a follow-up migration.
- **Coverage route latency**: p95 under 100 ms — one `GROUP BY` aggregate over a table that holds ≤ 240 rows at full ES/DE/TR coverage.
- **Panel cold-render time**: from `useTheoryTopic` first call to topic-visible, p95 under 300 ms over a typical home network — fetch + parse + `renderTheoryTopicJson` + React commit. Static-hit cases (the three ES TSX topics) are < 50 ms because no network call fires.
- **Admin page render time**: p95 under 500 ms for an empty DE/TR + filled ES catalog — single API call, single RSC render, no client hydration on the table itself.

### Security

- All four new routes (`GET /theory/:lang`, `GET /theory/:lang/:topicId`, `GET /admin/theory/coverage`, and the admin page itself) require a verified Clerk JWT via existing middleware. No anonymous access — theory is a logged-in-only surface, consistent with the rest of the app.
- Admin route additionally requires `ADMIN_USER_IDS` membership via `adminMiddleware` — same enforcement as `/admin/pool-status`.
- The `:topicId` regex (`/^[a-z0-9-]+$/`) is the parameterization boundary even though Drizzle binds the parameter — defense-in-depth against future log-injection or path-traversal-style attacks if the param ever leaks into a log line unescaped.
- `content_json` is returned as-is to the authenticated client — it's already been validated by the schema check (Req 2.5), and the panel renderer escapes inline text via React's default JSX escaping.
- No PII in theory data (it's curriculum reference material), so no special data-classification handling needed.

### Reliability

- The single-topic route degrades gracefully on a corrupt row: the row is returned as 500 + structured log, not as a malformed response that crashes the client renderer. The schema check at the route boundary is the contract.
- The list route degrades per-row: one corrupt row drops out of the response with a warn log, the rest of the list serves normally.
- The admin coverage route returns 12 rows always — if the DB is unreachable, the route returns 500 (RSC renders the error message); if the DB returns zero rows, the route still returns 12 rows with `approved: 0, flagged: 0, total: <curriculum count>`.
- The hooks degrade to static-only on any DB error (Req 4.4, 5.5) — `subjunctive`, `preterite-imperfect`, `conditional` keep rendering for ES learners even if the entire `theory_topics` table is unreachable. The three hand-authored topics are a hard floor on availability.

### Usability

- The panel's loading state (Req 6.2) reuses existing typography classes (`t-small`) and styling — no visual redesign, no new CSS rules.
- The empty-state (Req 6.3) and error-state (Req 6.4) reuse the existing `TheoryEmpty` component — same look learners already know.
- The admin coverage tile mirrors the visual language of `/admin/generation` — same Tailwind color scale, same table layout, so the operator's mental model transfers.
- The renamed `getStaticTheoryTopic` / `listStaticTheoryTopics` names are unambiguous about which path they exercise — a developer adding a new theory consumer can tell at a glance whether they're hitting the override or the DB.
