# Requirements Document

## Introduction

This spec implements **Phase 1 — Schema, output type, renderer** from `docs/theory-generation-plan.md`. Phase 1 is the data foundation for theory content generation: it defines the JSON-serializable shape Claude will emit (`TheoryTopicJson`), creates the database tables that store generated theory pages and their audit trail, and ships the React renderer that turns that JSON back into the existing Theory Panel primitives.

This is the smallest phase in the plan (~1.5d), and intentionally so: nothing in Phase 1 calls Claude, contacts the network, or changes user-visible UI. The phase exists to make Phases 2–5 mechanical to write — once the shape, the storage, and the rendering path are pinned, the generator (Phase 2), validator (Phase 3), Lambda + scheduler (Phase 4), and panel integration (Phase 5) can each be added as additive layers without revisiting any decisions made here.

After this phase:

- `TheoryTopicJson` is importable from `@language-drill/shared` for both the future generator (`packages/ai`, Phase 2) and the renderer (web).
- A `theory_topics` row inserted manually via `psql` renders identically to a hand-authored TSX file when fetched through the renderer.
- The `theory_generation_jobs` audit table accepts cell rows with the same column contract Phase 4's scheduler will write.
- Migrations 0008 and 0009 are applied to the dev Neon branch and the partial pool-lookup index has been verified to be hit (`\d theory_topics` shows the index; an attempted second `auto-approved` insert for the same cell fails with a unique-constraint violation).

Per resolved decision #10 in the plan, topic ids retain the CEFR level prefix (`b1-present-subjunctive`, not `present-subjunctive`) so cross-level grammar points with the same root slug stay distinct. Per resolved decision #11, the three hand-authored TSX files in `apps/web/content/theory/es/` are NOT migrated; they remain as the panel's editorial-override path. Per resolved decision #12, the parser rejects empty content (empty inline arrays, empty section bodies, zero-section topics) at parse time — the contract is enforced at the boundary, not at render time.

### Files added or modified by this phase

```
packages/shared/src/theory.ts                              (new)  — TheoryTopicJson + block/inline taxonomy + parser
packages/shared/src/theory.test.ts                         (new)  — parser unit tests
packages/shared/src/index.ts                               (mod)  — re-export theory types and parser

apps/web/components/theory/render-json.tsx                 (new)  — TheoryTopicJson → TheoryTopic
apps/web/components/theory/__tests__/render-json.test.tsx  (new)

packages/db/migrations/0008_<drizzle_slug>.sql             (new)  — theory_topics table + indices
packages/db/migrations/0009_<drizzle_slug>.sql             (new)  — theory_generation_jobs table + index
packages/db/migrations/meta/0008_snapshot.json             (new)  — Drizzle generated
packages/db/migrations/meta/0009_snapshot.json             (new)  — Drizzle generated
packages/db/migrations/meta/_journal.json                  (mod)  — Drizzle generated

packages/db/src/schema/theory.ts                           (new)  — Drizzle table definitions
packages/db/src/schema/theory.test.ts                      (new)  — schema-shape regression test
packages/db/src/schema/index.ts                            (mod)  — export theory tables
packages/db/src/lib/theory-cell-key.ts                     (new)  — assertValidTheoryCellKey helper
packages/db/src/lib/theory-cell-key.test.ts                (new)

packages/db/scripts/__fixtures__/theory-json/{subjunctive,minimal}.json (new) — calibration fixtures used by renderer + parser tests
```

### Out of scope (this phase)

These are explicitly deferred and SHALL NOT be implemented here:

- **The generator** (`packages/ai/src/theory-generate.ts`, the tool schema, prompts, deterministic IDs, mock-client fixtures) — Phase 2.
- **The validator** (`packages/ai/src/theory-validate.ts`, routing rules, `quality_score` writes) — Phase 3.
- **CLI** (`packages/db/scripts/generate-theory.ts`, argument parser, summary printer) — Phase 2.
- **Per-cell orchestration** (`packages/db/src/theory-generation/run-one-cell.ts`) — Phase 2.
- **Lambda + scheduler** (`infra/lambda/src/theory-generation/`) — Phase 4.
- **Panel registry fallback** (the async `getTheoryTopic` fallthrough to DB, the `useTheoryTopic` TanStack hook, the new `GET /theory/:lang/:topicId` route) — Phase 5.
- **Admin coverage tile** — Phase 5.
- **Migration of the three hand-authored ES TSX files into the DB** — explicitly NOT done (resolved decision #11). They stay as the panel's editorial override.
- **Tooling that reads or writes `theory_topics` rows.** Phase 1 ships the schema, the renderer, and the parser only. The first writer is Phase 2's CLI; the first read path (other than the renderer's tests) is Phase 5's panel integration.
- **Inline link, line-break, or code-span variants** on `TheoryInlineJson`. The three v1 ES topics never use them; adding them is mechanical when needed (one variant on the union, one switch arm in the renderer + parser).

## Alignment with Product Vision

The product is positioned (`product.md` §2) as **"what you do between italki sessions"** for intermediate learners stuck at the plateau. The Theory Panel (shipped per `.claude/specs/theory-panel/`) is the in-context reference learners reach for when a drill stumps them; without it, the only escape is closing the tab and Googling. Today that panel ships with three hand-authored ES topics and zero DE/TR coverage — enough to validate the UI, nowhere near enough to be load-bearing for a learner working through 60+ B1 grammar points.

This phase delivers the load-bearing pieces of the **content scale-out** strategy from `docs/theory-generation-plan.md`:

- **Structured JSON, not TSX, as the canonical generator output** (plan §3, "Output: structured JSON, not TSX"). Generating freeform TSX would throw away the gating mechanism (tool-use with strict schemas) that makes the exercise generator reliable. Defining `TheoryTopicJson` here pins that decision in code.
- **DB-backed storage as the v2 evolution** (`web-implementation-plan.md` §H — "Move to DB-stored Claude-generated content later"). The `theory_topics` table and partial pool-lookup index ship now so Phase 5's panel integration is a one-line lookup change rather than a schema design.
- **Audit trail parity with exercise generation** (plan §3, reuse map). `theory_generation_jobs` mirrors `generation_jobs` (shipped in exercise-gen Phase 1) so the cost dashboard in `apps/web/app/(dashboard)/admin/generation/` extends trivially in Phase 5 to surface theory coverage alongside exercise pool depth.

This phase reinforces three differentiators from `CLAUDE.md`:

1. **Skill-based mastery, not content consumption** — the schema is keyed on `(language, grammar_point_key)` from the curriculum that already drives exercise generation. One source of truth for what counts as a "topic" across the app.
2. **Pre-generated content reuse** — generated theory is read by every learner; the cost of a topic page is paid once. The unique partial index `theory_topics_pool_lookup_idx` (one approved row per cell) is the schema-level guarantee.
3. **Cost-controlled** — `theory_generation_jobs` records token + cost per cell, so the existing pattern (operator queries `generation_jobs` for "$ spent this week") extends to theory without new tooling.

## Requirements

### Requirement 1 — `TheoryTopicJson` type

**User Story:** As Phase 2's generator, I want a single typed `TheoryTopicJson` that mirrors the runtime `TheoryTopic` shape but carries no React types, so that the same shape can be emitted as Claude tool-use input, validated by the parser, stored as `JSONB` in the DB, and rehydrated by the renderer without circular imports between `packages/ai`, `packages/db`, and `apps/web`.

#### Acceptance Criteria

1. WHEN the codebase is built THEN `packages/shared/src/theory.ts` SHALL export the type `TheoryTopicJson` with fields `id: string`, `title: string`, `subtitle: string`, `cefr: string`, `sections: TheorySectionJson[]` — structurally compatible with the existing runtime `TheoryTopic` from `apps/web/components/theory/types.ts` (same field names, JSON-only `body`).
2. WHEN the codebase is built THEN `packages/shared/src/theory.ts` SHALL export `TheorySectionJson` with `id: string`, `title: string`, `body: TheoryBlockJson[]`.
3. WHEN the codebase is built THEN `packages/shared/src/theory.ts` SHALL export `TheoryBlockJson` as a discriminated union over `kind` covering: `'paragraph'`, `'callout'`, `'example'`, `'list'`, `'conjugation-table'`. Every block used in the prototype (`apps/web/content/theory/es/subjunctive.tsx`, `apps/web/content/theory/es/preterite-imperfect.tsx`) SHALL be representable through this union.
4. WHEN the codebase is built THEN `packages/shared/src/theory.ts` SHALL export `TheoryInlineJson` as a discriminated union over `kind` covering: a leaf `'text'` variant carrying `text: string`, plus four wrapper variants `'strong'`, `'em'`, `'hilite'`, `'mono'`, each carrying `children: TheoryInlineJson[]`. The wrapper shape supports nested inline emphasis (the prototype's `<em>"i suggest he <strong>be</strong> here"</em>` in `apps/web/content/theory/es/subjunctive.tsx` lines 28–36) without lossy flattening. The Phase-1 union deliberately omits `'a'` (links), `'br'`, and `'code'` — the three v1 ES topics never use them.
5. WHEN the type `TheoryBlockJson.callout` is built THEN it SHALL allow an optional `variant: 'default' | 'warn'` field (matching `Callout`'s prop in `apps/web/components/theory/primitives.tsx`).
6. WHEN the type `TheoryBlockJson.example` is built THEN it SHALL have fields `target: TheoryInlineJson[]` (target-language line, can carry `<Hilite>`), `en: string` (translation, plain string — the prototype's `<Example.EN>` is always plain text), and optional `note?: TheoryInlineJson[]` (the prototype's `<Example.Note>` carries `<em>` for verb names, e.g. `<em>tener</em>` in `subjunctive.tsx` line 247 — so `note` must accept inline content, not a plain string).
7. WHEN the type `TheoryBlockJson.list` is built THEN it SHALL have field `items: TheoryBlockJson[][]` — each list item is itself an array of blocks. (Required: list items in the `pitfalls` section of the subjunctive prototype contain a paragraph with mixed `<strong>` + `<Mono>`.)
8. WHEN the type `TheoryBlockJson['conjugation-table']` is built THEN it SHALL have fields `head: string[]` (column headers; first column is the row-label column and may be the empty string `""`) and `rows: string[][]` (each row's cells; first cell is the row label).
9. WHEN the codebase is built THEN `packages/shared/src/index.ts` SHALL re-export `TheoryTopicJson`, `TheorySectionJson`, `TheoryBlockJson`, `TheoryInlineJson` so all three downstream packages (`@language-drill/ai`, `@language-drill/db`, `apps/web`) can import without deep imports.
10. WHEN `pnpm typecheck` is run THEN there SHALL be no `any` in the new type declarations and the `kind` discriminator SHALL force exhaustive switching at the renderer (Requirement 3) and the parser (Requirement 2).

### Requirement 2 — `parseTheoryTopicJson` runtime parser

**User Story:** As Phase 2's generator, I want a runtime parser that validates Claude's tool-use input against the `TheoryTopicJson` shape and throws field-level errors on any mismatch, so that bad output is rejected at the boundary rather than producing renderer crashes downstream.

#### Acceptance Criteria

1. WHEN the codebase is built THEN `packages/shared/src/theory.ts` SHALL export `parseTheoryTopicJson(input: unknown): TheoryTopicJson` that returns the parsed value or throws `Error` with an `Invalid <field>: must be <expected>, got <JSON.stringify(value)>` message — matching the format used by `parseGeneratedClozeDraft` in `packages/ai/src/generate.ts`.
2. WHEN the parser is called with a value missing a required field THEN it SHALL throw naming the missing field.
3. WHEN the parser is called with a value where `sections` is empty THEN it SHALL throw `Invalid sections: must be a non-empty array, got []` (resolved decision #12).
4. WHEN the parser encounters a section body where `body` is empty THEN it SHALL throw naming the offending section index (`Invalid sections[<i>].body: must be a non-empty array, got []`).
5. WHEN the parser encounters a `paragraph` block where `text` is empty OR an inline wrapper variant (`strong`/`em`/`hilite`/`mono`) where `children` is empty OR an inline `text` leaf where the `text` string is empty THEN it SHALL throw naming the path (e.g., `Invalid sections[<i>].body[<j>].text: must be a non-empty array, got []`, `Invalid sections[<i>].body[<j>].text[<k>].children: must be a non-empty array, got []`).
6. WHEN the parser encounters an `example` block where `target` is empty OR `en` is an empty string OR `note` (when present) is an empty array THEN it SHALL throw naming the path — empty content is rejected at the boundary regardless of whether the field is an array or a string.
7. WHEN the parser encounters a `list` block where `items` is empty OR any item array is empty THEN it SHALL throw naming the path.
8. WHEN the parser encounters a `conjugation-table` block where `head` is empty, `rows` is empty, or `rows[i].length !== head.length` for any row THEN it SHALL throw — width mismatch is the most common Claude error mode for tables. The error SHALL name the offending row index and both lengths.
9. WHEN the parser encounters an unknown `kind` discriminator (block or inline) THEN it SHALL throw naming the unknown kind and the path.
10. WHEN the parser encounters a section id that's not a non-empty kebab-case string (`/^[a-z][a-z0-9-]*$/`) THEN it SHALL throw — section ids become DOM anchors in the renderer.
11. WHEN the parser encounters duplicate section ids within a single topic THEN it SHALL throw naming both indices — the scroll-spy hook depends on unique anchors.
12. WHEN the parser succeeds THEN the returned value SHALL be type-narrowed to `TheoryTopicJson` (the function signature returns the type, not `unknown`).

### Requirement 3 — Renderer

**User Story:** As Phase 5's panel integration, I want a pure function `renderTheoryTopicJson(topic): TheoryTopic` that produces the existing runtime `TheoryTopic` (with `React.ReactNode` bodies) using only the existing primitives in `apps/web/components/theory/primitives.tsx`, so that DB-stored topics render identically to hand-authored TSX without panel changes.

#### Acceptance Criteria

1. WHEN the codebase is built THEN `apps/web/components/theory/render-json.tsx` SHALL export `renderTheoryTopicJson(topic: TheoryTopicJson): TheoryTopic` that walks the JSON and produces a runtime `TheoryTopic` whose `sections[i].body` is JSX composed from existing primitives.
2. WHEN the renderer encounters a `paragraph` block THEN it SHALL render `<p>{text.map(renderInline)}</p>`.
3. WHEN the renderer encounters a `callout` block THEN it SHALL render `<Callout variant={variant}>{children.map(renderBlock)}</Callout>` using the existing `Callout` primitive — supports both `'default'` (the omitted-variant case) and `'warn'`.
4. WHEN the renderer encounters an `example` block THEN it SHALL render `<Example><Example.ES>{target.map(renderInline)}</Example.ES><Example.EN>{en}</Example.EN>{note && <Example.Note>{note.map(renderInline)}</Example.Note>}</Example>` using the existing `Example` primitive — `note` is a `TheoryInlineJson[]`, walked through the same inline renderer as `target`.
5. WHEN the renderer encounters a `list` block THEN it SHALL render `<TheoryList>{items.map(item => <li>{item.map(renderBlock)}</li>)}</TheoryList>` using the existing `TheoryList` primitive.
6. WHEN the renderer encounters a `conjugation-table` block THEN it SHALL render `<ConjugationTable><thead><tr>{head.map(h => <th>{h}</th>)}</tr></thead><tbody>{rows.map(r => <tr>{r.map(c => <td>{c}</td>)}</tr>)}</tbody></ConjugationTable>` using the existing `ConjugationTable` primitive. The first column is the row label per Req 1.8 (rendered as `<td>`, matching how the prototype handles the row-label column).
7. WHEN the renderer encounters an inline `text` leaf THEN it SHALL render the raw string (no wrapper). For wrapper variants `strong`, `em`, `hilite`, `mono` it SHALL render `<strong>{children.map(renderInline)}</strong>`, `<em>{...}</em>`, `<Hilite>{...}</Hilite>`, `<Mono>{...}</Mono>` respectively — recursing into `children` so nested inline (e.g. `<em>` containing `<strong>`) renders correctly.
8. WHEN the renderer encounters a block kind not in the union (which TypeScript should make impossible) THEN the exhaustive switch SHALL throw `Unknown block kind: <kind>` so future taxonomy extensions surface immediately if the renderer isn't updated.
9. WHEN the renderer is called THEN every JSX element rendered in a list (block array, inline array, list items, table rows, table cells) SHALL receive a stable `key` derived from its index in the source array — React's reconciler needs them.
10. WHEN the renderer is called THEN it SHALL be a pure function (no hooks, no effects, no React state). Synchronous, deterministic — the same JSON produces the same React tree.
11. WHEN the renderer's output's `sections[i].id` is read THEN it SHALL equal the `TheorySectionJson.id` byte-for-byte — the section id is not transformed, normalized, or re-derived. The scroll-spy depends on this equality.
12. WHEN the renderer is called THEN it SHALL NOT emit `<section id={...}>` wrappers around section bodies — that wrapping is the panel's responsibility (`apps/web/components/theory/theory-content.tsx` already wraps each section). The renderer's output is exactly a `TheoryTopic` — section bodies are JSX trees, not pre-wrapped sections. This keeps the panel's existing scroll-spy + section markup behavior unchanged.

### Requirement 4 — `theory_topics` schema migration

**User Story:** As Phase 2's CLI, I want a `theory_topics` table that stores generated pages with the columns Phase 4's scheduler can query and Phase 5's read path can serve, so that adding new generated rows is one INSERT and reading them is one SELECT against an existing index.

#### Acceptance Criteria

1. WHEN `pnpm db:migrate` is run THEN migration `0008` SHALL create a table `theory_topics` with the following columns and types:
   - `id UUID PRIMARY KEY` — deterministic from `(language, grammar_point_key, batch_seed)`, derived in Phase 2
   - `language TEXT NOT NULL` — `'ES' | 'DE' | 'TR'`; CHECK constraint enforcing the enum
   - `grammar_point_key TEXT NOT NULL` — string-FK to curriculum module, e.g. `'es-b1-present-subjunctive'`
   - `topic_id TEXT NOT NULL` — kebab-case panel-facing slug, e.g. `'b1-present-subjunctive'` (Phase 2 derives this from `grammar_point_key`; Phase 1 just provisions the column)
   - `cefr_level TEXT NOT NULL` — `'A1' | 'A2' | 'B1' | 'B2'`; CHECK constraint enforcing the round-1 levels
   - `content_json JSONB NOT NULL` — the `TheoryTopicJson` payload
   - `generation_source TEXT NOT NULL DEFAULT 'manual'` — `'manual' | 'claude-realtime' | 'claude-batch'`; CHECK constraint
   - `model_id TEXT` — nullable; `'manual'` rows have NULL; generated rows have e.g. `'claude-sonnet-4-5'`
   - `quality_score REAL` — nullable; 0..1 from Phase 3 validator
   - `review_status TEXT NOT NULL DEFAULT 'auto-approved'` — `'auto-approved' | 'flagged' | 'rejected' | 'manual-approved'`; CHECK constraint
   - `flagged_reasons JSONB` — nullable
   - `generated_at TIMESTAMPTZ` — nullable; set by Phase 2 at insert time
   - `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
   - `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`
2. WHEN `pnpm db:migrate` is run THEN migration `0008` SHALL also create:
   - A unique partial index `theory_topics_pool_lookup_idx ON theory_topics (language, grammar_point_key) WHERE review_status IN ('auto-approved', 'manual-approved')` — at most one approved row per cell. Phase 2's CLI relies on this for `INSERT ... ON CONFLICT DO NOTHING` to express "skip; already filled".
   - An index `theory_topics_panel_idx ON theory_topics (language, topic_id) WHERE review_status IN ('auto-approved', 'manual-approved')` — the panel's lookup key (Phase 5).
3. WHEN the migration is applied to the dev Neon branch THEN both indices SHALL exist (verified by `\d theory_topics` in `psql`); attempting to insert a second `auto-approved` row with the same `(language, grammar_point_key)` SHALL fail with a unique-constraint violation; attempting to insert with `review_status = 'rejected'` SHALL succeed (the partial index excludes those rows). The verification commands SHALL be documented in the task's verify step so a reviewer can reproduce.
4. WHEN `pnpm db:migrate` is re-run THEN the migration SHALL be idempotent — Drizzle's migration journal handles this; the SQL itself uses `CREATE TABLE` and `CREATE INDEX` (not `IF NOT EXISTS`) because the journal is the dedup mechanism, matching the pattern of migrations 0001–0007.
5. WHEN reading the migration file THEN there SHALL be no FK constraints on `grammar_point_key` (the curriculum lives in TS modules, not in `skill_topics`; an FK to `skill_topics(name)` would couple the table to the seed-population timing — Phase 4's scheduler runs against the curriculum directly).

### Requirement 5 — `theory_generation_jobs` schema migration

**User Story:** As an operator querying "how much have we spent on theory generation this week", I want every batch run to leave one row in `theory_generation_jobs` with the same column shape as `generation_jobs`, so that the exercise-gen cost dashboard pattern transfers directly.

#### Acceptance Criteria

1. WHEN `pnpm db:migrate` is run THEN migration `0009` SHALL create a table `theory_generation_jobs` with the following columns and types:
   - `id UUID PRIMARY KEY`
   - `cell_key TEXT NOT NULL` — formatted `<lang>:<level>:<grammar_point_key>` (Phase 2 derives via `assertValidTheoryCellKey` — see Requirement 7)
   - `status TEXT NOT NULL` — `'queued' | 'running' | 'succeeded' | 'failed'`; CHECK constraint
   - `trigger TEXT NOT NULL` — `'cli' | 'scheduled' | 'admin'`; CHECK constraint
   - `started_at TIMESTAMPTZ NOT NULL DEFAULT now()`
   - `finished_at TIMESTAMPTZ`
   - `input_tokens_used INT`
   - `output_tokens_used INT`
   - `cost_usd_estimate NUMERIC(10,4)`
   - `approved BOOLEAN` — TRUE when the job inserted an auto-approved row
   - `flagged BOOLEAN` — TRUE when the job inserted a flagged row
   - `rejected BOOLEAN` — TRUE when the validator vetoed the draft (no insert)
   - `error_message TEXT` — truncated to 1000 chars by Phase 2 inserter; the column itself is unbounded
   - **Note (asymmetry vs. `generation_jobs`):** the exercise-gen audit table tracks `produced_count`/`approved_count`/`flagged_count`/`rejected_count` because each batch produces 50 drafts. Theory's audit columns collapse to three booleans (`approved`/`flagged`/`rejected`) because theory cardinality is exactly 1 page per cell. A reader carrying mental model from `generation_jobs` should expect this collapse; no integer count columns exist on this table.
2. WHEN `pnpm db:migrate` is run THEN migration `0009` SHALL also create `theory_generation_jobs_cell_idx ON theory_generation_jobs (cell_key, started_at DESC)` — Phase 4's scheduler reads "most recent successful job per cell" against this index.
3. WHEN the migration is applied THEN re-running `pnpm db:migrate` SHALL be a no-op (Drizzle journal).

### Requirement 6 — Drizzle schema definitions

**User Story:** As Phase 2's CLI and Phase 4's scheduler, I want the `theory_topics` and `theory_generation_jobs` tables exposed as Drizzle table objects in `packages/db/src/schema/theory.ts` so that all DB writes go through type-safe column references.

#### Acceptance Criteria

1. WHEN the codebase is built THEN `packages/db/src/schema/theory.ts` SHALL export `theoryTopics` (a `pgTable`) whose column definitions match Requirement 4 field-for-field. The `content_json` column SHALL be typed as `jsonb('content_json').$type<TheoryTopicJson>().notNull()` so the Drizzle type inference produces typed reads/writes without casts.
2. WHEN the codebase is built THEN `packages/db/src/schema/theory.ts` SHALL export `theoryGenerationJobs` matching Requirement 5.
3. WHEN the codebase is built THEN `packages/db/src/schema/index.ts` SHALL re-export both tables so callers can `import { theoryTopics } from '@language-drill/db'` (the package barrel — same convention as `exercises`, `generationJobs`).
4. WHEN `pnpm db:generate` (Drizzle's migration generator) is run after editing the schema THEN it SHALL produce migrations `0008` and `0009` matching the SQL described in Requirements 4–5. The generated SQL MAY include comments or formatting differences but the schema effects SHALL be identical. (The migration files committed to the repo are the Drizzle-generated output, not hand-written SQL.)
5. WHEN `pnpm typecheck` is run THEN the new schema file SHALL compile with zero `any`. The CHECK constraints SHALL be expressed via Drizzle's `check()` helper where the version in use supports it; otherwise a code comment in `theory.ts` SHALL note that the migration SQL is authoritative for the constraint and the test in Requirement 8.4 covers the runtime check.

### Requirement 7 — `assertValidTheoryCellKey` helper

**User Story:** As every Phase 2/4 caller that builds a `cell_key` for `theory_generation_jobs.cell_key`, I want a single helper that enforces the canonical format `<lang>:<level>:<grammar_point_key>` and rejects malformed input at the call boundary, so that bad keys never reach the audit table.

#### Acceptance Criteria

1. WHEN the codebase is built THEN `packages/db/src/lib/theory-cell-key.ts` SHALL export `THEORY_CELL_KEY_REGEX` (a `RegExp`), `assertValidTheoryCellKey(cellKey: string): void` (throws on mismatch), and `buildTheoryCellKey(input: { language; cefrLevel; grammarPointKey }): string` (typed constructor that returns a guaranteed-valid key).
2. WHEN `assertValidTheoryCellKey` is called with a string matching `^(es|de|tr):(a1|a2|b1|b2):[a-z]{2}-[a-z0-9]+-[a-z0-9-]+$` THEN it SHALL return without throwing. WHEN called with any other string THEN it SHALL throw `Error('Invalid theory cell key: <value>')`. The lowercase alternation matches the existing `CELL_KEY_REGEX` convention in `packages/db/src/lib/cell-key.ts`.
3. WHEN `buildTheoryCellKey` is called with typed inputs (the upper-case enum literals `Language.ES`, `CefrLevel.B1`, etc.) THEN it SHALL lowercase each segment before joining (matching `buildCellKey`'s convention) and SHALL return a string that always passes `assertValidTheoryCellKey`. The function SHALL also call `assertValidTheoryCellKey` on its own output as a defense-in-depth check.
4. WHEN unit-tested THEN every input class from `cell-key.test.ts` (the exercise-cell-key tests at `packages/db/src/lib/cell-key.test.ts`) SHALL have a parallel test for theory: valid case, missing segment, wrong language, wrong level, malformed grammar key. The theory test file SHALL deliberately include one case that's a valid *exercise* cell key (`ES:B1:cloze:es-b1-present-subjunctive`) and assert it's rejected — theory keys have no exercise-type segment.

### Requirement 8 — Tests

**User Story:** As a maintainer, I want every load-bearing piece of Phase 1 covered by tests appropriate to its level so that Phases 2–5 can refactor without silently breaking the contract this phase pins.

#### Acceptance Criteria

1. WHEN `pnpm test --filter @language-drill/shared` is run THEN there SHALL be a unit-test file `packages/shared/src/theory.test.ts` covering the `parseTheoryTopicJson` parser at minimum: (a) a happy-path test that round-trips a fixture matching a real topic; (b) one rejection test per parser-thrown condition in Requirements 2.2–2.11 (missing field, empty `sections`, empty `body`, empty paragraph `text`, empty inline wrapper `children`, empty inline `text` leaf string, empty `example.target` / empty `en` / empty `note`, empty `list.items`, empty list item, empty `conjugation-table.head` / `rows` / width mismatch, unknown `kind` for block, unknown `kind` for inline, malformed section id, duplicate section ids); (c) a nested-inline happy-path test that round-trips an `<em>` containing `<strong>` (the subjunctive.tsx prototype case); (d) a type-narrowing assertion (`const t: TheoryTopicJson = parseTheoryTopicJson(input)` compiles).
2. WHEN `pnpm test --filter @language-drill/web` is run THEN there SHALL be a unit-test file `apps/web/components/theory/__tests__/render-json.test.tsx` that renders the fixture topic via `renderTheoryTopicJson` + `render(<>{topic.sections[0].body}</>)` and asserts no React error throws, plus targeted assertions: (a) `<Callout variant="warn">` renders with the warn class; (b) `<Example>` renders `<Example.Note>` containing `<em>` when `note` is `[{kind: 'em', children: [{kind: 'text', text: 'tener'}]}]` (the subjunctive prototype case) and only two sub-elements when `note` is omitted; (c) `<ConjugationTable>` renders a `<table>` with the expected number of `<th>`, `<tr>`, `<td>` elements; (d) `<TheoryList>` renders one `<li>` per item with the item's blocks inside; (e) inline `hilite` produces the existing `.hilite` class; (f) nested inline (`em` containing `strong`) produces `<em><strong>…</strong></em>` markup.
3. WHEN `pnpm test --filter @language-drill/web` is run THEN there SHALL be a regression test (in the same file) that takes the existing hand-authored `apps/web/content/theory/es/subjunctive.tsx` topic, expresses an equivalent `TheoryTopicJson` fixture (by hand, in `packages/db/scripts/__fixtures__/theory-json/subjunctive.json`), pipes it through the renderer, and asserts the rendered text content (via `screen.getByText(...)` for selected anchors like `WEIRDO` and `opposite vowel rule`) matches what the hand-authored file produces. This is the test that proves the renderer is byte-equivalent to the TSX path for the canonical case.
4. WHEN `pnpm test --filter @language-drill/db` is run THEN there SHALL be a schema-shape test in `packages/db/src/schema/theory.test.ts` (new file) that, against a `TEST_DATABASE_URL` Neon branch when set, asserts the `theoryTopics` and `theoryGenerationJobs` tables have the columns + nullability + check constraints the migration creates. The test SHALL be marked with `describe.skipIf(!process.env.TEST_DATABASE_URL)` so the suite passes locally without the var, mirroring how `seed-exercises.test.ts` already handles its planning vs. DB-touching split.
5. WHEN `pnpm test --filter @language-drill/db` is run THEN there SHALL be a unit-test file `packages/db/src/lib/theory-cell-key.test.ts` covering Requirement 7.4.
6. WHEN `pnpm typecheck` is run from the repo root THEN it SHALL pass with zero `any` in the new code.

### Requirement 9 — Read-path parity with existing primitives

**User Story:** As a learner who lands on a generated theory page in a future phase, I want it to look and feel identical to the hand-authored ES topics, so that the source of the content (DB vs. TSX) is invisible.

#### Acceptance Criteria

1. WHEN a `TheoryTopicJson` is round-tripped through `parseTheoryTopicJson → renderTheoryTopicJson → ReactDOM.renderToString` THEN the resulting HTML SHALL use only class names already present in `apps/web/app/globals.css` (the theory styles shipped by the `theory-panel` task 23). The renderer SHALL NOT introduce any new class names.
2. WHEN the renderer renders a `list` block THEN the resulting markup SHALL be `<ul class="theory-list">…</ul>` with `<li>` children — matching what the hand-authored topics produce.
3. WHEN the renderer renders a `conjugation-table` block THEN the resulting markup SHALL be `<table class="theory-table">…</table>` — matching the existing primitive.
4. WHEN the rendered `TheoryTopic` is passed to the existing `TheoryPanel` THEN the panel's existing `<TheoryContent>` wrapping (`apps/web/components/theory/theory-content.tsx`) SHALL produce `<section id={topic.sections[i].id}>` markup using the renderer's section ids. The Phase-1 test asserts the renderer's output `TheoryTopic.sections[i].id` equals `TheorySectionJson.id` (Req 3.11–3.12); the actual `<section>` wrapping is verified by the panel's existing tests, not re-tested here.

## Non-Functional Requirements

### Performance

- The renderer SHALL be O(n) in the total number of blocks + inline nodes — no quadratic walks. For a typical 6-section topic with ~30 blocks total, render time SHALL be sub-millisecond on a developer laptop. No `React.memo` or `useMemo` in Phase 1; the renderer is called once per topic load, not in a hot loop.
- The migration SHALL not require a table rewrite or a long lock — both `theory_topics` and `theory_generation_jobs` are new empty tables; `CREATE TABLE` + `CREATE INDEX` on an empty table is fast.

### Reliability

- The parser SHALL fail closed: any unparsable input throws, period. There is no "best-effort" partial parse — a `TheoryTopicJson` is either valid or rejected.
- The migration SHALL be forward-only (per CLAUDE.md "Migrations are forward-only"). No `DOWN` migration is provided.

### Security

- No new auth boundary is introduced — Phase 1 ships pure types, a renderer, a parser, and DB schema. The first auth-relevant surface is Phase 5's `GET /theory/:lang/:topicId` route, which inherits the existing JWT authorizer.
- The parser SHALL not accept arbitrary JSX/HTML strings as inline content — the inline taxonomy is a closed enum (`text | strong | em | hilite | mono`), which is structurally incapable of carrying unsafe markup.
- `JSONB` payloads stored in `theory_topics.content_json` SHALL be rendered through the renderer (which produces React elements via primitives) and never via `dangerouslySetInnerHTML`. Phase 1 sets the precedent in the renderer; Phase 5's read-path adopts it.

### Maintainability

- Adding a new block variant in a future phase SHALL require exactly three coordinated changes: (1) a new variant on `TheoryBlockJson`, (2) a new `case` in the renderer's exhaustive switch, (3) a new `case` in the parser's exhaustive switch. The exhaustive-switch invariant in TypeScript SHALL ensure (2) and (3) fail compilation if forgotten.
- The `TheoryTopicJson` fixture set under `packages/db/scripts/__fixtures__/theory-json/` SHALL be the calibration corpus the Phase 3 validator's prompts are tuned against. Phase 1 ships at least two fixtures (`subjunctive.json` — the equivalent of the hand-authored ES topic; `minimal.json` — the smallest valid topic, one section, one paragraph) so Phase 3's prompts have something to compare against.

### Usability

- Not applicable — Phase 1 ships pure types, a parser, a renderer, and DB schema. No user-facing surface ships in this phase. The first user-facing surface is Phase 5's panel registry fallback.
