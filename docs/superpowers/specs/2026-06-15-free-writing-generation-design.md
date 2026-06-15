# Free-Writing Pre-Generation + Validation Pipeline — Design

**Date:** 2026-06-15
**Status:** Approved (design); pending implementation plan
**Scope:** Spanish (ES) only, CEFR B1 + B2. One PR (no audio step).

## Goal

Bulk-generate free-writing **prompts** per `(language, CEFR, topic)`, validate them,
and land approved/flagged rows in the shared `exercises` pool — mirroring the
dictation generation pipeline (commit `2f7fce1`, "Phase 2, PR1"). Free-writing
already has the `FreeWritingContent` shape, an evaluation prompt, and 4
hand-seeded rows; this adds only the **generation** side.

Free-writing has no audio, so the dictation PR2 half (Polly → S3 audio-synth
Lambda) does **not** apply — this is a single PR.

## Template being mirrored

The dictation pipeline is the closest analog: topic-driven, no real grammar
point, a `kind` umbrella curriculum entry, a dedicated
`*-generation-prompts.ts` / `*-validation-prompts.ts` file pair, type-routing in
`generate.ts` / `validate.ts`, and full reuse of `runOneCell` + the three pools
+ `generation_jobs` + the `exercises` table + shared `routeValidationResult`.

The one place free-writing diverges: **topic is a real cell dimension**, not a
loose per-draft hint. Each `(language, CEFR, topic)` is its own umbrella
curriculum entry → its own cell, so the scheduler tops up each topic to a target
deterministically.

## Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Topic modeling | Topic = its own cell, from a curated curriculum list |
| Language/CEFR scope | ES only, B1 + B2 (mirror dictation's first PR) |
| Register | Author-declared per topic entry |
| Length (min/max words, suggested minutes) | Derived from CEFR via a code table |
| Per-cell target | 12 prompts/cell (design-tunable) |
| Topics per level | ~6–8 each for ES B1, ES B2 (design-tunable) |
| Dedup surface | Normalised `title` |

## Architecture

### 1. Curriculum — topics as cells

- Add `'free-writing'` to the `GrammarPoint.kind` union in
  `packages/shared/src/curriculum-types.ts` (joins `'grammar' | 'vocab' |
  'dictation'`).
- Add one **optional** field to `GrammarPoint`:
  `freeWriting?: { register: 'informal' | 'neutral' | 'formal' }`. Carries the
  author-declared register per topic. Length is **not** stored here (CEFR-derived,
  §4). Only valid on `kind: 'free-writing'` entries (curriculum invariant).
- Author ~6–8 curated topic entries each for ES B1 and ES B2 in
  `packages/db/src/curriculum/es.ts`. Example:
  `es-b2-fw-remote-work` — `name` = "El teletrabajo: ¿avance o aislamiento?",
  `description` = the angle/framing the prompt should take,
  `freeWriting: { register: 'formal' }`. `examplesPositive` /
  `examplesNegative` / `commonErrors` describe "what a good prompt at this level
  looks like" (the same role dictation gives them). No `coverageSpec`
  (count-only, like dictation).
- `cells.ts` → `compatibleTypes()`: `kind: 'free-writing'` →
  `[ExerciseType.FREE_WRITING]`. Each topic entry yields one cell, key
  `es:b2:free_writing:es-b2-fw-remote-work`.

### 2. Generation prompt (new file)

- `packages/ai/src/free-writing-generation-prompts.ts`:
  - `FREE_WRITING_GENERATION_PROMPT_VERSION` (`free-writing-generate@YYYY-MM-DD`).
  - A cached system-prompt template: topic framing + CEFR descriptors + the
    author register + a "do not resemble these recent titles" list (the
    free-writing analog of `recentStems`). Same Langfuse-registered-template +
    in-repo-fallback pattern as the other prompts (flat `{{vars}}` for cache
    parity).
  - A per-draft user-prompt builder (ordinal + any per-draft variation).
- New generation tool `submit_free_writing_exercise` in `generate.ts`. The model
  authors only: `title`, `task`, `domain`, `instructions`,
  `requiredElements[]` (`{ id, label, detail? }`), `topicHint?`. The code injects
  `register` (from the topic entry) and `minWords` / `maxWords` /
  `suggestedMinutes` (from the CEFR table) — the model does **not** choose them.
- `parseGeneratedFreeWritingDraft(...)` (parallel to
  `parseGeneratedDictationDraft`): assembles the full `FreeWritingContent`,
  stamps `register` + length band, computes `_dedupKey`.

### 3. Validation prompt (new file)

- `packages/ai/src/free-writing-validation-prompts.ts`:
  - `FREE_WRITING_GENERATION_VALIDATION_PROMPT_VERSION`.
  - Scores a generated **prompt** (not a learner answer). Dimensions:
    - task is clear and self-contained;
    - achievable at the CEFR level within the word band;
    - `requiredElements` are realistic and answerable (not trivially few,
      not impossibly many, not self-contradictory);
    - register matches the declared register;
    - topic is safe/neutral;
    - the prompt does not secretly demand a specific structure it never states.
- Reuses the shared `submit_validation_result` tool and `routeValidationResult`
  **unchanged**, with fixed non-applicable fields like dictation:
  `ambiguous: false`, `contextSpoilsAnswer: false`, `grammarPointMatch: true`,
  `coverage: {}`. Routing thresholds inherited as-is (≥0.7 + `levelMatch` +
  no `culturalIssues` → auto-approve; `<0.5` or `culturalIssues` → reject; else
  flag).
- `validate.ts` gains an `isFreeWriting` branch selecting these builders.

### 4. CEFR → length table

A small table in the generation-prompts module, single source for both the
prompt text and the injected `FreeWritingContent` band (design-tunable):

| CEFR | minWords | maxWords | suggestedMinutes |
|---|---|---|---|
| B1 | 80 | 120 | 15 |
| B2 | 150 | 200 | 25 |

### 5. Dedup surface

`canonicalSurface()` currently **throws** for `FREE_WRITING`. Define it as the
normalised `title`, so two prompts on the same topic must differ in title. Feeds
`_dedupKey` and the existing generic `exercises_dedup_idx`
(`language, type, difficulty, grammar_point_key, _dedupKey`) — **no schema
change**.

### 6. Orchestration / infra — reused unchanged

- `runOneCell` + the generator/validator/outcome pools + `generation_jobs` +
  the `exercises` table are reused as-is. Generated rows land as
  `type='free_writing'`, `grammarPointKey=<topic key>`, `topicDomain=<domain>`,
  `reviewStatus` from routing — already covered by `poolLookupIdx` and the
  existing serve path (the 4 seed rows already serve; generated rows just add to
  the pool). No audio gate.
- `cell-targets.ts`: set `[ExerciseType.FREE_WRITING]: { B1: 12, B2: 12 }`
  (replacing today's empty `{}`). The scheduler is generic — once cells exist and
  carry a target, it auto-enqueues them at ~04:00 UTC. **No scheduler / handler /
  CDK changes; no audio Lambda.**
- CLI: the unified
  `pnpm generate:exercises --lang es --level B2 --type free_writing
  --grammar-point es-b2-fw-remote-work --count N` works once `cells.ts` routes
  the kind.

### 7. Loose ends

- Add both new prompts to the `PROMPTS` manifest in `bootstrap-prompts.ts`
  (single source for bootstrap + push + check) — otherwise they only ever serve
  the in-repo fallback.
- Bump `CURRICULUM_VERSION_ES` (clears the scheduler's low-yield suppression so
  the new cells actually run).
- New `free_writing` generation branches in the exhaustive `switch` /
  `Record<ExerciseType, …>` sites that the generation path touches (`generate.ts`,
  `validate.ts`, `canonicalSurface`). `ExerciseType.FREE_WRITING` already exists,
  so there is **no** enum-wide ripple across the wider app.

## Out of scope

- Audio (free-writing has none).
- Languages other than ES; CEFR levels other than B1/B2 (follow-up PRs).
- Register as a coverage axis, or Claude-chosen register/length (rejected in
  brainstorming).
- Any change to the free-writing **evaluation** prompt (grades learner answers —
  untouched here).
- Web/UI changes (generated rows flow through the existing serve + render path).

## Testing & gates

- Unit tests alongside each new module (prompt builders, draft parser, cells
  routing, cell-target entry, `canonicalSurface` free-writing case), following
  the dictation tests as a template.
- Full suite green before push:
  `pnpm lint && pnpm typecheck && pnpm turbo run test --concurrency=1`.

## Files touched (anticipated)

**New:**
- `packages/ai/src/free-writing-generation-prompts.ts`
- `packages/ai/src/free-writing-validation-prompts.ts`
- (+ co-located `*.test.ts` for each)

**Modified:**
- `packages/shared/src/curriculum-types.ts` (`kind` union + `freeWriting` field)
- `packages/db/src/curriculum/es.ts` (topic entries + `CURRICULUM_VERSION_ES` bump)
- `packages/db/src/generation/cells.ts` (`compatibleTypes` routing)
- `packages/ai/src/generate.ts` (`submit_free_writing_exercise` tool + parser + routing)
- `packages/ai/src/validate.ts` (`isFreeWriting` branch)
- `packages/ai/src/generation-prompts.ts` (`canonicalSurface` free-writing case)
- `packages/ai/src/index.ts` (re-export new version constants)
- `infra/lambda/src/generation/cell-targets.ts` (`FREE_WRITING` targets)
- `packages/ai/scripts/bootstrap-prompts.ts` (PROMPTS manifest entries — exact path to confirm at plan time)
</content>
</invoke>
