# Bug Analysis

## Root Cause Analysis

### Investigation Summary

The bug report's framing checks out against the code: a generation job whose validator returns one of three hard-reject conditions writes `theory_generation_jobs.{status='succeeded', approved=false, rejected=true}` and skips the `theory_topics` INSERT entirely (`packages/db/src/theory-generation/run-one-cell.ts:295-318`). That matches the user's observation exactly — "succeeded technically, but the validator rejected the draft, no row inserted."

The investigation hit a **data-access blocker** that determines the next step:

- The Langfuse keys in the worktree's `.env` (`pk-lf-5f4ccc46…`) point to a Langfuse project with **0 traces in the past 30 days**. Probed via `/api/public/traces` with no filters, then with `name=generate-theory` / `name=validate-theory` / `tags=cellKey:tr-a1-locative` — all return zero. That's the dev project. The production Langfuse keys live in AWS Secrets Manager (`language-drill/LANGFUSE_PUBLIC_KEY`/`SECRET_KEY` per `CLAUDE.md`) but aren't in the local `.env`.
- The worktree's `.env` `DATABASE_URL` is the dev Neon branch (host `ep-holy-union-anhivmbh`), not production (`ep-withered-hall-an34g3y2`, present in `.env.bak.production`). Reading `theory_generation_jobs.error_message` for the two rejected runs requires production DB access.

So the **per-dimension rejection reason cannot be confirmed from this worktree**. What follows is code-side reasoning that narrows the candidate causes to three; identifying the actual one is a fix-phase prerequisite (see Implementation Plan → step 1).

### Root Cause

`routeTheoryValidationResult` (`packages/db/src/theory-generation/routing.ts:96-…`) routes to `'rejected'` for exactly three conditions, in priority order:

1. **`factualErrors.length > 0`** — hard veto. The validator's tool schema describes this as "Free-text descriptions of factually-wrong claims: incorrect rule statements, wrong conjugations, mis-stated trigger conditions" (`packages/ai/src/theory-validate.ts:92`).
2. **`culturalIssues.length > 0`** — hard veto. "Stereotyping, sensitive content, exclusion" (`theory-validate.ts:114`).
3. **`qualityScore < 0.5`** — the `flagQualityFloor` from `THEORY_VALIDATION_THRESHOLDS` (`packages/ai/src/theory-validation-thresholds.ts:25-30`).

`sectionsIncomplete` non-empty and `examplesUseGrammarPoint=false` are **flagged**, not rejected — both runs reaching `rejected=true` rules them out as the trigger.

**Most-likely candidate: `factualErrors`.** The locative case has subtle morphophonology that's easy to get wrong in prose:

- Four-way vowel harmony: `-da/-de/-ta/-te` keyed off the stem's final vowel.
- Consonant assimilation: `-d` softens to `-t` after voiceless final consonants (the "fıstıkçı şahap" set: p, ç, t, k, h, s, ş, f).
- The curriculum entry (`packages/db/src/curriculum/tr.ts:65-79`) explicitly lists these as commonErrors — "Forgetting the consonant assimilation after voiceless final consonants" and "Confusing locative -DA with ablative -DAn" — which the validator system prompt feeds into the model verbatim (`packages/ai/src/theory-validation-prompts.ts:88-90`).
- Concrete failure shapes the validator could plausibly catch: a paragraph stating that `sokakda` is correct (it's `sokakta`), a formation table that mis-orders the four allomorphs against their triggering vowels, a softening rule stated in reverse.

**Second-most-likely: `qualityScore < 0.5`.** The validator system prompt is explicitly conservative ("Be conservative. Reject anything factually wrong, anything mis-leveled… Score on the high side only when the page is genuinely accurate, well-leveled, and on-point" — `theory-validation-prompts.ts:78`). A draft that's competent but not crisp on the morphophonology — or that demonstrates the wrong allomorph in an example — could land in the 0.0–0.5 band.

**Least-likely: `culturalIssues`.** No plausible cultural-issue trigger for a phonology/case-marker page.

### Contributing Factors

1. **Theory prompt versions equal the first-failure date.** Both `THEORY_GENERATION_PROMPT_VERSION` and `THEORY_VALIDATION_PROMPT_VERSION` are `theory-generate@2026-05-12` / `theory-validate@2026-05-12` (`packages/ai/src/theory-prompts.ts:50`, `packages/ai/src/theory-validation-prompts.ts:74`). The first observed failure is also 2026-05-12. That correlation is suspicious — either the prompts that shipped that day fail this cell deterministically, or the validator's rubric was tightened in that commit and the locative draft no longer clears the new bar. Need to check (a) what the prompts looked like before that commit and (b) what the live Langfuse `production`-labelled body is today.

2. **No backoff or blacklist for repeatedly-rejected cells.** `enqueueMissingTheoryCells` (`infra/lambda/src/theory-generation/scheduler.ts`) computes `approvedSet` from `theory_topics` rows whose `review_status ∈ {auto-approved, manual-approved}` and enqueues every curriculum cell **not** in that set (lines 97-138). Rejected cells are never inserted into `theory_topics`, so they're permanently absent from `approvedSet` and re-enqueued every sweep. **A deterministically-rejected cell is a permanent daily token annuity** with no circuit-breaker. The bug report's $0.085/day figure is the per-cell symptom of this orchestrator-level gap; if many cells are stuck rejected, the total burn scales linearly.

3. **No per-cell rejection-count visibility.** `theory_generation_jobs` carries `error_message` per run but no aggregate "how many times has this cell been rejected" metric, so the pattern is invisible until someone manually correlates audit rows or sees the spend.

## Technical Details

### Affected Code Locations

- **File**: `packages/db/src/theory-generation/routing.ts`
  - **Function**: `routeTheoryValidationResult()`
  - **Lines**: ~96–end
  - **Role**: Decides `'rejected' | 'flagged' | 'auto-approved'` from the validator's verdict. Three hard-reject conditions documented in source.

- **File**: `packages/db/src/theory-generation/run-one-cell.ts`
  - **Function**: `runOneTheoryCell()` — `'rejected'` branch at lines `295-318`.
  - **Role**: On a rejected verdict, writes `theory_generation_jobs.{status='succeeded', approved=false, rejected=true}` and does **not** INSERT into `theory_topics`. This is intentional (Req 4.3).

- **File**: `packages/ai/src/theory-validation-thresholds.ts`
  - **Lines**: `25-30`
  - **Role**: Frozen 0.5 / 0.7 thresholds. Change here would alter what counts as "rejected vs flagged" pool-wide. Not the right knob for one bad cell.

- **File**: `packages/ai/src/theory-prompts.ts`
  - **Constant**: `THEORY_SYSTEM_PROMPT_TEMPLATE` (in-repo fallback)
  - **Lines**: `62-90`
  - **Role**: The generator prompt body. Live version is in Langfuse (`theory-generate-system-prompt`, label `production`) per runbook §2A.

- **File**: `packages/ai/src/theory-validation-prompts.ts`
  - **Constant**: `THEORY_VALIDATION_SYSTEM_PROMPT_TEMPLATE`
  - **Lines**: `76-129`
  - **Role**: The validator prompt body. The "Be conservative" framing at line 78 is the conservative-bias source.

- **File**: `packages/db/src/curriculum/tr.ts`
  - **Lines**: `65-79`
  - **Role**: The `tr-a1-locative` curriculum entry — name, description, examplesPositive, commonErrors. The generator and validator both consume this; if the description is too thin, the generator under-produces; if commonErrors is too sharp, the validator over-rejects.

- **File**: `infra/lambda/src/theory-generation/scheduler.ts`
  - **Function**: `enqueueMissingTheoryCells()` — lines `~91-138`
  - **Role**: The re-enqueue loop. Lacks a "skip cells rejected N times in the last M days" rule.

### Data Flow Analysis

1. Daily scheduled sweep → SQS → handler picks `tr-a1-locative`.
2. `runOneTheoryCell` opens an ALS scope (`withLlmTrace(feature='generate-theory'…)`), calls Claude with the live `theory-generate-system-prompt` body → draft.
3. Same handler re-enters `withLlmTrace(feature='validate-theory'…)`, calls Claude with the live `theory-validate-system-prompt` body → `TheoryValidationResult`.
4. `routeTheoryValidationResult(result)` → `{reviewStatus: 'rejected', flaggedReasons: [...]}`.
5. UPDATE `theory_generation_jobs` SET `status='succeeded', approved=false, rejected=true, error_message=<reasons>`.
6. No INSERT into `theory_topics`.
7. Next day: `approvedSet` is unchanged, `tr-a1-locative` is missing → enqueued again. Loop.

### Dependencies

- Anthropic `claude-sonnet-4-6` via `@anthropic-ai/sdk` (called through the `createObservedClaudeClient` Proxy).
- Langfuse SDK — for prompt fetch (5-min TTL) and trace emission.
- AWS SQS + EventBridge for scheduling.
- Postgres (Neon) — `theory_generation_jobs`, `theory_topics`, curriculum schema.

## Impact Analysis

### Direct Impact

- One foundational A1 Turkish grammar cell (`tr-a1-locative`) is permanently unfilled in the theory pool.
- Daily token spend: ~$0.085 today (one rejected run). Continues until the cell either succeeds or gets exempted.
- Any UX that surfaces a theory page link from a locative-tagged exercise renders empty / 404 / fallback.

### Indirect Impact

- The *pattern* — a deterministically-rejected cell being retried daily — likely applies to other cells. The bug user's framing ("is this cell going to remain a permanent line item, and how many others look like it") is the right one. Even if `tr-a1-locative` is the only one today, the orchestrator-level gap (no backoff) means any future regression has the same shape.
- Confidence cost: a stuck low-level grammar cell is a visible quality signal to anyone browsing the curriculum and finding gaps.

### Risk Assessment

- **If not fixed**: the daily annuity continues. At $0.085/cell/day, one cell is ~$30/year — small. Five stuck cells is ~$150/year. The bigger risk is that this is the canary for a class of failures we can't observe in aggregate.
- **If fixed wrong**: the wrong knob is `THEORY_VALIDATION_THRESHOLDS` (lowering the 0.5 floor). That would let other genuinely-bad pages through pool-wide. The right knob is either a sharper generator prompt or a softer validator-side rubric for this grammar point specifically, neither of which moves the global thresholds.

## Solution Approach

### Fix Strategy

Follow `docs/runbooks/prompt-update-and-revalidate.md`. The pre-conditions for choosing §2A vs §2B aren't yet known — they require the Langfuse trace data this worktree can't reach. So the fix unfolds in two stages:

**Stage A — Diagnose (fix-phase step 1, must happen on a host with prod credentials):**

1. Fetch the latest `theory_generation_jobs` row for `cell_key='tr-a1-locative'`. Capture `error_message`, `cost_usd_estimate`, `input_tokens_used`, `output_tokens_used`. The `error_message` is the validator's `flaggedReasons` joined — that already tells you which hard-reject hit.
2. Fetch the matching Langfuse traces (`name=validate-theory`, `metadata.cellKey=tr-a1-locative`, env=prod). Read the verdict's full per-dimension scores. Specifically look at `qualityScore`, `factualErrors`, `culturalIssues`.
3. Diff the live Langfuse `production`-labelled body of `theory-generate-system-prompt` and `theory-validate-system-prompt` against the in-repo fallback templates. If they've drifted, the runtime prompt is whatever Langfuse says, not the repo text.

**Stage B — Fix per the diagnosis:**

| Stage-A finding | Stage-B path |
|---|---|
| `factualErrors` non-empty, **generator-side** wrong rule (e.g. generator wrote `sokakda` in an example) | Runbook §2A — prompt-only edit. Sharpen the generator's `theory-generate-system-prompt` with explicit instructions on the consonant-assimilation rule. Bump `THEORY_GENERATION_PROMPT_VERSION`. |
| `factualErrors` non-empty, **validator-side** false positive (the draft was right; the validator hallucinated an error) | Runbook §2A — prompt-only edit on `theory-validate-system-prompt`. Add "before adding a string to factualErrors, you must be able to cite the exact line and the correct alternative." Bump `THEORY_VALIDATION_PROMPT_VERSION`. |
| `qualityScore < 0.5`, no specific issue called out | Runbook §2A — sharpen the generator's Voice / Required-sections guidance so the draft scores above 0.5. Or, if the existing draft objectively looks fine, runbook §2B is needed — the validator's "be conservative" framing may be too coarse for grammar-point pages with tight technical content. |
| Live Langfuse prompts have drifted from repo and the drift correlates to 2026-05-12 | Triage the live prompt change. The repo fallback may not even be the live runtime. |

The pool-revalidation step (`pnpm revalidate:cloze` analog for theory) is not yet wired up — theory only has cloze's `revalidate:cloze` script. If the fix is generator-side, no pool revalidation is needed (the cell has no row to revalidate; the next scheduled run picks up the new prompt). If the fix is validator-side, you'd want to re-route any historically-flagged theory rows under the new rubric — out of scope for this bug, but worth a follow-up.

### Alternative Solutions

1. **Lower `flagQualityFloor` below 0.5** — rejected. That's a pool-wide policy change; any laxness here lets bad pages through for every cell, not just the locative.
2. **Hand-write the `tr-a1-locative` theory page and INSERT directly** — a workaround, not a fix. Doesn't address the underlying generator-or-validator gap and doesn't prevent the next stuck cell.
3. **Add a per-cell rejection-count blacklist now** — out of scope for the headline fix, but a real gap. After N rejections in M days, the scheduler should stop enqueuing and surface the cell for human review. File as a follow-up.
4. **Re-run today and hope it succeeds** — explicitly what the bug report cautions against. Stage A must come first.

### Risks and Trade-offs

- **Prompt-only fixes have no rollback in code.** A bad Langfuse edit affects the *next* warm Lambda within 5 minutes (the prompt cache TTL — `LANGFUSE_PROMPT_CACHE_TTL_MS`). Mitigate by keeping the previous Langfuse version reachable and re-labelling on regression. Runbook §2A.4 covers this.
- **A sharper generator prompt for one grammar point can cause cross-cell regressions** — generic "be more careful with morphophonology" guidance is fine; injecting locative-specific Turkish prose into the generic prompt would bias generation for other languages. Keep additions language-and-CEFR-agnostic, or scope them to TR/A1 via conditional wording.
- **Stage A may surface a different root cause** than the three I've enumerated. If `error_message` says something like "max_tokens" or "tool_use parse error", the framing flips — it's a transient retry problem after all, and the bug report's "content/prompt" framing was wrong. Stage A is what disambiguates.

## Implementation Plan

### Changes Required

The plan is two-phase. Stage A is diagnosis (no code changes); Stage B's edits depend on what Stage A finds.

1. **Stage A.1 — Pull prod audit row.**
   - On a host with prod `DATABASE_URL`: `SELECT * FROM theory_generation_jobs WHERE cell_key='tr-a1-locative' ORDER BY started_at DESC LIMIT 5;`
   - Capture the `error_message`, `cost_usd_estimate`, and `started_at` for the two rejected runs and any prior history.

2. **Stage A.2 — Pull Langfuse traces.**
   - On a host with prod Langfuse keys: re-run `scripts/fetch-langfuse-traces.mjs` (built in this analysis — currently empty result from dev keys).
   - For each `validate-theory` trace tagged `cellKey:tr-a1-locative`, capture the verdict's per-dimension values.

3. **Stage A.3 — Diff live Langfuse prompts vs repo fallback.**
   - Either via the Langfuse dashboard (Prompts → `theory-generate-system-prompt` / `theory-validate-system-prompt` → label `production`), or with a script that calls `prompt.get(name, { label: 'production' })`.
   - If the live body differs from `THEORY_SYSTEM_PROMPT_TEMPLATE` / `THEORY_VALIDATION_SYSTEM_PROMPT_TEMPLATE`, the live version is the runtime — diff against repo to see what's actually been deployed.

4. **Stage B — Apply the fix per the diagnostic table above.**
   - File(s): one of `theory-generate-system-prompt` (Langfuse) or `theory-validate-system-prompt` (Langfuse) — edited via the Langfuse dashboard, not via repo PR. Bump the matching `*_PROMPT_VERSION` constant in the repo in the same commit (per `CLAUDE.md` "Prompt Editing").
   - File: `packages/ai/src/theory-prompts.ts` or `packages/ai/src/theory-validation-prompts.ts` — bump `THEORY_GENERATION_PROMPT_VERSION` / `THEORY_VALIDATION_PROMPT_VERSION` to today's date.
   - Trigger a one-off generation re-run for `tr-a1-locative` (the next scheduled sweep will pick it up automatically, but a manual CLI trigger gets us a verdict in minutes, not a day).

5. **Follow-up (not part of this bug): per-cell rejection backoff.**
   - File: `infra/lambda/src/theory-generation/scheduler.ts` — add an "exclude cells with N rejections in the last M days" filter to `enqueueMissingTheoryCells`. Threshold values are policy; suggest 3 rejections in 14 days → exclude and require manual re-enqueue.
   - File: `infra/lambda/src/theory-generation/log.ts` — surface stuck-cell count in the daily run summary.
   - Out of scope here, but should be filed as a separate bug or task before closing this one (it's the orchestrator-level half of the same problem).

### Testing Strategy

Stage A has no code to test — it's data-gathering.

Stage B (whichever path applies):

1. **Local Langfuse prompt edit smoke test**: edit the prompt in Langfuse staging (or the dev label), wait 5 minutes for the cache TTL to expire (or call `__resetRegistryForTests()`), then run `pnpm exec tsx scripts/theory-generation-cli.ts --cell tr-a1-locative` (or the equivalent local theory-gen invocation if one exists). Confirm the new prompt is fetched, and observe the verdict.
2. **Unit test on the prompt builder**: byte-parity tests for `THEORY_*_PROMPT_TEMPLATE` already exist (per `theory-prompts.ts:57-59` comment). Bumping the prompt version and updating the in-repo fallback must keep these tests green.
3. **Production verification**: after the Langfuse edit lands, trigger a CLI-mode theory-gen for `tr-a1-locative` (the `'cli'` trigger value is allowed in `theory_generation_jobs.trigger`). Verify the new audit row has `approved=true` and a row appears in `theory_topics`.
4. **Pre-push checks**: `pnpm lint && pnpm typecheck && pnpm test` from repo root (per `CLAUDE.md` "Pre-Push Checks").

### Rollback Plan

- **Langfuse prompt edits**: roll back via the Langfuse dashboard by re-labelling the previous version as `production`. Effect propagates within 5 minutes (TTL). No code redeploy required.
- **`*_PROMPT_VERSION` constants in repo**: revert the commit. Cosmetic — the version constant only drives the trace cohort tag; behavior is determined by what Langfuse serves.
- **If the fix triggers cross-cell regressions** (other theory cells start failing under the sharper prompt): revert immediately, then narrow the prompt edit. The 5-minute TTL keeps the blast radius small.
