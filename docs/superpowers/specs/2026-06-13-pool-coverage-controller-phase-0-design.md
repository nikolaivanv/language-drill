# Pool Coverage Controller — Phase 0 Design

_Spec for Phase 0 of the [pool coverage controller](../../pool-coverage-controller.md):
**coverage tags + monitoring**. Turns the one-off manual
[pool diversity audit](../../pool-diversity-audit.md) into a standing, queryable
measurement. Status: approved, ready for planning._

---

## Goal & scope

Make exercise-pool diversity a **measured quantity** instead of something
discovered by hand-run SQL audits. Concretely:

1. The generation-time **validator emits the realized coverage value** of each
   draft on a small set of categorical axes.
2. Those values are **persisted** on the exercise row in a dedicated
   `coverage_tags` JSONB column.
3. The approved pool's **per-cell distribution** is surfaced on the existing
   `GET /admin/pool-status` endpoint (a free `GROUP BY`).
4. A one-off **backfill CLI** tags the existing approved pool so monitoring is
   useful immediately.

### In scope

- Validator change: emit a `coverage` object (`person`, `wordClass`, `polarity`,
  `sentenceType`).
- DB: `coverage_tags` column + migration.
- Persistence: write the cell-applicable subset of the validator's coverage map
  at INSERT time.
- Endpoint: generic per-axis distribution over approved rows.
- Backfill CLI.

### Out of scope (explicitly)

- **The scheduler/controller** — deficit-driven targeting, per-bucket give-up,
  vector `need`. That is Phase 1.
- **Any generation-side fix** — word-class rotation directives, quotas,
  blank-placement rules. Those each require `eval:gen` gating + a
  `GENERATION_PROMPT_VERSION` bump (and sometimes a curriculum-version bump +
  re-pass) and are a separate, heavier effort. **Phase 0 measures; it does not
  change generation.**
- **Declarative per-cell coverage specs** (`coverageAxes` in the curriculum) and
  the cell-specific axes that need them — morphophonology (`mu/mü`, `-ta/-te`),
  function of polyfunctional forms, regular-vs-irregular, blank-placement. These
  need grammar-point semantics to define a legitimate value set and belong to
  Phase 2.
- **Any web UI** rendering of the distribution. Endpoint only.

---

## Why these four axes

The backfill (an LLM re-read of the pool) is the expensive part; having the
validator emit *one more categorical field per draft* in the same call is nearly
free. So the full measurement axis set is decided **now** and captured in a
single validator pass + single backfill, rather than doing `person` now and
re-reading the whole pool again later for `wordClass`.

Mapped from the [diversity audit](../../pool-diversity-audit.md) taxonomy:

| Axis | Audit basis | Why now |
|---|---|---|
| `person` | #272 person rotation | Verifies the rotation fix actually landed in the *approved* pool. |
| `wordClass` | Finding 3 (vocab noun-monoculture), audit priority #1 | Generalizes to every vocab cell with no per-cell config. |
| `polarity` | Finding 4 (affirmative skew) | Cheap binary classify; broad. |
| `sentenceType` | Finding 4 (declarative skew) | Cheap classify; broad. |

Deferred to Phase 2 (need per-cell specs; the "legitimate concentration" trap
means raw numbers are uninterpretable without grammar-point semantics):
morphophonological variants, function of polyfunctional forms,
regular-vs-irregular, blank-placement (compound-tenses).

---

## Axis applicability

Each axis is written only for the cells where it is meaningful. The sets are
chosen so a single coverage pass tags every cell on its relevant axes with no
wasted work:

| Axis | Cells written for | Gate |
|---|---|---|
| `person` | grammar cells (`cloze` / `translation` / `sentence_construction`) of a grammar point with `personRotation` | `grammarPoint.personRotation === true` |
| `wordClass` | `vocab_recall` cells | `exerciseType === vocab_recall` |
| `polarity` | grammar cells (`cloze` / `translation` / `sentence_construction`) | grammar exercise type |
| `sentenceType` | grammar cells (`cloze` / `translation` / `sentence_construction`) | grammar exercise type |

No `curriculum-types.ts` change is required: `wordClass` keys off
`exerciseType`, `polarity`/`sentenceType` apply to all grammar cells, and
`person` reuses the existing `personRotation` flag.

### Canonical value sets

```
person       : "1sg" | "2sg" | "3sg" | "1pl" | "2pl" | "3pl"
wordClass    : "noun" | "verb" | "adjective" | "adverb" | "other"
polarity     : "affirmative" | "negative"
sentenceType : "declarative" | "interrogative" | "imperative"
```

`person` uses the canonical six-member superset regardless of language (ES omits
`2pl`/vosotros at *generation* time, but a draft that realizes it must still be
captured). These codes live in one shared module
(`packages/shared` or `packages/ai`) and are imported by the tool schema,
parser, column type, and tests so they cannot drift.

---

## Component 1 — Validator emits `coverage` (`packages/ai`)

**Tool schema (`validate.ts`).** Add a single non-required `coverage` object to
`VALIDATION_TOOL` with optional enum sub-fields `person`, `wordClass`,
`polarity`, `sentenceType`. A nested object (vs four flat fields) mirrors the
storage shape and keeps the tool tidy as axes grow.

```ts
coverage: {
  type: "object",
  description:
    "Realized coverage values for this draft on the axes relevant to its cell. " +
    "Fill only the sub-fields you are asked about in the user prompt; omit the rest.",
  properties: {
    person:       { type: "string", enum: PERSON_CODES,        description: "..." },
    wordClass:    { type: "string", enum: WORD_CLASS_CODES,    description: "..." },
    polarity:     { type: "string", enum: POLARITY_CODES,      description: "..." },
    sentenceType: { type: "string", enum: SENTENCE_TYPE_CODES, description: "..." },
  },
}
// NOT added to the tool's `required` array.
```

**Type + parse.** `ValidationResult` gains `coverage: CoverageTags` where
`CoverageTags = Partial<Record<CoverageAxis, string>>`. `parseValidationResult`
reads `raw.coverage` with a **lenient** reader (same spirit as the
`flaggedReasons`/`culturalIssues` handling): for each known axis key, keep the
value iff it is a member of that axis's enum, otherwise drop it; a missing or
non-object `coverage` yields `{}`. **Never throws, never gates routing** — purely
non-load-bearing, so a malformed value cannot cost a draft.

**Directives (per-draft user prompt).** Inject the "report realized X" directive
into the **uncached per-draft user prompt**, gated per cell — the same pattern as
the existing `clozeCellScoringNote`, so non-applicable cells pay zero tokens and
the **cached system prompt stays byte-identical**:

- vocab_recall user prompt → ask for `wordClass` (classify the part of speech of
  `expectedWord`).
- grammar user prompts (cloze/translation/sentence_construction) → ask for
  `polarity` + `sentenceType`, and additionally `person` when
  `spec.grammarPoint.personRotation`.

`spec.grammarPoint` already carries `personRotation`, so no new threading is
needed.

**Version bump.** Bump `VALIDATION_PROMPT_VERSION` → `validate@2026-06-13` (per
the CLAUDE.md prompt-editing rule). The Langfuse *system* body is unchanged (the
new directive lives in the per-draft user prompt), so **`push-prompts` is not
required** — note this explicitly in the commit/PR so a reviewer doesn't expect a
Langfuse sync.

---

## Component 2 — Persist `coverage_tags` (`packages/db`)

**Schema (`schema/exercises.ts`).**

```ts
coverageTags: jsonb('coverage_tags').$type<CoverageTags | null>(),
```

Generate the Drizzle migration. No index in Phase 0 (the endpoint aggregate is a
full scan over an already-small approved pool; add an index only if/when the
controller in Phase 1 needs it).

**Write at INSERT (`generation/validate-and-insert.ts`, the successful-insert
branch, ~line 437).** Compute the cell-applicable subset and write it (or
`null`):

```ts
coverageTags: applicableCoverageTags(opts.cell, result.coverage),
```

`applicableCoverageTags(cell, coverage)` keeps only the axes valid for the cell
(per the applicability table), and returns `null` if the result is empty.
Gating the *write* (not just relying on the validator) keeps the column clean
regardless of model over-eagerness. `result` here is the validation of the
**actually-inserted** draft, so the recorded value is the realized one even when
a dedup-retry replaced the original draft.

`applicableCoverageTags` lives in `packages/db/src/generation/` next to the
routing helpers and is unit-tested in isolation.

---

## Component 3 — Surface on `GET /admin/pool-status` (`infra/lambda`)

Add a fourth aggregate query in `routes/admin.ts`, **generic over axes**:

```sql
SELECT language, difficulty, type, grammar_point_key,
       tag.key   AS axis,
       tag.value AS value,
       COUNT(*)  AS n
FROM exercises
CROSS JOIN LATERAL jsonb_each_text(coverage_tags) AS tag
WHERE review_status IN ('auto-approved', 'manual-approved')
  AND coverage_tags IS NOT NULL
GROUP BY language, difficulty, type, grammar_point_key, tag.key, tag.value
```

- **Approved-only** (`auto-approved` + `manual-approved`) — measure what learners
  actually see (controller-doc risk #4).
- Assembled in JS into `coverageDistribution: Record<axis, Record<value, count>>`
  per cell, or `null` when the cell has no tagged approved rows.
- **Any future axis appears automatically** — no per-axis SQL.

Update `PoolStatusItemSchema` (`packages/api-client/src/schemas/pool-status.ts`)
with the new optional/nullable `coverageDistribution` field. All existing fields
are unchanged, so the admin web page keeps working without edits.

---

## Component 4 — Backfill CLI (`packages/db/scripts`)

`packages/db/scripts/backfill-coverage-tags.ts`, wired as
`pnpm backfill:coverage-tags` (root + `packages/db`). Modelled on
`revalidate-cloze-pool.ts`:

- **Dry-run by default**; `--apply` to write.
- Flags: `--language`, `--cefr`, `--limit`, `--concurrency`, `--max-cost-usd`.
- Selects approved exercises (`auto-approved` + `manual-approved`) with
  `coverage_tags IS NULL`, replays `validateDraft` (which now emits `coverage`),
  applies `applicableCoverageTags(cell, result.coverage)`, and writes the column.
- Reports per-axis counts written and total cost.

**Scope note.** Because `polarity`/`sentenceType` apply to *all* grammar cells
(not only `personRotation` ones), the backfill effectively covers the whole
approved grammar + vocab pool — a larger pass than person-only. The cost cap and
language/level scoping bound spend, and the pass is **resumable** since it only
touches rows with `coverage_tags IS NULL`. Run it incrementally per language if
needed.

---

## Data flow

```
generateBatch
  → draft
  → validateDraft  (now returns result.coverage)
  → routeValidationResult / applyDeterministicChecks   (unchanged)
  → INSERT exercises (coverage_tags = applicableCoverageTags(cell, coverage))
  → GET /admin/pool-status  (LATERAL jsonb_each_text GROUP BY)
  → standing per-cell, per-axis distribution

backfill-coverage-tags  → replays validateDraft over legacy approved rows
                         → same applicableCoverageTags → same column
```

---

## Error handling

- `coverage` is strictly **non-load-bearing**: lenient coercion to `{}`/dropped
  values, never throws, never affects reject/flag/approve routing. A bad axis
  value simply isn't recorded.
- Backfill is **cost-capped** and **idempotent/resumable** (only touches
  `coverage_tags IS NULL`).
- The endpoint treats a cell with no tagged approved rows as
  `coverageDistribution: null`, never an error.

---

## Testing

- **`validate.test.ts`** — `parseValidationResult`: valid axis values kept;
  invalid enum value / wrong type / missing `coverage` → dropped/`{}`; routing
  outputs unchanged by the new field.
- **`validation-prompts` test** — the per-axis directive appears only for the
  applicable cell type (vocab → `wordClass`; grammar → `polarity`+`sentenceType`;
  `person` only when `personRotation`); cached system prompt byte-parity
  preserved.
- **`applicableCoverageTags` unit test** — correct axis subset per cell type;
  `null` when empty; drops axes not valid for the cell.
- **`validate-and-insert` test** — `coverage_tags` written with the right subset
  for a vocab cell, a personRotation grammar cell, and a non-personRotation
  grammar cell; uses the realized value of the inserted draft.
- **`routes/admin` test** — distribution nests multiple axes; approved-only;
  `null` for a cell with no tagged rows.
- **Migration** — snapshot included.
- **Backfill** — focused unit test on the classify-and-write core (selection
  predicate + applicability + write), not a live LLM run.
- Full `pnpm lint && pnpm typecheck && pnpm test` green before push (CLAUDE.md),
  watching the known `db/dist` staleness (run `pnpm build` after editing db
  source) and `infra` parallel-test flake (`--concurrency=1`) from memory.

---

## Files touched

- `packages/shared/src/` (or `packages/ai/src/`) — shared axis code constants +
  `CoverageTags` / `CoverageAxis` types.
- `packages/ai/src/validate.ts` — tool schema, `ValidationResult`, parser.
- `packages/ai/src/validation-prompts.ts` — per-draft directives,
  `VALIDATION_PROMPT_VERSION`.
- `packages/ai/src/index.ts` — re-exports if needed.
- `packages/db/src/schema/exercises.ts` — `coverage_tags` column.
- `packages/db/migrations/` — generated migration.
- `packages/db/src/generation/` — `applicableCoverageTags` + INSERT write.
- `packages/db/scripts/backfill-coverage-tags.ts` + `package.json` script wiring.
- `infra/lambda/src/routes/admin.ts` — distribution aggregate.
- `packages/api-client/src/schemas/pool-status.ts` — schema field.
- Test files alongside each.
