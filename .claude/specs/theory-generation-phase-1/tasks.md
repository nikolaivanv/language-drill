# Implementation Plan

## Task Overview

Phase 1 ships in five thin layers, each independently mergeable:

1. **Shared types + parser** (Tasks 1–5) — `TheoryTopicJson` taxonomy, the `parseTheoryTopicJson` runtime parser, the JSON fixtures, and the parser's full test coverage. This layer is pure and has zero React, zero DB, zero network.
2. **Drizzle schema + migrations** (Tasks 6–8) — both tables in one schema file, barrel re-exports, then `pnpm db:generate` runs once to produce both migration SQL files + the journal entry.
3. **Cell-key helper** (Tasks 9–10) — `assertValidTheoryCellKey` + `buildTheoryCellKey` (mirror of `cell-key.ts`) and its tests. Independent of the schema; could land before or after Layer 2 in any order.
4. **Renderer** (Tasks 11–12) — `renderTheoryTopicJson` + its tests including the calibration test against the hand-authored `subjunctive.tsx`.
5. **Verification** (Tasks 13–15) — schema-shape test (gated on `TEST_DATABASE_URL`), manual migration apply on dev Neon, and the project-wide pre-push (`pnpm lint && pnpm typecheck && pnpm test`).

The CLI, Lambda, and panel-fallthrough integration are Phase 2/4/5 and are deliberately absent here. After Layer 5, an operator can manually `INSERT` a `theory_topics` row and prove (via the renderer test in Layer 4) that the row would render byte-equivalently to the hand-authored TSX path — this is the Phase 1 contract.

## Steering Document Compliance

- **Drizzle + JSONB + `$type<TheoryTopicJson>()`** (`tech.md` §"Database"): Tasks 6–7 mirror `exercises.ts` and `generation.ts` line-for-line; the typed-payload pattern exists already and is reused without modification.
- **Forward-only migrations** (`tech.md` §5, CLAUDE.md §"CI/CD"): Task 8 produces two `CREATE TABLE` + `CREATE INDEX` migrations against new tables — no `ALTER`, no backfill. Drizzle's journal is the idempotency mechanism.
- **Co-located tests** (CLAUDE.md §Testing): every test file (`theory.test.ts`, `theory-cell-key.test.ts`, `render-json.test.tsx`, schema `theory.test.ts`) sits next to the module it tests. No orphan test directories.
- **Shared types via `packages/shared`** (`tech.md` §"Monorepo Structure"): Task 1 places the taxonomy in shared (not in `packages/ai`) per design Component 2's cycle-avoidance rationale. Tasks 2 + 7 + 9 add barrel re-exports so consumers never reach into `lib/` or schema/ directly.
- **No new dependencies** (CLAUDE.md §"Package Management"): Phase 1 introduces zero npm packages. Drizzle, React, Vitest are already on every package this phase touches.
- **Tests-before-merge**: every code-touching task closes by running `pnpm typecheck` (always) plus `pnpm test --filter <package>` (for tasks that ship behavior). The phase-level pre-push runs in Task 15.

## Atomic Task Requirements

Each task below touches ≤ 3 files, fits in 15–30 minutes for an experienced developer, and has a single testable outcome. Tasks 4 and 11–12 are at the upper end of the box because they involve hand-transcribing JSON fixtures (Task 4) or composing recursive renderers + their assertions (Tasks 11–12); they remain single-purpose and review-friendly against the design's component definitions.

## Tasks

### Layer 1 — Shared types + parser

- [x] 1. Create `packages/shared/src/theory.ts` with the `TheoryTopicJson` taxonomy
  - File: `packages/shared/src/theory.ts` (new)
  - Define and export `TheoryInlineJson` as the wrapper-shape discriminated union per design Component 1: leaf `{ kind: 'text'; text: string }` plus four wrapper variants `{ kind: 'strong' | 'em' | 'hilite' | 'mono'; children: TheoryInlineJson[] }`.
  - Define and export `TheoryBlockJson` as the discriminated union over the five block kinds per design Component 1: `paragraph { text: TheoryInlineJson[] }`, `callout { variant?: 'default' | 'warn'; children: TheoryBlockJson[] }`, `example { target: TheoryInlineJson[]; en: string; note?: TheoryInlineJson[] }`, `list { items: TheoryBlockJson[][] }`, `'conjugation-table' { head: string[]; rows: string[][] }`.
  - Define and export `TheorySectionJson { id: string; title: string; body: TheoryBlockJson[] }`.
  - Define and export `TheoryTopicJson { id: string; title: string; subtitle: string; cefr: string; sections: TheorySectionJson[] }`.
  - Add a JSDoc block at the top naming the runtime mirror (`apps/web/components/theory/types.ts`) and the resolved decision (#11) that hand-authored TSX is NOT migrated. Do NOT export anything else yet — the parser ships in Task 3.
  - Run `pnpm typecheck --filter @language-drill/shared` and confirm zero errors.
  - Purpose: pin the taxonomy at the type level so every later task compiles against a stable surface.
  - _Leverage: `apps/web/components/theory/types.ts` (runtime mirror — same field names)_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.10_

- [x] 2. Re-export theory types from `packages/shared/src/index.ts`
  - File: `packages/shared/src/index.ts` (modify)
  - Append `export type { TheoryTopicJson, TheorySectionJson, TheoryBlockJson, TheoryInlineJson } from './theory';` in the position the existing `*.ts` re-exports would alphabetically sort (after `./read` if present).
  - Run `pnpm typecheck --filter @language-drill/shared` and confirm the new exports resolve.
  - Purpose: downstream packages (`@language-drill/ai`, `@language-drill/db`, `apps/web`) can `import type { TheoryTopicJson } from '@language-drill/shared'` without deep imports.
  - _Leverage: existing barrel pattern at `packages/shared/src/index.ts`_
  - _Requirements: 1.9_

- [x] 3. Add `parseTheoryTopicJson` to `packages/shared/src/theory.ts`
  - File: `packages/shared/src/theory.ts` (modify — continue from Task 1)
  - Add private helpers (matching the format of `parseGeneratedClozeDraft` in `packages/ai/src/generate.ts:270-330`): `isObject(value): value is Record<string, unknown>`, `requireString(raw, field, path): string` (rejects empty), `requireNonEmptyArray(raw, field, path): unknown[]` (rejects empty arrays), `requireOptionalArray(raw, field, path): unknown[] | undefined`.
  - Implement and export `parseInline(raw: unknown, path: string): TheoryInlineJson` — switches on `kind`; for `'text'` requires non-empty `text` string; for the four wrapper kinds requires non-empty `children` and recurses; throws `Invalid <path>.kind: unknown inline kind, got "<kind>"` for any other discriminator.
  - Implement and export `parseBlock(raw: unknown, path: string): TheoryBlockJson` — switches on `kind` for the five variants per design Error Handling table rows 5, 6, 7, 8, 9; for `'callout'` recurses on `children`; for `'list'` requires non-empty `items` AND each item array is non-empty; for `'conjugation-table'` enforces `rows[i].length === head.length` with the exact format `Invalid <path>.rows[<k>]: must have length <head.length> (header columns), got <row.length>`.
  - Implement and export `parseTheoryTopicJson(input: unknown): TheoryTopicJson` — the top-level walker. Validates the topic shape, requires non-empty `sections`, walks each section (validates `id` against `/^[a-z][a-z0-9-]*$/`, validates `title`, walks `body` via `parseBlock`), and after the walk checks for duplicate section ids by collecting `id → firstSeenIndex` in a `Map` and throwing on the second occurrence (per design Error Handling row 11).
  - All errors throw `Error` instances with messages in the `Invalid <path>: must be <expected>, got <JSON.stringify(value)>` format from design Error Handling (lines 422). The `path` argument seeds at `''` for the topic root and grows like `sections[2].body[1].rows[3]` as the walk descends.
  - Run `pnpm typecheck --filter @language-drill/shared` and confirm the file compiles.
  - Purpose: every JSON payload is validated against the taxonomy at the boundary; bad input fails closed with a path-prefixed message Phase 2's CLI can write to `theory_generation_jobs.error_message`.
  - _Leverage: `parseGeneratedClozeDraft` shape at `packages/ai/src/generate.ts:270-373` (helpers re-implemented locally to keep `packages/shared` standalone)_
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12_

- [x] 4. Create JSON fixtures `subjunctive.json` + `minimal.json`
  - File: `packages/db/scripts/__fixtures__/theory-json/subjunctive.json` (new)
  - File: `packages/db/scripts/__fixtures__/theory-json/minimal.json` (new)
  - For `subjunctive.json`: hand-author a `TheoryTopicJson` equivalent of `apps/web/content/theory/es/subjunctive.tsx`. Fields: `id: 'subjunctive'`, `title: 'el subjuntivo'`, `subtitle: 'present subjunctive · doubt, hope, desire, hypotheticals'`, `cefr: 'B1–B2'`, all six sections (`what`, `when`, `form-regular`, `form-irregular`, `examples`, `pitfalls`) translated block-by-block. The `what` section demonstrates nested inline (`em > strong > text` for `<em>"i suggest he <strong>be</strong> here"</em>`); the `examples` section demonstrates `note: TheoryInlineJson[]` carrying `<em>tener</em>`, `<em>venir</em>`, etc.; `form-regular` and `form-irregular` demonstrate `conjugation-table` with the verb tables; `pitfalls` demonstrates `list` with mixed-inline items; `when` demonstrates `callout` with both `default` and `warn` variants.
  - For `minimal.json`: smallest valid topic. `id: 'minimal-test'`, `title: 'minimal test topic'`, `subtitle: 'one section, one paragraph'`, `cefr: 'A1'`, `sections: [{ id: 'only', title: 'only section', body: [{ kind: 'paragraph', text: [{ kind: 'text', text: 'Just one paragraph.' }] }] }]`.
  - Both files SHALL be valid input to `parseTheoryTopicJson` (verified in Task 5's happy-path test).
  - Purpose: the calibration corpus for parser + renderer tests AND the seed material Phase 3's validator prompts will be tuned against.
  - _Leverage: `apps/web/content/theory/es/subjunctive.tsx` (the source of truth for `subjunctive.json`)_
  - _Requirements: 8.3, NFR Maintainability_

- [x] 5. Create `packages/shared/src/theory.test.ts` with parser tests
  - File: `packages/shared/src/theory.test.ts` (new)
  - Setup: load `subjunctive.json` and `minimal.json` via `JSON.parse(readFileSync(join(__dirname, '../../db/scripts/__fixtures__/theory-json/subjunctive.json'), 'utf-8'))` (use `import.meta.url` + `fileURLToPath` to derive `__dirname` per ESM convention used elsewhere in the repo).
  - Happy-path tests: (a) `parseTheoryTopicJson(subjunctiveJson)` returns a value structurally deep-equal to the input (round-trip); (b) `parseTheoryTopicJson(minimalJson)` succeeds; (c) nested-inline round-trip for the `em > strong > text` case from `subjunctive.json`.
  - Type-narrowing assertion (compile-time only): `const t: TheoryTopicJson = parseTheoryTopicJson(subjunctiveJson); expect(t.sections.length).toBeGreaterThan(0);`.
  - Rejection tests — one per row in design Error Handling table (lines 403–420). Each test mutates a clone of `minimalJson`, calls `parseTheoryTopicJson`, and asserts via `expect(() => …).toThrow(/<expected substring>/)`:
    - non-object input (number, null, array)
    - missing required field (`id`, `title`, `sections`, `body`, etc.)
    - empty `sections` → `/sections.*non-empty/`
    - empty section `body` → `/sections\[0\]\.body.*non-empty/`
    - empty `paragraph.text` array → `/sections\[0\]\.body\[0\]\.text.*non-empty/`
    - empty inline wrapper `children` (e.g. `{kind:'em',children:[]}`)
    - empty inline `text` leaf string
    - `example.target` empty / `example.en` empty string / `example.note` empty array (when present)
    - `list.items` empty / single `list.items[i]` empty array
    - `conjugation-table.head` empty / `rows` empty / row width mismatch (`/length 3.*got 2/`)
    - unknown block `kind` (e.g. `{kind:'paragraf',text:[…]}`) → `/unknown block kind/`
    - unknown inline `kind` → `/unknown inline kind/`
    - section id not kebab-case (e.g. `'Bad Id'`, `'1leading'`, `''`) → `/sections\[0\]\.id.*kebab/`
    - duplicate section ids → `/duplicates sections\[0\]\.id/`
  - Run `pnpm test --filter @language-drill/shared` and confirm all tests pass.
  - Purpose: the parser is the gate; this test file proves the gate covers every rejection condition Req 2.2–2.11 promised.
  - _Leverage: existing test pattern in `packages/shared/src/read.test.ts`_
  - _Requirements: 8.1, 8.6_

### Layer 2 — Drizzle schema + migrations

- [x] 6. Create `packages/db/src/schema/theory.ts` with both tables
  - File: `packages/db/src/schema/theory.ts` (new)
  - Imports: `pgTable, uuid, text, jsonb, real, timestamp, index, uniqueIndex, integer, numeric, boolean, check, sql` from `drizzle-orm/pg-core` and `drizzle-orm` as needed; `InferInsertModel, InferSelectModel` from `drizzle-orm`; `TheoryTopicJson` from `@language-drill/shared`.
  - Define and export `theoryTopics` per design Component 4: caller-supplied `id: uuid('id').primaryKey()` (no `defaultRandom()`); `language: text('language').notNull()`; `grammarPointKey: text('grammar_point_key').notNull()`; `topicId: text('topic_id').notNull()`; `cefrLevel: text('cefr_level').notNull()`; `contentJson: jsonb('content_json').$type<TheoryTopicJson>().notNull()`; `generationSource: text('generation_source').notNull().default('manual')`; `modelId: text('model_id')` (nullable); `qualityScore: real('quality_score')` (nullable); `reviewStatus: text('review_status').notNull().default('auto-approved')`; `flaggedReasons: jsonb('flagged_reasons')` (nullable); `generatedAt: timestamp('generated_at', { withTimezone: true })` (nullable); `createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()`; `updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()`. In the table-options callback, declare CHECK constraints via `check('theory_topics_language_check', sql\`${table.language} IN ('ES', 'DE', 'TR')\`)`, `theory_topics_cefr_check` (`A1|A2|B1|B2`), `theory_topics_generation_source_check` (`manual|claude-realtime|claude-batch`), `theory_topics_review_status_check` (`auto-approved|flagged|rejected|manual-approved`). Indices: `poolLookupIdx: uniqueIndex('theory_topics_pool_lookup_idx').on(table.language, table.grammarPointKey).where(sql\`${table.reviewStatus} IN ('auto-approved', 'manual-approved')\`)` and `panelIdx: index('theory_topics_panel_idx').on(table.language, table.topicId).where(sql\`…\`)`.
  - Define and export `theoryGenerationJobs` per design Component 5: `id: uuid('id').primaryKey()`; `cellKey: text('cell_key').notNull()`; `status: text('status').notNull()`; `trigger: text('trigger').notNull()`; `startedAt`/`finishedAt` timestamps (with-timezone); `inputTokensUsed`/`outputTokensUsed: integer(...)` nullable; `costUsdEstimate: numeric('cost_usd_estimate', { precision: 10, scale: 4 })`; `approved`/`flagged`/`rejected: boolean(...)` nullable; `errorMessage: text('error_message')`. CHECK constraints: `theory_generation_jobs_status_check` (`queued|running|succeeded|failed`), `theory_generation_jobs_trigger_check` (`cli|scheduled|admin`). Index: `cellIdx: index('theory_generation_jobs_cell_idx').on(table.cellKey, table.startedAt.desc())`.
  - Export `TheoryTopic = InferSelectModel<typeof theoryTopics>`, `NewTheoryTopic = InferInsertModel<typeof theoryTopics>`, and the same pair for `theoryGenerationJobs` (use distinct names like `TheoryGenerationJob` to avoid clashing with the runtime `TheoryTopic` from `apps/web/components/theory/types.ts` — note this is the **DB row** type, not the panel render type; add a one-line JSDoc clarifying which is which).
  - Run `pnpm typecheck --filter @language-drill/db` and confirm the file compiles.
  - Purpose: the Drizzle types Phase 2's CLI and Phase 4's scheduler will write through.
  - _Leverage: `packages/db/src/schema/exercises.ts` (column patterns) and `packages/db/src/schema/generation.ts` (audit-table patterns)_
  - _Requirements: 4.1, 4.2, 5.1, 5.2, 6.1, 6.2, 6.5, NFR Maintainability_

- [x] 7. Re-export theory tables from schema barrel and `@language-drill/db` barrel
  - File: `packages/db/src/schema/index.ts` (modify)
  - File: `packages/db/src/index.ts` (modify)
  - In `packages/db/src/schema/index.ts`: append `export * from './theory';` (matches the existing `export * from './exercises'` etc. patterns).
  - In `packages/db/src/index.ts`: add `export { theoryTopics, theoryGenerationJobs, type TheoryTopic, type NewTheoryTopic, type TheoryGenerationJob, type NewTheoryGenerationJob } from './schema/theory';` (matches existing `theoryTopics`-style explicit re-exports for `exercises`, `generationJobs`).
  - Run `pnpm typecheck --filter @language-drill/db` and confirm exports resolve.
  - Purpose: callers can `import { theoryTopics } from '@language-drill/db'` without deep imports.
  - _Leverage: existing barrel pattern at `packages/db/src/index.ts`_
  - _Requirements: 6.3_

- [x] 8. Generate migrations 0008 + 0009 via `pnpm db:generate`
  - Files (generated): `packages/db/migrations/0008_<drizzle_slug>.sql`, `packages/db/migrations/0009_<drizzle_slug>.sql`, `packages/db/migrations/meta/0008_snapshot.json`, `packages/db/migrations/meta/0009_snapshot.json`, `packages/db/migrations/meta/_journal.json` (modified)
  - Run `pnpm db:generate` from the repo root. Drizzle inspects the schema diff (Task 6 added two new tables) and produces two migration files plus the snapshot + journal updates.
  - Open both generated SQL files and verify they match Requirements 4.1–4.2 and 5.1–5.2: `theory_topics` has all 14 columns + the unique partial index on `(language, grammar_point_key)` filtered by `review_status IN ('auto-approved', 'manual-approved')` + the panel index + the four CHECK constraints; `theory_generation_jobs` has all 13 columns + the cell-key descending index + the two CHECK constraints. If Drizzle generated unexpected SQL (e.g. missed a CHECK), fix the schema in Task 6 and re-run.
  - Run `pnpm typecheck` from the repo root to confirm no breakage.
  - Commit all generated files together (the journal alone without the SQL would be invalid).
  - Purpose: the migrations are the authoritative DB shape.
  - _Leverage: existing migration pattern in `packages/db/migrations/0004_sharp_quentin_quire.sql` (the partial-index syntax reference)_
  - _Requirements: 4.1, 4.2, 4.4, 5.1, 5.2, 5.3, 6.4_

### Layer 3 — Cell-key helper

- [x] 9. Create `packages/db/src/lib/theory-cell-key.ts` and re-export from `@language-drill/db`
  - File: `packages/db/src/lib/theory-cell-key.ts` (new)
  - File: `packages/db/src/index.ts` (modify)
  - In `theory-cell-key.ts`: define and export `THEORY_CELL_KEY_REGEX = /^(es|de|tr):(a1|a2|b1|b2):[a-z]{2}-[a-z0-9]+-[a-z0-9-]+$/` (lowercase alternation matching `CELL_KEY_REGEX`'s convention in `cell-key.ts:22`); `assertValidTheoryCellKey(cellKey: string): void` that throws `Error(\`Invalid theory cell key: ${JSON.stringify(cellKey)}\`)` on regex mismatch; `buildTheoryCellKey(parts: { language: string; cefrLevel: string; grammarPointKey: string }): string` that lowercases each segment before joining with `:` AND calls `assertValidTheoryCellKey` on its own output (defense-in-depth, matching `buildCellKey`'s pattern in `cell-key.ts:42-48`). Add a JSDoc comment explaining the `<lang>:<level>:<grammar_point_key>` format and the lowercasing convention.
  - In `packages/db/src/index.ts`: append `export { THEORY_CELL_KEY_REGEX, assertValidTheoryCellKey, buildTheoryCellKey } from './lib/theory-cell-key';`.
  - Run `pnpm typecheck --filter @language-drill/db` and confirm both files compile and the new exports resolve.
  - Purpose: single source of truth for the `theory_generation_jobs.cell_key` format; first caller is Phase 2's CLI.
  - _Leverage: `packages/db/src/lib/cell-key.ts` (line-for-line structural mirror)_
  - _Requirements: 7.1, 7.2, 7.3_

- [x] 10. Create `packages/db/src/lib/theory-cell-key.test.ts`
  - File: `packages/db/src/lib/theory-cell-key.test.ts` (new)
  - Tests: (a) `assertValidTheoryCellKey('es:b1:es-b1-present-subjunctive')` returns without throwing; (b) `assertValidTheoryCellKey('de:a2:de-a2-akkusativ')` returns without throwing; (c) all of these throw — missing language segment, missing level segment, missing grammar-point segment, non-`es|de|tr` language, non-`a1|a2|b1|b2` level, malformed grammar-point key (e.g. uppercase, special chars); (d) the negative case asserting an exercise cell key (`'es:b1:cloze:es-b1-present-subjunctive'`) is rejected — theory keys have no exercise-type segment; (e) `buildTheoryCellKey({ language: 'ES', cefrLevel: 'B1', grammarPointKey: 'es-b1-present-subjunctive' })` returns `'es:b1:es-b1-present-subjunctive'` (uppercase enums lowercased); (f) `buildTheoryCellKey` calls `assertValidTheoryCellKey` on its output (test by passing inputs that would produce a malformed key and asserting it throws — e.g. an empty `grammarPointKey` would lowercase but still fail the regex, so the build throws).
  - Run `pnpm test --filter @language-drill/db -t theory-cell-key` and confirm all tests pass.
  - Purpose: the helper's contract is enforced; first caller (Phase 2 CLI) inherits a tested boundary.
  - _Leverage: existing test pattern in `packages/db/src/lib/cell-key.test.ts`_
  - _Requirements: 7.4, 8.5_

### Layer 4 — Renderer

- [x] 11. Create `apps/web/components/theory/render-json.tsx`
  - File: `apps/web/components/theory/render-json.tsx` (new)
  - Imports: `TheoryTopicJson, TheorySectionJson, TheoryBlockJson, TheoryInlineJson` from `@language-drill/shared`; `TheoryTopic, TheorySection` from `./types`; `Callout, Example, Hilite, Mono, TheoryList, ConjugationTable` from `./primitives`; `React` for the JSX.
  - Implement and export `renderTheoryTopicJson(topic: TheoryTopicJson): TheoryTopic` — top-level function that maps `topic.sections` through `renderSection` and returns `{ id, title, subtitle, cefr, sections }`. Section ids are passed through byte-for-byte (Req 3.11).
  - Implement private `renderSection(section: TheorySectionJson): TheorySection` returning `{ id: section.id, title: section.title, body: <>{section.body.map((block, i) => renderBlock(block, i))}</> }`.
  - Implement private `renderBlock(block: TheoryBlockJson, key: number): React.ReactNode` — exhaustive switch on `block.kind`:
    - `'paragraph'` → `<p key={key}>{block.text.map((inline, j) => renderInline(inline, j))}</p>`
    - `'callout'` → `<Callout key={key} variant={block.variant ?? 'default'}>{block.children.map((b, j) => renderBlock(b, j))}</Callout>` (note: pass `'default'` explicitly only if the primitive needs it — `Callout`'s default prop is already `'default'`, so passing `block.variant` directly is sufficient)
    - `'example'` → `<Example key={key}><Example.ES>{block.target.map((inline, j) => renderInline(inline, j))}</Example.ES><Example.EN>{block.en}</Example.EN>{block.note && <Example.Note>{block.note.map((inline, j) => renderInline(inline, j))}</Example.Note>}</Example>`
    - `'list'` → `<TheoryList key={key}>{block.items.map((item, j) => <li key={j}>{item.map((b, k) => renderBlock(b, k))}</li>)}</TheoryList>`
    - `'conjugation-table'` → `<ConjugationTable key={key}><thead><tr>{block.head.map((h, j) => <th key={j}>{h}</th>)}</tr></thead><tbody>{block.rows.map((row, j) => <tr key={j}>{row.map((c, k) => <td key={k}>{c}</td>)}</tr>)}</tbody></ConjugationTable>`
    - default arm: `const _exhaustive: never = block; throw new Error(\`Unknown block kind: ${(_exhaustive as TheoryBlockJson).kind}\`)`
  - Implement private `renderInline(inline: TheoryInlineJson, key: number): React.ReactNode` — exhaustive switch on `inline.kind`:
    - `'text'` → returns the raw `inline.text` string (no wrapper). React keys not needed for plain strings; the parent's `.map(..., j)` provides the key.
    - `'strong'` → `<strong key={key}>{inline.children.map((c, j) => renderInline(c, j))}</strong>`
    - `'em'` → `<em key={key}>{inline.children.map(...)}</em>`
    - `'hilite'` → `<Hilite key={key}>{inline.children.map(...)}</Hilite>`
    - `'mono'` → `<Mono key={key}>{inline.children.map(...)}</Mono>`
    - default arm: `const _exhaustive: never = inline; throw new Error(\`Unknown inline kind: ${(_exhaustive as TheoryInlineJson).kind}\`)`
  - The renderer SHALL NOT emit `<section id={...}>` wrappers — that's the panel's job (Req 3.12). Sections in the returned `TheoryTopic` carry their `body` as a fragment of children only.
  - Pure: no `useState`, no `useEffect`, no `useMemo`. Calling twice with the same input produces structurally identical React trees.
  - Run `pnpm typecheck --filter @language-drill/web` and confirm zero errors.
  - Purpose: the bridge between DB-stored JSON and the existing panel primitives. Phase 5's panel registry fallthrough will call this directly.
  - _Leverage: `apps/web/components/theory/primitives.tsx` (every primitive used as-is, no signature changes); `apps/web/components/theory/types.ts` (return type)_
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12_

- [x] 12. Create `apps/web/components/theory/__tests__/render-json.test.tsx`
  - File: `apps/web/components/theory/__tests__/render-json.test.tsx` (new)
  - Setup: load `subjunctive.json` and `minimal.json` via `fs.readFileSync(path.join(__dirname, '../../../../../packages/db/scripts/__fixtures__/theory-json/<file>.json'), 'utf-8')` then `JSON.parse`. Use `parseTheoryTopicJson` to validate before rendering (so the test's "render the fixture" path also exercises the parser end-to-end on real data).
  - Happy-path render: pipe the parsed `subjunctive.json` through `renderTheoryTopicJson` and `render(<>{topic.sections[i].body}</>)` for each section index in `[0..5]` — assert no React error throws.
  - Targeted DOM assertions per Req 8.2:
    - (a) `Callout variant="warn"`: render the `when` section (which contains the WEIRDO callout with `variant: 'warn'` per Task 4) and assert `screen.getByText(/WEIRDO/).closest('.callout')?.classList.contains('warn')`.
    - (b) `Example` with note (subjunctive prototype): render the `examples` section, assert `<Example.Note>` exists and contains an `<em>` element with text `'tener'` — `expect(screen.getByText('tener').tagName).toBe('EM')` and the parent has class `example-note`.
    - (b') `Example` without note: construct a small inline `TheoryTopicJson` fixture with one example missing `note`, render, assert `screen.queryByText(/example-note/)` is null OR no element with class `.example-note` is present.
    - (c) `ConjugationTable`: render the `form-regular` section (the -AR/-ER/-IR table from Task 4), assert exactly 4 `<th>` elements, 7 `<tr>` elements (1 head + 6 body), and 24 `<td>` elements (6 rows × 4 cols).
    - (d) `TheoryList`: render the `pitfalls` section, assert the rendered `<ul class="theory-list">` has 4 `<li>` children matching the 4 pitfalls in the fixture.
    - (e) Inline `hilite`: assert `screen.getAllByText(/[a-z]+/).some(el => el.classList.contains('hilite'))` — at least one rendered element from the fixture carries the `hilite` class (the `<Hilite>` primitive wraps in `<span class="hilite">`).
    - (f) Nested inline (`em > strong`): construct a small fixture `{ kind: 'em', children: [{ kind: 'text', text: '...' }, { kind: 'strong', children: [{ kind: 'text', text: 'be' }] }, ...] }` and assert the rendered DOM contains `<em>...<strong>be</strong>...</em>` — query the `<strong>` and check `el.parentElement?.tagName === 'EM'`.
  - Calibration test (Req 8.3): the `subjunctive.json` rendered output's text content includes the anchors `WEIRDO`, `opposite vowel`, `DISHES`, `subjunctive of` (from the various sections). One `it()` block per anchor using `screen.getByText(...)` so a regression on any of them surfaces a clear failure name.
  - Run `pnpm test --filter @language-drill/web -t render-json` and confirm all tests pass.
  - Purpose: prove the renderer is byte-equivalent to the hand-authored TSX path for the canonical case AND that every taxonomy variant renders correctly.
  - _Leverage: existing test pattern in `apps/web/components/theory/__tests__/theory-panel.test.tsx`_
  - _Requirements: 8.2, 8.3, 9.1, 9.2, 9.3_

### Layer 5 — Verification

- [x] 13. Create `packages/db/src/schema/theory.test.ts` (skipped without `TEST_DATABASE_URL`)
  - File: `packages/db/src/schema/theory.test.ts` (new)
  - Use `describe.skipIf(!process.env.TEST_DATABASE_URL)` for the DB-touching block — matches the pattern in `seed-exercises.test.ts`.
  - Setup: `const db = createDb(process.env.TEST_DATABASE_URL!)`. Run migrations to ensure 0008 and 0009 are applied (or rely on the test runner having migrated already — match whatever pattern `seed-exercises.test.ts` uses).
  - Tests:
    - Query `information_schema.columns WHERE table_name = 'theory_topics'`, assert all 14 columns exist with the expected `data_type` and `is_nullable` per Req 4.1.
    - Query `information_schema.columns WHERE table_name = 'theory_generation_jobs'`, assert all 13 columns per Req 5.1.
    - Query `pg_indexes WHERE tablename = 'theory_topics'`, assert both `theory_topics_pool_lookup_idx` and `theory_topics_panel_idx` exist.
    - CHECK constraint exercise: attempt `INSERT INTO theory_topics (id, language, ...) VALUES (..., 'FR', ...)` and assert the language-check fails with a constraint-violation error containing the constraint name. Same for an invalid `cefr_level`, an invalid `generation_source`, an invalid `review_status`.
    - Unique partial index exercise: `INSERT` one row with `language='ES', grammar_point_key='es-b1-test', review_status='auto-approved'`, then `INSERT` a second row with the same `language` + `grammar_point_key` + `review_status='auto-approved'` — assert the second fails with a unique-violation. Then `INSERT` a third row with `review_status='rejected'` — assert it succeeds (the partial index excludes it).
  - Run `pnpm test --filter @language-drill/db -t theory.schema` (or whatever test name pattern the new file uses) — without `TEST_DATABASE_URL` the suite skips and the run still passes.
  - Purpose: catch the case where the migration SQL drifts from the schema TS or where Drizzle's generator produces unexpected SQL.
  - _Leverage: `packages/db/scripts/seed-exercises.test.ts` (`describe.skipIf` pattern)_
  - _Requirements: 4.3, 8.4_

- [x] 14. Apply migrations to dev Neon branch and verify indices manually
  - No new files — this is a runbook step.
  - Set `DATABASE_URL` to the dev Neon branch's connection string (use the existing `.env` or override at the command line).
  - Run `pnpm db:migrate` from the repo root. Confirm both `0008` and `0009` apply without error (Drizzle journal advances by two entries).
  - Open `psql` against the same connection string. Verify with `\d theory_topics`: both indices appear (`theory_topics_pool_lookup_idx UNIQUE`, `theory_topics_panel_idx`); all four CHECK constraints appear; column types match Req 4.1.
  - Verify with `\d theory_generation_jobs`: the cell-key descending index appears; both CHECK constraints appear; column types match Req 5.1.
  - Manual constraint test (matches the schema-test in Task 13 but executed by hand for the PR description):
    - `INSERT INTO theory_topics (id, language, grammar_point_key, topic_id, cefr_level, content_json) VALUES (gen_random_uuid(), 'ES', 'es-b1-test-cell', 'b1-test-cell', 'B1', '{"id":"b1-test-cell","title":"x","subtitle":"x","cefr":"B1","sections":[{"id":"s","title":"s","body":[{"kind":"paragraph","text":[{"kind":"text","text":"hello"}]}]}]}'::jsonb);` — assert returns 1 row.
    - Repeat the insert with a different UUID — assert it fails with the unique partial index violation (`duplicate key value violates unique constraint "theory_topics_pool_lookup_idx"`).
    - `INSERT … review_status='rejected' …` — assert it succeeds (the partial index excludes rejected rows).
    - `INSERT … language='FR' …` — assert it fails with the language CHECK constraint.
  - Document the verification commands and their outputs in the PR description (per Req 4.3 — "verification commands SHALL be documented in the task's verify step so a reviewer can reproduce").
  - Purpose: prove the migrations behave as designed against a real Postgres before the PR ships. CI will re-run the migration on the production Neon branch via `.github/workflows/deploy.yml`; this manual run de-risks that path.
  - _Leverage: `pnpm db:migrate` script and existing dev Neon branch setup_
  - _Requirements: 4.3, 4.4_

- [x] 15. Pre-push checks — `pnpm lint && pnpm typecheck && pnpm test` from repo root
  - No new files — this is the project-wide pre-push gate per CLAUDE.md.
  - Run the three commands sequentially from the repo root. Confirm all three exit zero.
  - If `pnpm lint` flags formatting on any file from this phase, fix in place and re-run.
  - If `pnpm typecheck` surfaces a cross-package issue (e.g. `apps/web` can't see `TheoryTopicJson` because Task 2's barrel export was missed), revisit the relevant earlier task.
  - If `pnpm test` shows any failures, fix in the relevant test file and re-run.
  - Purpose: the one mandatory pre-merge gate. Phase 1 ships only when this is green.
  - _Leverage: existing CI gate at `.github/workflows/deploy.yml`_
  - _Requirements: 8.6, NFR Reliability_
