# Dictation for Turkish (A1/A2) — Design

_Date: 2026-06-16 · Status: designed (pending plan) · From the Phase 2 roadmap "more languages + bigger pool" item_

## Goal

Extend the dictation generation pipeline (shipped for ES B1/B2) to **Turkish at
A1 and A2**. The pipeline (text generation + validation + audio synthesis +
serving + debrief) is already language/level-agnostic except for three
per-language/level knobs: the curriculum dictation umbrellas, the Polly voice
pool, and the prompts' hard-coded per-level length bands. This milestone fills
those in for TR A1/A2.

## Scope (decided during brainstorming)

- **Language: Turkish only.** German is skipped for now. (EN is structurally
  source-only — excluded from generation and from the voice-pool type.) TR's
  curriculum is full A1/A2 (TR B1/B2 are disabled), so dictation at A1/A2 matches
  where the TR content actually lives.
- **Levels: A1 + A2.**
- **Voice: `Burcu`** — per the AWS Polly voice table, the *only* neural Turkish
  voice (`tr-TR`); `Filiz` is standard-engine only. The synth is hard-coded to the
  `neural` engine, so TR uses Burcu. Single-voice pool (less rotation variety than
  ES's two voices — acceptable).
- No DB migration, no infra/CDK change, no new env var.

## Section 1 — Curriculum + voice pool + cell targets (mirror of ES)

- **`packages/db/src/curriculum/tr.ts`** — add two `kind: 'dictation'` umbrellas:
  - `tr-a1-dictation` (cefrLevel `A1`), `tr-a2-dictation` (cefrLevel `A2`).
  - Each carries Turkish, level-appropriate `description`, `examplesPositive` (≥2
    short reference texts), `examplesNegative` (≥1, leading `*`), `commonErrors`
    (≥1). These feed the dictation generation prompt as theme/style guidance.
  - No `coverageSpec` (count-only), matching the ES umbrellas.
  - Bump `CURRICULUM_VERSION_TR` (currently `2026-06-14`) to today — the scheduler
    only picks up new cells / clears low-yield suppression on a curriculum-version
    change.
  - `compatibleTypes` (`kind: 'dictation'` → `[DICTATION]`) and the curriculum
    invariants are already kind-aware and language/level-agnostic — no change.
    (The per-language grammar-count invariant counts only `kind: 'grammar'`, so
    dictation umbrellas don't affect TR's A1/A2 minimums.)
- **`packages/ai/src/generate.ts`** — set
  `DICTATION_VOICE_POOL_BY_LANGUAGE[Language.TR] = [{ voiceId: 'Burcu', accent: 'standart Türkçe · İstanbul' }]`.
  `Language.DE` stays `[]`.
- **`infra/lambda/src/generation/cell-targets.ts`** —
  `CELL_TARGET_DEFAULTS[ExerciseType.DICTATION]` gains `A1: 10, A2: 12` (alongside
  the existing `B1: 15, B2: 15`). A1/A2 clips are short with a smaller distinct-clip
  surface than B1/B2; design-tunable.
- Audio handler `LANGUAGE_CODE_BY_LANGUAGE` already maps `TR → tr-TR`; `skill_topics`
  auto-seed from `ALL_CURRICULA` via `planSkillTopics`. Neither needs a change —
  add a test pinning the skill-topic rows for the two new umbrellas.

## Section 2 — A1/A2 prompt bands (the content work; two prompt edits)

The generation and validation prompts hard-code per-level length/complexity
guidance for **B1 and B2 only**. Without A1/A2 bands the generator would
improvise clip length and the validator would likely reject short A1 clips as
"too short". Both edits are semantic prompt changes → version bump + post-merge
Langfuse sync.

- **`packages/ai/src/dictation-generation-prompts.ts`** — add explicit bands to the
  "length for level" hard constraint:
  - **A1 = one short, clearly-articulated everyday sentence** — high-frequency A1
    vocabulary, simple structures, minimal connected-speech reduction (it should be
    transcribable by a near-beginner who listens carefully).
  - **A2 = 1–2 short sentences** — everyday A2 vocabulary, light connected speech.
  - Bump `DICTATION_GENERATION_PROMPT_VERSION` to `dictation-generate@2026-06-16`.
- **`packages/ai/src/dictation-validation-prompts.ts`** — extend the
  length-for-level + listenability rubric so A1/A2 short clips pass: a one-sentence
  A1 clip is *correct*, not "too short"; do not penalize simplicity at A1/A2 (the
  point is clarity, not density). Bump `DICTATION_VALIDATION_PROMPT_VERSION` to
  `dictation-validate@2026-06-16`.
- Both prompts are Langfuse-fetched at runtime with the in-repo string as fallback;
  after merge, `pnpm push-prompts` syncs prod + dev (per CLAUDE.md "Prompt
  Editing"), then `bootstrap-prompts --check` confirms in sync. Until the push, the
  runtime serves the updated in-repo fallback.

The prompts stay language-agnostic via the `{{language}}`/`{{cefrLevel}}`
placeholders + the curriculum-derived description/examples; the A1/A2 length bands
are the only level-specific additions (they apply to any language at those levels,
which is correct).

## Section 3 — Testing & rollout

- **`packages/db`** — `enumerateCurriculumCells(trCurriculum)` includes
  `tr-a1-dictation`/`tr-a2-dictation`, each paired with `DICTATION` only;
  `assertCurriculumInvariants` passes for the umbrellas; `CURRICULUM_VERSION_TR`
  bumped; skill-topic plan covers both umbrella keys.
- **`packages/ai`** — TR voice pool non-empty (`Burcu`);
  `parseGeneratedDictationDraft` assigns `voiceId: 'Burcu'` for a TR spec;
  generation + validation prompt template/vars parity holds after the A1/A2 edits;
  version constants match `dictation-(generate|validate)@\d{4}-\d{2}-\d{2}`.
- **`infra/lambda`** — `resolveCellTarget` returns 10 (A1) / 12 (A2) for TR
  dictation cells.
- **`eval:gen`** — smoke a TR A1 cell + a TR A2 cell before the scheduler converges:
  confirm A1 clips generate short and auto-approve (not rejected as too-short),
  A2 clips fit the band.
- Gate with `pnpm lint` + `pnpm typecheck` + `pnpm turbo run test --concurrency=1`.
- **Rollout:** no DB migration / infra change. Post-merge: `push-prompts` to sync
  the two edited prompts; then the ~04:00 UTC scheduler fills `tr:a1:dictation` +
  `tr:a2:dictation`, and the audio Lambda synthesizes each approved clip via Burcu
  (`tr-TR`, neural). Watch `generation_jobs` rejection-reason counts for the two TR
  cells to confirm the A1/A2 bands land; tune the prompt / targets if A1 over-rejects.

## Out of scope

German dictation (deferred); TR B1/B2 (curriculum disabled there); real waveforms;
multi-voice TR rotation (only one neural TR voice exists).
