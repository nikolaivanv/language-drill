# Generation pool history in context — design

**Date:** 2026-10-07
**Status:** approved design, pre-plan
**Scope:** cloze, translation, sentence_construction generation. Free writing is
out of scope (see below).

## Problem

Each draft is its own Claude call (`generateBatch` → `generateOneDraft`, one call
per ordinal), and cells fill over many nightly batches. No call sees the rows
already in its cell. The explicit diversity mechanisms — `coverageSpec`,
`constructionVariants`, frequency seeds — each control an axis someone
enumerated. Lexical fillers, scenes and sentence templates are not enumerated, so
they collapse onto the model's prototype across batches:

- `es-b1-nominalizers/article-de-nominalizer`: 15 of 38 approved rows used "my
  sister" as the owner (#727).
- `es-b1-relative-clauses` sentence_construction: 41 of 46 rows mentioned a café
  (2026-08-14).

Neither `audit:collapse` nor `audit:constructions` sees this class; it is found
only with `ILIKE` counts on `content_json`. Prompt text asking to "vary across
drafts" or "not reuse a noun from earlier exercises in this batch" is inert,
because no single call contains a batch.

## Decision

Feed each cell's existing approved stems into the **cached system prompt**
through the existing `priorPoolSurfaces` → `{{priorPoolSection}}` channel. That
channel already serves vocab_recall, free_writing and contextual_paraphrase;
cloze/translation were excluded with the comment "effectively unbounded surface
space — listing all prior sentences would bloat the prompt without payback".
That reasoning no longer holds: cells are capped at 20–50 rows (more with variant
floors), so a whole cell's stems are ~1–2k tokens, written to the cache once per
batch.

Rejected alternatives:

- **One call per cell (whole batch at once).** Lets the model see its siblings,
  but does not see the existing pool, which is where the cross-batch collapse
  happens. It also degrades per-item quality in long structured outputs, loses
  the whole batch on one truncation, and breaks the per-ordinal accounting the
  scheduler relies on.
- **History in the per-draft user prompt.** Uncached, so every draft pays the
  full history; per-draft tailoring is not needed.
- **Extracted over-used fillers instead of raw stems.** Sharper signal, but needs
  per-language lemmatization (weak for TR/DE with a tokenizer) or a per-cell LLM
  pass. Raw stems are the cheapest thing to A/B first.

## Section 1 — prod wiring

### `fetchPriorStems(db, cell)` (`packages/db/src/generation/run-one-cell.ts`)

Modelled on `fetchPriorParaphraseSurfaces`. Returns the stem of every
`auto-approved` / `manual-approved` row in the cell:

| Type | Stem |
|---|---|
| cloze | `content_json->>'sentence'` |
| translation | `content_json->>'sourceText'` |
| sentence_construction | `prompt` + ` → ` + `modelAnswers[0]` |

- **Flagged rows are excluded.** They are evidence limbo and may be demoted;
  steering away from them is wasted signal. (This differs from the existing
  fetchers, which include `flagged` because they serve dedup.)
- Deterministic order (by `id`), capped at 60, so the system prompt's bytes are
  identical across every ordinal in the batch and the cache prefix hits.
- Returns `[]` for an empty cell so the renderer omits the section.

### Wiring

The `priorPoolSurfaces` ternary at `run-one-cell.ts:~968` gains CLOZE,
TRANSLATION and SENTENCE_CONSTRUCTION → `fetchPriorStems`. No new
`GenerationSpec` field. `@language-drill/ai` still does not import
`@language-drill/db`. The "unbounded surface space" comment is rewritten to
record the new reasoning.

### Rendering (`renderPriorPoolSection`, `packages/ai/src/generation-prompts.ts`)

A new heading and body for the three sentence types. The existing dedup wording
("do NOT propose any exercise whose surface matches these") is the wrong
instruction here. Intended content:

> **Already in this cell.** These exercises test the same grammar as yours, so
> reusing the tested form is expected. Do not reuse their people, relationships,
> places, objects or situations, and do not mirror any sentence's template.
> Invent your own rather than reusing these. If this draft has an assigned seed
> word or sub-construction, that assignment takes precedence over this list.

The per-draft phrasing ("invent your own") follows #727: "vary across drafts" is
inert when each draft is its own call. vocab_recall, free_writing and
contextual_paraphrase rendering stays **byte-identical**.

### Prompt versioning

- Bump `GENERATION_PROMPT_VERSION` (the rendered system body changes for these
  types).
- The section is rendered in code into an existing template variable, so no
  Langfuse template change is expected. Confirm with `bootstrap-prompts --check`
  that the registered generation template contains `{{priorPoolSection}}`; if it
  does not, a `push-prompts` per environment becomes a post-merge step.

### Production effect

None until generation resumes: `enableScheduledExerciseGeneration: false` in
`infra/bin/app.ts`. Resuming is a separate decision.

## Section 2 — eval:gen pool-history arm and reuse metric

Two existing eval:gen properties would confound a history A/B:

1. Arms are deliberately asymmetric on seeding: the baseline is unseeded, the
   candidate gets construction-variant seeds (built to measure seeding).
2. eval:gen never passes frequency seeds, which prod uses for non-variant
   cloze/translation/SC. Frequency seeds diversify nouns on their own, so an
   eval without them would overstate history's effect.

### `--pool-history` flag (`packages/ai/scripts/eval-gen-run.ts`)

- The candidate arm's `GenerationPromptInputs.priorPoolSurfaces` is the cell's
  real stems (via `fetchPriorStems`), rendered into its system prompt. The
  baseline arm gets none.
- Intended invocation: `--baseline repo --candidate repo --pool-history`, so the
  history section is the only difference between arms.
- **Both arms get prod's seeding, identically.** Extract the seed-building block
  of `runOneCell` (seed-kind selection, prior-seed fetch, `buildSeedWords`;
  `run-one-cell.ts:~990–1015`) into an exported
  `buildCellSeedWords(db, cell, count, batchSeed, coverageTargets?)`. `runOneCell`
  calls it (no behaviour change); eval:gen calls it once per cell and passes the
  same `seedWords` to both arms. This replaces the seeding asymmetry only when
  `--pool-history` is set; existing runs are unchanged.
- The pool is read via `DATABASE_URL`, read-only. A prod read requires the
  existing `--allow-prod`.

### Lexical-reuse metric (pure functions in the script)

- **Content tokens:** lowercased letter runs of ≥4 characters, minus a small
  per-language stopword list, truncated to a 5-character prefix as a rough stem.
- **Hot tokens (per cell):** tokens present in ≥15% of the cell's pool stems
  **and** ≥3 rows. Listed per cell in the markdown, so a reader can tell the
  tested form (e.g. `donde`) from filler (`herma…`, `café`).
- **Hot-reuse rate (per arm):** share of drafts whose stem contains any hot
  token. Lower is better.
- **Template mirroring (per arm):** mean over drafts of the maximum Jaccard
  similarity between the draft's token set and any single pool stem. Lower is
  better; a rise flags drafts copying a pool stem's frame.
- Approval rate, rejection reasons, flag tags and cost remain the guardrails.

Draft stems use the same field mapping as `fetchPriorStems`.

### Dataset

A fixture of ~12 collapse-prone cells across ES/DE/TR and
cloze/translation/SC, each with ≥20 approved rows, committed under
`packages/ai/scripts/fixtures/`. It must include `es-b1-nominalizers` (cloze),
`es-b1-relative-clauses` (SC), `de-a2-perfekt-with-haben` (SC) and
`de-a2-weil-deshalb` (SC). The rest are chosen by a read-only SQL query on top
content-token concentration over the prod pool.

### Decision rule (fixed before the run)

Run at `--drafts-per-cell 10` (~120 drafts per arm, ~$6–8).

- **Ship-ready:** candidate hot-reuse rate ≤ 0.7 × baseline **and** approval-rate
  delta ≥ −5pp.
- **Otherwise:** inspect drafts by hand before any decision, with particular
  attention to frame copying (template-mirroring rising in the candidate).

## Section 3 — tests and rollout

### Tests (added to existing files)

- `packages/db/src/generation/run-one-cell.test.ts`
  - `fetchPriorStems`: field per type (SC concatenation), flagged excluded,
    deterministic order, cap of 60, `[]` on empty.
  - `priorPoolSurfaces` branch covers cloze/translation/SC.
  - `buildCellSeedWords`: existing seeding tests pass unchanged, plus one direct
    test.
- `packages/ai/src/generation-prompts.test.ts`
  - The new section renders for the three types.
  - vocab_recall and contextual_paraphrase sections are byte-identical to
    before.
  - Empty or undefined history renders `""`.
- `packages/ai/scripts/eval-gen-run.test.ts`
  - `--pool-history` parses.
  - With it set, both arms get identical seeds; only the candidate's rendered
    prompt contains the history.
  - Metric functions on fixtures: hot-token thresholds, stopword and prefix
    handling, hot-reuse rate, max-Jaccard mirroring.
- Gate: lint, typecheck and test per package (the full `pnpm test` is killed on
  the author's machine).

### Rollout

1. Before merging: `bootstrap-prompts --check` for `{{priorPoolSection}}`; bump
   `GENERATION_PROMPT_VERSION`.
2. Merge. Prod is unaffected while the cron is paused.
3. Build the fixture with the read-only query; run
   `eval:gen --baseline repo --candidate repo --pool-history --drafts-per-cell 10 --allow-prod`.
4. Apply the decision rule; record the result and a frame-copying spot check on
   the PR.

## Out of scope

- **Free writing.** It already has title-only history
  (`fetchPriorFreeWritingTitles`), and #757 showed titles are not enough: ES B2
  cells filled with one or two questions reworded 5–10 times under different
  titles (119 of 251 approved FW rows demoted). FW needs title + task history
  **and** task-level semantic dedup, measured with an FW-specific check (the
  token metric is meaningless when a cell is one topic, and eval:gen's prompt
  sources are cloze-shaped). Separate spec.
- **Dictation, conjugation, vocab_recall, contextual_paraphrase.** Unchanged.
- **Within-batch sibling visibility.** Drafts still run in parallel without
  seeing each other. Revisit (small batched calls) only if same-night lexical
  repetition persists after this ships.
- **Resuming generation.** A separate decision.
