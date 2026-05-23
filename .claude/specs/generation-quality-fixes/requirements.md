# Requirements Document

## Introduction

The exercise generation pipeline shipped in Phase 1–4 reliably produces exercises end-to-end, but production data shows six concrete defects that together prevent the pool from reaching its quality and coverage targets:

1. **Coverage stalls below target.** The EventBridge-driven scheduler in `infra/lambda/src/generation/scheduler.ts` uses a hysteresis floor of `MIN_PER_CELL = 25`. Cells that crossed 25 once (e.g. `tr:a1:cloze:tr-a1-locative` at 42 approved, `tr:a1:cloze:tr-a1-vowel-harmony` at 43) are never re-enqueued even though `TARGET_PER_CELL = 50`. The gap is silently abandoned.
2. **`tr-a1-vowel-harmony` only exercises one of the two harmony patterns.** 42 of 43 stored cloze exercises blank out the plural suffix `-lAr/-lEr`. The curriculum entry covers BOTH 2-way (e/a) and 4-way (i/ı/u/ü) harmony; only the 2-way path is being sampled. Learners doing the cell are effectively re-drilling `tr-a1-plural-suffix`.
3. **`contextSpoilsAnswer` validator check is not firing.** Many auto-approved TR A1 cloze exercises have `context` fields that map the rule directly to the required form ("(u = back → -lar)" above a `-lar` blank; full enumeration "use -da/-de after voiced... -ta/-te after voiceless..." above a four-way locative blank). The validator prompt forbids these but lets them through.
4. **`quality_score` is a degenerate signal.** 99 % of stored rows score exactly `0.85`. The validator is effectively a binary gate at the 0.7 floor — there is no signal to threshold, rank, sample, or A/B with.
5. **One malformed draft kills the whole batch.** When the parser rejects a single draft (empty `correctAnswer`, whitespace in `expectedWord`), `runOneCell` throws and the remaining ordinals never run. We've already lost ~$0.70 of work on `tr:a1:cloze:tr-a1-personal-suffixes` (only 12 of 50 ordinals landed) and `es:b1:vocab_recall:es-b1-environment-vocab` (0 of 36).
6. **`es-b1-environment-vocab` is in a dedup death-spiral.** Last three scheduled runs produced 0 / 7 / 8 approved out of 36 / 34 / 27 requested, with `dedup_given_up_count = 0 / 5 / 17`. The cell still sits under `MIN_PER_CELL`, so the scheduler keeps hammering it daily for diminishing returns and ~$0.80/day in Claude spend.
7. **Buffer-consonant blanks are ambiguous.** Clozes like `"Ben çok mutlu___"` with `correctAnswer: "um"` are gameable two ways: the linguistic suffix is `-um` and the `-y-` is a buffer consonant, so by-the-book the answer is `"um"`; but a learner mentally completing the word `mutluyum` will naturally type `"yum"` as the visible blank. The exercise needs either to embed the buffer in the stem (`"Ben çok mutluy___"` → `"um"`) or to accept both forms via `acceptableAnswers`. Today it does neither, and the runtime evaluator's feedback on the resulting near-miss is itself muddled.
8. **Langfuse traces don't carry the exercise UUID.** Generation, validation, and runtime evaluation traces all flow through Langfuse but none of them tag the deterministic exercise UUID (`deterministicUuid(spec | batchSeed | ordinal)`). So when a learner reports a bad exercise, there is no way to pull its generation + validation pair from Langfuse without grepping by surface text — and surface text is not stable enough to be a join key.

This spec defines a focused set of changes to the scheduler, validator, generator prompt, retry loop, TR A1 curriculum, and Langfuse instrumentation to address all eight.

## Alignment with Product Vision

These fixes are squarely in service of the product's core thesis (`product.md`): _active production over passive recognition_ and _honest skill-based progress_. Both require that the pool actually drill the grammar point it claims to drill (R2), that exercises don't pre-leak their answers and don't admit multiple equally-valid fills (R3), that we can tell good drafts from mediocre ones for selection and metrics (R4), and that the pool eventually reaches enough volume and variety to support spaced-repetition scheduling without rote (R1, R6). R7 makes blank positions themselves unambiguous so that a "produce, don't recognize" exercise is actually gradeable. R5 is a cost-and-reliability fix; R8 is an observability fix that pays back across every other change in this spec by letting the maintainer pull a specific bad exercise's generation+validation pair from Langfuse on demand.

## Requirements

### Requirement 1 — Pool top-ups continue to target

**User Story:** As a learner, I want every active curriculum cell to converge to its declared target volume, so that spaced-repetition selection has enough variety per skill to avoid rote.

#### Acceptance Criteria

1. WHEN the scheduler enumerates curriculum cells THEN it SHALL enqueue every cell whose approved count is below `TARGET_PER_CELL` (currently 50), not only those below `MIN_PER_CELL`.
2. WHEN a cell is enqueued THEN the requested count SHALL equal `TARGET_PER_CELL - approved`, capped so that no single job requests more than the existing per-cell cost cap allows.
3. WHEN a cell's approved count already equals or exceeds `TARGET_PER_CELL` THEN the scheduler SHALL skip it (no message enqueued).
4. WHEN a cell has been enqueued and its most recent succeeded job produced **fewer than 3 net new approved exercises** AND the cell remains under target THEN the scheduler SHALL skip it on the next tick and record the skip in the structured log (`reason: 'saturated-low-yield'`). This stops the per-cell daily Claude spend on cells that can no longer make material progress (see R6).
5. WHEN the scheduler runs THEN every job it enqueues SHALL retain idempotent `jobId = deterministicUuid(cellKey | batchSeed)` semantics so same-day re-fires remain a no-op via the existing audit-row guard.

### Requirement 2 — `tr-a1-vowel-harmony` drills both 2-way and 4-way harmony

**User Story:** As a Turkish A1 learner, I want the vowel-harmony cell to exercise the high-vowel (i/ı/u/ü) forms as well as the low-vowel (e/a) plural suffix, so that the cell actually tests the grammar point its name claims.

#### Acceptance Criteria

1. The `tr-a1-vowel-harmony` curriculum entry in `packages/db/src/curriculum/tr.ts` SHALL include `examplesPositive` covering **at least two 2-way (e/a) plural-suffix forms** AND **at least four 4-way (i/ı/u/ü) suffix forms drawn from non-plural suffixes** (accusative -(y)I, locative -DA on a high-vowel stem, possessive -(s)I, or dative -(y)A on a high-vowel stem). The `description` field SHALL name both patterns by their CEFR-typical surface forms.
2. WHEN the existing TR A1 vowel-harmony pool is queried after the change is shipped THEN at least 30 % of the approved cloze exercises in the cell SHALL exercise a non-plural high-vowel suffix. This is enforced by a one-shot data check, not at runtime.
3. WHEN a generation job runs for the cell THEN the prompt SHALL declare that within a single batch the generator must cover at least three of the four high-vowel slots (i, ı, u, ü) AND both low-vowel slots (e, a) across the batch, **and** is forbidden from blanking the plural suffix `-lAr/-lEr` more than 50 % of the time. (Diversity guard expressed in the system-prompt instructions, not enforced by code — Claude is the executor; the validator stays grammar-correctness-only.)
4. IF the resulting drafts violate the distribution requirement THEN the validator SHALL flag them via the existing `flaggedReasons` array (`'cell over-concentrated on plural suffix'`) so the review CLI surfaces the imbalance. This MAY be implemented at the validator-prompt level (a new bullet under "Dimensions to score") without introducing new tool-schema fields.
5. WHEN the generator system prompt changes for R2.3 THEN the `GENERATION_PROMPT_VERSION` constant in `packages/ai/src/generation-prompts.ts` SHALL be bumped to today's date (`generate@YYYY-MM-DD`), per the project rule in CLAUDE.md.
6. WHEN any draft is validated THEN the validator SHALL set `grammarPointMatch = false` if the construction the blank actually tests is a different grammar-point key from the cell's declared point — even when the construction is grammatically related. Concrete example: the lone `correctAnswer: "da"` exercise currently stored in the `tr-a1-vowel-harmony` cell tests locative-DA (which belongs in `tr-a1-locative`), not vowel-harmony — that draft would be flagged under the new rule. (This is a validator-prompt clarification, not a new tool field.)

### Requirement 3 — Validator hard-veto checks fire reliably

**User Story:** As a learner, I want exercises that either tell me the answer in their `context` field, or admit more than one equally-correct fill, to never reach my queue — so that "produce, don't recognize" remains the binding rule. (This requirement covers two hard-veto checks that the validator's current prompt nominally enforces but in practice does not: `contextSpoilsAnswer` and `ambiguous`.)

#### Acceptance Criteria

##### R3.A — `contextSpoilsAnswer` vetoes spoiled contexts

1. WHEN the validator system prompt is rebuilt THEN it SHALL include at least three explicit `(spoiler context, blank, why-spoiled)` triples drawn from the production examples (vowel-harmony "stem 'çocuk' (u = back, unrounded → -lar)" / blank "lar"; locative "use -da/-de after voiced consonants, -ta/-te after voiceless" / blank one of four; vowel-harmony "front vowel stems take -ler" / blank "ler") so Claude has concrete shape to match against.
2. WHEN a cloze draft whose `context` either (a) explicitly contains the `correctAnswer` token (or the same token wrapped in `-`, `''`, `""`, or directional arrows), OR (b) exhaustively enumerates every member of the closed set of forms targeted by the grammar point (e.g. all four of `-da/-de/-ta/-te`) is validated THEN the validator SHALL set `contextSpoilsAnswer = true`.
3. WHEN `contextSpoilsAnswer = true` THEN the existing routing in `packages/db/src/generation/routing.ts` SHALL continue to map the draft to `review_status = 'rejected'` with `'context spoils answer'` first in `flaggedReasons`.

##### R3.B — `ambiguous` vetoes drafts that admit multiple valid fills

4. WHEN the validator system prompt is rebuilt THEN it SHALL include at least three explicit `(ambiguous sentence, declared answer, why-ambiguous)` triples drawn from the production examples:
   - `"Evde yeni ___ var. Onlar çok güzel."` / `"perdeler"` — perdeler, kitaplar, çiçekler, lambalar all fit; the "Onlar çok güzel" follow-on only signals plurality and a positive descriptor.
   - `"Sınıfta sekiz ___ var."` / `"öğrenci"` — sandalye, kalem, kitap all satisfy the no-plural-after-numeral rule equally; `correctAnswer: "öğrenci"` alone is ambiguous.
   - One translation example where surface variation crosses into structural variation (TBD by the implementer from the existing pool; non-binding if no clean case is in the data).
5. WHEN a cloze draft is validated AND (a) the blank admits more than one substantively-different lexeme/form that satisfies the targeted grammar point in the given sentence AND (b) the draft's `acceptableAnswers` does not enumerate them THEN the validator SHALL set `ambiguous = true`. The prompt's existing "Sınıfta sekiz" bullet (`packages/ai/src/validation-prompts.ts:64-70`) SHALL be retained and reinforced with the new examples — not removed.
6. WHEN `ambiguous = true` THEN the existing routing in `packages/db/src/generation/routing.ts` SHALL continue to map the draft to `review_status = 'flagged'` with `'ambiguous'` in `flaggedReasons` (R3.B does not change routing thresholds; it only makes the boolean actually fire).
7. WHEN the generator system prompt is rebuilt for R2 THEN it SHALL also add an explicit instruction that vocab-fill cloze sentences MUST either (a) be structurally constraining enough that only one specific lexeme fits — every other candidate ruled out by something explicit in the sentence — OR (b) populate `acceptableAnswers` with every lexeme that fits the rule. (This is restated from the existing prompt; in practice it has been ignored. The R2.5 `GENERATION_PROMPT_VERSION` bump covers this prompt edit.)

##### R3.C — Common to both vetoes

8. WHEN `pnpm revalidate:cloze --language TR --cefr A1 --apply` is run after the prompt change THEN exercises currently approved under R3.A or R3.B patterns SHALL be demoted to `review_status = 'rejected'` or `'flagged'` per the validator's new judgment. The existing `revalidate-cloze-pool.ts` CLI is the channel for this — no new CLI surface is required.
9. WHEN the prompt change ships THEN the `VALIDATION_PROMPT_VERSION` constant in `packages/ai/src/validation-prompts.ts` SHALL be bumped to today's date (`validate@YYYY-MM-DD`), per the project rule in CLAUDE.md.

### Requirement 4 — Quality score carries usable information

**User Story:** As the maintainer of the pool, I want the validator's `qualityScore` to express meaningful differentiation between drafts, so that I can use it to sort review queues, A/B prompt changes via Langfuse, and threshold downstream selection.

#### Acceptance Criteria

1. WHEN the validator system prompt is rebuilt THEN it SHALL replace the current single-floor wording with an explicit anchored rubric covering at least the values `0.5`, `0.65`, `0.8`, `0.9`, `1.0` with a one-line description of what each anchor represents (e.g. `0.9` = "publishable as-is by a native-speaker teacher"; `0.8` = "publishable with cosmetic edit"; `0.65` = "borderline — clear issue but salvageable"; `0.5` = "unusable; reject").
2. WHEN the existing TR A1 + ES B1 cloze pool is revalidated through the new prompt via `pnpm revalidate:cloze --dry-run --limit 200 --language TR --cefr A1` (and the equivalent for ES B1) THEN at least three distinct `qualityScore` values SHOULD appear in the dry-run output for the sampled cohort, and no single value SHOULD account for more than 70 % of the cohort. This is a **non-binding sanity check** on a single sampled cohort — a reviewer SHALL NOT block merge on a marginal violation, since Claude variance can produce flaky single-sample distributions. The check is used to confirm direction of travel, not absolute compliance.
3. WHEN the routing rules in `routing.ts` are evaluated THEN the existing boolean vetoes (cultural issues, `contextSpoilsAnswer`, `levelMatch`, `grammarPointMatch`, `ambiguous`) SHALL remain the hard gates. `qualityScore` SHALL keep its current routing role (rejected < 0.5, auto-approve gate ≥ 0.7) — this requirement does not change the thresholds, only the distribution feeding them.
4. WHEN the prompt ships THEN `VALIDATION_PROMPT_VERSION` SHALL be bumped. Per R7.5, the R3 + R4 + R7 validator-prompt edits SHALL ship as one coordinated commit with a single version bump (not three sequential bumps).

### Requirement 5 — Malformed drafts do not abort the batch

**User Story:** As an operator paying per Claude call, I want a single malformed draft to be charged off as one wasted ordinal, not to throw out 30 + already-completed ordinals, so that the realized cost of a generation job matches its budget.

#### Acceptance Criteria

1. WHEN `runRetryGeneration` in `packages/db/src/generation/validate-and-insert.ts:93-107` receives a `generateBatch` result that contains zero `drafts` (because the regenerated draft was malformed and landed in `result.malformedDrafts` instead) THEN it SHALL stop returning `result.drafts[0]` (which today produces `undefined`, crashing the downstream `currentDraft.contentJson` reference) and instead return a discriminated union `{ ok: true, draft, usage } | { ok: false, malformedDraft, usage }`. The `usage` field SHALL be populated in both branches so token cost is accounted for even when the draft is discarded — `generateBatch` already returns `tokenUsage` regardless of malformed status (`packages/ai/src/generate.ts:277-289`).
2. WHEN the per-ordinal flow in `validateAndInsertWithRetry` receives an `ok: false` outcome from `runRetryGeneration` THEN it SHALL treat the failure as the rejected branch of that attempt, fold the returned `usage` into `extraUsage`, and continue the retry-on-dedup loop exactly as it does today for a validator-rejected draft.
3. WHEN every retry slot of an ordinal yields a parser failure THEN that ordinal SHALL terminate with `terminalStatus = 'rejected'` and the caller (`runOneCell`) SHALL continue with the next ordinal — the batch SHALL NOT throw.
4. WHEN a batch finishes with any parser-failed ordinals THEN the structured log SHALL include a `parserFailedOrdinals: N` count alongside the existing `producedCount` / `approvedCount` / `rejectedCount` totals so the CLI breakdown line surfaces the underlying defect. (Distinct from the existing `malformedDraftCount` which counts initial-batch malformed drafts; `parserFailedOrdinals` counts ordinals that consumed every retry slot on parser failures.)
5. WHEN the parser failure originates from a malformed `correctAnswer` (the TR A1 personal-suffixes seed bug) or a malformed `expectedWord` (the ES B1 instance) THEN the same path SHALL apply — the recovery is upstream of the content-type discriminator.

### Requirement 6 — Saturated cells exit gracefully

**User Story:** As an operator, I want cells whose dedup index has effectively saturated the production search space to stop draining the Claude budget on near-zero-yield runs, so that scheduler cost stays predictable.

#### Acceptance Criteria

1. WHEN a generation job records `dedup_given_up_count >= ceil(0.5 * requested_count)` AND `approved_count < ceil(0.3 * requested_count)` THEN the job SHALL be considered _saturated_. The persisted `generation_jobs` row already carries both counters; no schema change.
2. WHEN the scheduler evaluates whether to enqueue a cell THEN it SHALL skip cells whose most recent succeeded job for that cell was _saturated_ (per R6.1) — even if `approved < TARGET_PER_CELL`. The skip SHALL appear in the structured log with `reason: 'saturated-dedup'`.
3. WHEN both R1.4 ("low-yield") and R6.2 ("saturated-dedup") would suppress the same cell on the same tick THEN `saturated-dedup` SHALL take precedence in the log `reason` field. (Saturated-dedup carries strictly more information — it diagnoses why the cell can't make progress, not just that it didn't.)
4. WHEN a cell is suppressed via R1.4 or R6.2 THEN the suppression SHALL clear when the curriculum content the cell depends on has changed since the suppressing job finished. Implementation: each curriculum language module (`packages/db/src/curriculum/{en,es,de,tr}.ts`) SHALL export a `CURRICULUM_VERSION_<LANG>` constant (today's date in `YYYY-MM-DD` form, bumped in the same commit as any edit to the language's grammar entries — analogous to `*_PROMPT_VERSION`). The scheduler SHALL compare that constant against a `curriculum_version` column (new, nullable text) added to `generation_jobs` — the column is populated on job INSERT from the module's `CURRICULUM_VERSION_<LANG>` constant and read back when scheduling. The suppression clears when the constant on disk differs from the value recorded on the most recent succeeded job. This is the only schema change in the spec: one nullable column with no migration on existing rows.
5. WHEN R6 ships THEN the daily scheduler log line SHALL include a `suppressed: { lowYield: N, saturatedDedup: M }` summary so the operator can see at a glance what was skipped.

### Requirement 7 — Cloze blanks unambiguous about buffer consonants

**User Story:** As a learner, I want the visible blank in a cloze to have exactly one correct fill string, so that I am graded on the linguistic point being tested and not on an arbitrary tokenization choice the exercise author made.

#### Acceptance Criteria

1. WHEN the generator system prompt is rebuilt THEN it SHALL declare that whenever a Turkish (or any-language) cloze blank follows a vowel-final stem and tests a suffix that takes a buffer consonant (`-y-` before vowel-initial copular suffixes like `-Im/-sIn/-Iz`; `-n-` before suffixes on possessive-marked stems; `-s-` in 3sg possessive on vowel-final stems), the draft MUST either (a) embed the buffer consonant in the visible stem so the blank is exactly the linguistic suffix (`"Ben çok mutluy___" → "um"`), OR (b) populate `acceptableAnswers` with both buffer-included and buffer-excluded forms (`correctAnswer: "yum", acceptableAnswers: ["um"]` — or the reverse) and clarify in `instructions` which form is preferred. Doing neither is forbidden.
2. WHEN a cloze draft tests a suffix subject to buffer-consonant ambiguity AND fails both alternatives in R7.1 THEN the validator SHALL set `ambiguous = true` and add `'buffer-consonant ambiguous blank'` to `flaggedReasons`. (This reuses the R3.B `ambiguous` veto path — no new boolean field.)
3. WHEN the validator system prompt is rebuilt THEN it SHALL include the `"Ben çok mutlu___"` / `"um"` vs `"yum"` example from production as an explicit triple under the `ambiguous` dimension, alongside the R3.B vocab-fill examples.
4. WHEN `pnpm revalidate:cloze --language TR --cefr A1 --apply` is run after the prompt change THEN any currently-approved buffer-consonant-ambiguous draft (specifically: a cloze where the visible stem ends in a vowel AND the `correctAnswer` is a vowel-initial copular/possessive suffix AND `acceptableAnswers` does not include the buffered form) SHALL be demoted by the validator's new judgment.
5. WHEN R7's prompt edits ship THEN they SHALL be folded into the same `VALIDATION_PROMPT_VERSION` and `GENERATION_PROMPT_VERSION` bumps as R3 and R2 — i.e. all four prompt-edit requirements (R2, R3, R4, R7) ship as one coordinated commit per prompt file, each bumping its version constant once.

### Requirement 8 — Exercise UUID propagates to Langfuse traces

**User Story:** As the maintainer of the pool, I want every Langfuse trace produced by generation, validation, or runtime evaluation to carry the deterministic exercise UUID, so that I can pull a specific bad exercise's full LLM-call history from Langfuse with a single search.

#### Acceptance Criteria

1. WHEN the generator (`packages/ai/src/generate.ts`) emits a Langfuse trace for a per-ordinal draft attempt THEN that trace SHALL include the exercise UUID — `deterministicUuid(spec | batchSeed | ordinal)`, which is the same id used as the `exercises.id` primary key — under a stable metadata key `exerciseId`.
2. WHEN the validator (`packages/ai/src/validate.ts`) emits a Langfuse trace for a per-draft validation call THEN that trace SHALL include the same `exerciseId` metadata key with the matching value, so generation and validation traces for one exercise share a join key.
3. WHEN the runtime answer evaluator (`packages/ai/src/evaluate.ts`) emits a Langfuse trace for a user-submitted-answer evaluation THEN that trace SHALL include `exerciseId` with the value of the exercise being evaluated (available from the request body the API already receives).
4. WHEN a Langfuse trace is queried by `exerciseId` (Langfuse's filter UI or its API) THEN all three trace types for that exercise SHALL appear together. The metadata key SHALL be exactly `exerciseId` (camelCase) — no aliases — so the search shape is stable.
5. WHEN this requirement ships THEN no prompt version constant SHALL change. R8 is observability metadata only; it adds nothing to the LLM input/output, and therefore neither `GENERATION_PROMPT_VERSION` nor `VALIDATION_PROMPT_VERSION` nor `EVALUATION_SYSTEM_PROMPT_VERSION` is bumped.

## Non-Functional Requirements

### Performance
- The scheduler MUST keep its DB hits bounded: today it issues exactly one `GROUP BY` aggregate over `exercises`. The R1/R6 changes MAY add at most one additional aggregate over `generation_jobs` (using `generation_jobs_cell_idx`); no per-cell queries.
- The validator's **steady-state billed token cost per draft** MUST NOT increase by more than ~15 % relative to today. This is the billed cost after Anthropic prompt-cache hits, not the raw prompt size. Today the validator's system prompt is ~950 tokens (`VALIDATION_SYSTEM_PROMPT_TEMPLATE` is 3,805 bytes; ~4 bytes per English token). The R3+R4+R7 additions add ~415 tokens (~+44 % raw). With the existing ≥0.8 prompt-cache hit rate, billed input-token cost grows by ~`0.44 × (1 − 0.8) = 0.088` = **~9 % per draft**, comfortably inside +15 %. The first call after each deploy pays the full miss cost (one-time, ~3-5 c). The +15 % cap is enforced on billed cost; raw prompt size is bounded by capping rubric anchors to ≤5 and combined R3.A + R3.B + R7.3 triples to ≤8. The R2.4 over-concentration and R2.6 grammarPointMatch bullets each cost one bullet under "Dimensions to score" and are counted in the budget.
- The Anthropic prompt-cache hit rate (Langfuse `cache_read_input_tokens / input_tokens`) on the validator's system block MUST stay ≥ 0.8 after the change. Prompt-cache parity is preserved because the system prompt's substitution variables don't change shape (only static text grows).

### Security
- No new external network calls. All changes stay within the existing Claude API, Postgres, and SQS surfaces.
- The revalidator (R3.4) reuses the existing `revalidate:cloze` script's auth model (env-injected `DATABASE_URL`, `ANTHROPIC_API_KEY`) — no new credential paths.

### Reliability
- All changes MUST be backward-compatible at the schema level **except for R6.4's single nullable `generation_jobs.curriculum_version text` column**, which is additive and requires no backfill. `generation_jobs.dedup_given_up_count` already exists; `exercises.review_status` enum already has `rejected` and `flagged`.
- The malformed-draft handling (R5) MUST be defensive — if upstream parsing changes in `packages/ai`, the retry loop still bounds total Claude calls per ordinal at the existing `MAX_DEDUP_RETRIES + 1` budget.
- The scheduler's suppression logic (R1.4, R6.2) MUST never permanently disable a cell. A curriculum edit (R6.3) or an explicit CLI re-enqueue (`pnpm --filter @language-drill/db generate:exercises --cell <key>` already exists) MUST always re-activate it.

### Usability
- The validator-prompt change MUST keep `VALIDATION_PROMPT_VERSION` semantics intact so Langfuse dashboards continue to cohort old/new traces cleanly.
- The structured logs introduced by R1.4, R5.4, and R6.5 MUST follow the existing single-JSON-object-per-line pattern in `infra/lambda/src/generation/scheduler.ts` (and the `runOneCell` log helper) so existing CloudWatch queries continue to parse them.
- All commands a reviewer needs to verify the change (the revalidator dry-run, the data check for R2.2, Langfuse search by `exerciseId` for R8) MUST already exist in the repo's package scripts or Langfuse UI — this spec does not introduce a new CLI surface.

## Future Work (out of scope for this spec)

- **Runtime evaluator prompt quality.** The runtime answer evaluator at `packages/ai/src/prompts.ts:EVALUATION_SYSTEM_PROMPT` produces convoluted, self-contradicting feedback on near-miss answers — see the production example where a learner's `"yum"` answer to a `"mutlu___" → "um"` blank receives ~150 words of waffle that ultimately undermines its own conclusion. Much of this is downstream of R7 (once the exercise's blank is unambiguous, the evaluator has less to be confused about) and R3 (once ambiguous-fill exercises are vetoed, the evaluator stops fielding "is this even wrong?" cases), so the right sequencing is to ship this spec first and re-evaluate evaluator-prompt quality afterwards as a separate spec. R8's `exerciseId` propagation makes that follow-up spec dramatically easier to drive — every bad-feedback report can be traced back to the exercise that produced it.
- **Per-language `CURRICULUM_VERSION` for theory generation.** R6.4 introduces `CURRICULUM_VERSION_<LANG>` for exercise scheduling. The same mechanism almost certainly applies to the theory-generation scheduler (`packages/db/src/theory-generation/`), but its operational data hasn't been audited for the same failure mode and the change isn't required for any user-visible defect today.
