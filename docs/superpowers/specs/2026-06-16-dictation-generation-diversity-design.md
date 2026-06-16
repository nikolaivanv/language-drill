# Dictation Generation Diversity (TR A1/A2) — Design

_Date: 2026-06-16 · Status: designed (pending plan) · Follow-up to the 2026-06-16 generation-run analysis_

## Problem

Today's scheduler run (2026-06-16 04:00 UTC) filled ES B1/B2 dictation perfectly
(15/15 each, 0 rejections) but TR A1/A2 collapsed: `tr-a1-dictation` produced 28
drafts to net **1** approved (6 dedup-give-ups), `tr-a2-dictation` 38 drafts for 5
approved (7 dedup-give-ups). The stored A1 clips are all the same scene
("Masada bir kitap var." + three variants); A2 all "this morning … breakfast …
market". Zero quality/too-short rejections (`rejection_reason_counts` null) — the
A1/A2 length bands are fine. The failure is **generation mode-collapse at low
levels**: the model anchors on one scene, the dedup index (`_dedupKey` = normalized
`referenceText`) rejects the repeats, and the cell gives up. Dictation has no
per-draft diversity lever — unlike cloze/translation (`seedWords`) or
sentence-construction (mode rotation). The unreachable A1/A2 targets (10/12) then
grind dedup and burn tokens (TR A1 spent $0.40 for 1 clip).

## Scope (decided during brainstorming)

- **A — per-ordinal domain rotation** (the core fix; user-prompt only, no Langfuse push).
- **C — reachable A1/A2 targets** (A1: 6, A2: 10) + a `CURRICULUM_VERSION_TR` bump to
  un-suppress the now-saturated `tr-a1-dictation` cell.
- **Not** doing B (cross-batch prior-pool avoid-list) — with the rotation + small
  targets, one diverse batch fills the pool, so the scheduler stops (`skip-target-
  reached`) before tick-over-tick repeats matter. Deferred.
- No DB migration, no infra change, no system-prompt edit, no `push-prompts`.

## Section 1 — Per-ordinal domain rotation

All in `packages/ai/src/dictation-generation-prompts.ts` (the user prompt is built
locally per-draft and is NOT Langfuse-registered — only the system prompt is — so
this needs no `*_PROMPT_VERSION` bump and no Langfuse sync, exactly like `seedWord`
and `sentenceConstructionModeForOrdinal`):

- Add a curated `DICTATION_DOMAINS` constant — ~10 everyday, A1-expressible topics,
  e.g. `["home and family", "food and meals", "daily routine", "weather and seasons",
  "school and study", "shopping and the market", "free time and the weekend",
  "work and jobs", "travel and transport", "health and the body"]`. English labels
  (guidance to Claude; it writes the clip in the target language).
- Add `dictationDomainForOrdinal(ordinal: number, batchSeed: string): string` —
  returns `DICTATION_DOMAINS[(ordinal + offset) % DICTATION_DOMAINS.length]`, where
  `offset` is a small deterministic non-negative hash of `batchSeed` (e.g. a simple
  char-sum mod length). This yields **in-batch spread** (consecutive ordinals get
  distinct domains → breaks the single-scene collapse) AND **cross-tick variety**
  (a different starting domain per batch, so a later refill doesn't repeat the same
  domain order).
- Change `buildDictationGenerationUserPrompt(inputs, ordinal, topicDomain)` →
  `buildDictationGenerationUserPrompt(inputs, ordinal, topicDomain, batchSeed)`. The
  domain line becomes `topicDomain ?? dictationDomainForOrdinal(ordinal, batchSeed)`
  — an explicit `topicDomain` (CLI passthrough) still overrides for all ordinals
  (back-compat); scheduled runs (null `topicDomain`) get the rotation. Drop the
  now-redundant "Vary the domain…" sentence or keep it as reinforcement (the
  explicit per-ordinal domain is the real driver).
- `packages/ai/src/generate.ts`, the `isDictation` branch of `generateOneDraft`:
  pass `spec.batchSeed` as the new fourth argument. `spec.batchSeed` is always set
  (it's a required `GenerationSpec` field).

Applies to every dictation cell, ES included — harmless for ES (already 100%; just
distributes its 15 clips across domains) and the real fix for TR A1/A2. No `spec`
or `runOneCell` changes (the rotation is computed from `ordinal` + `batchSeed`
inside the builder, mirroring `sentenceConstructionModeForOrdinal`).

## Section 2 — Reachable targets + un-suppress TR A1

- `infra/lambda/src/generation/cell-targets.ts`:
  `CELL_TARGET_DEFAULTS[ExerciseType.DICTATION] = { A1: 6, A2: 10, B1: 15, B2: 15 }`
  (down from A1: 10, A2: 12). Keyed by level, not language — A1/A2 dictation is
  small-space in any language; ES has no A1/A2 dictation cells so ES is unaffected.
- `packages/db/src/curriculum/tr.ts`: bump `CURRICULUM_VERSION_TR` (currently
  `'2026-06-16'`) to a new value. Today's run left `tr-a1-dictation`
  saturated-dedup-suppressed; `decideEnqueue` clears suppression ONLY on a
  curriculum-version change — neither the prompt nor the target change triggers it,
  so the bump is required for the A1 cell to re-run. Use a same-day suffix
  (`'2026-06-16b'`); confirm `curriculum.test.ts`'s version regex admits it (prod
  already carries `'2026-06-15b'` for ES, so the suffix form is valid). The TR
  curriculum entries themselves don't change — the bump is purely to clear
  suppression.

## Section 3 — Testing & rollout

- **`packages/ai`** (`dictation-generation-prompts.test.ts`):
  - `dictationDomainForOrdinal(0, seed)` ≠ `dictationDomainForOrdinal(1, seed)` (distinct
    consecutive domains); the first ~`DICTATION_DOMAINS.length` ordinals are all distinct.
  - Two different `batchSeed`s shift the starting domain (`dictationDomainForOrdinal(0, "a")`
    ≠ `dictationDomainForOrdinal(0, "b")` for at least some seed pair).
  - `buildDictationGenerationUserPrompt` emits a different `Topic domain:` line for
    ordinal 0 vs 1 when `topicDomain` is null, and honors an explicit `topicDomain`
    (same line for all ordinals) when provided.
- **`infra/lambda`** (`cell-targets.test.ts`): `resolveCellTarget` → 6 (A1) / 10 (A2)
  for a TR dictation cell; B1/B2 still 15.
- **`packages/db`** (`curriculum.test.ts`): `CURRICULUM_VERSION_TR` matches the
  version regex after the bump; TR dictation umbrellas unchanged.
- Gate: `pnpm lint` + `pnpm typecheck` + `pnpm turbo run test --concurrency=1`.
- **Rollout:** no DB/infra/migration/Langfuse change. After merge + CDK deploy, the
  next 04:00 UTC tick (un-suppressed by the version bump) refills
  `tr:a1:dictation` + `tr:a2:dictation`. **Verify in `generation_jobs`:** expect
  `dedup_given_up` to drop sharply and `approved` to reach 6 (A1) / 10 (A2) at far
  lower `produced_count` and cost than today's run. `eval:gen` can't validate this
  (it doesn't dedup against the pool), so the scheduler run is the verification; a
  manual scheduler trigger can confirm sooner.

## Out of scope

Cross-batch prior-pool avoid-list (B — deferred; not needed once the pool fills);
German dictation; B1/B2 dictation diversity (ES already at 100%).
