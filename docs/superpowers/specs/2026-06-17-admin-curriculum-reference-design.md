# Admin Curriculum / Grammar-Point Reference (Design)

**Status:** approved · **Date:** 2026-06-17 · **Scope:** Tier 3 item #11 (read-only)

Derived from `docs/admin-panel.md` (Tier 3, item 11: "Curriculum / grammar-point management UI" — built read-only; this is also the Tier 2 §2 "Curriculum / grammar-point reference" row, which had not been built yet). A read-only reference view over the in-code curriculum. Mirrors the existing admin read surfaces (content browser, pool drill-down, audit/capacity viewers).

## Goal

Give the admin a browsable, filterable reference to the curriculum: every grammar point / umbrella per language and CEFR level, its CEFR mapping, suitability flags, coverage spec, and which generation cells (exercise types) it drives — with a deep-link into the content browser for live pool inspection. No editing, no mutations.

## Background (verified against current code)

- **Curriculum is in-code static data**, not a DB table. `@language-drill/db` exposes:
  - `ALL_CURRICULA: readonly GrammarPoint[]` — frozen concat of `esCurriculum`, `deCurriculum`, `trCurriculum` (order ES → DE → TR).
  - `getGrammarPoint(key)`, `curriculumOrderOf(key)` (0-based position within the point's OWN language array; `undefined` for unknown), `CURRICULUM_VERSION_BY_LANGUAGE: Record<'ES'|'DE'|'TR', string>`.
  - `enumerateCurriculumCells(ALL_CURRICULA): Cell[]` — one `Cell` per `(grammarPoint, exerciseType)` via `compatibleTypes(entry)`; each cell carries `{ language, cefrLevel, exerciseType, grammarPoint, cellKey }`. Grouping by `cell.grammarPoint.key` yields the exercise types a point drives.
  - All four (`ALL_CURRICULA`, `enumerateCurriculumCells`, plus the curriculum tables) are **already imported in `infra/lambda/src/routes/admin.ts`** (lines 6, 10). `getGrammarPoint`/`curriculumOrderOf`/`CURRICULUM_VERSION_BY_LANGUAGE` are exported from the same package barrel and can be added to the import.
- **`GrammarPoint` shape** (`packages/shared/src/curriculum-types.ts`): `key`, `kind` (`'grammar' | 'vocab' | 'dictation' | 'free-writing'`), `name`, `description` (≤200 chars), `cefrLevel` (`A1|A2|B1|B2`), `language` (ES|DE|TR), `examplesPositive[]` (≥2), `examplesNegative[]` (≥1, each `*`-prefixed), `commonErrors[]` (≥1), `prerequisiteKeys?[]`, `targetOverride?: number`, `clozeUnsuitable?`, `sentenceConstructionSuitable?`, `conjugationSuitable?` (booleans), `coverageSpec?: CoverageSpec`, `freeWriting?: { register: 'informal'|'neutral'|'formal' }`.
- **`CoverageSpec`** (`packages/shared/src/coverage.ts`): `{ axes: { name: CoverageAxis; floors: Partial<Record<value, number>> }[] }` where `CoverageAxis` = `'person' | 'wordClass' | 'polarity' | 'sentenceType'`.
- **Content browser deep-link target exists**: `apps/web/app/(admin)/admin/content/page.tsx` reads `searchParams` for `language` / `level` / `type` / `grammarPoint` / `q`. The pool drill-down (`generation/_components/pool-cell-detail.tsx`) already links to `/admin/content?language=…&level=…&type=…&grammarPoint=…`. We deep-link the same way (omitting `type` — a point spans multiple types).
- **Admin router / page conventions**: `/admin/*` gated by `authMiddleware + adminMiddleware`; read-list idiom (`safeParse` query → 400 `VALIDATION_ERROR`, `c.json`) is established by `/admin/audit`, `/admin/content`, `/admin/capacity`. `ADMIN_NAV` (`apps/web/components/admin/admin-nav-items.tsx`) currently `[Moderation, Content, Pool, Theory, Invites, Audit, Capacity]`; its test asserts exact order. The read-only client-page idiom (`useAuth` → `createAuthenticatedFetch` → hook → table) is the audit/capacity page; the expandable-row idiom is the content browser.

## Architecture

A new read-only **Curriculum** section at `/admin/curriculum`, one new endpoint, a `useCurriculum` hook + `schemas/curriculum.ts`, and a page. New `ADMIN_NAV` entry "Curriculum" appended last. No table, no migration, no infra change, no mutations, no DB read (curriculum is bundled in the Lambda).

```
app/(admin)/admin/curriculum/page.tsx   — client: filters + entry list with expandable detail
```

## API — `GET /admin/curriculum` (new, read-only, in `infra/lambda/src/routes/admin.ts`)

Query params (all optional; zod `safeParse` → `400 { error: 'VALIDATION_ERROR' }` on a bad enum, mirroring sibling routes):
- `language`: `'ES' | 'DE' | 'TR'`
- `level`: `'A1' | 'A2' | 'B1' | 'B2'`
- `kind`: `'grammar' | 'vocab' | 'dictation' | 'free-writing'`

Returns:
```
{
  items: CurriculumEntry[],   // filtered, sorted: language (ES→DE→TR), then curriculumOrderOf(key) asc
  total: number,              // items.length after filtering
  curriculumVersionByLanguage: { ES: string, DE: string, TR: string },
}
```
where `CurriculumEntry`:
```
{
  key: string,
  kind: 'grammar' | 'vocab' | 'dictation' | 'free-writing',
  name: string,
  description: string,
  cefrLevel: 'A1' | 'A2' | 'B1' | 'B2',
  language: 'ES' | 'DE' | 'TR',
  examplesPositive: string[],
  examplesNegative: string[],
  commonErrors: string[],
  prerequisiteKeys: string[],            // [] when absent
  targetOverride: number | null,
  clozeUnsuitable: boolean,              // normalized from optional → false when absent
  sentenceConstructionSuitable: boolean,
  conjugationSuitable: boolean,
  coverageSpec: { axes: { name: string; floors: Record<string, number> }[] } | null,
  freeWritingRegister: 'informal' | 'neutral' | 'formal' | null,
  exerciseTypes: string[],               // sorted; derived from enumerateCurriculumCells grouped by key
}
```

Implementation notes:
- Build the exercise-type map ONCE: `const cellsByKey = new Map<string, string[]>()` from `enumerateCurriculumCells(ALL_CURRICULA)`, pushing `cell.exerciseType` under `cell.grammarPoint.key`; sort each list. (Filtering happens on the curriculum list, but the cell map is built from the full curriculum so the exercise types are complete.)
- Map each `ALL_CURRICULA` entry to `CurriculumEntry`, normalizing optionals: `prerequisiteKeys ?? []`, `targetOverride ?? null`, `!!clozeUnsuitable` etc., `coverageSpec ?? null`, `freeWriting?.register ?? null`, `exerciseTypes: cellsByKey.get(key) ?? []`.
- Filter by the provided params (equality on `language` / `cefrLevel` / `kind`).
- Sort: primary by language in fixed order `['ES','DE','TR']`, secondary by `curriculumOrderOf(key) ?? Number.MAX_SAFE_INTEGER` (unknown-order last, though every shipped key resolves).
- `curriculumVersionByLanguage` = `CURRICULUM_VERSION_BY_LANGUAGE` (the `Language.ES/DE/TR` keys serialize to `'ES'/'DE'/'TR'`).
- Read-only: no DB query, no `recordAdminAction` audit write (reads are not audited).

## Web — `app/(admin)/admin/curriculum/page.tsx`

- `'use client'`; `useAuth()` → `createAuthenticatedFetch` (memoized) → `useCurriculum({ fetchFn, params })`.
- **Filters:** `language` select (All / ES / DE / TR), `level` select (All / A1 / A2 / B1 / B2), `kind` select (All / grammar / vocab / dictation / free-writing) — these drive the server `params`. Plus a **client-side text filter** on `key` + `name` (does not refetch).
- **Curriculum version** muted line from `curriculumVersionByLanguage` (show all three, or the selected language's).
- **Entry list:** one row per entry — `key`, a `kind` badge, `name`, `cefrLevel`, and flag chips shown only when set: `cloze-unsuitable`, `SC` (sentenceConstructionSuitable), `conjugation`, `coverage` (has coverageSpec), `target N` (targetOverride). Row count line (`{visible} of {total}`).
- **Expandable detail** (content-browser row idiom): `description`; positive examples; negative examples; common errors; prerequisites; coverage spec (per axis: name + floor values); free-writing register; `Drives: <exerciseTypes joined>`; and a **"View pool content →"** link to `/admin/content?language=<language>&level=<cefrLevel>&grammarPoint=<key>`.
- Loading / error / empty states (match the audit/capacity wording).
- api-client: `schemas/curriculum.ts` (`CurriculumEntrySchema`, `CurriculumResponseSchema`, exported types) + `hooks/useCurriculum.ts` (`useCurriculum({ fetchFn, params, enabled })`, `buildQueryString(params)`, query key `['admin','curriculum', params]`). Barrel-exported.

## Testing

- **Lambda** (`infra/lambda/src/routes/admin.test.ts`): this route reads `ALL_CURRICULA` directly (no `db` chain-mock needed). Assert: unfiltered returns all entries with `total === items.length`; `?language=TR` filters to TR only; `?level=A1` and `?kind=grammar` filter correctly; a bad enum (`?language=FR`) → 400 `VALIDATION_ERROR`; a known grammar entry serializes the full shape (flags normalized to booleans, `coverageSpec`/`freeWritingRegister` null-or-object, non-empty `exerciseTypes`); sort order is ES→DE→TR; `curriculumVersionByLanguage` has all three keys. Pick assertion targets by property (e.g. "every item has `kind: 'grammar'`", "the TR `present-tense`-style key resolves") rather than brittle exact counts, since the curriculum evolves.
- **api-client** (`hooks/useCurriculum.test.ts`): calls `/admin/curriculum` with no params; calls with `{ language: 'ES', kind: 'grammar' }` → asserts the querystring; parses a representative payload (incl. `coverageSpec: null` and a populated one).
- **web** (`curriculum/page` test, mock `useCurriculum` + `useAuth`): renders rows, kind badge + flag chips, expand reveals examples/coverage/exerciseTypes, the deep-link href is correct, client text filter narrows the list, empty + loading states.
- Gate: `pnpm lint`, `pnpm typecheck`, `pnpm turbo run test --concurrency=1`.

## Out of scope

- **Editing the curriculum** — it is code-defined (`packages/db/src/curriculum/*.ts`) and guarded by `assertCurriculumInvariants`; a write UI would need a runtime store and would bypass those invariants. The Tier 3 item is delivered read-only per the request.
- **Live pool counts / coverage-vs-floors** — the pool-health drill-down (`/admin/generation`) already owns that; we deep-link to `/admin/content` for per-point inspection instead of re-reading the pool.
- The thin **`skill_topics`** table — `ALL_CURRICULA` is the authoritative curriculum source; `skill_topics` carries no grammar-point semantics.

## Risks / notes

- **Curriculum churn vs. tests** — entries are added/removed regularly. Tests must assert structural/property invariants (filtering, shape, sort, normalization), not exact entry counts, to avoid breaking on every curriculum edit.
- **`kind` is not just grammar** — vocab/dictation/free-writing umbrellas appear; flags like `coverageSpec` axis applicability differ by kind. The UI shows the `kind` badge so the admin reads each row in context; the endpoint applies no kind-specific shaping beyond normalization.
- **Payload size** — the full curriculum is small (tens of entries) and static; returning everything (server-filtered) in one response is fine, and the client text filter avoids extra round-trips.
- **Language enum serialization** — `CURRICULUM_VERSION_BY_LANGUAGE` is keyed by the `Language` enum whose values are the strings `'ES'/'DE'/'TR'`, so it serializes to the documented shape with no remapping.
