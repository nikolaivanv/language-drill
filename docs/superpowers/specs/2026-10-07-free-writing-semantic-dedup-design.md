# Free-writing semantic dedup — design

**Date:** 2026-10-07
**Status:** approved design, pre-plan
**Scope:** `free_writing` generation only.

## Problem

Free-writing dedup is the normalized **title** (`canonicalSurface` →
`exercises_dedup_idx`), and the generator's history lists only titles. On
2026-10-07 (#757) reviewers found most cells holding one or two essay questions
reworded 5–10 times under different titles: 119 of 251 approved free-writing
rows were demoted as `duplicate`, leaving most cells at 1–2 rows against a
target of 5.

**The duplicates were mostly created within a single batch.** A prod query
(branch `br-green-waterfall-ancrvpr5`) over cells with duplicate demotions:

| Cell | Rows | Duplicates | Generation days |
|---|---|---|---|
| `es-b2-fw-study-abroad` | 10 | 9 | 1 |
| `es-b2-fw-social-media` | 10 | 8 | 1 |
| `es-b2-fw-technology-relationships` | 10 | 8 | 1 |
| `es-b1-fw-daily-routine` | 6 | 5 | 1 |

A batch's drafts are generated in parallel. Each gets a different angle from
`freeWritingAngleForOrdinal`, none sees its siblings, and they converge on the
same question with different titles. History in the prompt is frozen at batch
start, so **history alone cannot fix this**; the same frozen-history mechanism
produced within-batch convergence in the cloze pool-history A/B (#760). The fix
must enforce distinctness at insert time.

**Duplicate rule** (as applied by the #757 reviewers): two prompts are
duplicates if *a learner would write essentially the same essay*. A different
title, wording or angle label does not make a prompt distinct. At A1/A2,
different required content counts as distinct.

**When a topic has fewer distinct questions than its target**, generation
underfills: the duplicate is rejected, retried a bounded number of times, then
given up, and the cell stays below target. Breadth comes from authoring more
topic umbrellas, not from forcing a narrow topic to 5.

## Section 1 — the judge and the insert path

### Judge (`packages/ai/src/free-writing-dedup.ts`)

- `judgeFreeWritingDuplicate(client, { candidate, existing, cefrLevel })` →
  `{ result: { duplicateOf: number | null; reason: string }, tokenUsage }`.
  - `candidate` and each `existing` item: `{ title, task, requiredElements }`
    (labels only).
  - `duplicateOf` is the 0-based index into `existing`, or `null`.
- System prompt `FREE_WRITING_DEDUP_SYSTEM_PROMPT`: states the duplicate rule
  above, including the A1/A2 exception. **No few-shot examples drawn from the
  #757 data**, which is the judge's ground truth (see Measurement 1).
- Forced tool call `submit_dedup_verdict`; model `VALIDATION_MODEL`.
- An out-of-range or non-integer `duplicateOf` throws; the caller treats a throw
  as "judge unavailable".
- `FREE_WRITING_DEDUP_PROMPT_VERSION = "free-writing-dedup@2026-10-07"`.
  Fetched through the prompts registry like the other surfaces, and **added to
  the `PROMPTS` manifest** in `packages/ai/scripts/bootstrap-prompts.ts`, so
  `bootstrap-prompts` creates it and `--check` / `push-prompts` see it.
  CLAUDE.md's prompt-version table gains a row.
- Exported from `packages/ai/src/index.ts`. `ai` does not import `db`.

### Insert path (`packages/db/src/generation/validate-and-insert.ts`, free-writing cells only)

- After validation routes a draft to `auto-approved` or `flagged`, and before
  the INSERT:
  1. Fetch the cell's current free-writing prompts with `review_status IN
     ('auto-approved','manual-approved','flagged')`, freshly on every attempt,
     so rows inserted earlier in the same batch are seen.
  2. Call the judge.
  3. `duplicateOf !== null` → `semanticDuplicate`. It is handled exactly like
     the existing vocab `capReached` pre-emption: no insert, then the existing
     retry loop (`MAX_DEDUP_RETRIES = 3`), then `dedup-given-up`. The job's
     existing `dedup_given_up_count` records the underfill.
- **Retries see fresh history.** For free-writing cells, the retry spec's
  `priorPoolSurfaces` is re-fetched (Section 2's `title — task` lines) before
  `runRetryGeneration`, so a regenerated draft knows about the siblings just
  inserted. Only retries change the cached prompt prefix.
- **Judge failure** (API error, parse error, invalid index): insert the draft as
  **`flagged`** with the new reason code `dedup-check-unavailable`. Flagged rows
  are not served, so a failure costs a manual review, never a duplicate reaching
  learners, and a run never stalls on the judge.
- The judge's usage folds into `extraUsage` like every validator and retry call.

### Serialization (`packages/db/src/generation/run-one-cell.ts`)

Free-writing cells run `runOutcomePool` with `concurrency: 1` (other types keep
`MAX_OUTCOME_CONCURRENCY = 5`). Otherwise two ordinals could each pass the judge
before the other inserted. Free-writing cells request 3–5 drafts, so the cost is
seconds.

### New reason code

`GenerationReasonCode` gains `dedup-check-unavailable`, with its friendly label.
Hard-coded reason lists outside `packages/shared` (web admin, lambda) are
grepped and updated: reason-code and admin-list ripples have escaped
typecheck before.

## Section 2 — history and measurement

### History (cross-batch prevention)

- `fetchPriorFreeWritingTitles` is renamed `fetchPriorFreeWritingPrompts` and
  returns `title — task` lines, with `task` collapsed to one line and truncated
  to 200 characters. Same review-status set, same 60-row cap, same
  deterministic order.
- `renderPriorTitlesSection` keeps the `{{priorTitlesSection}}` template
  variable, so the Langfuse template is unchanged. New heading and body:
  *"Prompts already in this cell — do NOT ask the same question in other words.
  A new title or a new angle label on the same question is still the same
  question."*
- Bump `FREE_WRITING_GENERATION_PROMPT_VERSION` to
  `free-writing-generate@2026-10-07`.

### Measurement 1 — judge accuracy (`eval:fw-dedup-judge`)

- Ground truth: `docs/analysis/fw-round3-dedup-proposals-2026-10-07.json` (35
  cells; each cluster is one distinct question with a kept row and its demoted
  rewordings). The rows' title, task and required elements are read from prod,
  read-only, via `DATABASE_URL`.
- For each row, the judge runs once against that cell's other rows, the same
  one-against-many shape production uses.
  - **Positive:** another row shares its cluster.
  - **Predicted positive:** `duplicateOf !== null`.
- Reports row-level precision and recall, and lists every disagreement with
  both texts. About 200 calls, roughly $1–2.
- **Bar:** precision ≥ 0.9 and recall ≥ 0.8. Below either, fix the judge prompt
  before Measurement 2.

### Measurement 2 — pipeline A/B (`eval:fw-dedup`; never writes to the DB)

- **Dataset:** 8 cells that collapsed in #757: `es-b2-fw-study-abroad`,
  `es-b2-fw-social-media`, `es-b2-fw-technology-relationships`,
  `es-b1-fw-daily-routine`, `es-b1-fw-free-time`, `es-b2-fw-environment`,
  `tr-a1-fw-my-family`, `de-b1-fw-complaint`. Each requests what a resumed run
  would: target minus currently approved, computed from prod.
- **Baseline arm (today):**
  - drafts generated in parallel with title-only history;
  - validated;
  - accepted if approved or flagged and the title is unique within the cell plus
    the arm's accepted drafts.
- **Candidate arm (new behavior, simulated in memory):**
  - drafts generated one at a time with `title — task` history over the cell's
    pool plus the drafts accepted so far;
  - validated, then judged;
  - a duplicate triggers up to 3 retries with refreshed history, then gives up.
- The candidate arm mirrors the insert path's accept/retry loop (about 20 lines)
  rather than calling `validateAndInsertWithRetry`, which writes to the DB. The
  judge, history renderer and fetchers are the shared production code.
- **Scoring:** an independent judge, the same rule on `QA_CRAFTER_MODEL` (`claude-opus-4-8`, the Opus model the repo already uses for `qa:sample`; a
  different model from the pipeline's judge), scores each accepted draft against
  the cell's existing prompts and the arm's other accepted drafts.
- **Metrics per arm:**
  - duplicate rate (accepted drafts the scorer finds duplicate of anything);
  - underfill rate (requested minus accepted, over requested);
  - approval rate;
  - cost.
- **Pre-registered rule:**
  - **ship-ready** iff the judge passed Measurement 1 **and** candidate
    duplicate rate ≤ 5% **and** baseline duplicate rate ≥ 20% **and** approval
    change ≥ −10pp;
  - **inconclusive** if the baseline duplicate rate is < 20% (the run never
    exercised the defect);
  - otherwise **inspect**.
  - Underfill is reported, not gated.
- About $3–5.

## Section 3 — tests and rollout

### Tests (existing files except new modules)

- `packages/ai/src/free-writing-dedup.test.ts` (new):
  - the system prompt contains the essay-level rule and the A1/A2 exception;
  - the rendered user message lists the candidate and indexed existing prompts;
  - tool parsing covers `null`, a valid index, and out-of-range or non-numeric
    values (which throw);
  - the version matches `/^free-writing-dedup@\d{4}-\d{2}-\d{2}$/`.
- `free-writing-generation-prompts.test.ts`: the new heading, `title — task`
  lines, truncation, and empty history omitted (`""`).
- `bootstrap-prompts.test.ts`: the manifest contains the dedup prompt.
- `validate-and-insert.test.ts` (mocked judge and DB):
  - a free-writing semantic duplicate is not inserted and triggers a retry;
  - three consecutive duplicates give `dedup-given-up`;
  - the retry spec carries refreshed history;
  - a judge error inserts as `flagged` with `dedup-check-unavailable`;
  - non-free-writing cells never call the judge.
- `run-one-cell.test.ts`: free-writing cells run the outcome pool at
  concurrency 1; other types are unchanged.
- `generation-reasons.test.ts`: the new code has a label.
- Eval scripts: pure tests for the ground-truth builder (clusters → per-row
  labels), the metrics, and the verdict.
- Gate: lint, typecheck and test per package (shared, ai, db, lambda; web if a
  reason list there changes).

### Rollout

1. Merge. Prod is unaffected while generation is paused.
2. `bootstrap-prompts` creates the dedup prompt in Langfuse prod and dev
   (create-only), and `--check` confirms. The free-writing generation template
   is unchanged, so no `push-prompts` for it.
3. Run `eval:fw-dedup-judge`. If it misses the bar, fix the judge prompt and
   re-run before step 4.
4. Run `eval:fw-dedup`, apply the rule, and record the result on the PR.
5. Resuming generation remains a separate decision.

## Out of scope

- Re-judging the current free-writing pool (cleaned by hand in #757).
- Semantic dedup for other exercise types.
- Changing free-writing cell targets (they stay at 5; underfill is accepted).
- Per-ordinal angle rotation (`freeWritingAngleForOrdinal`) stays as is.
