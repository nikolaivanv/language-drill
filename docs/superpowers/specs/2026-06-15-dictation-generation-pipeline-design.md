# Dictation Generation Pipeline — Design

_Date: 2026-06-15 · Status: designed (pending plan) · Roadmap item 1 of [`2026-06-15-dictation-phase-2.md`](2026-06-15-dictation-phase-2.md)_

## Goal

Wire the `dictation` exercise type into the background generation pipeline so the
pool fills and refreshes automatically like cloze / translation / vocab /
sentence-construction. Today dictation is the **only** generated exercise type
not produced by the pipeline — slice 1 hand-seeds ~6 Spanish clips via
`pnpm db:seed:dictation` (text authored in-repo, audio synthesized once at seed
time). After this milestone the scheduler refills under-target dictation cells,
Claude drafts + validates the clip text, and a background Lambda synthesizes the
audio.

Phase-1 contracts this builds on: [`2026-06-13-dictation-exercise-design.md`](2026-06-13-dictation-exercise-design.md),
plan [`../plans/2026-06-14-dictation-exercise-slice-1.md`](../plans/2026-06-14-dictation-exercise-slice-1.md).

## Scope (decided during brainstorming)

- **Cell model:** synthetic per-`(language, CEFR)` dictation cells (a clip tests
  several grammar points + carries a domain/register, so it does not fit the
  one-grammar-point-per-cell model).
- **Variety control:** count-only — no new coverage axis. Variety comes from
  generation temperature + the existing dedup index. (Revisit a `domain` axis
  only if the pool looks samey.)
- **Language/level scope:** **ES B1/B2 only** this milestone — mirrors the
  slice-1 seeded scope, smallest blast radius, and there is a hand-seeded
  baseline to compare against. DE/TR and other levels are a later widening
  (roadmap "more languages + bigger pool").
- **Staging:** two PRs — PR 1 (no infra: text generation + validation + serve
  gate + eval:gen), PR 2 (infra: audio-synth Lambda + CDK + handler enqueue).
- **Seed script:** retire its inline Polly code — the seed script keeps
  authoring its 6 clips but calls the shared synth helper (no duplicate Polly).

Out of scope (deferred to other roadmap items / smaller-items list): real
waveform envelopes, exact audio duration, the gap-fill variant, phonology
sub-competencies, unstuck helpers, CloudFront signed URLs.

---

## Section 1 — Synthetic dictation cells (the keystone)

The pipeline keys everything — `cellKey`, per-cell targets, scheduler
enumeration, the `generation_jobs` audit row — off a `GrammarPoint`. To make
dictation a first-class generated cell with minimal machinery churn, introduce a
new **`kind: 'dictation'`** discriminator on `GrammarPoint` and author two
umbrella entries in the ES curriculum.

**Changes:**

- `packages/shared/src/curriculum-types.ts` — widen `GrammarPoint.kind` to
  `'grammar' | 'vocab' | 'dictation'`.
- `packages/db/src/generation/cells.ts` — `compatibleTypes()` returns
  `[ExerciseType.DICTATION]` for `kind === 'dictation'` (and **only** that — no
  cloze/translation/vocab). `clozeUnsuitable` / `sentenceConstructionSuitable`
  remain grammar-only.
- `packages/db/src/curriculum/es.ts` — add `es-b1-dictation`, `es-b2-dictation`:

  ```ts
  {
    key: 'es-b1-dictation',
    kind: 'dictation',
    name: 'Dictation — connected speech (B1)',
    description:
      'Natural connected-speech clips (~2–4 short sentences) on everyday B1 domains; tests sinalefa, weak-syllable reduction, and common spelling traps.',
    cefrLevel: 'B1',
    language: 'ES',
    examplesPositive: [ /* 2 representative reference texts */ ],
    examplesNegative: [ /* 1 mis-transcription example */ ],
    commonErrors: [ /* word-boundary / silent-letter slips */ ],
  }
  ```

  The example/error fields are **not vestigial** — they feed the dictation
  generation prompt as theme + style guidance, so we keep the required
  `GrammarPoint` fields and populate them meaningfully rather than relaxing the
  type.
- `packages/db/src/curriculum/index.ts` — extend the curriculum invariants to
  permit `kind: 'dictation'` (and keep the `wordClass`-axis = vocab-only,
  `clozeUnsuitable` / `sentenceConstructionSuitable` = grammar-only guards).

**Why not synthesize cells outside the curriculum?** `enumerateCurriculumCells`
is the *canonical* cell-universe builder shared by the scheduler and the CLI;
forking it risks the two trigger paths drifting. Adding a curriculum kind keeps
one source of truth.

No `coverageSpec` on these umbrellas ⇒ count-only, no per-axis targeting.

---

## Section 2 — Text generation & validation (`packages/ai`)

### Generation

- New `packages/ai/src/dictation-generation-prompts.ts`:
  - `DICTATION_GENERATION_PROMPT` + `DICTATION_GENERATION_PROMPT_VERSION`
    (`dictation-generate@2026-06-15`).
  - The model drafts: `referenceText`, `sentences[]`, `title`, `blurb`,
    `domain`, `register`, `tested[]`, and an **estimated** `durationSec`.
  - `voiceId` / `accent` are assigned by **code** from a per-language Polly voice
    pool (rotating across drafts for variety), not by the model.
  - `waveform` is a deterministic placeholder envelope (decorative; real
    envelopes are out of scope).
- `DICTATION_GENERATION_TOOL` (Anthropic tool schema) registered in
  `GENERATION_TOOL_BY_TYPE` and `TOOL_NAME_BY_TYPE` (`generate.ts`).
- `parseGeneratedDictationDraft` mirrors the other per-type parsers; sets a
  `_dedupKey` derived from the normalized `referenceText` (so the existing
  `exercises_dedup_idx` blocks duplicates).
- **Remove the veto** at `generate.ts:776` and dispatch dictation in
  `generateOneDraft` via a dedicated user-prompt builder
  (`buildDictationGenerationUserPrompt`) — dictation does not reuse the
  grammar-point cloze/translation user prompt.

### Validation

- New `DICTATION_VALIDATION_PROMPT` + `DICTATION_VALIDATION_PROMPT_VERSION`
  (`dictation-validate@2026-06-15`) and `buildDictationValidationUserPrompt`
  (`validation-prompts.ts`).
  - Scores: length-appropriate-for-level, vocabulary band, naturalness (real
    connected speech, not stilted), and **listenability** (no tongue-twisters,
    no ambiguous segmentation).
  - Returns the standard `ValidationResult` (qualityScore, flaggedReasons, etc.)
    so `routeValidationResult` / `validateAndInsertWithRetry` route it unchanged
    (qualityScore < 0.5 → REJECTED; [0.5, 0.7) → FLAGGED; ≥ 0.7 →
    AUTO-APPROVED). Axes that don't apply (`ambiguous`, `contextSpoilsAnswer`)
    are returned false/NA.
- **Remove the veto** at `validation-prompts.ts:330`.

### Prompt registration

- Add `dictation-generate-system-prompt` and `dictation-validate-system-prompt`
  to the `PROMPTS` manifest in `bootstrap-prompts.ts` (the single source for
  bootstrap + push + check; a new `getPromptOrFallback` prompt that is missing
  here only ever serves the in-repo fallback). The manifest count test updates
  accordingly.
- Post-merge: `push-prompts` to sync prod + dev Langfuse per the CLAUDE.md
  "Prompt Editing" workflow. Verify prompt edits with `eval:gen` before relying
  on the scheduler (it converges ~2 days behind a Langfuse push).

---

## Section 3 — Audio-synth background Lambda (`infra`) — PR 2

- **Shared synth helper:** extract Polly synthesis into
  `infra/lambda/src/lib/polly-synth.ts` (`synthesize(text, voiceId, languageCode)
  → bytes`, then S3 `PutObject`). `LanguageCode` becomes a parameter (was
  hardcoded `es-ES`). The seed script's `synthesizeToS3` is replaced by a call
  into this helper (no duplicate Polly code).
- **CDK construct:** new `infra/lib/constructs/dictation-audio-queue.ts`
  mirroring `generation-queue.ts` — an SQS `DictationAudioQueue` + DLQ and a
  consumer Lambda construct, wired in `infra/lib/stack.ts`. The Lambda needs
  Polly + S3 (`CONTENT_BUCKET_NAME`) + DB access.
- **Trigger:** the generation handler (`infra/lambda/src/generation/handler.ts`),
  after `runOneCell`, enqueues one `{ exerciseId }` message per **newly approved
  dictation row**. To surface those IDs cleanly, `validateAndInsertWithRetry`'s
  `DraftOutcome` gains the inserted exercise `id`; the handler filters to
  `type === 'dictation'` + approved/flagged and batches SQS sends (≤ 10/batch,
  like the scheduler).
- **Audio Lambda handler** (`infra/lambda/src/dictation-audio/handler.ts`):
  load the row → read `referenceText` + `voiceId` + language → synth → upload to
  `dictation/${exerciseId}.mp3` → `UPDATE exercises SET audio_s3_key = …`.
  **Idempotent:** if `audioS3Key` is already set or the S3 object exists, skip
  (safe re-delivery). Returns `SQSBatchResponse` partial-failure like the
  generation handler. Failures land in the DLQ.

Real waveform + exact MP3 duration stay out of scope; `durationSec` keeps the
model's estimate.

---

## Section 4 — Serving gate, scheduler counting, eval:gen

### Serve gate

A dictation row is only playable once audio exists. The serve / today-plan
selection (`infra/lambda/src/lib/today-plan.ts`, `routes/sessions.ts`,
`routes/exercises.ts`) excludes `type = 'dictation' AND audio_s3_key IS NULL`.
Approved-but-audioless rows are transient (audio job in flight) and never
surface to learners. (Audio-synth failures sit in the DLQ and are alarmed, so
they don't silently leak as unplayable exercises.)

### Scheduler counting + targets

- The scheduler's approved-count aggregate (`scheduler.ts`) starts counting
  dictation cells via the existing `exercises_pool_lookup_idx` (no index change
  — dictation rows already match `review_status IN ('auto-approved',
  'manual-approved')`). For target purposes we count approved rows regardless of
  audio state; the serve gate handles the in-flight window.
- `CELL_TARGET_DEFAULTS[ExerciseType.DICTATION]` gets real numbers:
  **`{ B1: 15, B2: 15 }`** (connected-speech clips are expensive and a small
  rotating pool suffices for the single listening slot per session; tunable).
  The empty-record stub is replaced.
- `coverageAxesFor(DICTATION, …)` already returns `[]` (it only adds axes for
  vocab/cloze/translation/sentence_construction; dictation falls through), so
  persistence writes `coverage_tags = null` with no code change — just add a
  test pinning this.

### eval:gen

Largely free once generate + validate support dictation — the `eval:gen` runner
is generic over exercise type. Dictation cells carry no coverage axes, so the
only change is a no-axis path in the executor. `eval:gen:export` picks up
dictation cells automatically from `generation_jobs` once they generate.

---

## Section 5 — Cross-cutting: exhaustiveness ripple

Adding dictation handling trips the exhaustive `Record<ExerciseType, …>` maps
and switches across packages. Find them all in one pass
(`typecheck --continue | grep "error TS"`) and handle (not stub) each:

- `GENERATION_TOOL_BY_TYPE`, `TOOL_NAME_BY_TYPE` (`generate.ts`)
- `CELL_TARGET_DEFAULTS` (`cell-targets.ts`)
- `compatibleTypes()` (`cells.ts`)
- validation user-prompt dispatch (`validation-prompts.ts`)
- any per-type switch in the eval:gen executor

Version-constant bumps required in the same commit (per CLAUDE.md "Prompt
Editing"): the two new constants, plus re-export from `packages/ai/src/index.ts`.

---

## Testing plan

Per CLAUDE.md, add tests to the existing module test files; run
`pnpm turbo run test --concurrency=1` as the real gate (single-package runs can
miss stale-dist and `*.test.ts` breakage).

- **`packages/ai`** — `parseGeneratedDictationDraft` (valid/invalid drafts,
  `_dedupKey`); dictation generation + validation prompt presence + version
  constants; `routeValidationResult` over dictation validation outputs
  (approve/flag/reject thresholds); manifest count test in
  `bootstrap-prompts.test.ts`.
- **`packages/db`** — `compatibleTypes()` for `kind: 'dictation'`;
  `enumerateCurriculumCells` includes `es-b1-dictation` / `es-b2-dictation`;
  curriculum invariants accept dictation umbrellas; `resolveCellTarget`
  (B1/B2 = 15); `DraftOutcome` carries inserted id.
- **`packages/shared`** — `coverageAxesFor(DICTATION)` → `[]`; any stale
  ExerciseType count test.
- **`infra/lambda`** — audio-synth handler (synth → S3 → update; idempotent
  skip); generation handler enqueues approved dictation IDs; serve gate excludes
  audioless dictation rows; scheduler counts/targets dictation cells.
- **`eval:gen`** — a dictation cell flows through the runner (no-axis path).

---

## Rollout

1. Merge PR 1 → migrate is N/A (no schema change unless `DraftOutcome` needs a
   column — it doesn't; it's in-memory). `push-prompts` to sync the two new
   prompts to prod + dev Langfuse; confirm `bootstrap-prompts --check` is clean.
2. Verify generation quality with `eval:gen` on a small ES B1/B2 dictation
   dataset before letting the scheduler converge.
3. Merge PR 2 → CDK deploy provisions the audio queue + Lambda. The ~04:00 UTC
   scheduler begins enqueuing dictation cells; the audio Lambda fills
   `audioS3Key`; rows become servable.
4. Watch the DLQ + `generation_jobs` rejection-reason counts for the dictation
   cells; tune the validation prompt / targets as needed.

Note: a prompt-only fix to a suppressed dictation cell won't re-run without a
`CURRICULUM_VERSION` bump (scheduler skip-low-yield clears only on a curriculum
bump) — bump curriculum when adding the dictation umbrellas so the new cells are
picked up.
