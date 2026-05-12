# Theory Content Generation Plan

A phased plan for tooling that produces grammar-theory content — the long-form reference material rendered by the Theory Panel (`.claude/specs/theory-panel/`) — at scale, using Claude with the same orchestration framework that exercise generation just shipped (`docs/exercise-generation-plan.md`).

This plan inherits aggressively from the exercise-generation pipeline. Exercise gen Phases 1–5 (curriculum, generator core, validator, Lambda+SQS+EventBridge, admin dashboard) are merged on `main` as of 2026-05-10. The bulk of this doc is about what to **reuse**, what to **adapt**, and the small surface that's genuinely new.

Out of scope here: theory for non-grammar topics (vocabulary umbrellas, phonology, discourse), audio narration of theory pages, mobile rendering. Those each carry their own content shape and ship separately.

---

## 1. Goal & success criteria

The generator must produce theory pages that:

1. **Slot into the Theory Panel without UI changes** — the panel reads from a registry keyed by `(language, topicId)` and renders sections via `TheoryTopic` / `TheorySection` (`apps/web/components/theory/types.ts`). Generated content fills the same shape; the registry gains a DB-backed source alongside the existing static TSX files.
2. **Match the curriculum 1:1** — one theory page per `GrammarPoint` (`packages/shared/src/curriculum-types.ts`). The curriculum already covers ES/DE/TR A1–B2 (~60 grammar points per language). Vocab umbrellas are skipped for round 1 — those don't render as theory pages today.
3. **Are pedagogically faithful** — each page accurately explains the target grammar point at its CEFR level, with worked examples that reuse the curriculum's `examplesPositive` / `commonErrors` as anchors.
4. **Are validated by a second Claude pass** — same routing model as exercises (`auto-approved` / `flagged` / `rejected`), with topic-specific quality dimensions (faithfulness, level match, section completeness, cultural neutrality).
5. **Cost a known, bounded amount** — every batch declares its expected token spend up front, hard-capped via `--max-cost-usd`, audited per-cell in `theory_generation_jobs`.
6. **Are reproducible** — given the same `(language, grammarPointKey, batchSeed)`, the generator produces the same topic id, same row, same content hash. Re-running is a no-op via `INSERT … ON CONFLICT DO NOTHING`.
7. **Have a human-in-the-loop fallback** — flagged pages land in a review queue (`pnpm review:flagged-theory`) that mirrors `review-flagged` for exercises.

Non-goals for this plan: pool depth (theory has exactly 1 page per cell, not 50), in-batch dedup (one page per call, no surface diversity needed), translation-style L2↔EN handling (theory is written in English about the target language).

---

## 2. Current state

What exists today (verified on `main` as of 2026-05-10):

### Theory Panel (shipped)
- `apps/web/components/theory/{types,primitives,theory-panel,theory-toc,theory-content,theory-trigger,theory-empty}.tsx` — full UI
- `apps/web/content/theory/index.ts` — `theoryRegistry: Record<LearningLanguage, Record<string, TheoryTopic>>`, `getTheoryTopic`, `listTheoryTopics`
- `apps/web/content/theory/es/{subjunctive,preterite-imperfect,conditional}.tsx` — three hand-authored ES pages (the v1 ship)
- `apps/web/lib/theory-topic-map.ts` — string → `TheoryTopicId` lookup
- DE/TR registries are empty by design

### Exercise generation (shipped — the framework we'll reuse)
- `packages/ai/src/generate.ts` — `generateBatch`, `GENERATION_MODEL='claude-sonnet-4-5'`, per-type tool schemas, parsers, `exerciseDraftId` (deterministic UUID derivation), token-usage extraction, `cache_control: ephemeral` system blocks
- `packages/ai/src/validate.ts` — `validateDraft`, `parseValidationResult`, the validator tool schema (`qualityScore` / `ambiguous` / `levelMatch` / `grammarPointMatch` / `culturalIssues` / `flaggedReasons`)
- `packages/ai/src/cost-model.ts` — `ClaudeUsageBreakdown`, `ZERO_USAGE`, `addUsage`, `estimateCostUsd`, `SONNET_4_5_PRICING`
- `packages/ai/src/{generation,validation}-prompts.ts` — prompt builders that inject `GrammarPoint` fields into system prompts
- `packages/db/src/generation/run-one-cell.ts` — the per-cell orchestrator: audit row → `generateBatch` → `validateDraft` → `routeValidationResult` → INSERT with dedup retry
- `packages/db/src/generation/cells.ts` — `enumerateCurriculumCells`, `Cell`, `ROUND_1_CEFR_LEVELS`
- `packages/db/src/generation/routing.ts` — `routeValidationResult` (the auto-approve/flag/reject decision)
- `packages/db/scripts/generate-exercises.ts` — CLI: `parseGenerateArgs`, `pLimit` concurrency limiter, SIGINT→`AbortController` bridge, `--dry-run`, `--queue`, `--max-cost-usd`, `printSummary`, `MOCK_CLAUDE=1` fixture path
- `packages/db/scripts/review-flagged.ts` — interactive review CLI
- `infra/lambda/src/generation/{handler,scheduler,job-message,log}.ts` — SQS-driven generator Lambda + EventBridge daily scheduler
- `infra/lib/constructs/{generation-lambda,generation-queue,scheduler-lambda}.ts` — CDK constructs
- `apps/web/app/(dashboard)/admin/generation/page.tsx` — pool coverage admin dashboard
- `generation_jobs` table — per-batch audit trail

### Curriculum (the input)
- `packages/db/src/curriculum/{es,de,tr}.ts` — ~23 entries each (20 grammar + 3 vocab umbrellas). Each grammar entry already carries the **exact seed material a theory page needs**: `name`, `description`, `examplesPositive`, `examplesNegative`, `commonErrors`, `cefrLevel`, `prerequisiteKeys`.

### Gaps this plan closes

| Gap | What's missing | Phase |
|-----|----------------|-------|
| Output shape | No `TheoryTopicJson` schema (the JSON-serializable mirror of the runtime `TheoryTopic`) | 1 |
| DB schema | No `theory_topics` / `theory_generation_jobs` tables | 1 |
| Renderer | No way to render DB-stored topics through the existing primitives — TSX files are statically imported only | 1 |
| Generator | No `packages/ai/src/theory-generate.ts`; no theory-specific tool schema; no theory prompts | 2 |
| Validator | No theory-specific validation prompt (the exercise validator's dimensions don't all transfer) | 3 |
| Review CLI | No `pnpm review:flagged-theory` | 3 |
| Lambda + scheduler | No theory generator Lambda or scheduler | 4 |
| Panel integration | Registry doesn't fall through to DB-stored topics; no DE/TR data path | 5 |
| Admin surface | No theory coverage dashboard tile | 5 |

---

## 3. Architecture overview

### Output: structured JSON, not TSX

The single biggest design call. Two options:

**Option A — Generate TSX files.** Claude emits TSX, we commit the file, the existing static registry picks it up. Reuses the panel verbatim. Fragile (TSX can be malformed in ways jsdom only catches at render time), and the audit trail lives in git instead of `theory_generation_jobs` — which loses the cost/token columns the cost dashboard reads.

**Option B — Generate structured JSON, store in DB, render via primitives.** Claude emits a `TheoryTopicJson` (sections as a discriminated union of `paragraph` | `callout` | `example` | `table` | `list` | `conjugation-table`), stored in `theory_topics.content_json`. The web app gets a small server-side renderer that maps each block to the existing primitive components. The static TSX registry stays as the override path for hand-authored topics.

**This plan picks Option B.** Reasons:

1. The Theory Panel spec explicitly names "Move to DB-stored Claude-generated content later" as the v2 evolution (`web-implementation-plan.md` §H). Option B *is* that v2.
2. Tool-use with a strict input schema is the gating mechanism that makes the exercise generator reliable. Generating freeform TSX throws that away.
3. The validator gets a structured input it can reason about block-by-block, rather than parsing JSX.
4. The cost dashboard, audit table, dedup machinery, scheduler, and admin tile all transfer with one extra column predicate (`content_kind = 'theory'`).
5. It's the only path that lets DE/TR ship without a human writing 60 TSX files per language.

The hand-authored TSX files remain — they're the explicit override. The registry resolves `(language, topicId)` first against the static TSX registry, then falls back to DB.

### Reuse map

```
                       ┌──────────────────────────────────────────────┐
                       │  packages/ai/src/theory-generate.ts (NEW)    │
                       │   • generateTheoryTopic(spec) → TheoryDraft  │
                       │   • THEORY_GENERATION_TOOL                    │
                       │   • parseTheoryTopicJson                      │
                       └────────────────┬─────────────────────────────┘
                                        │
                       ┌────────────────┴─────────────────────────────┐
                       │  packages/ai/src/theory-validate.ts (NEW)    │
                       │   • validateTheoryDraft(draft, spec)          │
                       │   • THEORY_VALIDATION_TOOL                    │
                       └────────────────┬─────────────────────────────┘
                                        │
   REUSED VERBATIM:                     ▼
   - cost-model.ts (ClaudeUsageBreakdown, addUsage, estimateCostUsd)
   - createClaudeClient
   - GENERATION_MODEL constant
   - cache_control: ephemeral pattern
   - tool_choice forced-call pattern
   - SONNET_4_5_PRICING
   - deterministicUuid
   - GrammarPoint type
                                        │
                       ┌────────────────┴─────────────────────────────┐
                       │  packages/db/src/theory-generation/ (NEW)    │
                       │   • runOneTheoryCell(input)                   │
                       │   • routeTheoryValidationResult(result)       │
                       │   • enumerateTheoryCells(curricula)           │
                       └────────────────┬─────────────────────────────┘
                                        │
                       ┌────────────────┼─────────────────┐
                       ▼                ▼                 ▼
                ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
                │ CLI driver   │ │ Lambda       │ │ Scheduler    │
                │ generate-    │ │ generation/  │ │ (EventBridge)│
                │ theory.ts    │ │ theory-      │ │ theory-      │
                │              │ │ handler.ts   │ │ scheduler.ts │
                └──────┬───────┘ └──────┬───────┘ └──────┬───────┘
                       └────────────────┼─────────────────┘
                                        ▼
                              ┌──────────────────┐
                              │  Neon Postgres   │
                              │  theory_topics + │
                              │  theory_         │
                              │  generation_jobs │
                              └──────────────────┘
```

### What does NOT transfer cleanly

These five things look reusable but aren't, and naming them up front avoids wasted PRs:

1. **In-batch dedup (`canonicalSurface`, `recentStems`).** Theory generates one page per call; there's no "50 drafts in a batch" to diversify. The `MAX_DEDUP_RETRIES` retry loop in `validateAndInsertWithRetry` has no theory analogue — a topic is either approved, flagged, or rejected.
2. **Per-cell pool depth.** Theory cells are 0-or-1, not 0-or-50. The scheduler enumerates cells where `theory_topics` has no `auto-approved` or `manual-approved` row for the `(language, grammarPointKey)` and posts those.
3. **Vocab cells.** Vocab-recall exercises use frequency-band umbrellas (`grammarPoint.kind === 'vocab'`); theory pages are grammar-only in round 1. `enumerateTheoryCells` filters to `kind === 'grammar'`.
4. **Exercise type dimension.** Theory has no per-type fan-out — one page per `(language, grammarPoint)`. The cell key drops the `exerciseType` segment.
5. **`exercises_pool_lookup_idx` partial index.** Theory needs its own equivalent on `theory_topics(language, grammar_point_key) WHERE review_status IN ('auto-approved', 'manual-approved')`.

Everything else — the audit row pattern, the `routeValidationResult` shape, the cost cap, the SIGINT bridge, the Lambda cold-start singletons, the deterministic-UUID jobId for scheduler idempotency, the structured logging, the CDK construct shape — transfers with renaming only.

---

## 4. Phased delivery

Total estimated effort: **~6–8 working days**. Smaller than exercise generation because most of the orchestration is reused. Phases 1–3 produce a working dev-time generator. Phase 4 productionizes. Phase 5 wires it into the panel and dashboard.

| Phase | Output | Effort | Depends on | Status |
|-------|--------|--------|------------|--------|
| 1 | `TheoryTopicJson` schema + DB tables + renderer | ~1.5d | — | ✅ shipped (worktree-theory-content-generation) |
| 2 | Generator core + CLI driver | ~1.5d | 1 | ✅ shipped (worktree-theory-generation-phase-2) |
| 3 | Validator + routing + review CLI | ~1d | 2 | ✅ shipped |
| 4 | Lambda + SQS + EventBridge | ~1d | 3 | pending |
| 5 | Panel registry fallback + admin tile | ~1d | 4 | pending |

---

### Phase 1 — Schema, output type, renderer ✅ shipped

**Status:** Complete. Spec at `.claude/specs/theory-generation-phase-1/`. All 15 tasks merged into `worktree-theory-content-generation`. Migrations 0008 + 0009 applied to the dev Neon branch and verified. The actual taxonomy diverged slightly from the sketch below in two places: inline wrapper variants carry `children: TheoryInlineJson[]` (not `text: string`) so nested emphasis like `<em>"i suggest he <strong>be</strong> here"</em>` round-trips losslessly; `example.note` is `TheoryInlineJson[]` (not `string`) so notes carry `<em>verb-name</em>`. The renderer, parser, and JSON fixtures all match the actual taxonomy.

**Goal:** the data shape Claude will emit, the table it lands in, and the React renderer that turns it back into the existing primitives.

**1.1 — `TheoryTopicJson` shape (`packages/shared/src/theory.ts`)**

A pure-data, JSON-serializable mirror of the runtime `TheoryTopic`. The runtime type stays in `apps/web/components/theory/types.ts` because it carries `React.ReactNode`; the JSON type is structural and lives in shared so both `packages/ai` and the web renderer can import it.

```ts
// packages/shared/src/theory.ts
export type TheoryBlockJson =
  | { kind: 'paragraph'; text: TheoryInlineJson[] }
  | { kind: 'callout'; variant?: 'default' | 'warn'; children: TheoryBlockJson[] }
  | { kind: 'example'; target: TheoryInlineJson[]; en: string; note?: string }
  | { kind: 'list'; items: TheoryBlockJson[][] }       // each item is a list of blocks
  | { kind: 'conjugation-table'; head: string[]; rows: string[][] };

export type TheoryInlineJson =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'em'; text: string }
  | { kind: 'hilite'; text: string }
  | { kind: 'mono'; text: string };

export type TheorySectionJson = {
  id: string;                          // kebab-case, unique within topic
  title: string;
  body: TheoryBlockJson[];
};

export type TheoryTopicJson = {
  id: string;                          // kebab-case, equals the topicId in the registry
  title: string;
  subtitle: string;
  cefr: string;                        // free text band, e.g. "B1–B2"
  sections: TheorySectionJson[];
};
```

The block taxonomy is a deliberate subset of what hand-authored TSX can do. It covers every primitive used in the three v1 ES topics. Extending the union (e.g. images, audio) is additive and only requires touching the renderer + the tool schema.

**1.2 — Renderer (`apps/web/components/theory/render-json.tsx`)**

A pure presentational function `renderTheoryTopicJson(topic: TheoryTopicJson): TheoryTopic` that walks the JSON and produces JSX using the existing primitives in `apps/web/components/theory/primitives.tsx`. No new primitives, no styling changes.

```tsx
function renderInline(node: TheoryInlineJson): React.ReactNode {
  switch (node.kind) {
    case 'text': return node.text;
    case 'strong': return <strong>{node.text}</strong>;
    case 'em': return <em>{node.text}</em>;
    case 'hilite': return <Hilite>{node.text}</Hilite>;
    case 'mono': return <Mono>{node.text}</Mono>;
  }
}

function renderBlock(block: TheoryBlockJson): React.ReactNode {
  switch (block.kind) {
    case 'paragraph': return <p>{block.text.map(renderInline)}</p>;
    case 'callout': return (
      <Callout variant={block.variant}>
        {block.children.map(renderBlock)}
      </Callout>
    );
    // ... etc.
  }
}
```

Tested by rendering each fixture topic from `packages/db/scripts/__fixtures__/claude-theory-generation/*.json` and asserting no React error.

**1.3 — Drizzle migration `0008_theory_topics.sql`**

```sql
CREATE TABLE theory_topics (
  id UUID PRIMARY KEY,                                  -- deterministic from (language, grammar_point_key, batch_seed)
  language TEXT NOT NULL,                               -- ES | DE | TR (no EN)
  grammar_point_key TEXT NOT NULL,                      -- FK-by-string to curriculum module
  topic_id TEXT NOT NULL,                               -- kebab-case, panel-facing id (slug of grammar_point_key)
  cefr_level TEXT NOT NULL,                             -- A1 | A2 | B1 | B2 (denormalized from curriculum)
  content_json JSONB NOT NULL,                          -- TheoryTopicJson
  generation_source TEXT NOT NULL DEFAULT 'manual',     -- manual | claude-realtime | claude-batch
  model_id TEXT,                                        -- e.g. 'claude-sonnet-4-5'
  quality_score REAL,                                   -- 0..1 from validator
  review_status TEXT NOT NULL DEFAULT 'auto-approved',  -- auto-approved | flagged | rejected | manual-approved
  flagged_reasons JSONB,
  generated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Pool lookup. Mirror of exercises_pool_lookup_idx, dropping the type/difficulty
-- segments since theory has no per-type fan-out.
CREATE UNIQUE INDEX theory_topics_pool_lookup_idx
  ON theory_topics (language, grammar_point_key)
  WHERE review_status IN ('auto-approved', 'manual-approved');

-- The panel's lookup key.
CREATE INDEX theory_topics_panel_idx
  ON theory_topics (language, topic_id)
  WHERE review_status IN ('auto-approved', 'manual-approved');

CREATE TABLE theory_generation_jobs (
  id UUID PRIMARY KEY,
  cell_key TEXT NOT NULL,                  -- "es:b1:es-b1-present-subjunctive"
  status TEXT NOT NULL,                    -- queued | running | succeeded | failed
  trigger TEXT NOT NULL,                   -- cli | scheduled | admin
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  input_tokens_used INT,
  output_tokens_used INT,
  cost_usd_estimate NUMERIC(10,4),
  approved BOOLEAN,                        -- TRUE = inserted as auto-approved
  flagged BOOLEAN,                         -- TRUE = inserted as flagged
  rejected BOOLEAN,                        -- TRUE = not inserted (validator vetoed)
  error_message TEXT
);

CREATE INDEX theory_generation_jobs_cell_idx
  ON theory_generation_jobs (cell_key, started_at DESC);
```

The unique partial index on `theory_topics_pool_lookup_idx` is the dedup mechanism — at most one approved/manual-approved row per `(language, grammar_point_key)`. Generating a second draft for the same cell collides and rolls back via `ON CONFLICT DO NOTHING`, which is the explicit "skip; this cell is already filled" signal.

**1.4 — Drizzle schema (`packages/db/src/schema/theory.ts`)**

Standard Drizzle column definitions matching the migration. Exported via `packages/db/src/schema/index.ts`. No special considerations — same patterns as `schema/exercises.ts`.

---

### Phase 2 — Generator core + CLI

**Goal:** `pnpm generate:theory --lang es --grammar-point es-b1-present-subjunctive` produces one approved row in `theory_topics`.

**2.1 — `packages/ai/src/theory-generate.ts`**

API surface mirroring `generate.ts`:

```ts
import { GENERATION_MODEL } from './generate';  // shared model constant
import { addUsage, ZERO_USAGE, type ClaudeUsageBreakdown } from './cost-model';

export const THEORY_GENERATION_TEMPERATURE = 0.4;  // lower than exercises (0.7) — accuracy > diversity
export const THEORY_GENERATION_MAX_TOKENS = 8192;  // theory pages are larger than exercises
export const THEORY_TOOL_NAME = 'submit_theory_topic';

export const THEORY_GENERATION_TOOL: Anthropic.Tool = {
  name: THEORY_TOOL_NAME,
  description: 'Submit a complete grammar theory topic for the configured grammar point.',
  input_schema: { /* ... TheoryTopicJson shape, field-for-field ... */ },
};

export type TheoryGenerationSpec = {
  language: Exclude<Language, Language.EN>;
  grammarPoint: GrammarPoint;       // kind === 'grammar' enforced upstream
  batchSeed: string;                // default 'theory-v1'
};

export type TheoryDraft = {
  id: string;                       // deterministic UUID
  topicId: string;                  // slug of grammarPoint.key, e.g. 'present-subjunctive'
  contentJson: TheoryTopicJson;
  metadata: {
    grammarPointKey: string;
    modelId: string;
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
  };
};

export async function generateTheoryTopic(
  client: Anthropic,
  spec: TheoryGenerationSpec,
): Promise<{ draft: TheoryDraft; tokenUsage: ClaudeUsageBreakdown }>;
```

Internals follow `generateBatch` line-for-line: `messages.create` with `tool_choice: { type: 'tool', name: THEORY_TOOL_NAME }`, single cached system block (`cache_control: ephemeral`), one user message (no per-ordinal loop — theory generates exactly one page per call), `parseTheoryTopicJson` mirrors `parseGeneratedClozeDraft`'s field-level error format.

**Parser strictness — fail at parse time, not at render time.** Empty inline arrays (`paragraph.text: []`), empty section bodies (`section.body: []`), and zero-section topics (`topic.sections: []`) all throw at parse time with the same `Invalid <field>: must be <expected>, got <JSON.stringify(value)>` shape as the exercise parsers. Reasons: (a) consistent with `requireString`'s "non-empty or throw" rule in `generate.ts:280`; (b) parse-time errors land in `theory_generation_jobs.error_message` immediately and skip the second Claude call entirely (the validator would have caught most of these via `sectionsIncomplete` anyway, but at the cost of a $0.02 round-trip); (c) silent rendering of empty blocks is the worst failure mode — the panel paints a blank section and a learner can't tell whether they hit a bug or whether the topic genuinely has no examples.

**Deterministic ID derivation** — matches `exerciseDraftId`:

```ts
export function theoryDraftId(spec: TheoryGenerationSpec): string {
  return deterministicUuid(
    [spec.language, spec.grammarPoint.key, spec.batchSeed].join('|'),
  );
}
```

The topic id (panel-facing slug) is derived once: `topicId = spec.grammarPoint.key.replace(/^[a-z]{2}-/, '')` → `'es-b1-present-subjunctive'` becomes `'b1-present-subjunctive'`. The level prefix is retained on purpose so cross-level points with the same root slug stay distinct (e.g. `a2-conditional` vs `b1-conditional` are different topics). The panel never exposes topic ids in user-visible text — only the curated `title` from `TheoryTopicJson` — so the longer slug carries no cosmetic cost.

**2.2 — `packages/ai/src/theory-prompts.ts`**

System prompt template (cached per cell):

```
You are an expert author of grammar reference material for {{language}} learners
at CEFR {{cefrLevel}}. Your job is to produce one complete theory page that
explains exactly one grammar point: {{grammarPoint.name}}.

## Grammar point context
{{grammarPoint.description}}

## Positive examples (use these — verbatim or paraphrased — in your "examples"
section)
{{grammarPoint.examplesPositive}}

## Common learner errors (address each in your "pitfalls" section)
{{grammarPoint.commonErrors}}

## Required sections (in this order)
1. what is it? — a single paragraph defining the concept
2. when to use it — bullets or short paragraphs covering the trigger conditions
3. formation — how the form is built (use a conjugation-table block when
   applicable)
4. examples in context — at least three example blocks, each with target +
   English + a one-line note
5. common pitfalls — bulleted list addressing every entry in commonErrors

## Voice
Editorial. Concise. Lowercase headings. Treat the reader as an adult.
No padding, no encouragement, no emojis.

## Output format
Call the submit_theory_topic tool exactly once with the structured topic.
Each section.body is an array of typed blocks (paragraph, callout, example,
list, conjugation-table). Inline emphasis goes through the inline-node union
(text, strong, em, hilite, mono) — do not use raw HTML or markdown.
```

User message: `"Produce the theory page for {{grammarPoint.name}} ({{grammarPoint.key}}) at CEFR {{cefrLevel}}."`

The hand-authored ES topics in `apps/web/content/theory/es/` are **the calibration set** — the prompt's "voice" section is tuned by sampling from those three files in dev runs and comparing against generated output. Voice drift is the most likely failure mode; tracking it requires periodic eyeballing, not automated metrics.

**2.3 — CLI driver (`packages/db/scripts/generate-theory.ts`)**

```bash
# Single grammar point:
pnpm generate:theory --lang es --grammar-point es-b1-present-subjunctive

# Whole language at one level, all grammar points:
pnpm generate:theory --lang es --level B1

# Whole language, all grammar points across A1–B2:
pnpm generate:theory --lang es

# Dry run — print spec, estimated cost, no Claude calls:
pnpm generate:theory --lang es --level B1 --dry-run
```

Implementation pattern is a near-verbatim copy of `generate-exercises.ts` with five renames:

| Exercise CLI | Theory CLI |
|---|---|
| `parseGenerateArgs` | `parseTheoryGenerateArgs` (no `--type`, no `--count`) |
| `resolveCells` | `resolveTheoryCells` (filter to `kind === 'grammar'`) |
| `runOneCell` | `runOneTheoryCell` (no per-draft loop, no dedup retry) |
| `pLimit(args.concurrency)` | unchanged |
| `printSummary` | `printTheorySummary` (different counts: per-cell is approved/flagged/rejected, no `inserted vs skipped`) |

**Reuse verbatim:** SIGINT→AbortController bridging, `MOCK_CLAUDE=1` mock client (extend the existing fixture loader at `packages/db/scripts/generate-exercises-mock-client.ts` with a `theory` branch), the `--max-cost-usd` cell-level cap, the `--allow-prod` guard, the `--queue` SQS dispatch path, the direct-run guard. All copied with renamed handlers.

**`packages/db/src/theory-generation/run-one-cell.ts`** mirrors `packages/db/src/generation/run-one-cell.ts` but trimmed:

```ts
export async function runOneTheoryCell(input: RunOneTheoryCellInput): Promise<TheoryCellResult> {
  // 1. Open theory_generation_jobs row (status='running')
  // 2. Call generateTheoryTopic
  // 3. Call validateTheoryDraft (Phase 3 — Phase 2 ships with auto-approved)
  // 4. routeTheoryValidationResult → 'auto-approved' | 'flagged' | 'rejected'
  // 5. INSERT into theory_topics with ON CONFLICT DO NOTHING
  //    - on conflict: cell already has an approved row → status='succeeded', insertedCount=0
  //    - on rejected: do not insert; status='succeeded', approved/flagged/rejected counts set
  // 6. Close audit row with token + cost numbers
}
```

No `validateAndInsertWithRetry`-style retry loop. If the validator rejects, the cell stays empty for this run; the scheduler will pick it up again next cycle (idempotent re-fire produces the same `jobId`, the audit row's existing-status check makes that a no-op).

**2.4 — Tests**

Following project convention (tests next to module):

- `packages/ai/src/theory-generate.test.ts` — mocked Anthropic client; covers tool-schema parsing, block-shape validation (every union variant), the `topicId` derivation, deterministic-id property
- `packages/ai/src/theory-prompts.test.ts` — golden-file tests on prompt assembly for one ES grammar point
- `packages/db/src/theory-generation/run-one-cell.test.ts` — full cell pipeline against a mock client and a Neon dev branch
- `packages/db/scripts/generate-theory.test.ts` — CLI integration test with `MOCK_CLAUDE=1` fixtures

---

### Phase 3 — Validator + routing + review CLI ✅ shipped

**Status:** Complete. Spec at `.claude/specs/theory-generation-phase-3/`. All 21 tasks merged. The validator (`packages/ai/src/theory-validate.ts`) + router (`packages/db/src/theory-generation/routing.ts`) + orchestrator wiring (`runOneTheoryCell` in `packages/db/src/theory-generation/run-one-cell.ts`) + review CLI (`pnpm review:flagged-theory`) are live. Two deliberate deltas from the sketch below: (1) the `[e]dit` branch is deferred — Phase 3 ships with `a / r / s / q` keymap parity to the exercise reviewer; the salvageable-edit case is rejected-and-regenerated next batch. (2) Routing accumulates all flag conditions in a single deterministic pass (low-score header + level mismatch + each incomplete section + examples off-target + free-text reasons) instead of the early-return chain — a row that's both off-level AND has incomplete sections surfaces both reasons in the reviewer's terminal.

**Goal:** every generated draft passes through quality control. Anything ambiguous gets `review_status = 'flagged'` and is invisible to the panel until a human approves.

**3.1 — `packages/ai/src/theory-validate.ts`**

Second Claude call, low temperature, cold-cached:

```ts
export type TheoryValidationResult = {
  qualityScore: number;            // 0..1
  factualErrors: string[];         // grammar claims that are wrong
  levelMismatch: boolean;          // vocab/concepts above or below the target CEFR
  sectionsIncomplete: string[];    // names of required sections that are missing or thin
  examplesUseGrammarPoint: boolean; // do the examples actually demonstrate the target?
  culturalIssues: string[];        // sensitive content, stereotyping, exclusion
  flaggedReasons: string[];
};

export async function validateTheoryDraft(
  client: Anthropic,
  draft: TheoryDraft,
  spec: TheoryGenerationSpec,
): Promise<{ result: TheoryValidationResult; tokenUsage: ClaudeUsageBreakdown }>;
```

The dimensions differ from exercise validation. `ambiguous` doesn't apply (theory is prose, not an answer); `grammarPointMatch` becomes `examplesUseGrammarPoint` (sharper, more checkable); a new `factualErrors` array catches the most expensive failure mode (Claude confidently teaching a wrong rule) and a new `sectionsIncomplete` enforces the required-sections contract from the prompt.

System prompt: "You are a strict reviewer of language reference material for adult learners. The page is for CEFR {{cefrLevel}} {{language}}. Reject anything factually wrong; flag anything thin or off-level."

**3.2 — Routing (`packages/db/src/theory-generation/routing.ts`)**

```ts
export function routeTheoryValidationResult(r: TheoryValidationResult):
  { reviewStatus: 'auto-approved' | 'flagged' | 'rejected'; flaggedReasons: string[] } {

  // Hard rejects.
  if (r.factualErrors.length > 0) {
    return { reviewStatus: 'rejected', flaggedReasons: r.factualErrors };
  }
  if (r.culturalIssues.length > 0) {
    return { reviewStatus: 'rejected', flaggedReasons: r.culturalIssues };
  }
  if (r.qualityScore < 0.5) {
    return { reviewStatus: 'rejected', flaggedReasons: r.flaggedReasons };
  }

  // Flag conditions.
  if (r.qualityScore < 0.7) return { reviewStatus: 'flagged', flaggedReasons: r.flaggedReasons };
  if (r.levelMismatch) return { reviewStatus: 'flagged', flaggedReasons: ['level-mismatch', ...r.flaggedReasons] };
  if (r.sectionsIncomplete.length > 0) return { reviewStatus: 'flagged', flaggedReasons: r.sectionsIncomplete };
  if (!r.examplesUseGrammarPoint) return { reviewStatus: 'flagged', flaggedReasons: ['examples-off-target'] };

  return { reviewStatus: 'auto-approved', flaggedReasons: [] };
}
```

Stricter than exercise routing because the cost of a wrong theory page (a learner internalizes a false rule) is higher than the cost of a wrong exercise (one bad item in a 50-item pool).

**3.3 — Review CLI (`packages/db/scripts/review-flagged-theory.ts`)**

```bash
pnpm review:flagged-theory --lang es --level B1
```

Walks flagged theory rows, prints the rendered topic (sections inline as plain text via a one-shot `theoryTopicJsonToText` helper for the terminal), prompts `[a]pprove / [r]eject / [s]kip / [e]dit`. The `[e]dit` branch dumps the JSON to a temp file, opens `$EDITOR`, validates the edited JSON against the schema, and re-saves with `review_status='manual-approved'` and a note.

Mirrors `packages/db/scripts/review-flagged.ts` byte-for-byte except for the printed format and the rendered preview.

---

### Phase 4 — Productionization (Lambda + SQS + EventBridge)

**Goal:** the same generator runs unattended on AWS, refilling the catalog when curriculum entries are added.

**4.1 — Generation Lambda (`infra/lambda/src/theory-generation/handler.ts`)**

SQS-triggered, one message = one cell. Mirrors `infra/lambda/src/generation/handler.ts` with renamed imports.

```ts
type TheoryGenerationJobMessage = {
  jobId: string;
  trigger: 'scheduled' | 'admin';
  spec: {
    language: 'ES' | 'DE' | 'TR';
    grammarPointKey: string;       // string-form, resolved to GrammarPoint inside handler
    batchSeed: string;
  };
  maxCostUsd: number;
};
```

Handler body:
1. Read secrets (`ANTHROPIC_API_KEY`, `DATABASE_URL`) — same Secrets Manager pattern
2. Resolve `grammarPointKey → GrammarPoint` against `ALL_CURRICULA`
3. Idempotency guard: if a `theory_generation_jobs` row with `id=jobId` already exists, exit silently
4. Call `runOneTheoryCell`
5. Update audit row with terminal status

Reserved concurrency: **2** (intentionally tight; theory generation is rare and bursty, never live-traffic).

**4.2 — Scheduler Lambda (`infra/lambda/src/theory-generation/scheduler.ts`)**

EventBridge-invoked on a weekly cron (every Monday 04:00 UTC — theory cells fill once and stay; daily is overkill). Mirrors `infra/lambda/src/generation/scheduler.ts`:

```ts
export async function handler(): Promise<void> {
  // 1. enumerateTheoryCells(ALL_CURRICULA) → all (language × grammar-point) pairs where kind === 'grammar'
  // 2. SELECT (language, grammar_point_key) FROM theory_topics WHERE review_status IN (...)
  // 3. Diff in JS — every cell with no approved row is undersized
  // 4. Build TheoryGenerationJobMessage[] with deterministic jobIds:
  //      jobId = deterministicUuid([cellKey, batchSeed].join('|'))
  //      batchSeed = `theory-${YYYY-MM-DD-UTC}`
  // 5. SendMessageBatch in groups of 10
}
```

Same idempotency guarantees as the exercise scheduler — same-week re-fires collapse on the audit-row insert.

**4.3 — CDK constructs (`infra/lib/constructs/theory-{generation-lambda,generation-queue,scheduler-lambda}.ts`)**

Three new constructs that mirror the exercise-generation constructs structurally. Stack wiring (`infra/lib/stack.ts`) adds three lines.

The `enableScheduledJobs` flag on `LanguageDrillStackProps` already gates the EventBridge rule for exercise generation; reuse the same flag for theory. Default off in dev, on in prod.

**4.4 — Secrets, env vars, IAM**

Theory shares the same secrets as exercise generation (`ANTHROPIC_API_KEY`, `DATABASE_URL`). The new env vars are `THEORY_GENERATION_QUEUE_URL` (the new queue) and the IAM policy on the scheduler Lambda needs `sqs:SendMessage` on the new queue arn — additive, no policy churn for existing resources.

---

### Phase 5 — Panel registry fallback + admin tile

**Goal:** generated theory shows up in the panel without code changes per topic; the admin dashboard surfaces theory coverage.

**5.1 — Registry fallback (`apps/web/content/theory/index.ts`)**

The current registry is purely static. After Phase 5 it falls through to DB:

```ts
// Phase 5 additions:
import 'server-only';
import { db } from '@/lib/db';
import { theoryTopics } from '@language-drill/db';
import { renderTheoryTopicJson } from '@/components/theory/render-json';

export async function getTheoryTopic(
  language: LearningLanguage,
  topicId: string,
): Promise<TheoryTopic | null> {
  // 1. Static registry (hand-authored TSX) takes precedence — operator override.
  const staticTopic = (theoryRegistry[language] as Record<string, TheoryTopic>)[topicId];
  if (staticTopic) return staticTopic;

  // 2. DB fallback.
  const rows = await db.select()
    .from(theoryTopics)
    .where(and(
      eq(theoryTopics.language, language),
      eq(theoryTopics.topicId, topicId),
      inArray(theoryTopics.reviewStatus, ['auto-approved', 'manual-approved']),
    ))
    .limit(1);
  if (rows.length === 0) return null;
  return renderTheoryTopicJson(rows[0].contentJson as TheoryTopicJson);
}
```

This shifts `getTheoryTopic` from sync to async, which means the Theory Panel needs a small change: the panel today reads the topic synchronously inside the component body; Phase 5 introduces a `useTheoryTopic(language, topicId)` hook that fetches via TanStack Query against a new `GET /theory/:lang/:topicId` API route. The hand-authored TSX path stays sync — the hook short-circuits on a local cache hit before fetching.

`listTheoryTopics(language)` similarly merges the static keys with `SELECT topic_id, ... FROM theory_topics WHERE language=$1 AND review_status IN (...)`.

**5.2 — Admin tile (`apps/web/app/(dashboard)/admin/theory/page.tsx`)**

A coverage table mirroring the exercise pool dashboard, but the cells are 0/1 instead of 0–50:

| Language | A1 | A2 | B1 | B2 |
|---|---|---|---|---|
| ES | 12/15 ✓ | 10/14 ⚠ | 8/12 ⚠ | 0/9 ✗ |
| DE | 0/14 ✗ | … | … | … |
| TR | … | … | … | … |

Each cell is a count of curriculum grammar points at that level vs `theory_topics` rows with `review_status IN ('auto-approved', 'manual-approved')`. Same admin layout (`apps/web/app/(dashboard)/admin/layout.tsx`), same Clerk admin gate (`infra/lambda/src/middleware/admin.ts`).

**5.3 — Backend route (`infra/lambda/src/routes/theory.ts`)**

Two endpoints, both behind the existing JWT authorizer:

```
GET /theory/:lang/:topicId       → TheoryTopicJson | 404
GET /theory/:lang                  → { topics: Array<{ id, title, cefr }> }
```

Both serve from `theory_topics` filtered to approved rows. Cache TTL: 5 minutes via Upstash Redis (theory changes ~weekly at most). The cache key is `theory:${lang}:${topicId}`; cache invalidation on the review CLI's approve/edit path is one `redis.del(...)`.

---

## 5. Cost & throughput model

Round-1 target volume:

- 3 learning languages (ES, DE, TR)
- 4 CEFR levels in scope (A1, A2, B1, B2)
- ~20 grammar points per language per level → 80 cells per language, ×3 langs ≈ **240 cells total**
- 1 page per cell → **240 generated pages**
- Each page ≈ 2K input tokens (cached after first per-cell call) + ~3K output tokens (theory pages are ~5–8× longer than exercises)
- Each validation ≈ 4K input + 500 output, no cache (the validator reads the entire generated page)

At Sonnet 4.5 list pricing (`packages/ai/src/cost-model.ts`):

| | Per page | Total (240 pages) |
|---|---|---|
| Generation | ~$0.05 | **~$12** |
| Validation | ~$0.02 | **~$5** |
| **Round-1 total** | | **~$17** |

Steady-state replenishment is essentially zero — pages don't drain. The only refills are when the curriculum gets new grammar points (currently a ~10/year event). Annual cost ≈ $5.

These numbers are an order of magnitude smaller than exercise generation (~$170 round-1) because there's one page per cell instead of 50 drafts. The `--max-cost-usd` default for the CLI can be **$1.00** safely.

---

## 6. Resolved decisions

These were the open questions while drafting; resolutions below are load-bearing for the phases.

1. **Output format — structured JSON, not TSX.** Reason: lets the validator reason block-by-block, makes generation tool-use-driven (the gating mechanism that makes the exercise generator reliable), unlocks the audit trail and admin tile, and matches the spec's named v2 evolution. The hand-authored TSX path stays as the override for high-traffic topics like `subjunctive` where editorial polish matters more than coverage.
2. **Model choice — Sonnet 4.5 for both generation and validation.** Same as exercises. Pinned via the shared `GENERATION_MODEL` constant in `packages/ai/src/generate.ts:47`. Asserted equal in `theory-generate.test.ts` so the two paths cannot drift.
3. **Storage — DB (`theory_topics`) is canonical; the static TSX registry takes precedence as the override.** Moving the existing three ES topics into the DB is **out of scope** for this plan; they stay as TSX. The lookup order makes both paths coexistent.
4. **Cell shape — `(language, grammarPointKey)` only.** No `exerciseType` segment, no `count`. The unique partial index enforces one approved row per cell.
5. **Languages — ES, DE, TR.** EN is rejected at the CLI's argument parser, mirroring `generate-exercises.ts`. Round 1 ships ES first to validate the prompt against the existing hand-authored content; DE and TR follow once approval rates on ES are >85%.
6. **Vocab umbrellas — skipped.** Theory pages don't render meaningful content for "A1 high-frequency vocabulary." Phase 6 (out of scope) could add a different page kind for vocab strategy/recommendations, with its own template.
7. **Translation direction / source language — N/A.** Theory pages are written in English about the target language. The metalanguage is fixed; there is no L1 selection.
8. **Rate-limit interaction — shares the Anthropic key with exercise generation and live evaluation.** Theory generation Lambda concurrency is capped at **2** specifically because most theory runs are weekly batches that should never compete with the live evaluator. Bursts use the existing CloudWatch "Claude 429s observed" panel for visibility.
9. **Curriculum source — read directly from `packages/db/src/curriculum/{es,de,tr}.ts`** via the existing `ALL_CURRICULA` export. No DB-stored curriculum mirror; the modules are authoritative for both exercise and theory generation.
10. **Topic id slug — keep the CEFR level prefix.** Derivation: `grammarPoint.key.replace(/^[a-z]{2}-/, '')` (strip language only). `es-b1-present-subjunctive` → `b1-present-subjunctive`. Cross-level points with the same root slug stay distinct (`a2-conditional` vs `b1-conditional`) without a runtime collision check. The slug is panel-internal and never user-visible, so the longer form costs nothing.
11. **Hand-authored TSX stays as the override forever.** The three ES TSX files (`subjunctive`, `preterite-imperfect`, `conditional`) are not migrated to the DB and not re-generated. They serve as (a) the editorial override for high-traffic topics where polish matters more than coverage, and (b) the calibration corpus the validator's prompts are tuned against. The registry's lookup order (static TSX → DB) honors this.
12. **Parser rejects empty content at parse time.** Empty inline arrays, empty section bodies, and zero-section topics all throw at `parseTheoryTopicJson`. Reasons: matches the strict-at-parse pattern of `parseGeneratedClozeDraft`, surfaces generation bugs in `theory_generation_jobs.error_message` immediately, skips the validator's $0.02 round-trip on hopeless drafts, and prevents the "blank section in the panel" failure mode that learners can't distinguish from a bug.

---

## 7. Workflow

For each phase:

1. `/spec-create theory-generation-phase-N "…"` — drives the requirements/design/tasks docs.
2. Tasks are 5–30 min, atomic, with verification (`pnpm typecheck && pnpm test`).
3. Pre-push: `pnpm lint && pnpm typecheck && pnpm test` from repo root must all pass.
4. Phases 1–3 ship in sequence on `worktree-theory-content-generation`; Phase 4 onward ships to its own branch because it touches CDK.
5. After Phase 5, generate ES first (~$5, validate approval rate), then DE + TR if approval >85%.
