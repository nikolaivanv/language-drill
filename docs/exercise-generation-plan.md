# Exercise Generation Plan

A phased plan for building the tooling that produces the pre-generated exercise pool described in `docs/exercise-strategy.md` ("Pre-generated pool — default for all exercise types"). The pool is the cost backbone of the app: evaluation is metered per submission, but exercise *content* must be generated once, validated, and reused across all users.

This plan starts from what already exists in the repo, identifies the gaps, and lays out an incremental path from a one-off CLI to a scheduled Lambda batch system. It is deliberately conservative about scope: we ship a working generator for the three implemented exercise types (cloze, translation, vocab recall) in EN/ES/DE/TR before generalizing.

---

## 1. Goal & success criteria

The generator must produce exercises that:

1. **Slot into `exercises.contentJson` unchanged** — schemas already exist for cloze, translation, and vocab recall (`packages/shared/src/index.ts`); the generator output is one of those discriminated-union shapes, no UI changes required.
2. **Hit the pool target from the strategy doc** — ~50 exercises per `(language, CEFR level, exercise type, grammar point)` cell. Round 1 only fills the cells our curriculum actually defines, not the theoretical ceiling.
3. **Are pedagogically calibrated** — each exercise targets exactly one grammar point at a specific CEFR level, and the difficulty matches that level (no C1 vocab in an A2 exercise).
4. **Are deduplicated** — no two cloze exercises in the same cell share the same sentence stem; vocab cells don't repeat the same target word.
5. **Cost a known, bounded amount** — every batch declares its expected token spend up front and is hard-capped.
6. **Are reproducible** — given the same curriculum row + batch seed, the generator produces the same exercise IDs (idempotency).
7. **Have a human-in-the-loop fallback** — every generated exercise is automatically validated by a second Claude pass, and anything flagged is queued for manual review before it reaches users.

Non-goals for this plan: audio (Polly), speaking prompts, listening passages, and personal-word-bank exercises. Those have separate generation paths and are explicitly out of scope until the pre-gen pool for text exercises is solid.

---

## 2. Current state

What exists today (verified in the worktree):

- **Schema:** `packages/db/src/schema/exercises.ts` — `exercises (id, type, language, difficulty, contentJson, audioS3Key, createdAt)` + `exercise_tags(exerciseId, skillTopicId)` join table to `skill_topics(skillId, name, cefrLevel, language)`. The skills table is empty in seeds.
- **Content shapes:** `ClozeContent`, `TranslationContent`, `VocabRecallContent` discriminated by `ExerciseType` in `packages/shared/src/index.ts`. The generator output goes straight into `contentJson`.
- **AI package:** `packages/ai/src/{evaluate,prompts,index}.ts` — a clean evaluation engine using Claude tool use with `cache_control: ephemeral` on the system prompt. **There is no generator counterpart yet.**
- **Seed:** `packages/db/scripts/seed-exercises.ts` — 36 hand-authored exercises (4 langs × 3 types × 3 levels, one each). Uses a deterministic FNV-style hash for idempotent UUIDs. The pattern (`onConflictDoNothing` + deterministic key) is what the generator should copy.
- **CDK:** `infra/lib/stack.ts` already wires `QueueConstruct` (SQS + DLQ) and `enableScheduledJobs: boolean` on stack props. No scheduled Lambda is attached to either yet — both are scaffolded but unused.
- **Model in use:** `claude-sonnet-4-5` for evaluation (`packages/ai/src/evaluate.ts:207`). CLAUDE.md mentions `claude-sonnet-4-6`. Generation should use the same model the evaluator uses (so calibration matches), but make it a single config constant.

Gaps the generator will close:

| Gap | What's missing | Phase |
|-----|----------------|-------|
| Curriculum | No grammar-point inventory per language; `skill_topics` is empty | 1 |
| Schema metadata | `exercises` lacks `grammarPointId`, `topicDomain`, `qualityScore`, `generatedAt`, `reviewStatus` | 1 |
| Generator code | No `generate.ts` in `packages/ai`; no per-type prompt builders for generation | 2 |
| Validator | No second-pass quality check | 3 |
| Dedup | No similarity check; seed currently relies on hand-curated uniqueness | 3 |
| Batch driver | No CLI, no Lambda, no SQS message shape for generation jobs | 2, 4 |
| Pool depth tracking | No way to ask "how many exercises do I have for (ES, B1, cloze, subjunctive)?" | 4 |
| Scheduling | EventBridge rule + Lambda not wired | 4 |
| Review UI | Flagged exercises have no admin surface | 5 |

---

## 3. Architecture overview

The generator is a separate concern from the live API. It runs in three modes, all sharing the same core code in `packages/ai`:

```
                    ┌────────────────────────────────────────────┐
                    │ packages/ai/src/generate.ts (core)         │
                    │  • generateBatch(spec) → ExerciseDraft[]   │
                    │  • validateDraft(draft) → ValidationResult │
                    │  • promptBuildersByType                     │
                    └────────────────┬───────────────────────────┘
                                     │
        ┌────────────────────────────┼─────────────────────────────────┐
        ▼                            ▼                                 ▼
 ┌─────────────────┐         ┌────────────────────┐          ┌──────────────────┐
 │ CLI (dev)        │        │ Lambda + SQS        │          │ Lambda invoke    │
 │ packages/db/     │        │ infra/lambda/       │          │ on demand (admin │
 │ scripts/         │        │ generate-handler.ts │          │ trigger)         │
 │ generate-pool.ts │        │ scheduled by        │          │                  │
 │                  │        │ EventBridge daily   │          │                  │
 └────────┬─────────┘        └─────────┬──────────┘          └────────┬─────────┘
          │                            │                              │
          └────────────────┬───────────┴──────────────────────────────┘
                           ▼
                   ┌──────────────────┐
                   │  Neon Postgres   │
                   │  exercises +     │
                   │  generation_jobs │
                   └──────────────────┘
```

**Key design choices:**

- **One core, three triggers.** The CLI (Phase 2) and Lambda (Phase 4) wrap the same `generateBatch` function — the Lambda just adds SQS message parsing, secrets fetch, and structured logging.
- **Anthropic Batches API for bulk runs.** [Message Batches](https://docs.anthropic.com/en/api/messages-batches) gives 50% off and tolerates 24h turnaround — perfect for "fill a 1,000-cell pool overnight." Real-time generation (admin trigger) uses the standard messages endpoint.
- **Prompt caching across the batch.** The system prompt + curriculum-row context (language profile, CEFR descriptors, target grammar point explanation) is identical for all 50 exercises in a cell. `cache_control: ephemeral` gives ~80% prompt-token savings within the 5-minute cache TTL — critical when each cell is one Claude call per draft.
- **Deterministic IDs.** UUID v5-style hash of `(language, type, cefrLevel, grammarPointId, batchSeed, ordinal)`. Re-running the generator on the same spec produces the same IDs → idempotent, no duplicate inserts. Mirrors the existing seed pattern.
- **Two-pass quality.** Generation prompt is calibrated for *productivity* (give me a B1 cloze on the past subjunctive); validation prompt is calibrated for *strictness* (is this actually B1? is the answer unambiguous?). Same model, different prompts, different temperatures (0.7 → 0.0).
- **Pool is a queue, not a table.** Conceptually, generation refills a per-cell queue. We don't track this with a real queue table — we just count rows in `exercises` filtered by cell and trigger refills when count drops below a threshold.

---

## 4. Phased delivery

Total estimated effort: **~10–12 working days**, broken into six phases. Phases 1–3 produce a working dev-time generator (CLI). Phase 4 productionizes it. Phases 5–6 are quality and scale follow-ups that can ship later.

| Phase | Output | Effort | Depends on | Status |
|-------|--------|--------|------------|--------|
| 1 | Curriculum data + schema migration | ~1.5d | — | **Shipped** |
| 2 | Generator core + CLI driver | ~2d | 1 | **Shipped** |
| 3 | Validation + dedup + review queue | ~2d | 2 | **Shipped** |
| 4 | Lambda + SQS + EventBridge | ~2d | 3 | **Shipped** |
| 5 | Pool monitoring + adaptive scheduling | ~1.5d | 4 | Pending |
| 6 | Generators for new exercise types as added | rolling | 2 | Pending |

---

### Phase 1 — Curriculum & schema

**Status: shipped.** Spec docs live at `.claude/specs/exercise-generation/`. Migration `0004_sharp_quentin_quire.sql` applied to the `dev` Neon branch and the partial index `exercises_pool_lookup_idx` was verified to be hit (`Index Scan` plan when seqscan is forced — see PR description for the EXPLAIN output). EN curriculum was dropped per resolved decision #4; ES/DE/TR each ship 23 entries (20 grammar + 3 vocab umbrellas).

**Goal:** give the generator a structured input that says "produce N exercises of type T at level L targeting grammar point G in language LANG."

**1.1 — Curriculum content (~0.5d)**

Author a per-language grammar curriculum as a TypeScript module, seeded into `skill_topics`:

```
packages/db/src/curriculum/
  ├── es.ts   ~25 grammar points across A1–C2
  ├── de.ts   ~25 points
  ├── tr.ts   ~25 points
  └── en.ts   ~20 points (smaller — EN is mostly source-only)
```

Each entry:

```ts
{
  key: 'es-b1-present-subjunctive',  // stable, used in deterministic UUIDs
  name: 'Present subjunctive',
  description: 'Use of the present subjunctive in noun, adjective, and adverbial clauses.',
  cefrLevel: 'B1',
  language: 'ES',
  examplesPositive: ['Espero que llegues a tiempo.', 'No creo que sea cierto.'],
  examplesNegative: ['*Espero que llegas a tiempo.'],
  commonErrors: ['Indicative used after expressions of doubt/desire.'],
  prerequisiteKeys: ['es-a2-present-indicative'],
}
```

The curriculum lives in code (not a DB-only seed) because (a) it's small enough, (b) the generator imports it directly to build prompts, and (c) it changes infrequently and is reviewed via PR.

The `progress-tracking.md` doc already lists the per-language CEFR grammar tables — those become the starting point for the curriculum files. Numbers in the strategy doc imply ~120 grammar points per language total, but we ship A1–B2 first (~80 points/lang).

**1.2 — Schema migration (~0.5d)**

Extend `exercises` (one Drizzle migration):

```sql
ALTER TABLE exercises
  ADD COLUMN grammar_point_key TEXT,             -- FK-by-string to curriculum module
  ADD COLUMN topic_domain TEXT,                  -- everyday | academic | professional | travel
  ADD COLUMN generation_source TEXT NOT NULL DEFAULT 'manual',  -- manual | claude-batch | claude-realtime
  ADD COLUMN model_id TEXT,                      -- e.g. 'claude-sonnet-4-5'
  ADD COLUMN quality_score REAL,                 -- 0..1 from validator pass; null = unvalidated
  ADD COLUMN review_status TEXT NOT NULL DEFAULT 'auto-approved',  -- auto-approved | flagged | rejected | manual-approved
  ADD COLUMN flagged_reasons JSONB,
  ADD COLUMN generated_at TIMESTAMPTZ;

CREATE INDEX exercises_pool_lookup_idx
  ON exercises (language, difficulty, type, grammar_point_key)
  WHERE review_status IN ('auto-approved', 'manual-approved');
```

Add a sibling table to track batch runs:

```sql
CREATE TABLE generation_jobs (
  id UUID PRIMARY KEY,
  cell_key TEXT NOT NULL,                  -- "es:B1:cloze:es-b1-present-subjunctive"
  requested_count INT NOT NULL,
  produced_count INT NOT NULL DEFAULT 0,
  approved_count INT NOT NULL DEFAULT 0,
  flagged_count INT NOT NULL DEFAULT 0,
  rejected_count INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL,                    -- queued | running | succeeded | failed
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  input_tokens_used INT,
  output_tokens_used INT,
  cost_usd_estimate NUMERIC(10,4),
  trigger TEXT NOT NULL,                   -- cli | scheduled | admin
  error_message TEXT
);

CREATE INDEX generation_jobs_cell_idx ON generation_jobs (cell_key, started_at DESC);
```

`generation_jobs` is the audit trail: every batch is one row, regardless of whether it ran via CLI or Lambda. It's how we'll answer "how much have we spent on generation this week" and "when was the last refill for ES/B1/subjunctive."

**1.3 — Backfill curriculum into `skill_topics` (~0.5d)**

Update `seed-exercises.ts` (or split into a new `seed-skills.ts`) so `skill_topics` is populated from the curriculum modules. The 36 existing seed exercises get their `exercise_tags` rows back-filled to the relevant grammar point. This is the dataset the generator's pool monitor (Phase 5) will read against.

---

### Phase 2 — Generator core + CLI

**Status: shipped.** Spec docs live at `.claude/specs/exercise-generation-phase-2/`. The CLI runs end-to-end against the dev Neon branch: `pnpm generate:exercises --lang es --level B1 --type cloze --grammar-point es-b1-present-subjunctive --count 3` produced 3 valid cloze drafts in 16s for $0.0225 (smoke captured in the PR description). Phase 3 (validator pass + across-batch dedup) is the next dependency.

**Goal:** a single command — `pnpm generate:exercises --lang es --level B1 --type cloze --grammar-point es-b1-present-subjunctive --count 50` — that produces drafts and inserts them into `exercises` with `review_status = 'auto-approved'` (validation comes in Phase 3).

**2.1 — Generator package (`packages/ai/src/generate.ts`)**

API surface mirroring `evaluate.ts`:

```ts
export type GenerationSpec = {
  language: Language;
  cefrLevel: CefrLevel;
  exerciseType: ExerciseType;
  grammarPoint: GrammarPoint;        // from curriculum
  topicDomain?: TopicDomain;          // optional, defaults to mixed
  count: number;                       // exercises to produce in this batch
  batchSeed: string;                   // for deterministic IDs
};

export type ExerciseDraft = {
  id: string;                          // deterministic UUID
  contentJson: ExerciseContent;        // discriminated union — slots into the existing column
  metadata: {
    grammarPointKey: string;
    topicDomain: TopicDomain;
    modelId: string;
    inputTokens: number;
    outputTokens: number;
  };
};

export async function generateBatch(
  client: Anthropic,
  spec: GenerationSpec,
): Promise<{ drafts: ExerciseDraft[]; tokenUsage: TokenUsage }>;
```

Internals: a `tools` schema per `ExerciseType` that mirrors the content shape. The model is forced to call the tool, just like the evaluator does — no free-text parsing.

**2.2 — Per-type generation prompts (`packages/ai/src/generation-prompts.ts`)**

System prompt template (cached per cell):

```
You are an expert language exercise author for {{language}} learners at CEFR
{{cefrLevel}}. Your job is to produce one exercise of type {{exerciseType}}
that targets exactly one grammar point: {{grammarPoint.name}}.

## Grammar point context
{{grammarPoint.description}}

## Positive examples
{{grammarPoint.examplesPositive}}

## Common learner errors
{{grammarPoint.commonErrors}}

## CEFR descriptors
{{...same descriptors used in EVALUATION_SYSTEM_PROMPT — DRY}}

## Hard constraints
- The correct answer must be uniquely correct given the surrounding context.
- Vocabulary outside CEFR {{cefrLevel}} is forbidden unless the exercise
  explicitly tests it.
- Do not produce an exercise that resembles any of these existing stems:
  {{recentStems}}      ← seeded with stems from previous drafts in this run
- One exercise per tool call. Do not batch multiple inside one tool call.
```

A user message is sent per draft (`count` user messages, each saying "produce exercise #N"). Because the system prompt is the heavy lift and stays identical across the batch, prompt caching pays off the first call and runs effectively free for the remaining 49.

The `recentStems` list grows during the batch — each successful draft's identifying surface (cloze sentence stem, translation source text, vocab target word) is appended so the generator naturally diversifies. This is much cheaper than a vector-similarity dedup pass for in-batch dedup.

**2.3 — Deterministic IDs**

```ts
function exerciseDraftId(spec: GenerationSpec, ordinal: number): string {
  const key = [
    spec.language,
    spec.cefrLevel,
    spec.exerciseType,
    spec.grammarPoint.key,
    spec.batchSeed,
    String(ordinal),
  ].join('|');
  return deterministicUuid(key);  // reuse the helper from seed-exercises.ts
}
```

Re-running the same spec is a no-op (`onConflictDoNothing` already handles it). Bumping `batchSeed` is the explicit "give me 50 more" lever.

**2.4 — CLI driver (`packages/db/scripts/generate-exercises.ts`)**

```bash
# Single cell, 50 exercises:
pnpm generate:exercises \
  --lang es --level B1 --type cloze \
  --grammar-point es-b1-present-subjunctive --count 50

# Whole language at one level, all defined cells:
pnpm generate:exercises --lang es --level B1 --count 50

# Dry run — print spec, estimated cost, no Claude calls:
pnpm generate:exercises --lang es --level B1 --dry-run
```

Behavior:

1. Reads `DATABASE_URL` and `ANTHROPIC_API_KEY` from env (consistent with existing scripts).
2. Resolves the cell list from CLI args + curriculum.
3. For each cell, opens a `generation_jobs` row (`status='running'`), then calls `generateBatch`, then `INSERT … ON CONFLICT DO NOTHING` into `exercises`, then closes the job row.
4. **Concurrency:** processes cells serially by default (`--concurrency 1`). The Anthropic SDK's built-in retry/backoff handles transient errors. Higher concurrency is opt-in via flag — handy for filling many cells overnight from a laptop, but needs visible cost guardrails.
5. **Cost cap:** per-run flag `--max-cost-usd 5` aborts the run when estimated spend exceeds the cap. Estimate from `tokenUsage` accumulated across cells.
6. **Output:** structured log per cell + a summary table at the end (cells, drafts, tokens, $$). Mirrors the seed script's "Summary by language" output.

This is the artifact that lets a developer fill the pool from their laptop on day one. Phase 4 wraps the same logic in a Lambda; nothing in the core needs to change.

**2.5 — Tests**

Following the project convention (tests next to module, no orphan files):

- `packages/ai/src/generate.test.ts` — unit tests against a mocked Anthropic client; covers each exercise type, validates the tool-input parser rejects malformed responses (mirror of `evaluate.test.ts`).
- `packages/db/scripts/generate-exercises.test.ts` — integration test that runs the CLI against a Neon dev branch with `MOCK_CLAUDE=1` (responses replayed from a fixture).

---

### Phase 3 — Validation, dedup, review queue

**Status: shipped.** Spec docs live at `.claude/specs/exercise-generation-phase-3/`. Validator + router land in `packages/ai/src/{validate,validation-prompts}.ts` and `packages/db/scripts/generate-exercises-validate.ts`; across-batch dedup ships as the partial UNIQUE index `exercises_dedup_idx` in migration `0006_*.sql`; `runOneCell` now wires generator → validator → router → dedup-retry (up to 3× per ordinal) and writes `approved_count` / `flagged_count` / `rejected_count` to `generation_jobs`. The review CLI lands as `pnpm review:flagged --lang … --type … --limit …` with single-keystroke approve/reject/skip/quit. End-to-end smoke against the dev Neon branch: `pnpm generate:exercises --count 3` produced 2 auto-approved + 0 flagged + 1 rejected (validator vetoed the third draft) for $0.0415 in 29s; the validator-standalone smoke auto-approved one draft of each type at q=0.85; the review CLI smoke flipped a row to `flagged` via SQL, drove `s` then `a` across two runs, and confirmed the final state was `manual-approved` with `flagged_reasons=NULL`. Phase 4 (Lambda + SQS + EventBridge) is the next dependency.

**Goal:** every generated draft passes through quality control before users see it. Anything ambiguous gets `review_status = 'flagged'` and is invisible until a human approves it.

**3.1 — Validator (`packages/ai/src/validate.ts`)**

Second Claude call per draft — independent, cold-cached, low temperature:

```ts
export async function validateDraft(
  client: Anthropic,
  draft: ExerciseDraft,
  spec: GenerationSpec,
): Promise<ValidationResult>;

type ValidationResult = {
  qualityScore: number;          // 0..1
  ambiguous: boolean;             // multiple equally-correct answers?
  levelMatch: boolean;            // does the difficulty match the spec?
  grammarPointMatch: boolean;     // does the exercise actually test the target grammar point?
  culturalIssues: string[];       // sensitive content, stereotyping, etc.
  flaggedReasons: string[];       // free-text reasons (denormalized into exercises.flagged_reasons)
};
```

System prompt: "You are a strict reviewer of language exercises. Reject anything ambiguous."

Routing rule:

| Validator says | Action |
|----------------|--------|
| `qualityScore >= 0.7 && !ambiguous && levelMatch && grammarPointMatch` | `review_status = 'auto-approved'` |
| `qualityScore >= 0.5` but with reservations | `review_status = 'flagged'` |
| `qualityScore < 0.5` or `culturalIssues.length > 0` | `review_status = 'rejected'`, **not** inserted into `exercises` |

Validator runs are charged separately from generation runs in the cost report.

**3.2 — Dedup**

Two layers:

1. **Within-batch (free):** the generation prompt's `recentStems` list (Phase 2.2) prevents in-batch repeats.
2. **Across-batch (cheap):** before insert, hash the canonical surface (lowercased, accent-stripped cloze stem; lowercased target word for vocab; lowercased source text for translation) and check uniqueness within the cell. Implemented as a `UNIQUE` partial index:

```sql
CREATE UNIQUE INDEX exercises_dedup_idx
  ON exercises (language, type, difficulty, grammar_point_key, (content_json->>'_dedupKey'))
  WHERE review_status IN ('auto-approved', 'manual-approved');
```

`_dedupKey` is computed at insert time from the content. A duplicate insert silently no-ops via `ON CONFLICT (... ) DO NOTHING`, and the generator is told to retry up to 3× per slot.

Semantic similarity (embedding-based) is **deferred**. Surface dedup is enough to start; we can add embedding dedup later if the pool starts feeling repetitive in practice.

**3.3 — Review queue (CLI-only for now)**

```bash
pnpm review:flagged --lang es --level B1
```

Walks flagged exercises one by one, prints them, prompts `[a]pprove / [r]eject / [s]kip`. Updates `review_status` accordingly. This is enough until we have an admin UI; flagged volume is expected to be <5% of generated drafts at typical validator thresholds.

---

### Phase 4 — Productionization (Lambda + SQS + EventBridge)

**Status: shipped.** Spec docs live at `.claude/specs/exercise-generation-phase-4/`. A dedicated generation SQS queue + DLQ (`GenerationQueueConstruct`), a worker Lambda (`GenerationLambdaConstruct`, SqsEventSource, reserved concurrency=3), and a scheduler Lambda (`SchedulerLambdaConstruct`, optional EventBridge daily rule) are wired into `infra/lib/stack.ts` and exposed via CDK output `GenerationQueueUrl`. The CLI gains a `--queue` flag that posts `GenerationJobMessage` objects directly to SQS instead of running Claude locally. `GrammarPoint` and `CurriculumCefrLevel` were moved from `@language-drill/db` to `@language-drill/shared` to break the build cycle introduced by the Lambda handler importing `runOneCell` from `packages/ai`. End-to-end smoke against `LanguageDrillStack-dev`: CLI posted job `cbccb4df-4895-4772-a551-a0a4aa1893da`, Lambda completed in 65 s, `approved_count=3 / flagged=0 / rejected=0`, three `auto-approved` rows confirmed in the dev DB. Phase 5 (pool monitoring + adaptive replenishment) is the next dependency.

**Goal:** the same generator runs unattended on AWS. The CLI stays usable for ad-hoc fills.

**4.1 — Generation Lambda (`infra/lambda/src/generate-handler.ts`)**

Triggered by the existing SQS `JobsQueue` (already provisioned in `infra/lib/constructs/queue.ts`). One SQS message = one cell = one batch:

```ts
type GenerationJobMessage = {
  jobId: string;                   // UUID, used as both SQS dedup id and generation_jobs.id
  spec: GenerationSpec;
  trigger: 'scheduled' | 'admin' | 'pool-replenish';
};
```

The handler:
1. Reads secrets (`ANTHROPIC_API_KEY`, `DATABASE_URL`) the same way the existing API Lambda does.
2. Inserts a `generation_jobs` row, then runs `generateBatch` + `validateDraft`.
3. Inserts approved drafts.
4. Updates the `generation_jobs` row to `succeeded` / `failed` with token counts.
5. SQS visibility timeout: bumped from 90s to 600s on a *separate* generation queue (not the existing `JobsQueue` which is shared with other future jobs — keep them isolated).

Scaling: Lambda reserved concurrency = **3** for generation. This is intentionally tight — we do not want a runaway batch to vaporize the API budget.

**4.2 — Use the Anthropic Messages Batches API for scheduled runs**

For non-urgent overnight refills, switch the Lambda to enqueue requests with the [Messages Batches API](https://docs.anthropic.com/en/api/messages-batches): up to 100k requests, 24h SLA, 50% off. The batch result is polled by a separate "batch-collector" Lambda triggered every 30 min.

For admin-triggered fills, stay on the standard messages endpoint (real-time). This dual path is the one place the core in `packages/ai` is **not** trigger-agnostic — the batch path needs to format requests as JSONL and parse results from S3. Encapsulate this in `packages/ai/src/batch.ts` with a unified return shape so callers don't care which path they took.

**4.3 — EventBridge schedule**

A daily CloudWatch Events rule that:
1. Queries `generation_jobs` for cells whose *approved exercise count* is below a per-cell minimum (e.g. 25).
2. For each undersized cell, posts an SQS message to refill it back to 50.

Pseudocode (in a small "scheduler" Lambda triggered by the EventBridge rule):

```ts
const undersized = await db.execute(sql`
  WITH cells AS (
    SELECT language, difficulty, type, grammar_point_key
    FROM curriculum_cells_view  -- materialized view from the curriculum import
  ),
  counts AS (
    SELECT language, difficulty, type, grammar_point_key, COUNT(*) AS approved
    FROM exercises
    WHERE review_status IN ('auto-approved', 'manual-approved')
    GROUP BY 1,2,3,4
  )
  SELECT cells.*, COALESCE(counts.approved, 0) AS approved
  FROM cells
  LEFT JOIN counts USING (language, difficulty, type, grammar_point_key)
  WHERE COALESCE(counts.approved, 0) < ${MIN_PER_CELL}
`);

for (const cell of undersized) {
  await sqs.sendMessage({ ... GenerationJobMessage ... });
}
```

This is the "refill" loop. It runs daily; in steady state most cells are at target and nothing happens. After exercises start being consumed (history rows accumulate), depleted cells get refilled automatically.

**4.4 — Observability**

- Each `generation_jobs` row carries token + cost numbers — that's the canonical audit trail.
- A simple CloudWatch dashboard: jobs per day, approval rate, $ per day, p95 latency per job. Built in CDK alongside the Lambda construct.
- On-call alarm: SQS DLQ depth > 0, or daily cost > configured cap.

**4.5 — Toggle via existing flag**

`enableScheduledJobs` (already on `LanguageDrillStackProps`) gates the EventBridge rule. Default off in dev, on in prod. The Lambda construct itself is always created so the queue + handler are testable in dev.

---

### Phase 5 — Pool monitoring & adaptive replenishment

This is where the generator stops being a static seed and starts behaving like a pool.

**5.1 — Pool depth API**

`GET /admin/pool-status?language=ES&level=B1` returns:

```json
[
  {
    "type": "cloze",
    "grammarPointKey": "es-b1-present-subjunctive",
    "approved": 47,
    "flagged": 3,
    "rejected": 2,
    "lastRefilledAt": "2026-05-04T03:12:00Z",
    "depletionRate7d": 6.4
  },
  ...
]
```

This drives the dashboard tile and gives the scheduler smarter inputs (fill cells with high depletion rates first).

**5.2 — Skill-aware target sizes**

Not every cell needs 50 exercises. Cells that map to high-traffic grammar points (presented to many users at once) should target 100+; rarely-targeted points can stay at 25. Implement as a function `targetCellSize(cellKey)` that uses the depletion rate as a proxy for traffic.

**5.3 — Cost dashboard**

A page in `apps/web/app/(dashboard)/admin/generation/` (Clerk-gated to a single admin role) that surfaces:

- $ spent on generation, this week / month
- Batches succeeded vs failed
- Approval rate by language / level / type
- Pool coverage heatmap (cells × types — how many cells are at target)

This is the operational surface that tells us when the pool is healthy.

---

### Phase 6 — New exercise types

When `docs/exercise-strategy.md` Phases 2+ ship, each new exercise type adds:

1. A new `ExerciseContent` shape in `packages/shared`.
2. A new content tool schema in `packages/ai/src/generate.ts` + a generation prompt builder.
3. A new validator user-prompt (the system prompt is shared).
4. Optional: new metadata columns if the type needs them (e.g. `audio_s3_key` already exists for listening).

Order matches the strategy doc: sentence construction → error correction → paragraph → contextual paraphrase → dialogue → mini-essay → listening → speaking. Each is roughly 0.5–1d of generator work given the framework from Phases 1–4.

---

## 5. Cost & throughput model

Round-1 target volume:

- 3 learning languages (ES, DE, TR) + EN as source-only for translation
- 3 exercise types (cloze, vocab recall — per language; translation — both directions)
- 4 CEFR levels in scope for round 1 (A1, A2, B1, B2)
- ~20 grammar points per language per level → 80 cells per language per type, ×3 langs ×3 types ≈ **720 cells**
- 50 drafts per cell → **36,000 drafts**
- Each draft ≈ 1.5K input tokens (cached after first) + 400 output tokens
- Each validation ≈ 1K input + 200 output, no cache

At Sonnet 4.5 list prices and assuming ~80% input-cache hit rate during a batch:

- Generation: ~$110
- Validation: ~$60
- **Round-1 total: ~$170**, fully refundable in the steady state because the pool is reused across all users.

Steady-state replenishment after launch: if a cell of 50 drains to 25 once per quarter on average, refilling all 720 cells once per quarter ≈ $40/qtr. This is the number the cost dashboard tracks against.

These numbers anchor the `--max-cost-usd` defaults in the CLI and the daily-cap alarm in CloudWatch.

---

## 6. Resolved decisions

These were the open questions while drafting; resolutions below are now load-bearing for the phases above.

1. **Model choice for generation — Sonnet for both generation and validation.** Matches the evaluator so calibration is consistent. Revisit after Phase 3 once we see real approval rates; if approval is consistently >95% we can try Haiku for generation as a cost optimization.
2. **Translation direction — EN→target only for round 1.** L2→EN exists in the strategy doc but isn't required for the production-test goal. The generator's translation prompt builder hard-codes `sourceLanguage: 'EN'` and `targetLanguage: spec.language`. Adding L2→EN later is one new prompt builder + a curriculum flag.
3. **Topic domains — left empty (mixed-domain) for round 1.** The `topic_domain` column is added in Phase 1.2 but the generator does not vary by domain yet. Domain-aware generation lights up when paragraph/free-writing types ship in Phase 6 (those need domain prompts anyway).
4. **EN as a learning language — dropped from the generator's input.** The 9 hand-authored EN seed exercises stay (useful for tests and as fixtures), but `generate-exercises.ts` skips EN cells. Curriculum module `packages/db/src/curriculum/en.ts` is therefore not authored in Phase 1.1 — only `es.ts`, `de.ts`, `tr.ts`.
5. **Curriculum maintenance — deferred.** Curriculum lives in TypeScript modules owned by whoever ships the next phase. The format is a pure data shape, so lifting it to a DB table or a teacher-editable surface later is mechanical.
6. **Rate-limit interaction — single Anthropic API key for both generation and evaluation.** Generation Lambda concurrency stays capped at **3** specifically to leave headroom for the live evaluator under the org-tier rate limit. The Phase 4 CloudWatch dashboard adds a "Claude 429s observed" panel; if we ever see evaluator throttling correlated with generation runs, the mitigation is to (a) lower generation concurrency, or (b) move bulk generation onto the Messages Batches API path (Phase 4.2), which doesn't share the live messages quota.

---

## 7. Workflow

For each phase:

1. `/spec-create exercise-generation-phase-N "…"` — drives the requirements/design/tasks docs.
2. Tasks are 5–30 min, atomic, with verification (`pnpm typecheck && pnpm test`).
3. Pre-push: `pnpm lint && pnpm typecheck && pnpm test` from repo root must all pass.
4. Phases 1–3 ship in sequence on `worktree-exercise-generation` branch; Phase 4 onward ships to its own branch because it touches CDK.
