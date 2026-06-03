# Implementation Plan — theory-generation-phase-5

## Task Overview

Phase 5 wires DB-stored `theory_topics` rows into the Theory Panel and adds an admin coverage tile. Work splits into five tracks:

1. **API-client schemas** — Zod envelopes for the two list-style responses. Topic-body validation reuses `parseTheoryTopicJson` from `@language-drill/shared` (design refinement of Req 2; no `TheoryTopicJsonSchema`).
2. **Backend routes** — `GET /theory/:lang/:topicId`, `GET /theory/:lang`, `GET /admin/theory/coverage`. All three behind the existing JWT authorizer; the admin route additionally behind `adminMiddleware`.
3. **Static registry rename** — `getTheoryTopic` → `getStaticTheoryTopic`, `listTheoryTopics` → `listStaticTheoryTopics`. Updates `lib/theory-topic-map.ts`.
4. **Hooks + panel refactor** — `useTheoryTopic` and `useTheoryTopics` in `apps/web/lib/hooks/` (each accepts **optional** `fetchFn` so static-only paths still work), then refactor the four panel components and the drill page to consume them.
5. **Admin coverage page** — `apps/web/app/(dashboard)/admin/theory/page.tsx` mirroring `admin/generation/page.tsx`.

Tracks 1 and 2 can ship in parallel; track 3 is independent and lands early to unblock track 4; track 5 depends only on track 1's coverage envelope and the new admin route.

**Optional-`fetchFn` pattern for the hooks.** Both hooks accept `fetchFn?: AuthenticatedFetch`. When `fetchFn` is `undefined`, the hook degrades to static-only (no `useQuery` execution; returns `null` if no static match). This means:
- The web app typechecks at every intermediate step of track 4.
- `lib/theory-topic-map.ts` doesn't need a `fetchFn` to call `getStaticTheoryTopic` directly (it stays sync; the optional pattern just means the hook is also usable from sync-only call paths in the future).
- The hook contract is honest: it's a static-first, DB-fallback resolver; if no DB connection exists, static-only is a valid degradation.

Each task is verified by `pnpm typecheck && pnpm test` from the repo root unless otherwise stated. Pre-push gate (`pnpm lint && pnpm typecheck && pnpm test`) MUST pass before merge.

**Out of scope, explicitly deferred (from requirements.md Introduction):**
- Upstash Redis cache layer (use Phase 5's design hook to revisit)
- `POST /admin/theory/regenerate` admin trigger
- Migrating the three ES TSX files to the DB
- Admin nav link to `/admin/theory` (Req 8.8) — no shared admin nav exists today (verified at `apps/web/app/(dashboard)/admin/layout.tsx:1-21`); operator reaches the page by typing the URL. Adding nav is a one-line follow-up once an admin nav surface is built.

## Steering Document Compliance

- **`tech.md` §2 (Hono + Zod)** — new routes use the `theory.use('/theory/*', authMiddleware)` pattern from `routes/exercises.ts:44`; envelope validation uses Zod at the boundary.
- **`tech.md` §7 (Pre-generated content)** — Phase 5 is the read-half of the content model. No new content-generation logic.
- **Tests-next-to-source** convention — every new `.ts` lands with a `.test.ts` sibling.
- **No new third-party services** — Upstash secrets stay unused this phase.

## Atomic Task Requirements

Each task touches **1–3 files**, completes in **15–30 min**, and has **one testable outcome**. References use `_Requirements: X.Y_` and `_Leverage: <path>_`.

## Tasks

### Track 1 — API-client schemas

- [x] 1. Create `packages/api-client/src/schemas/theory.ts` with response envelopes
  - File: `packages/api-client/src/schemas/theory.ts`
  - Define `TheoryListItemSchema` (`{ id, title, cefr }` all strings) and `TheoryListResponseSchema` (`{ topics: TheoryListItem[] }`)
  - Define `TheoryCoverageRowSchema` (`language: z.enum(['ES','DE','TR'])`, `level: z.enum(['A1','A2','B1','B2'])`, `approved`/`flagged`/`total: z.number().int().nonnegative()`) and `TheoryCoverageResponseSchema` (`{ rows: TheoryCoverageRow[] }`)
  - Export inferred TS types alongside each schema
  - **No `TheoryTopicJsonSchema`** — topic body validated via `parseTheoryTopicJson` from `@language-drill/shared` (design refinement; document in top-of-file comment)
  - Purpose: single source of truth for the two envelope responses on both server and client
  - _Leverage: packages/api-client/src/schemas/exercise.ts (style), packages/shared/src/theory.ts (re-import target)_
  - _Requirements: 2.1, 2.6, 9.4_

- [x] 2. Add tests for `packages/api-client/src/schemas/theory.ts`
  - File: `packages/api-client/src/schemas/theory.test.ts`
  - Cover `safeParse` success for a minimal valid list response and a 12-row coverage response
  - Cover `safeParse` failure for: missing `topics` array, non-string `id` in list item, negative `approved`, `language: 'EN'` rejected by enum, `level: 'C1'` rejected by enum
  - Purpose: pin the envelope contract before the route uses it
  - _Leverage: packages/api-client/src/hooks/useExercise.test.ts (vitest `describe`/`it`/`expect` patterns)_
  - _Requirements: 10.5_

- [x] 3. Extend `packages/api-client/src/index.ts` with new exports + parser re-export
  - File: `packages/api-client/src/index.ts` (modify existing)
  - Add `export { TheoryListItemSchema, TheoryListResponseSchema, TheoryCoverageRowSchema, TheoryCoverageResponseSchema, type TheoryListItem, type TheoryListResponse, type TheoryCoverageRow, type TheoryCoverageResponse } from './schemas/theory';`
  - Add `export { parseTheoryTopicJson, type TheoryTopicJson, type TheorySectionJson, type TheoryBlockJson, type TheoryInlineJson } from '@language-drill/shared';` so web-side code has one import root
  - Verify `pnpm typecheck` from repo root still passes
  - Purpose: make the schemas + parser importable as `@language-drill/api-client` consumers expect
  - _Leverage: packages/api-client/src/index.ts:154-160 (existing export block pattern)_
  - _Requirements: 2.6_

### Track 2 — Backend routes

- [x] 4. Create `infra/lambda/src/routes/theory.ts` with the single-topic endpoint
  - File: `infra/lambda/src/routes/theory.ts`
  - Set up Hono router scaffolding: import `Hono`, `z`, Drizzle helpers (`and`, `eq`, `inArray`, `sql`), `theoryTopics` from `@language-drill/db`, `db`, `authMiddleware`, `parseTheoryTopicJson` from `@language-drill/shared`
  - Apply `theory.use('/theory/*', authMiddleware)`
  - Define module-level constants `LANGUAGE_SCHEMA = z.enum(['ES','DE','TR'])` and `TOPIC_ID_REGEX = /^[a-z0-9-]+$/`
  - Implement `GET /theory/:lang/:topicId`:
    - Validate `:lang` via `LANGUAGE_SCHEMA.safeParse` → 400 on failure with `{ error: 'Invalid language', code: 'VALIDATION_ERROR' }`
    - Validate `:topicId` against `TOPIC_ID_REGEX` → 400 on failure with `{ error: 'Invalid topicId', code: 'VALIDATION_ERROR' }`
    - Run `db.select({ contentJson: theoryTopics.contentJson }).from(theoryTopics).where(and(eq(theoryTopics.language, lang), eq(theoryTopics.topicId, topicId), inArray(theoryTopics.reviewStatus, ['auto-approved','manual-approved']))).orderBy(sql\`${theoryTopics.generatedAt} DESC NULLS LAST\`).limit(1)`
    - Empty result → 404 `{ error: 'Topic not found', code: 'TOPIC_NOT_FOUND' }`
    - On result: wrap `parseTheoryTopicJson(row.contentJson)` in try/catch; on throw log `error`-level with row id + parse-error message, return 500 `{ error: 'Internal error', code: 'INTERNAL_ERROR' }`
    - On success: `return c.json(parsed)` (raw `TheoryTopicJson`, no envelope)
  - Outer try/catch around the DB call returns 500 with the standard internal-error shape (never leak underlying error)
  - Export the Hono router as default
  - Purpose: serve one approved theory topic to the panel
  - _Leverage: infra/lambda/src/routes/exercises.ts:1-90 (route module structure, validation pattern), infra/lambda/src/middleware/auth.ts, packages/db/src/schema/theory.ts (theoryTopics), packages/shared/src/theory.ts (parseTheoryTopicJson)_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 2.5_

- [x] 5. Add `GET /theory/:lang` (list endpoint) to `infra/lambda/src/routes/theory.ts`
  - File: `infra/lambda/src/routes/theory.ts` (continue from task 4)
  - Implement `GET /theory/:lang`:
    - Validate `:lang` (reuse `LANGUAGE_SCHEMA`)
    - Run `Promise.all([rowsQuery, totalQuery])`:
      - `rowsQuery`: `db.select({ id: theoryTopics.topicId, title: sql<string>\`${theoryTopics.contentJson}->>'title'\`, cefr: sql<string>\`${theoryTopics.contentJson}->>'cefr'\` }).from(theoryTopics).where(and(eq(theoryTopics.language, lang), inArray(theoryTopics.reviewStatus, ['auto-approved','manual-approved']), sql\`${theoryTopics.contentJson}->>'title' IS NOT NULL\`, sql\`${theoryTopics.contentJson}->>'cefr' IS NOT NULL\`)).orderBy(sql\`${theoryTopics.contentJson}->>'title' ASC\`)`
      - `totalQuery`: `db.select({ total: count() }).from(theoryTopics).where(and(eq(theoryTopics.language, lang), inArray(theoryTopics.reviewStatus, ['auto-approved','manual-approved'])))`
    - If `totalQuery[0].total > rowsQuery.length` → log `warn`-level `{ language, dropped: total - rows.length }` (corrupt rows filtered out by the IS NOT NULL predicates)
    - Return `c.json({ topics: rows })`
  - Purpose: serve the merged-list source for the panel's TOC and empty state
  - _Leverage: infra/lambda/src/routes/admin.ts:64-66 (JSON-path SQL pattern), packages/db/src/schema/theory.ts_
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 6. Mount the theory router in `infra/lambda/src/index.ts`
  - File: `infra/lambda/src/index.ts` (modify existing)
  - Add `import theory from './routes/theory';` after the existing `import exercises from './routes/exercises';` (line 7)
  - Add `app.route('/', theory);` after the existing `app.route('/', exercises);` (line 49)
  - Verify build types cleanly: `pnpm --filter @language-drill/lambda typecheck`
  - Purpose: wire the new routes into the Lambda
  - _Leverage: infra/lambda/src/index.ts:6-55 (existing mount pattern)_
  - _Requirements: 1.1_

- [x] 7. Add tests for `infra/lambda/src/routes/theory.ts` — single-topic happy paths
  - File: `infra/lambda/src/routes/theory.test.ts`
  - Use the test-DB harness `infra/lambda/src/routes/exercises.test.ts` already uses (vitest setup that seeds + tears down rows by `language` prefix)
  - Seed one approved ES row with a valid `TheoryTopicJson` for `topicId: 'b1-test-topic'`
  - Cover:
    - `GET /theory/ES/b1-test-topic` → 200, body validates against `parseTheoryTopicJson`
    - `GET /theory/ES/non-existent` → 404 `{ code: 'TOPIC_NOT_FOUND' }`
    - Flagged-only row for `(ES, b1-flagged)` → 404 (partial-index exclusion)
  - Purpose: lock the happy + 404 paths
  - _Leverage: infra/lambda/src/routes/exercises.test.ts (test-DB harness)_
  - _Requirements: 10.1 (a, d, e)_

- [x] 8. Add tests for `infra/lambda/src/routes/theory.ts` — single-topic error paths
  - File: `infra/lambda/src/routes/theory.test.ts` (continue from task 7)
  - Cover:
    - `GET /theory/EN/anything` → 400 `{ code: 'VALIDATION_ERROR' }` (invalid language)
    - `GET /theory/ES/Bad..ID` → 400 `{ code: 'VALIDATION_ERROR' }` (invalid topicId regex)
    - Seed a corrupt row (manually insert `content_json: { id: 'x', title: '', sections: [] }` — fails parser); GET → 500 `{ code: 'INTERNAL_ERROR' }` and `error`-level log emitted (mock `console.error` to assert)
    - Seed two rows with same `(language, topicId)` but different `generated_at`; GET → returns the row with the later `generated_at`
  - Purpose: lock validation and degraded-row branches
  - _Leverage: infra/lambda/src/routes/theory.test.ts (continue), packages/shared/src/theory.ts (parseTheoryTopicJson error format)_
  - _Requirements: 10.1 (b, c, g), 1.7_

- [x] 9. Add tests for `infra/lambda/src/routes/theory.ts` — list endpoint
  - File: `infra/lambda/src/routes/theory.test.ts` (continue from tasks 7–8)
  - Cover:
    - Seed three approved ES rows with `content_json.title` values `["beta","alpha","gamma"]`; `GET /theory/ES` → `{ topics: [...title:'alpha', title:'beta', title:'gamma'] }` (sorted)
    - `GET /theory/DE` with no rows → `{ topics: [] }`
    - Seed one approved ES row missing `title` (manually insert `content_json` without `title`); `GET /theory/ES` filters it out and emits one `warn`-level log
  - Purpose: lock list ordering + corrupt-row degradation
  - _Leverage: infra/lambda/src/routes/theory.test.ts (continue)_
  - _Requirements: 10.1 (f, g)_

- [x] 10. Add `GET /admin/theory/coverage` handler scaffold + DB aggregate in `infra/lambda/src/routes/admin.ts`
  - File: `infra/lambda/src/routes/admin.ts` (modify existing)
  - Add imports: `theoryTopics` from `@language-drill/db`, plus any missing Drizzle helpers
  - Below `admin.get('/admin/generation-stats', ...)` (line 204), add `admin.get('/admin/theory/coverage', async (c) => { ... })`
  - Inside the handler, run **just** the DB aggregate:
    - `const aggregateRows = await db.select({ language: theoryTopics.language, level: theoryTopics.cefrLevel, approved: sql<number>\`COUNT(*) FILTER (WHERE ${theoryTopics.reviewStatus} IN ('auto-approved','manual-approved'))::int\`, flagged: sql<number>\`COUNT(*) FILTER (WHERE ${theoryTopics.reviewStatus} = 'flagged')::int\` }).from(theoryTopics).groupBy(theoryTopics.language, theoryTopics.cefrLevel);`
    - Stub the response to `c.json({ rows: aggregateRows })` for now — task 11 wires in the curriculum totals + 12-row build-out
  - Purpose: get the SQL aggregate working in isolation before the curriculum merge
  - _Leverage: infra/lambda/src/routes/admin.ts:39-190 (pool-status pattern), packages/db/src/schema/theory.ts_
  - _Requirements: 9.1, 9.2_

- [x] 11. Complete `GET /admin/theory/coverage` with curriculum totals + 12-row merge
  - File: `infra/lambda/src/routes/admin.ts` (continue from task 10)
  - Add helper `theoryCurriculumTotals()` (inline in the file, or extracted to `infra/lambda/src/lib/theory-coverage.ts` if it grows):
    - Iterate `enumerateCurriculumCells(ALL_CURRICULA).filter(c => c.grammarPoint.kind === 'grammar')`
    - Dedup by `(language, cefrLevel, grammarPoint.key)` (since `enumerateCurriculumCells` returns one cell per exercise type — for theory we count distinct grammar points per `(language, level)` only)
    - Return `Map<\`${lang}:${level}\`, number>`
  - Replace the stub `c.json(...)` from task 10 with:
    - Build a `Map<\`${lang}:${level}\`, {approved:number, flagged:number}>` from `aggregateRows`
    - For each `language ∈ ['ES','DE','TR']` × `level ∈ ['A1','A2','B1','B2']` (12 combinations), look up `approved`/`flagged` (default 0) and `total` from the curriculum totals (default 0), push to result array
    - Return `c.json({ rows: result })` (12 rows always, even when both counts and total are 0)
  - Purpose: complete the 12-cell coverage shape
  - _Leverage: packages/db/src/curriculum/index.ts (ALL_CURRICULA), packages/db/src/generation/cells.ts (enumerateCurriculumCells)_
  - _Requirements: 9.3, 9.5, 9.6_

- [x] 12. Add test for `GET /admin/theory/coverage` in `infra/lambda/src/routes/admin.test.ts`
  - File: `infra/lambda/src/routes/admin.test.ts` (modify existing)
  - Add one `describe('/admin/theory/coverage', ...)` block
  - Cover:
    - Seed two approved ES rows at B1, one flagged ES row at B2. GET as admin → returns 12 rows; ES/B1 = `{approved:2, flagged:0, total:<curriculum count>}`; ES/B2 = `{approved:0, flagged:1, total:<curriculum count>}`; all other rows = `{approved:0, flagged:0, total:<curriculum count>}` matching the current curriculum
    - Non-admin user → 403 (inherits `adminMiddleware`)
  - Purpose: lock coverage shape + auth gate inheritance
  - _Leverage: infra/lambda/src/routes/admin.test.ts (existing admin test harness)_
  - _Requirements: 9.1, 9.3_

### Track 3 — Static registry rename

- [x] 13. Rename `getTheoryTopic` → `getStaticTheoryTopic` and `listTheoryTopics` → `listStaticTheoryTopics` in `apps/web/content/theory/index.ts`
  - File: `apps/web/content/theory/index.ts` (modify existing)
  - Rename both functions (same signatures, same bodies)
  - Add top-of-file docstring: `/** Static theory registry. Hand-authored TSX topics take precedence over DB-stored rows; for DB-backed access use useTheoryTopic / useTheoryTopics from apps/web/lib/hooks/. */`
  - Keep `theoryRegistry` and `TheoryTopicId` names unchanged
  - This will break TypeScript at 4 other call sites (theory-trigger, theory-panel, theory-toc, theory-empty) and one in theory-topic-map; the next task fixes theory-topic-map, the panel-component refactors in track 4 fix the others
  - Note: do **not** run `pnpm typecheck` after just this task — wait until task 14 also lands. The two tasks together restore the green build for everything outside `apps/web/components/theory/`
  - Purpose: make the static path's role explicit at the API surface
  - _Leverage: apps/web/content/theory/index.ts:22-37 (current export shape)_
  - _Requirements: 7.1, 7.2, 7.3, 7.5_

- [x] 14. Update `apps/web/lib/theory-topic-map.ts` to call `getStaticTheoryTopic`
  - File: `apps/web/lib/theory-topic-map.ts` (modify existing)
  - Replace the import on lines 2–5 with `import { getStaticTheoryTopic, type TheoryTopicId } from '../content/theory';`
  - Replace the call on line 40 with `return getStaticTheoryTopic(language, id) ? id : null;`
  - Function `topicIdForHint` stays sync (drill page calls it from a sync render path — Req 6.8)
  - At this point everything **outside** `apps/web/components/theory/*.tsx` typechecks again. The four panel components still need refactoring (tracks 4 next)
  - Run `pnpm --filter web typecheck` and confirm only the four panel components fail (with the old `getTheoryTopic`/`listTheoryTopics` import errors)
  - Purpose: keep `topicIdForHint` valid after the rename
  - _Leverage: apps/web/lib/theory-topic-map.ts:1-41_
  - _Requirements: 6.8, 7.4_

### Track 4 — Hooks + panel refactor

- [x] 15. Create `apps/web/lib/hooks/use-theory-topic.ts` with optional-`fetchFn` contract
  - File: `apps/web/lib/hooks/use-theory-topic.ts`
  - Imports: `useQuery` from `@tanstack/react-query`, `AuthenticatedFetch` from `@language-drill/api-client`, `parseTheoryTopicJson` from `@language-drill/api-client` (re-exported from shared via task 3), `type LearningLanguage` from `@language-drill/shared`, `getStaticTheoryTopic` from `../../content/theory`, `renderTheoryTopicJson` from `../../components/theory/render-json`, `type TheoryTopic` from `../../components/theory/types`
  - Define `UseTheoryTopicParams` (`{ language: LearningLanguage; topicId: string; fetchFn?: AuthenticatedFetch }`) — note the optional `fetchFn`
  - Define `UseTheoryTopicResult` (`{ topic: TheoryTopic | null; isLoading: boolean; isError: boolean; error: Error | null }`)
  - Implement:
    - Sync static lookup: `const staticTopic = getStaticTheoryTopic(language, topicId)`
    - `useQuery` with `enabled: staticTopic === null && fetchFn !== undefined`, `staleTime: 5 * 60 * 1000`, `queryKey: ['theory', 'topic', language, topicId]`, `retry` policy that skips 4xx (incl. 404), retries 5xx once
    - `queryFn`: `await fetchFn!(\`/theory/\${language}/\${encodeURIComponent(topicId)}\`)` → `await res.json()` → `parseTheoryTopicJson(...)` → `renderTheoryTopicJson(...)`
    - On static hit: return `{ topic: staticTopic, isLoading: false, isError: false, error: null }`
    - On 404 (detect via `(dbQuery.error as { status?: number }).status === 404`): return `{ topic: null, isLoading: false, isError: false, error: null }`
    - When no `fetchFn` and no static hit: return `{ topic: null, isLoading: false, isError: false, error: null }`
    - Otherwise: pass through `{ topic: dbQuery.data ?? null, isLoading: dbQuery.isLoading, isError: dbQuery.isError, error: dbQuery.error }`
  - Purpose: static-first hook with graceful degradation when `fetchFn` is absent
  - _Leverage: packages/api-client/src/hooks/useExercise.ts:23-41 (useQuery shape), apps/web/components/theory/render-json.tsx:29 (renderer), packages/api-client/src/fetchClient.ts:46-48 (error.status attachment)_
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

- [x] 16. Add tests for `apps/web/lib/hooks/use-theory-topic.ts`
  - File: `apps/web/lib/hooks/use-theory-topic.test.ts`
  - Use `renderHook` from `@testing-library/react`, wrap in a fresh `QueryClientProvider`, stub `fetchFn: AuthenticatedFetch` via `vi.fn<AuthenticatedFetch>()`
  - Cover:
    - Static hit (`ES, 'subjunctive'`) → returns `{topic: <static>, isLoading: false}` without calling `fetchFn`
    - Static miss + 200 with a valid `TheoryTopicJson` → returns the rendered runtime topic; `fetchFn` called exactly once
    - Static miss + 404 (mock fetchFn to reject with `Error` carrying `status: 404`) → returns `{topic: null, isError: false}`
    - Static miss + 500 → returns `{topic: null, isError: true, error}`
    - Static miss + 200 with corrupt JSON (missing `sections`) → `isError: true`
    - **No fetchFn + static hit** → returns the static topic (still works)
    - **No fetchFn + static miss** → returns `{topic: null, isLoading: false, isError: false}` (graceful degradation)
    - Re-render within `staleTime` window → `fetchFn.mock.calls.length === 1` after two renders
  - Purpose: prove the static-first contract + optional-fetchFn degradation
  - _Leverage: packages/api-client/src/hooks/useExercise.test.ts (renderHook + fetchFn stub pattern)_
  - _Requirements: 10.2_

- [x] 17. Create `apps/web/lib/hooks/use-theory-topics.ts` with optional-`fetchFn` contract
  - File: `apps/web/lib/hooks/use-theory-topics.ts`
  - Imports: same as `use-theory-topic.ts` plus `TheoryListResponseSchema` from `@language-drill/api-client`, `listStaticTheoryTopics` from `../../content/theory`
  - Define `UseTheoryTopicsParams` (`{ language: LearningLanguage; fetchFn?: AuthenticatedFetch }`) and `UseTheoryTopicsResult` (`{ topics: Array<{ id: string; title: string; cefr: string }>; isLoading: boolean; isError: boolean; error: Error | null }`)
  - Implement:
    - Sync `const staticTopics = listStaticTheoryTopics(language)`
    - `useQuery` with `enabled: fetchFn !== undefined`, `staleTime: 5 * 60 * 1000`, `queryKey: ['theory', 'list', language]`
    - `queryFn`: fetch `/theory/${language}`, parse with `TheoryListResponseSchema.parse`, return `data.topics`
    - Merge: `const dbTopics = dbQuery.data ?? []; const seen = new Set(staticTopics.map(t => t.id)); const merged = [...staticTopics, ...dbTopics.filter(t => !seen.has(t.id))]; merged.sort((a, b) => a.title.localeCompare(b.title));`
    - When `dbQuery.isError` → return `{topics: merged, isLoading: false, isError: true, error: dbQuery.error}` (static-only fallback floor)
    - When no `fetchFn` → return `{topics: staticTopics.sort by title, isLoading: false, isError: false, error: null}`
  - Purpose: merged-list hook with graceful degradation
  - _Leverage: apps/web/lib/hooks/use-theory-topic.ts (sibling pattern), apps/web/content/theory/index.ts:30-37 (sort + comparator)_
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [x] 18. Add tests for `apps/web/lib/hooks/use-theory-topics.ts`
  - File: `apps/web/lib/hooks/use-theory-topics.test.ts`
  - Cover:
    - Static-only when DB returns `{topics: []}` → merged equals static list, sorted by title
    - DB-only when static is empty (`DE`) → merged equals DB list, sorted
    - Collision: static and DB both have `subjunctive` (different titles) → merged includes the static entry (assert by title text)
    - DB error → `{topics: <static>, isError: true}`
    - **No fetchFn** → `{topics: <static>, isError: false, isLoading: false}`
    - Sort assertion across 4 mixed-source topics
  - _Leverage: apps/web/lib/hooks/use-theory-topic.test.ts (pattern), apps/web/content/theory/es/* (real static fixtures)_
  - _Requirements: 10.3_

- [x] 19. Refactor `apps/web/components/theory/theory-toc.tsx` to consume `useTheoryTopics`
  - File: `apps/web/components/theory/theory-toc.tsx` (modify existing)
  - Drop `listTheoryTopics` import, add `useTheoryTopics` from `../../lib/hooks/use-theory-topics`, `type AuthenticatedFetch` from `@language-drill/api-client`
  - Add `fetchFn?: AuthenticatedFetch` to `TheoryTocProps` (optional — matches hook contract)
  - Replace the sync call at line 24 with `const { topics: allTopics } = useTheoryTopics({ language, fetchFn }); const others = allTopics.filter((t) => t.id !== topic.id);`
  - The downstream rendering stays unchanged
  - Run `pnpm --filter web typecheck` — this file now compiles (it was previously broken by the rename in task 13)
  - Purpose: TOC consumes merged-list hook
  - _Leverage: apps/web/components/theory/theory-toc.tsx:1-65 (current shape), apps/web/lib/hooks/use-theory-topics.ts_
  - _Requirements: 6.6_

- [x] 20. Refactor `apps/web/components/theory/theory-empty.tsx` to consume `useTheoryTopics`
  - File: `apps/web/components/theory/theory-empty.tsx` (modify existing)
  - Drop `listTheoryTopics` import, add `useTheoryTopics` from `../../lib/hooks/use-theory-topics`, `type AuthenticatedFetch` from `@language-drill/api-client`
  - Add `fetchFn?: AuthenticatedFetch` to `TheoryEmptyProps` (optional)
  - Replace the sync call at line 18 with `const { topics: others } = useTheoryTopics({ language, fetchFn });`
  - Run `pnpm --filter web typecheck` — this file now compiles
  - Purpose: empty state consumes merged-list hook
  - _Leverage: apps/web/components/theory/theory-empty.tsx:1-53 (current shape), apps/web/lib/hooks/use-theory-topics.ts_
  - _Requirements: 6.7_

- [x] 21. Refactor `apps/web/components/theory/theory-trigger.tsx` to consume `useTheoryTopic`
  - File: `apps/web/components/theory/theory-trigger.tsx` (modify existing)
  - Replace imports on lines 5–8 with: `import { type TheoryTopicId } from '../../content/theory';` plus `import { useTheoryTopic } from '../../lib/hooks/use-theory-topic';` plus `import { type AuthenticatedFetch } from '@language-drill/api-client';`
  - Add `fetchFn?: AuthenticatedFetch` to `TheoryTriggerProps` (optional)
  - Replace the sync call at line 21 with `const { topic, isLoading } = useTheoryTopic({ language, topicId, fetchFn })`
  - Render `null` while `isLoading || !topic` (preserves "no flash of broken pill" per Req 6.5)
  - Otherwise render the existing button unchanged
  - Run `pnpm --filter web typecheck` — trigger compiles; drill/page.tsx still works because the new `fetchFn` prop is optional
  - Purpose: trigger consumes hook
  - _Leverage: apps/web/components/theory/theory-trigger.tsx:1-43 (current shape), apps/web/lib/hooks/use-theory-topic.ts_
  - _Requirements: 6.5_

- [x] 22. Refactor `apps/web/components/theory/theory-panel.tsx` to consume `useTheoryTopic` + new states + pass fetchFn down
  - File: `apps/web/components/theory/theory-panel.tsx` (modify existing)
  - Update imports: drop `getTheoryTopic`, add `useTheoryTopic` from `../../lib/hooks/use-theory-topic`, `type AuthenticatedFetch` from `@language-drill/api-client`
  - Add `fetchFn?: AuthenticatedFetch` to `TheoryPanelProps` (optional)
  - Replace `const topic = getTheoryTopic(language, internalTopicId)` at line 36 with `const { topic, isLoading, isError } = useTheoryTopic({ language, topicId: internalTopicId, fetchFn })`
  - Update the render conditional at lines 126–149:
    - Keep `topic ? <body> : <TheoryEmpty>` as the **last** branch
    - Insert ahead of `<TheoryEmpty>`: `else if (!topic && isLoading) → <div className="theory-loading"><span className="t-small">loading theory…</span></div>`
    - Insert ahead of `<TheoryEmpty>`: `else if (!topic && isError) → <div className="theory-error"><span className="t-small">couldn't load theory — try again</span></div>`
  - Pass `fetchFn` to `<TheoryToc>` and `<TheoryEmpty>` (both accept optional `fetchFn` after tasks 19–20)
  - Run `pnpm --filter web typecheck` — panel compiles; everything now typechecks
  - Purpose: panel consumes hook + handles loading/error
  - _Leverage: apps/web/components/theory/theory-panel.tsx:1-154, apps/web/lib/hooks/use-theory-topic.ts_
  - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [x] 23. Plumb `fetchFn` from `apps/web/app/(dashboard)/drill/page.tsx` into trigger + panel
  - File: `apps/web/app/(dashboard)/drill/page.tsx` (modify existing)
  - `fetchFn` is already constructed at line 106 (`createAuthenticatedFetch(getToken)`)
  - Add `fetchFn={fetchFn}` to the `<TheoryTrigger ... />` JSX at line ~321
  - Add `fetchFn={fetchFn}` to the `<TheoryPanel ... />` JSX at line ~367
  - Run `pnpm --filter web typecheck && pnpm --filter web test` from repo root
  - Purpose: complete the prop chain — DB-backed topics now reachable from the panel
  - _Leverage: apps/web/app/(dashboard)/drill/page.tsx:104-368 (existing fetchFn construction + theory mount points)_
  - _Requirements: 6.1, 6.5_

- [x] 24. Verify no stale call sites of `getTheoryTopic` / `listTheoryTopics` remain
  - File: N/A — verification only
  - Run `grep -rn "getTheoryTopic\\|listTheoryTopics" apps/ packages/ --include="*.ts" --include="*.tsx"`
  - Expected: only `getStaticTheoryTopic`, `listStaticTheoryTopics`, `useTheoryTopic`, `useTheoryTopics` appear; no bare `getTheoryTopic` / `listTheoryTopics` hits anywhere
  - Run `pnpm typecheck` from repo root
  - If any stale call site found, fix and re-run
  - Purpose: confirm the rename is complete
  - _Leverage: grep, pnpm typecheck_
  - _Requirements: 7.4_

### Track 5 — Admin coverage page

- [x] 25. Scaffold `apps/web/app/(dashboard)/admin/theory/page.tsx` with apiFetch + error handling
  - File: `apps/web/app/(dashboard)/admin/theory/page.tsx`
  - Server component (RSC), no `'use client'`
  - Imports: `redirect` from `next/navigation`, `TheoryCoverageResponseSchema` from `@language-drill/api-client`, `apiFetch` from `../../../../lib/api-server`
  - Implement `async function AdminTheoryPage()`:
    - Fetch `const res = await apiFetch('/admin/theory/coverage');`
    - On 403 → `redirect('/')`
    - Parse `await res.json()` through `TheoryCoverageResponseSchema.safeParse`
    - If parse fails or `res.ok === false` → render `<div><h1>Theory Coverage</h1><p className="text-red-600">Failed to load: {err}</p></div>` (similar to `admin/generation/page.tsx:53-58`)
    - On success → render `<div><h1>Theory Coverage</h1>{/* table goes in task 26 */}</div>`
  - Stub the table-render section for now (task 26 fills it in) — render `<pre>{JSON.stringify(rows, null, 2)}</pre>` as a placeholder so the page is functional at this step
  - Purpose: get the RSC + error path + auth gate working before the table styling
  - _Leverage: apps/web/app/(dashboard)/admin/generation/page.tsx:1-46 (RSC pattern, apiFetch + 403 redirect), apps/web/lib/api-server.ts:1-32_
  - _Requirements: 8.1, 8.5, 8.6, 8.7_

- [x] 26. Render the 12-cell coverage table with badges + flagged annotation
  - File: `apps/web/app/(dashboard)/admin/theory/page.tsx` (continue from task 25)
  - Replace the `<pre>{JSON.stringify(rows)}</pre>` placeholder with a `<table>`:
    - Header row: `<tr><th>Language</th><th>A1</th><th>A2</th><th>B1</th><th>B2</th></tr>`
    - For each `language ∈ ['ES','DE','TR']`, render a `<tr>`:
      - First cell: `<td>{language}</td>`
      - For each `level ∈ ['A1','A2','B1','B2']`, find `row` where `row.language === language && row.level === level`:
        - If `row.total === 0` → `<td>—</td>` (no badge, no background)
        - Else compute badge: `✓` if `approved === total && total > 0`, `⚠` if `approved > 0 && approved < total`, `✗` if `approved === 0 && total > 0`
        - Compute bg class: `bg-green-100` for ✓, `bg-amber-100` for ⚠, `bg-red-100` for ✗
        - Render `<td className={bgClass}>{approved}/{total} {badge}{flagged > 0 && <span className="t-micro">+{flagged} flagged</span>}</td>`
  - No new CSS rules — reuse existing Tailwind utilities and the `t-micro` typography class
  - Run `pnpm --filter web typecheck && pnpm --filter web test` from repo root
  - Purpose: visualize per-cell coverage with badges and flag annotation
  - _Leverage: apps/web/app/(dashboard)/admin/generation/_components/pool-coverage-table.tsx (color-class pattern), apps/web/app/(dashboard)/admin/theory/page.tsx (continue from task 25)_
  - _Requirements: 8.2, 8.3, 8.4_

- [x] 27. Add tests for `apps/web/app/(dashboard)/admin/theory/page.tsx`
  - File: `apps/web/app/(dashboard)/admin/theory/page.test.tsx`
  - Follow the RSC test pattern at `apps/web/app/(dashboard)/page.test.tsx`: `vi.mock('../../../../lib/api-server', () => ({ apiFetch: vi.fn(...) }))`, `vi.mock('next/navigation', () => ({ redirect: vi.fn() }))`, render the page as `await AdminTheoryPage()` then `render(jsx)`
  - Cover:
    - Full coverage payload (mix of 12 rows) → assert table has the right cell text for `ES/B1` (`12/15 ✓` or similar based on stub payload)
    - One cell with `total: 0` → assert the cell renders `—` (use `screen.getAllByText('—')`)
    - One cell with `approved: 2, flagged: 1, total: 5` → assert cell contains both `2/5` and `+1 flagged`
    - `apiFetch` returns 403 → assert `redirect` was called with `/`
    - `apiFetch` returns 500 → assert error text `Failed to load:` appears
  - Purpose: lock the page's render contract and auth/error paths
  - _Leverage: apps/web/app/(dashboard)/page.test.tsx (RSC test pattern with vi.mock + @testing-library/react render)_
  - _Requirements: 10.4_

### Manual smoke

- [x] 28. Run the manual smoke test against the dev Neon branch
  - File: N/A — manual verification, documented in PR description
  - Pre-req: at least one approved row in `theory_topics` on the dev branch. If not, either:
    - Run `pnpm generate:theory --lang es --grammar-point es-b1-present-subjunctive --max-cost-usd 1.0` (requires `ANTHROPIC_API_KEY`), OR
    - Insert a seed row via Drizzle Studio using a valid `TheoryTopicJson` fixture from `packages/db/scripts/__fixtures__/claude-theory-generation/*.json`
  - Run `pnpm dev` (web + API + streaming-annotate)
  - Open the drill page for ES at B1; trigger a drill that surfaces a theory trigger; confirm:
    1. Panel opens, content renders
    2. The three hand-authored ES topics still render verbatim (no regression)
    3. The TOC shows static + (if seeded) the DB topic
    4. Unmapped-topic empty state still uses the `TheoryEmpty` styling
  - Navigate to `/admin/theory`. Confirm:
    1. 12-cell table renders
    2. ES/B1 cell reflects the seeded count
    3. Zero-curriculum cells render `—`; non-zero empty cells render `0/N`
  - Manually update a row to `review_status = 'flagged'` via Drizzle Studio; reload `/admin/theory`; confirm the `+1 flagged` annotation appears
  - Document outcomes in the PR description (which DB rows were seeded, screenshots if helpful)
  - Purpose: end-to-end verification before merge
  - _Leverage: pnpm dev, pnpm db:studio, packages/db/scripts/__fixtures__/claude-theory-generation/_
  - _Requirements: 10.7_
