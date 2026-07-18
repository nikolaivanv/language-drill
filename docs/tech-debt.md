# Tech Debt

A living log of known issues to address. Add new entries at the top; mark as resolved (don't delete) so we can grep history. Each entry: title, status, discovered date, scope, root cause, remediation, references.

---

## Prompt caching: cold-wave writes on the generation pools; evaluation tool defeats its own cache

- **Status:** partially resolved 2026-07-18 — the generate/validate cold-wave (remediation **1**) is **fixed** (per-cell prefix priming in both worker pools); the evaluation tool (remediation **2**) and annotate min-prefix (remediation **3**) remain **open by decision** (negligible token share). See Resolution below.
- **Discovered:** 2026-07-18 (triaging an Anthropic "low prompt-cache hit rate" warning email against Langfuse `usageByType` data)
- **Scope:** `packages/db/src/generation/generator-pool.ts` + `validator-pool.ts` (the cold-wave, **fixed**); `packages/ai/src/evaluate.ts:40-117,416` (`buildEvaluationTool` — per-exercise tool enum, **open**); `packages/ai/src/annotate.ts` (Haiku 4096-token min-prefix, **open**)
- **Severity:** low — caching already works (overall ~73% hit over the 14 days to 2026-07-18); this is cost/efficiency headroom on the input-token bill and the metric Anthropic flagged, not a correctness issue

**Measurement (Langfuse `usageByType`, 14 days to 2026-07-18, input-side token millions; hit = cache_read / (cache_read + cache_creation + input)):**

| Surface | read | write | input | hit | reads/write | share of input tokens |
|---|--:|--:|--:|--:|--:|--:|
| generate | 108.3 | 27.7 | 9.6 | 74% | 3.9× | 62% |
| validate | 64.0 | 12.4 | 12.6 | 72% | 5.2× | 38% |
| evaluate | 0.30 | 0.27 | 0.48 | **29%** | 1.1× | 0.4% |
| annotate-span | 0.49 | 0.05 | 0.17 | 69% | 10× | 0.3% |
| annotate | 0 | 0 | 0.02 | **0%** | — | <0.1% |
| **overall** | 173.0 | 40.5 | 22.8 | **73%** | 4.3× | 100% |

`generate` + `validate` are **99.8% of all input tokens**. The daily trend is bimodal: big backfill days (07-07/17/18) hit 79–84%; small top-up days (07-14/15: 22–23%) crater. That's the cold-wave (below), and the recent run of low-volume days is what tripped Anthropic's warning.

**Root cause (three independent gaps):**

1. **Cold-wave on the generation pools (the dominant, fixed one).** `runGeneratorPool` / `runValidatorPool` fan out `MAX_*_CONCURRENCY = 5` workers that all start together. Every draft in a cell shares one `cache_control: ephemeral` system+tool prefix, but an Anthropic cache entry is only readable once the response that wrote it *starts streaming* — so all 5 workers in the opening wave miss and pay the 1.25× write. On a small-`need` top-up cell (deficit ≲ 5), the whole cell is one wave → ~0% reads. On a fresh cell (`need`≈`TARGET_PER_CELL = 50`) the 5 writes amortize over ~45 reads → ~90%. Hence the bimodal trend.
2. **`evaluate` defeats its own cache.** `buildEvaluationTool(attributionKeys)` embeds the exercise's in-scope grammar-point keys as a closed `enum`. Render order is `tools → system → messages` and the cache breakpoint is on the system block, so the key covers the tools before it. The tool schema is different for almost every submission → the tools+system prefix is unique per request → every eval is a cold write, never read (reads≈writes, 1.1×; 29% hit). `claude-sonnet-5`, per-user path.
3. **`annotate` never caches.** Haiku 4.5's minimum cacheable prefix is 4096 tokens; the annotate system prompt is evidently shorter, so `cache_control` silently no-ops (`cache_creation: 0`, no error).

**Remediation:**

1. **Per-cell prefix priming (done).** Run ordinal 0 of each pool alone, then release the remaining workers — the first draft writes the shared prefix, the rest read it warm. Makes concurrency irrelevant to caching; recovers the low-volume-day cratering. Chosen over lowering concurrency (adds wall-clock to the 120-cell run) and over a `max_tokens:0` pre-warm (extra request to maintain).
2. **`evaluate` tool (open, deferred).** Make the tool static: drop the `grammarPointKey` closed `enum` to a plain `string` and validate keys server-side in `parseEvaluationResult` (the valid keys are already listed in the user message). **Deferred by decision 2026-07-18:** evaluate is 0.4% of input tokens — fixing it will not move the org metric, and the closed enum is a real quality guard we'd be trading for cache-ability.
3. **`annotate` min-prefix (open, deferred).** Either accept no caching (it's <0.1% of tokens) or lift the prefix over 4096 tokens. Not worth touching.

**Why the fix is worth it (remediation 1 only):** lifting generate+validate from ~73% to the ~85–90% the big days already hit converts on the order of ~15–20M write-tokens/14d into reads (writes 1.25×, reads 0.1×) — ~$100–150/month at `claude-sonnet-4-6` pricing — and clears the low-hit-rate warning. Modest but free once shipped.

**Resolution (2026-07-18, remediation 1):** `runGeneratorPool` and `runValidatorPool` now prime ordinal 0 before spawning the worker fan-out (a shared `runOrdinal(ordinal)` closure called once for ordinal 0, then by each worker for `nextOrdinal++ ≥ 1`). No change to results, ordering, usage aggregation, abort semantics, or the validator's `ValidationParseError` per-ordinal isolation — only the scheduling of the first call. Covered by a new `'primes the shared prompt-cache prefix: ordinal 0 completes before any other ordinal starts'` test in each pool suite (asserts `end-0` precedes every other `start-*`); full generation suite green (186 passed). The `MAX_*_CONCURRENCY = 5` knobs are unchanged.

**Still open:** remediations 2 (evaluate tool) and 3 (annotate prefix), both deferred as negligible token share — revisit only if the per-user evaluation volume grows materially.

**Owner:** unassigned
**Tracking:** none yet — open a GitHub issue if remediation 2/3 is ever prioritized
**References:**
- Langfuse `usageByType` breakdown (14 days to 2026-07-18), grouped by observation `name` — the measurement table above.
- `packages/db/src/generation/generator-pool.ts` / `validator-pool.ts` — the primed pools.
- `packages/ai/src/evaluate.ts:40-117` (`buildEvaluationTool`), `:416` (call site) — the varying-tool cache-defeat.
- `packages/ai/src/observability.ts:359-402` — where per-call `cache_creation_input_tokens` / `cache_read_input_tokens` are recorded (the source of the breakdown).
- Anthropic prompt-caching semantics: cache readability begins at first stream; 1.25× write / 0.1× read; Haiku 4096-token min prefix.

---

## No brake or alert on Anthropic API spend in the scheduled generation path

- **Status:** partially resolved 2026-07-08 — remediations **2** (run-level scheduler ceiling) and **3** (Anthropic-cost CloudWatch metric + daily-sum alarm) shipped; remediations **1** (per-cell cap enforcement in `runOneCell`) and **4** (manual Anthropic-console alert) remain **open**. See Resolution below.
- **Status (original):** open — deferred until the self-revealing-targets exercise fix lands (`docs/findings/2026-07-07-self-revealing-target-elicitation.md`)
- **Discovered:** 2026-07-07 (the ES `2026-07-07` curriculum initial fill spent ~$117 in one 80-minute run and drained the Anthropic credit balance to $0.61 — zero alerts fired at any layer)
- **Scope:** `infra/lambda/src/generation/scheduler.ts:54` (`SCHEDULER_PER_CELL_COST_CAP_USD = 0.5`), `packages/db/src/generation/run-one-cell.ts` (`args.maxCostUsd` accepted but never read), `packages/db/scripts/generate-exercises.ts:360` (the only place a cost cap is actually enforced — CLI local-run path), `infra/lib/constructs/alerts.ts` (AWS-only budget + anomaly detection), `infra/lambda/src/generation/handler.ts` / `metrics.ts` (where a cost metric would be emitted)
- **Severity:** high — a single curriculum bump can fan out hundreds of cells and spend an unbounded amount against the Anthropic account in one nightly run, with no runtime stop and no alerting before or after

**Root cause (three independent gaps that lined up):**

1. **The per-cell cap is decorative on the scheduled path.** The scheduler puts `maxCostUsd: 0.50` into every SQS job message and the Lambda handler threads it into `runOneCell` — but `runOneCell` never compares accumulated cost against it. The `skipped-cost-cap` status only exists on the CLI path (`generate-exercises.ts:360`, run-level `totalCostUsd >= args.maxCostUsd` between cells). Evidence from the 2026-07-07 run: **124 of 187 jobs exceeded $0.50** (avg $0.63, max $1.49).
2. **The scheduler has no run-level ceiling.** Nothing limits how many cells one nightly run enqueues (a curriculum bump enqueued 187) or their projected total cost.
3. **No layer observes Anthropic spend.** AWS Budgets + Cost Anomaly Detection (`AlertsConstruct`) see AWS spend only — Anthropic billing never touches Cost Explorer. CloudWatch alarms cover Lambda errors/DLQ/CellFailed — all 187 jobs *succeeded*, so nothing fired. Per-job `cost_usd_estimate` is written to `generation_jobs` and then nothing reads it. (Anthropic-console spend alerts are a manual, account-level backstop — none were configured to fire here.)

Had the balance been ~$1 lower, tail jobs would have died on credit-exhausted API errors instead — visible as failed jobs + DLQ alarms, self-recovering next nightly run (see "Generation failures self-recover" behavior), but with the same silent overspend up to that point.

**Remediation (in priority order):**

1. **Enforce the cap that already travels in the message:** in `runOneCell`, stop issuing further draft batches once accumulated `estimateCostUsd` crosses `args.maxCostUsd`; finish the cell with the drafts already produced (or `skipped-cost-cap` if nothing was). The plumbing exists end-to-end; only the comparison is missing. Unit-test in `run-one-cell` tests.
2. **Run-level ceiling in the scheduler:** cap projected cost (or cell count) per nightly run and carry the remainder to subsequent nights, so an initial fill spreads over days instead of one unbounded fan-out. Log what was deferred.
3. **Emit Anthropic cost as a CloudWatch metric** (per-job `costUsd` from the handler; the value is already computed) and alarm on the daily sum via `AlertsConstruct`'s SNS topic — closes the "Anthropic spend is invisible" gap with data the pipeline already has.
4. **Anthropic console spend alert** (manual, account-level) as a defense-in-depth backstop.

Note: `cost_usd_estimate` is the pipeline's own pricing-table estimate; the real invoice can differ (prompt-caching discounts), but the 2026-07-07 estimate matched the observed balance drain to the right order of magnitude.

**Owner:** unassigned
**Tracking:** none yet — open a GitHub issue when prioritizing

**Resolution (2026-07-08, remediations 2 + 3):** Design in `docs/superpowers/specs/2026-07-08-generation-spend-brake-design.md`.

1. **Run-level ceiling + per-language fair-share cap (remediation 2).** `infra/lambda/src/generation/scheduler.ts` caps how many under-target cells one tick enqueues (`SCHEDULER_MAX_CELLS_PER_RUN`, default `DEFAULT_MAX_CELLS_PER_RUN = 120`; a non-positive/non-numeric override falls back to the default so the brake can't be disabled by a typo). Selection runs through the pure `selectCellsWithinCaps` (`cell-selection.ts`), which also applies a **per-language cap** (`SCHEDULER_MAX_CELLS_PER_LANGUAGE`, default `50`): each language reserves its highest-need share first, the reserved set trims by `need` under contention, and unused global slots redistribute to a language with a bigger backlog — so one language's curriculum expansion can't monopolize the run (the 2026-07-18 run went 100% German and parked every ES/TR top-up for days). A structured log line records `cap` / `perLanguageCap` / `enqueuedThisRun` / `enqueuedByLanguage` / `deferredCount`. No persistence — deferred cells stay under-target and re-enqueue next run. Both caps are optional props on `SchedulerLambdaConstruct` (`maxCellsPerRun` / `maxCellsPerLanguage`); the stack passes nothing → code defaults. Raised 60 → 120 on 2026-07-18 (see `docs/analysis/generation-run-2026-07-18.md`).
2. **Anthropic-cost metric + daily alarm (remediation 3).** `emitCellCostMetric` (`infra/lambda/src/generation/metrics.ts`) emits per-cell `CellCostUsd` EMF (namespace `LanguageDrill/Generation`, `env` dimension); the handler calls it with `estimateCostUsd(result.tokenUsage)` for **every** terminal outcome (so a `failed` cell's burned tokens still count). `GenerationDailyCostAlarm` (`infra/lib/constructs/generation-lambda.ts`) alarms on the daily `Sum` crossing `dailyCostAlarmUsd` (default $50) via the existing `AlertsConstruct` SNS topic — the first layer that observes Anthropic spend (AWS Budgets / Cost Anomaly Detection see AWS spend only, and all 187 cells of the incident *succeeded*).

**Still open:** remediation 1 (compare accumulated cost against `args.maxCostUsd` inside `runOneCell` — mirror the outcome pool's `earlyBailed` circuit breaker; the per-cell overshoot is minor next to the fan-out, hence deferred) and remediation 4 (manual Anthropic-console account-level spend alert).

---

## Generator leaks the target form into the `context` field for "form-named" grammar points (`contextSpoilsAnswer`)

- **Status:** open
- **Discovered:** 2026-06-03 (analysing the daily scheduled TR A2 run — `tr-a2-converb-temporal` auto-approved only 1 of 9 drafts; 3 rejected as `context-spoils-answer`)
- **Scope:** `packages/ai/src/generation-prompts.ts:175` (the *Spoiled blank* hard constraint the model violates), `:183` (anti-leak clause), `:149-153` (`{{grammarPointName}}` / `{{grammarPointDescription}}` injection); `packages/db/src/generation/deterministic-checks.ts:40-77` (where a deterministic guard would live); the grammar-point definitions whose `name` **is** the literal target suffix (`packages/db/src/curriculum/…` — e.g. `tr-a2-converb-temporal`, `tr-a1-vowel-harmony`, the TR case cells)
- **Severity:** medium — no bad data ships (the validator's `contextSpoilsAnswer` veto catches it), but it burns generation budget, suppresses yield on affected cells, and inflates the `context-spoils-answer` bucket

**Root cause:**
The per-exercise `context` field is **model-generated** — the generation *user* prompt passes no `context` value (verified in Langfuse: the user message is only *"Produce exercise #1 … build around '<word>'"*). The system prompt *explicitly forbids* naming the target form in `context` (Hard constraints → **Spoiled blank**: *"may name the grammar category … but MUST NOT state the rule's outcome, name the required suffix/form"*; reinforced by the anti-leak clause, which calls itself *"the generator-side guard for the validator's `contextSpoilsAnswer` veto"*). The model violates it anyway: for grammar points whose **name is the literal target form** — `{{grammarPointName}}` = "Temporal converbs **-mAdAn önce / -DIktAn sonra**" — it echoes that name straight into `context`. Naming one suffix (or, worse, the wrong one) gives the answer away.

**Evidence (2026-06-03 prod scheduled run, `tr:a2:cloze:tr-a2-converb-temporal`):**
- 9 drafts → 1 auto-approved / 4 flagged / 4 rejected. `rejection_reason_counts`: `{ context-spoils-answer: 3, low-quality-reject: 2 }`.
- **8 of 9** drafts wrote the suffix(es) into `context` (`"-mAdAn önce / -DIktAn sonra"`, `"-DIktAn sonra (after doing)"`). Validator vetoes (from Langfuse `validate` traces):
  - `Evi ___ önce…` / ctx `"-mAdAn önce"` → *"directly names the required suffix… learner can mechanically apply it. Hard veto."*
  - `Telefona ___ önce…` (answer `bağlanmadan`, a `-mAdAn önce` form) / ctx `"-DIktAn sonra"` → *"the context names the **wrong** converb type… actively misdirects the learner"* (qs 0.35).
- **Contrast:** the "category-named" `tr-a2-reported-speech` cells had **0** context-spoils across 15 drafts (their `context` reads "Reported speech with diye" — a category, which the prompt permits). So the leak correlates specifically with form-named grammar points.

**Remediation:**
Don't rely on LLM compliance with a buried prompt rule. Add a **deterministic post-generation guard** (same spirit as the Turkish harmony gate in `deterministic-checks.ts`):

1. For a cell whose grammar point's target form is a known suffix/form string, if the produced `context` (or `instructions`) contains that string, **strip `context`** (preferred — the field is optional and adds little for these cells) **or** route the draft to `flagged`/regenerate.
2. Equivalently, **omit the `context` field entirely** for form-named grammar-point cells at generation time — the sentence plus the parenthetical citation hint already carry the task.
3. Optionally tighten the prompt: for grammar points whose name contains the target form, instruct that `context` describe the *situation*, never restate the construction — but treat this as secondary to the deterministic guard (the prompt already forbids it and is ignored).

**Acceptance criteria for the fix:**
- A post-generation check rejects/strips a `context` that contains the cell's target form; covered by a unit test in `deterministic-checks.test.ts` (form-named cell with a leaking context → stripped/flagged; category-named cell unaffected).
- A re-run of `tr-a2-converb-temporal` produces 0 `context-spoils-answer` rejections attributable to the `context` field.

**Why we can't ignore it:**
- It's the entire `context-spoils-answer` population on form-named cells — the "amendable" rejections from the 2026-06-03 analysis. converb-temporal auto-approved only 1/9, largely because of this.
- The prompt already forbids it and the model ignores it; the same leak affects every grammar point whose name is a concrete suffix (vowel-harmony, cases), so the blast radius grows with curriculum coverage.

**Owner:** unassigned
**Tracking:** none yet — open a GitHub issue when prioritizing
**References:**
- 2026-06-03 prod run analysis (Langfuse `generate`/`validate` traces, cellKey `tr:a2:cloze:tr-a2-converb-temporal`).
- `packages/ai/src/generation-prompts.ts:175,183` — the *Spoiled blank* / anti-leak constraints the model violates; `:149-153` — `{{grammarPointName}}`/`{{grammarPointDescription}}` injection.
- `packages/db/src/generation/deterministic-checks.ts:40-77` — where the spoil-guard would live (mirrors the harmony gate).
- `packages/db/src/generation/routing.ts` — the `contextSpoilsAnswer` reject branch this guard would pre-empt.

---

## Generator ships a lone `correctAnswer` for multi-form constructions (reported speech) → `ambiguous` rejections

- **Status:** open
- **Discovered:** 2026-06-03 (same run analysis — both `tr-a2-reported-speech` cells low-yield: cloze 6/10 approved with 2 rejects; translation 1/5 approved with 3 rejects)
- **Scope:** `packages/ai/src/generation-prompts.ts` (the **Ambiguous blank** / *One correct fill, or enumerate them* constraints — under-applied for multi-form constructions); the `tr-a2-reported-speech` cloze + translation cells (`packages/db/src/curriculum/…`)
- **Severity:** medium — no bad data ships; low approval yield wastes generation budget and starves these cells of approved exercises

**Root cause:**
Turkish reported speech admits **several equally valid renderings** of one source meaning — direct quote + `dedi`, integrated `-mAsını söyledi`, or `diye` + reporting verb. The generator ships a single `correctAnswer` without enumerating the alternatives in `acceptableAnswers`, so the validator flags `ambiguous`. The prompt already requires enumeration (Hard constraints → *Ambiguous blank* / *One correct fill, or enumerate them*), but it's under-applied for this construction. This is **distinct from the `context`-spoil entry above** — these cells name the *category* ("reported speech") safely; they fail on ambiguity, plus some A2 level/quality drift (blanks placed inside the quoted clause; convoluted sentences).

**Evidence (2026-06-03 prod run):**
- `tr:a2:cloze:tr-a2-reported-speech` — 0/10 context-spoils; several `ambiguous` flags (qs 0.62) and 2 `low-quality-reject` (qs 0.2): `Komşum beni rahatsız etmeyi bırakmasını ___ söyledi` (convoluted) and a blank placed *inside* the quote (`Doktor, "Telefona çok ___ oluyorsunuz" diye uyardı`).
- `tr:a2:translation:tr-a2-reported-speech` — `ambiguous` on *"She said, 'Don't bother me!'"* (qs 0.45) and *"My mother told me to go to bed"* (qs 0.62) — both map to multiple valid Turkish reported-speech forms; no `acceptableAnswers` enumeration.

**Remediation:**
1. For multi-form constructions (reported speech, and any cell where one meaning maps to >1 valid surface form), the generator MUST enumerate every valid form in `acceptableAnswers` — reinforce the existing rule with a construction-specific instruction, and/or add a generation-quality check that rejects a lone `correctAnswer` for these grammar points.
2. Constrain A2 complexity: forbid placing a cloze blank *inside* the quoted clause for reported-speech cloze, and keep sentence structure within A2.
3. For translation cells, prefer source sentences whose reported-speech rendering is dominant, or ensure the validator's `ambiguous` bar matches the evaluation path's existing tolerance for minor variants.

**Acceptance criteria for the fix:**
- Reported-speech drafts that admit multiple valid forms carry `acceptableAnswers` listing them; a re-run reduces `ambiguous` flags/rejections on both cells.
- No cloze blank is placed inside the quoted clause for reported-speech cloze.

**Why we can't ignore it:**
- Both reported-speech cells are low-yield (translation approved 1/5), so the daily refill under-stocks them while spending budget.
- The fix generalizes to any future multi-form grammar point — it's the same `acceptableAnswers` discipline the prompt already mandates but doesn't enforce.

**Owner:** unassigned
**Tracking:** none yet — open a GitHub issue when prioritizing
**References:**
- 2026-06-03 prod run analysis (Langfuse `validate` traces, cellKeys `tr:a2:cloze:tr-a2-reported-speech`, `tr:a2:translation:tr-a2-reported-speech`).
- `packages/ai/src/generation-prompts.ts` — *Ambiguous blank* / *One correct fill, or enumerate them* constraints.
- Related: the `context`-spoil entry above (same run analysis; the two cells fail for different reasons).

---

## `rejection_reason_counts` / `flagged_reasons` mix canonical tags with free-form model prose (no canonical reason code)

- **Status:** resolved 2026-06-03 (PR #242 — canonical `GenerationReasonCode`; verified on the 2026-06-03 prod run)
- **Discovered:** 2026-06-01 (analysing the daily scheduled TR generation run — `generation_jobs.rejection_reason_counts` contained a 200-char paragraph as a single map key)
- **Scope:** `packages/db/src/generation/routing.ts:49-129` (where reasons are assembled), `packages/ai/src/validate.ts:96-145` (`ValidationResult.flaggedReasons` / `culturalIssues` — free-form `string[]`), `packages/ai/src/validation-prompts.ts:108-119` (prompt instructs free-text reasons), `packages/db/src/generation/run-one-cell.ts:410,548-556,599-617` (the `rejection_reason_counts` frequency map), `packages/db/src/generation/validate-and-insert.ts:440-443` (`exercises.flagged_reasons` persist), `packages/db/src/generation/deterministic-checks.ts:39-77` (Turkish reason strings that interpolate values)
- **Severity:** medium — no correctness or runtime risk, but it corrupts the exact analytics signal `rejection_reason_counts` was added to provide (migration `0012`), so the planned data-gated validator→generator repair loop can't aggregate over it

**Root cause:**
`routeValidationResult()` builds the reason arrays from two incompatible sources and concatenates them:

1. **Canonical tags** — a fixed, hand-written set of strings emitted on deterministic predicates: `'low quality score (<0.5)'`, `'context spoils answer'` (rejected branch); `'low quality score (<0.7)'`, `'ambiguous'`, `'level mismatch'`, `'grammar point mismatch'` (flagged branch). Plus the synthetic `'parser failure (retry exhausted)'` / `'validator parse failure (malformed response)'` (`validate-and-insert.ts:170,180`).
2. **Free-form model prose** — the validator's `result.culturalIssues[]` and `result.flaggedReasons[]`, which the tool schema and prompt explicitly define as free-text (`validate.ts:96-101`: *"Free-text descriptions…"*; `validation-prompts.ts:118`: *"Add anything that future-you would want to see when reviewing manually"*). These are unbounded English sentences with no canonical form.
3. **Value-interpolated deterministic strings** — `deterministic-checks.ts` emits e.g. `'wrong vowel-harmony allomorph (deterministic): expected <X>, got <Y>'`, so even the deterministic path produces a distinct key per token.

All three flow into the same array, which `run-one-cell.ts` folds into `rejectionReasonCounts[reason]++` — i.e. the **reason string is the map key**. There is no canonical reason enum anywhere in the codebase. So every unique paragraph becomes its own bucket with count 1, and the value-interpolated strings never collide either.

**Evidence (2026-06-01 prod scheduled run, TR A1/A2, 56 jobs):**
- `rejection_reason_counts` aggregated across the run: `low quality score (<0.5)` → 64, `context spoils answer` → 34, and a single bucket `The reference translation uses 'Ulan' as the equivalent of 'Hey', but 'Ulan' is a coarse, potentially offensive interjection in Turkish … [200+ chars]` → 1.
- `exercises.flagged_reasons` (JSON arrays) the same day mixed canonical tags — `low quality score (<0.7)` (153), `ambiguous` (104), `level mismatch` (89), `grammar point mismatch` (6) — with multi-sentence model explanations stored as sibling array elements.

The canonical tags aggregate cleanly; everything else is noise that defeats `GROUP BY reason`.

**Remediation:**
Separate the canonical reason **code** from the free-text **detail**:

1. **Introduce a canonical reason enum** (e.g. `packages/shared/src/generation-reasons.ts` exporting a `RejectionReasonCode` / `FlagReasonCode` union) covering the `routing.ts` tags, the parser/validator-failure synthetics, and a *category* for each deterministic check (`vowel-harmony-allomorph`, `malformed-surface-form`) and for validator free-text (`cultural-issue`, `validator-note`) — **without** interpolated values.
2. **Carry reasons as `{ code, detail? }`** out of `routeValidationResult()` / the deterministic checks. The `code` is enum-constrained; `detail` holds the free-form prose and interpolated values.
3. **Key the frequency map on `code` only** in `run-one-cell.ts` — so `rejection_reason_counts` has bounded cardinality and aggregates across cells and days.
4. **Keep `exercises.flagged_reasons` human-readable** for the manual review UI, but store it as `{ code, detail }[]` (or a `codes: string[]` + `notes: string[]` split) so dashboards filter on codes while reviewers still see the prose.
5. Backfill is optional — historical rows can stay as-is (the entry documents the format change); new runs get clean codes.

**Acceptance criteria for the fix:**
- A canonical reason-code constant exists and is the single source of truth; `routing.ts`, `deterministic-checks.ts`, and `validate-and-insert.ts` reference it instead of inline string literals.
- `generation_jobs.rejection_reason_counts` keys are drawn exclusively from that enum (assert in `run-one-cell.test.ts` that no map key contains a colon-interpolated value or a sentence-length string).
- Free-form validator prose is still retained per exercise (in `detail` / `notes`), so manual review loses no context.
- `SELECT reason, SUM(...) FROM generation_jobs, LATERAL jsonb_each_text(rejection_reason_counts) GROUP BY reason` on a post-fix run returns a bounded, stable set of rows.

**Why we can't ignore it:**
- Migration `0012` added `rejection_reason_counts` specifically to gate a validator→generator repair loop on rejection-reason frequencies (see `project_rejection_reason_logging`). Unbounded, per-row-unique keys make that aggregation meaningless — the feature is currently collecting data it can't use.
- Key cardinality grows without bound (one new bucket per unique model sentence / per interpolated token), so any dashboard or `GROUP BY` over these columns degrades over time rather than converging.
- It silently understates the real top reasons: 34 genuine `context spoils answer` rejections are easy to miss next to dozens of one-off prose buckets.

**Owner:** unassigned
**Tracking:** none yet — open a GitHub issue when prioritizing
**References:**
- `packages/db/migrations/0012_add_rejection_reason_counts_to_generation_jobs.sql` — the column this debt undermines.
- `packages/db/src/generation/routing.ts:49-129` — canonical tags + free-form concatenation.
- `packages/ai/src/validate.ts:96-145` — `ValidationResult` free-text reason arrays.
- `packages/ai/src/validation-prompts.ts:108-119` — prompt instructing free-text reasons.
- `packages/db/src/generation/run-one-cell.ts:548-556` — the `reason`-as-key fold.
- `packages/db/src/generation/deterministic-checks.ts:39-77` — value-interpolated reason strings.

**Resolution (2026-06-03):**
Shipped in **PR #242**. A canonical `GenerationReasonCode` enum + `GenerationReason { code, detail? }` now live in `packages/shared/src/generation-reasons.ts` (re-exported from the barrel, with `REASON_LABELS`, `REJECTED_BRANCH_CODES`, `formatReason`, and a throw-free `normalizeFlaggedReasons` for legacy rows). The emitters (`routing.ts`, `deterministic-checks.ts`, `validate-and-insert.ts`) emit `{ code, detail? }`; `run-one-cell.ts` keys `rejection_reason_counts` on `code` only; `exercises.flagged_reasons` is persisted as `GenerationReason[]` (`$type`-annotated — no migration, the column was already `jsonb`); the CLIs render via `formatReason` / `REASON_LABELS` and read legacy `string[]` rows back through `normalizeFlaggedReasons`. Bounded cardinality is locked by tests (`run-one-cell.test.ts` asserts every map key ∈ `REJECTED_BRANCH_CODES`, contains no `:`, and is not sentence-length).

**Verified in prod (2026-06-03 scheduled TR A2 run):** the aggregated `rejection_reason_counts` was exactly `{ low-quality-reject, context-spoils-answer }` — distinct keys = 2, keys containing a space or `:` = **0** (vs. the unbounded free-form keys this entry documented). `flagged_reasons` on the day's rows were likewise all coded (`validator-note`, `ambiguous`, `low-quality-flag`, `level-mismatch`). `SELECT key, sum(value) FROM generation_jobs, LATERAL jsonb_each_text(rejection_reason_counts) GROUP BY key` now returns a bounded, stable set — the acceptance criteria above are met.

---

## No generation-quality eval harness (`pnpm eval` only covers the evaluation prompt)

- **Status:** resolved 2026-06-02 (the `eval-gen` harness landed via the `generation-eval-harness` spec — see Resolution below). All acceptance criteria met.
- **Status (original):** open
- **Discovered:** 2026-05-30 (post-merge of PR #227, generation-quality-improvements — the spec named `pnpm eval` as the pre-merge gate for its generation-prompt guardrails; on inspection the tool can't do that)
- **Scope:** `packages/ai/scripts/eval-run.ts` (+ `eval-export.ts`); the `pnpm eval` / `pnpm eval:export` root scripts
- **Severity:** medium — no correctness risk, but generation-prompt PRs ship without a quantitative pre-merge quality signal, and a spec/runbook actively points operators at a gate that returns zero signal (and spends real Anthropic budget doing so)

**Root cause:**
`eval-run.ts` resolves `--candidate` to a prompt body and feeds it to `evaluateAnswer` as a `systemPromptOverride`, then scores the result against captured *evaluation* baselines (dataset items are `EvaluateAnswerInput` — exercise + user answer, exported from `user_exercise_history`). It never imports or invokes the generation prompt builders (`buildGenerationSystemPrompt` / `buildGenerationUserPrompt`) or the validator. So it measures the **answer-evaluation** prompt only. Pointing it at a generation-prompt change exercises a prompt that change doesn't touch — the diff is noise, and every item still bills the Anthropic key.

The `generation-quality-improvements` design/requirements (Testing Strategy → "`pnpm eval` (manual, pre-merge): run the new generation prompt against a Langfuse dataset … This is the gate for the model-judgment guardrails") assumed a capability that does not exist. Treat any doc that calls `pnpm eval` a generation gate as a documentation bug until the harness below lands.

**Interim validation path (what PR #227 actually used):**
1. Unit tests pin the prompt text and the byte-parity / Anthropic cache-prefix contract.
2. After merge + `pnpm push-prompts` (the runtime serves the live Langfuse body; the in-repo constant is only the fallback), the `GENERATION_PROMPT_VERSION` bump clears prompt-version suppression so cells regenerate against the new body on the next scheduled run.
3. **Validate observationally on the post-merge run** by comparing `generation_jobs.rejection_reason_counts` and the flagged-tag distribution against the prior baseline (for #227: the 2026-05-30 TR run, 35.6% approved). This is the design's stated success metric — it is *post-merge and observational*, not a pre-merge gate.

**Remediation — a real generation eval (`eval-gen`):**
1. **Dataset of cells, not answers.** A `(language, cefrLevel, exerciseType, grammarPointKey)` list — exported from `generation_jobs` (over-sampling failure-prone cells) or hand-curated. Distinct from the `eval:export` answer-submission datasets.
2. **OLD-vs-NEW runner.** For each cell, build the system+user prompt via `buildGenerationSystemPrompt` / `buildGenerationUserPrompt` for both prompt versions, generate N drafts each, then score every draft with the existing **validator** (`validate-system-prompt` via `validateDraft`).
3. **Diff that matters for generation.** Approval rate, `rejection_reason` distribution, and flag-tag distribution — candidate vs baseline — rather than the per-dimension score deltas `eval-run.ts` computes for evaluation.
4. **Reuse the guard rails** from `eval-run.ts`: `LANGFUSE_ENV=prod` requires `--allow-prod`, and add a `--max-cost-usd` cap (it spends Anthropic budget per draft, ~N× more than answer-eval).

**Acceptance criteria for the fix:**
- A `pnpm eval:gen` (or equivalent) script that, given a cell dataset and two prompt sources, reports approval-rate and rejection-reason/flag-tag deltas between them, writing a JSON summary like `eval-run.ts` does.
- The `generation-quality-improvements` design/requirements (and any future spec) reference *this* script — not `pnpm eval` — as the generation gate.
- A unit test exercising the runner with stubbed generate+validate calls (mirroring `eval-run.test.ts`'s injectable-executor pattern).

**Why we can't ignore it:**
- Generation-prompt changes are exactly where regressions are expensive (a bad prompt re-sweeps the pool at real cost — the #227 baseline run was ~$30.80) and where unit tests are weakest (they pin wording, not model behavior).
- The current docs send the next operator to spend budget on a no-signal run; that's a foot-gun, not just a missing feature.

**Owner:** unassigned
**Tracking:** none yet — open a GitHub issue when prioritizing
**References:**
- PR #227 — generation-quality-improvements (surfaced the gap during post-merge).
- `.claude/specs/generation-quality-improvements/design.md` Testing Strategy + `requirements.md` NFR Performance/Cost — the mistaken "`pnpm eval` is the generation gate" assumption.
- `packages/ai/scripts/eval-run.ts` — the evaluation-only harness to mirror.
- `packages/ai/src/generation-prompts.ts` (`buildGenerationSystemPrompt`) + `packages/ai/src/validate.ts` (`validateDraft`) — the builders/validator a generation eval would drive.

**Resolution (2026-06-02, `generation-eval-harness` spec):**
Built `pnpm eval:gen` (`packages/ai/scripts/eval-gen-run.ts`) — the generation-side analogue of `eval-run.ts`. Given a cell dataset (`--dataset-file`) and two prompt sources (`--baseline` / `--candidate`, each `repo` | `file:<path>` | `langfuse:<name>@<label>`), it renders each prompt per cell, generates `--drafts-per-cell` drafts under each via `generateBatch`, validates every draft with `validateDraft`, routes each verdict through `routeValidationResult`, and writes approval-rate / rejection-reason / flag-tag deltas (markdown to stdout + full JSON to `./eval-runs/<runName>.json`). All acceptance criteria met:
- **Generation gate exists** — `pnpm eval:gen` reports approval-rate and rejection-reason/flag-tag deltas between two prompt sources, with a JSON summary mirroring `eval-run.ts`.
- **Specs reference the real gate** — `generation-quality-improvements` `{design,requirements,tasks}.md` now point at `pnpm eval:gen` (not `pnpm eval`); the CLAUDE.md command table documents both `eval:gen` and `eval:gen:export`.
- **Stubbed-executor unit tests** — `packages/ai/scripts/eval-gen-run.test.ts` mirrors `eval-run.test.ts`'s injectable-port pattern (stub `GenCellArmExecutor` for orchestration; `vi.mock` of `generateBatch`/`validateDraft` with the real `routeValidationResult` for classification).

Implementation notes / deltas from the remediation sketch above:
- **Additive generator seam** rather than calling `buildGenerationSystemPrompt` twice: a `systemPromptOverride?: string` field on `GenerationSpec` lets the harness drive `generateBatch` with an explicit (rendered) system body, bypassing the Langfuse fetch. The no-override production path is byte-for-byte unchanged.
- **One new public export edge** — `routeValidationResult` (+ `ReviewStatus`, `RoutingDecision`) is now surfaced through the `@language-drill/db` barrel (previously internal to `generation/routing.ts`); no new dependency edge (`@language-drill/db` was already a `packages/ai` dependency).
- **Guard rails reused + extended** — `assertNotProdWithoutAllow` (prod requires `--allow-prod`) and a `--max-cost-usd` cap evaluated at the **cell boundary** (after both arms) so a cost-capped partial summary never holds a half-compared cell.
- **Export companion** — `pnpm eval:gen:export` (`eval-gen-export.ts`) builds a failure-prone cell dataset by sampling the lowest-approval cells from `generation_jobs`; `fixtures/cells-smoke.json` unblocks manual runs and loader tests without it.

**Implemented in:** `packages/ai/scripts/eval-gen-run.ts`, `eval-gen-export.ts`, `eval-gen-run.test.ts`, `eval-gen-export.test.ts`, `fixtures/cells-smoke.json`; `packages/ai/src/generate.ts` (`systemPromptOverride`); `packages/db/src/generation/index.ts` + `packages/db/src/index.ts` (barrel re-export). Committed on the `generation-eval-harness` spec branch.

---

## Langfuse `validate` traces missing `exerciseId` metadata

- **Status:** resolved 2026-06-02 (runtime fix landed in commit `81fb20d`, "Generation quality fixes (R1–R8)"; test coverage added 2026-06-02 — see Resolution below). All acceptance criteria met except the Phase-2 dashboard nice-to-have.
- **Status (original):** open (Phase 1 design accepted the gap; verified live in prod 2026-05-15)
- **Discovered:** 2026-05-15 (Task 24 post-deploy verification — observed validate trace with `feature/jobId/cellKey/promptVersion/env` but no `exerciseId`)
- **Scope:** `packages/ai/src/observability.ts` (Proxy ALS read), `infra/lambda/src/generation/handler.ts` (single outer `withLlmTrace` scope), `packages/db/src/generation/run-one-cell.ts` (where individual validate calls are dispatched)
- **Severity:** low — none of the five Phase-1 dashboards (Req 9 AC 1–5) need it; per-cell rejection rate aggregates by `cellKey`, which IS present on every validate trace

**Root cause:**
The generation Lambda enters `withLlmTrace` once per SQS record with the *shared* metadata (`jobId`, `cellKey`, `language`, `cefrLevel`, `exerciseType`). Inside that single ALS scope, `runOneCell` dispatches N `generate` Claude calls *and* 1..M `validate` Claude calls. The Proxy reads ALS at call time and swaps `feature` per call via `TOOL_NAME_TO_FEATURE` — that's why validate traces correctly inherit `jobId`/`cellKey` and get `feature='validate'`. But ALS doesn't know which specific draft is being validated, because that information lives inside `run-one-cell.ts` (in `packages/db`), which the Phase-1 spec deliberately kept observability-free for layering reasons (`.claude/specs/langfuse-implementation-phase-1/design.md §2c` — "Why a single outer scope, not nested").

**Requirements gap:** Req 2 AC 4 stated `validate` traces SHALL carry `exerciseId` (the draft id under validation). The design accepted partial coverage because Req 9 AC 4's dashboard math works on `cellKey` aggregation, not per-draft pairing.

**Remediation (two reasonable options):**

1. **Nested `withLlmTrace` inside the validation loop.** Modify `packages/db/src/generation/run-one-cell.ts` to import `withLlmTrace` from `@language-drill/ai` and open a nested scope around each `validateDraft(...)` call carrying `{ ...inheritedCtx, exerciseId: draft.id }`. ALS scopes nest cleanly — the inner store shadows the outer for the duration of the call. **Cost:** breaks the "packages/db observability-free" layering rule. Honest about it because run-one-cell already orchestrates LLM calls — adding trace context is in scope for an orchestrator.
2. **Proxy-side extraction.** Have the Proxy parse the request's tool input on `feature='validate'` to find a draft identifier (e.g. `draft.id` or a stable hash of the draft payload). Keeps `packages/db` clean. **Cost:** fragile — the validation prompt's input shape isn't a stable API; any prompt edit could silently break the extraction without test coverage catching it.

Recommended: **option 1**, despite the layering violation. The "no LLM observability in packages/db" rule made sense when only `packages/ai` issued Claude calls; once `run-one-cell` became the orchestrator, that rule stopped pulling its weight. Move the per-validate-call trace scope into the orchestrator and update the relevant tests.

**Acceptance criteria for the fix:**
- Every Langfuse trace with `feature='validate'` from the generation pipeline carries `metadata.exerciseId === <the draft row id under validation>`.
- `packages/db/src/generation/run-one-cell.test.ts` asserts the nested `withLlmTrace` scope is opened per draft (mock the symbol — same pattern used in `infra/lambda/src/generation/handler.test.ts`).
- A retry of the same draft (validation failed, regenerate-and-revalidate) produces a *new* validate trace with the *same* `exerciseId` — proves the pairing is stable across retries.
- Dashboard: pin a "per-draft validation outcome" view filtered to `feature='validate'`, grouped by `metadata.exerciseId`, showing the eventual approve/reject status. This is a Phase-2 nice-to-have, not a Phase-1 blocker.

**Why we can't ignore it forever:**
- Debugging "this exercise has weird feedback" against a generation job currently requires landing on the draft via `cellKey` then scanning every validate trace in that cell for the matching tool input. With `exerciseId` it's a one-click filter.
- The Phase-1 spec acknowledged this gap explicitly in `requirements.md` Req 2 AC 4 — closing the loop is a contract-completeness fix, not a feature add.

**Owner:** unassigned
**Tracking:** none yet — open a GitHub issue when prioritizing (good first-issue candidate for whoever picks up Phase 2 observability work)
**References:**
- `.claude/specs/langfuse-implementation-phase-1/requirements.md` Req 2 AC 4
- `.claude/specs/langfuse-implementation-phase-1/design.md §2c` (the deliberate-deferral note)
- `packages/ai/src/observability.ts` — `TOOL_NAME_TO_FEATURE` map shows how feature-switching already happens without per-call ALS edits
- `packages/db/src/generation/run-one-cell.ts` — the orchestrator that would host the nested scope

**Resolution (2026-06-02, commit `81fb20d`):**
Implemented as option 1 (nested `withLlmTrace`), but hosted one layer below where the entry proposed — in `validateAndInsertWithRetry` rather than `run-one-cell.ts`. This is strictly better coverage: a single `exerciseId`-tagged scope wraps the entire per-ordinal attempt loop, so the first validation, every dedup-retry validation, and the retry-generation calls all inherit the same `exerciseId`.
- `packages/db/src/generation/validate-and-insert.ts:292` reads the outer cell scope via `getCurrentLlmTraceContext()`; `:524-534` opens `withLlmTrace({ ...parentCtx, exerciseId: opts.draft.id, ... }, body)`. The `parentCtx ? … : body()` guard no-ops on CLI runs with no outer scope.
- `exerciseId` is a first-class field on `LlmTraceContext` (`packages/ai/src/observability.ts:64`) and is emitted by `buildTraceMetadata` (`:473`), so the Anthropic proxy now tags every `validate` generation with `metadata.exerciseId`. The retry-stability AC is satisfied for free: a regenerate-and-revalidate reuses the same scope, so the new validate trace carries the same `exerciseId`.

**Test coverage (2026-06-02):** `packages/db/src/generation/validate-and-insert.test.ts` gained a `per-ordinal exerciseId trace scope` describe block (3 cases). It drives the **real** ALS — `withLlmTrace` / `getCurrentLlmTraceContext` are left unmocked (the test's `vi.mock` spreads `...actual`), so they share the module-singleton `AsyncLocalStorage` with the production code and the test asserts true end-to-end context propagation, not a stubbed call count:
- `exerciseId === draft.id` on the validate call, inheriting the parent cell scope (`feature`/`jobId`/`cellKey`/`promptVersion`) — covers AC #1 and #2.
- The same `exerciseId` is observed across every dedup-retry validation even as `currentDraft` is replaced mid-loop — covers AC #3 (retry stability).
- The CLI no-parent-scope path opens no scope (observed context is `undefined`) rather than fabricating one with missing required fields.

The entry's original AC #2 named `run-one-cell.test.ts`, but since the fix lives in `validate-and-insert.ts` the test belongs alongside it. The Phase-2 dashboard AC (#4 — a per-draft validation-outcome view grouped by `metadata.exerciseId`) remains an explicit nice-to-have, not a blocker.

---

## Annotate-stream Function URL CORS allows all origins

- **Status:** open (worked around in PR #97 — set `allowedOrigins: ["*"]`)
- **See also:** [`aws-lambda-gotchas.md`](./aws-lambda-gotchas.md) §1 — the permanent reference for Function URL CORS schema quirks.
- **Discovered:** 2026-05-12 (production deploy after PR #95 — CloudFormation rejected `https://*.vercel.app` with `isn't a valid origin`)
- **Scope:** `infra/lib/constructs/annotate-stream-lambda.ts` Function URL CORS
- **Severity:** low (JWT verification + daily rate-limit are the real security boundary; browser CORS is a politeness filter, not authorization)

**Root cause:**
AWS Lambda Function URL CORS uses a different (more restrictive) schema than API Gateway HTTP API CORS. Function URL `AllowOrigins` accepts only:
- Full URLs (`https://www.example.com`)
- `https://*` (any HTTPS origin)
- `*` (any origin)

It does **not** accept subdomain wildcards like `https://*.vercel.app` — which is exactly what we want for Vercel preview deploys. API Gateway accepts them; Function URL doesn't. The original construct copied the API-Gateway-style list verbatim.

**Verified:** CloudFormation returned `https://*.vercel.app isn't a valid origin. An origin must be in a valid URL format. For example: https://www.example.com, https://*, or the wildcard character (*).` on `AWS::Lambda::Url` resource creation. Local `cdk synth` doesn't catch this — schema validation only fires server-side during resource creation, after `synth` and asset publish have succeeded.

**Current workaround:** `allowedOrigins: ["*"]`. Means any origin can make POST requests to the Function URL. The JWT auth still gates access — only authenticated users' tokens work — but the surface area is technically wider than the API Gateway endpoints (which retain the regex-matched allow-list via Hono middleware).

**Remediation:**
Move CORS enforcement into the streaming handler, matching the pattern already in `infra/lambda/src/index.ts:25` (`matchOrigin`):

1. **Promote `matchOrigin` to `packages/shared/src/cors.ts`** so both Lambdas import it from one place (alongside `FALLBACK_ORIGINS`).
2. **Update the streaming handler's SSE writer (`infra/lambda/src/annotate-stream/sse.ts`)** to:
   - Accept the request's `Origin` header.
   - Pass it through `matchOrigin`.
   - Emit `Access-Control-Allow-Origin: <matched-origin-or-omitted>` and `Access-Control-Allow-Credentials: true` (if needed) on every response branch: `openSse()`, `errorJson()`, and `cors200()`.
3. **Remove the `cors` config from the Function URL** in the construct. With in-handler CORS the platform CORS layer is redundant.
4. **Tests**: extend `sse.test.ts` and `handler.test.ts` with origin-echo cases (Vercel preview, prod hostname, unauthorized origin).

Important: the main API Lambda's CORS lives in Hono middleware. The streaming Lambda doesn't use Hono. So the new code is a thin handler-level adapter, not a Hono middleware reuse.

**Acceptance criteria for the fix:**
- Revert `allowedOrigins: ["*"]` in `infra/lib/constructs/annotate-stream-lambda.ts` to either `undefined` (no CDK CORS config) or just the bare `["*"]` retained as a belt-and-braces fallback.
- `infra/lib/constructs/annotate-stream-lambda.test.ts` asserts the in-handler origin echo via the SSE writer's response shape.
- End-to-end: a Vercel preview origin (`https://my-feature-abc123.vercel.app`) receives `Access-Control-Allow-Origin: https://my-feature-abc123.vercel.app` on the SSE response. An unauthorized origin receives no allow-origin header → browser blocks.

**Why we can't ignore it:**
- The streaming endpoint POSTs from authenticated browser sessions, so JWT theft via XSS on any page that holds the token is the actual threat — and browser CORS doesn't defend against that anyway. So the security delta is small.
- But: the design doc explicitly said "CORS allow-list is identical to the main Lambda's ... and is implemented in the new handler" (more-responsive-reading/design.md §Integration Points). The current state diverges from the design.
- Consistency with the main Lambda's pattern is worth ~50 lines of handler/sse-writer plumbing.

**Owner:** unassigned
**Tracking:** none yet — open a GitHub issue when prioritizing
**References:**
- PR #97 — workaround.
- `infra/lambda/src/index.ts:25` — `matchOrigin` to extract.
- `packages/shared/src/cors.ts` — where to put it.
- AWS docs on Function URL CORS (vs API Gateway): https://docs.aws.amazon.com/lambda/latest/dg/urls-configuration.html#urls-cors

---

## `@language-drill/shared` emits ESM with extensionless relative imports

- **Status:** open (worked around in PR #94)
- **Discovered:** 2026-05-12 (production deploy failed after PR #91 merged the streaming-annotate feature)
- **Scope:** `packages/shared/` — its tsconfig + every relative `export * from "./x"` / `import { y } from "./z"` inside `src/`
- **Severity:** medium (currently survives via bundler lenience + a CDK-side workaround; will resurface whenever a Node-strict consumer is added)
- **See also:** [`aws-lambda-gotchas.md`](./aws-lambda-gotchas.md) §3 — the permanent reference for ts-node + CDK module resolution.

**Root cause:**
`packages/shared` compiles with `module` defaulting to ES2022 (target ES2022 → ESM output) but `package.json` has no `"type": "module"` and `main`/`types` point at plain `dist/index.js`/`dist/index.d.ts`. The compiled `dist/index.js` therefore contains ESM syntax with relative re-exports that omit the `.js` extension:

```js
export * from "./onboarding";
export * from "./read";
export * from "./tokenize";
export * from "./cors";
```

That layout is fine for the consumers we currently have — Next.js, esbuild (Lambda bundling), and tsx all resolve extensionless imports as a matter of convenience — but it violates the ESM spec, which requires explicit extensions on relative specifiers. Node's strict ESM resolver (the one ts-node hits via `require(esm)` when it loads the package from a CJS-compiled file) rejects them with `ERR_MODULE_NOT_FOUND: Cannot find module '...packages/shared/dist/onboarding'`.

**Verified:** reproduced on `main` locally with `pnpm --filter @language-drill/shared build && cd infra && pnpm cdk synth LanguageDrillStack`. The CI failure on commit `3b4d452` is the same trace. The first time this surfaced was during the streaming-annotate rollout — task 26b added `import { FALLBACK_ORIGINS } from "@language-drill/shared"` in `infra/lib/constructs/annotate-stream-lambda.ts`, which is the only Node-strict-ESM consumer in the tree. Every other consumer either bundles the source or uses tsx.

**Symptoms this causes:**
- Production deploy blocked between PRs #93 and #94 (ts-node, invoked by `cdk synth`, couldn't load `dist/index.js`).
- Latent — any future infra construct that imports a value from `@language-drill/shared` will re-trip the same failure unless it follows the relative-source-path workaround.
- Subtle blast radius: works in `pnpm dev`, in `pnpm test`, in Next.js build, in the Lambda esbuild bundle. Fails only at `cdk synth`/`cdk deploy`. So a regression won't show up in pre-push CI — only in the deploy job.

**Remediation options (pick one):**

1. **Add `.js` extensions to every relative import in `packages/shared/src/`** and enable `"verbatimModuleSyntax": true` (or rely on TypeScript 5.7+'s `rewriteRelativeImportExtensions`) so tsc preserves them in output.
   - Pros: smallest behavioral change for downstream; package becomes ESM-spec-correct; works for every consumer without workarounds.
   - Cons: touches every relative import in shared (counting `index.ts` re-exports plus internal cross-references — probably 10–20 lines). Has to be done atomically with a tsconfig change so `tsc` doesn't error on `.js` specifiers pointing at `.ts` sources.

2. **Switch `packages/shared` to CJS output** (add `"module": "commonjs"` to its tsconfig, optionally `"type": "commonjs"` to `package.json`).
   - Pros: extensionless requires work natively; no source-level churn.
   - Cons: Next.js's tree-shaking is materially better with ESM input; api-client and the web app would lose that. Probably regresses bundle size.

3. **Add an `exports` map to `packages/shared/package.json`** with both ESM (`.mjs` or `dist/index.js`-with-`type:module`) and CJS conditional exports. Build script emits both.
   - Pros: belt-and-braces; future consumers in either ecosystem just work.
   - Cons: heaviest change; requires dual emit and adjusting the build script.

Approach #1 is the recommended path: smallest patch, keeps everything ESM, and converts shared into a properly-spec'd ESM package without affecting bundle behavior.

**Acceptance criteria for the fix:**
- Revert the relative-source-path workaround in `infra/lib/constructs/annotate-stream-lambda.ts` (re-import via `@language-drill/shared`).
- Revert the `rootDir` removal in `infra/tsconfig.json`.
- `pnpm --filter @language-drill/shared build && cd infra && pnpm cdk synth LanguageDrillStack` succeeds (or fails only on missing runtime env vars).
- Full pre-push suite (`pnpm lint && pnpm typecheck && pnpm test`) green.
- Vercel preview build green (proves no Next.js regression).

**Why we can't ignore it:**
- The current state requires every infra consumer of shared to use the relative-source-path pattern — easy to forget, and grep-unfriendly compared to the package-name import.
- ts-node is the canonical "strict Node ESM" entry point used by CDK; we will keep adding constructs over time.
- The shared package is supposed to be the single source of truth for cross-workspace constants; making it inconvenient to consume from infra defeats that.

**Owner:** unassigned
**Tracking:** none yet — open a GitHub issue when prioritizing
**References:**
- PR #94 — the targeted CDK workaround that unblocked production deploy.
- `infra/lib/constructs/annotate-stream-lambda.ts:13–20` — the comment explaining why the relative-source path is used.
- `packages/shared/tsconfig.json` + `packages/shared/package.json` — the package-level settings to change.
- Node ESM resolver spec: https://nodejs.org/api/esm.html#mandatory-file-extensions
- TypeScript `rewriteRelativeImportExtensions`: https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-7.html

---

## Per-draft validation loop in `runOneCell` is strictly serial

- **Status:** resolved 2026-06-02 (parallelized across commits `d7429c9` / `a630ab8` / `d8a3faa`; verified still in place. See Resolution below).
- **Status (original):** open
- **Discovered:** 2026-05-12 (during the PR #71 DLQ-redrive observation)
- **Scope:** generation Lambda — `packages/db/src/generation/run-one-cell.ts:397-444`
- **Severity:** medium (correctness is fine; pipeline wall-clock + headroom are the cost)

**Root cause:**
`runOneCell` does one batched Claude call to generate ~50 drafts, then iterates the resulting array **sequentially** and calls `validateAndInsertWithRetry` per draft. That helper makes one full `validateDraft` Claude round-trip (`packages/ai/src/validate.ts:256`, `max_tokens: 1024`) for every draft before moving on. The dedup-conflict path can trigger up to `MAX_DEDUP_RETRIES = 3` extra validate+regenerate cycles on top.

Measured on the post-PR-#71 redrive (2026-05-12):
- Successful cells: `durationMs` 325–402 s for `inserted` 44–50.
- Per-draft cost: ~5–8 s average (one Claude validation round-trip).
- Generation call + DB inserts are small fractions of the total — the wall-clock is dominated by the serialized validate fan-out.

**Verified:** measurement source is the structured `cell succeeded` log lines in `/aws/lambda/LanguageDrillStack-GenerationLambdaWrapHandler1113-...` for jobIds completed during the redrive window starting 11:14 UTC.

**Symptoms this causes:**
- Pre-#71, cells with a couple of dedup retries tipped past the 600 s Lambda timeout, got silently killed, and DLQ'd after `maxReceiveCount: 3` redeliveries (34 of 43 today).
- Post-#71, headroom is 900 s — comfortable for now, but the failure mode is the same shape (linear in `count`). If we ever bump `MIN_PER_CELL` or generate longer cells, the same timeout cliff reappears.
- A daily batch of ~50 cells × ~6 min wall-clock at concurrency 3 takes ~100 min of Lambda time; parallelizing validation would shrink each cell to ~60–90 s and the batch to ~15–25 min.

**Remediation:**
Parallelize the validate fan-out with a small concurrency cap (start at 5–8 and tune against the Anthropic org-tier rate limits — Phase 4 reserved Lambda concurrency at 3 specifically to leave validator headroom). Sketch:

1. Split the per-draft loop into two phases:
   - **Phase A — validate in parallel.** `Promise.all(batch.drafts.map(p-limit(8)(validateDraft)))` to collect verdicts. Independent calls, no shared state.
   - **Phase B — insert+dedup sequentially** (or with a smaller cap). Keeps the dedup-retry coupling with the SQL unique-index intact, since that path needs to observe one conflict before regenerating the next draft.
2. Preserve cancellation: thread the existing `AbortSignal` through the `p-limit` wrapper so SIGINT (CLI) still aborts cleanly.
3. Preserve cost accounting: aggregate `combinedUsage` after Phase A resolves rather than incrementally; semantics unchanged.
4. Tests:
   - `run-one-cell.test.ts` already covers the serial path; add a case that asserts validate calls overlap in time (mock `validateDraft` to record start/end timestamps and assert at least two overlap).
   - Existing dedup-retry tests should still pass — Phase B keeps the sequential insert path.

**Why we can't ignore it:**
- Single biggest contributor to today's DLQ accumulation (PR #71 raised the ceiling but didn't fix the slope).
- Linear-in-`count` wall-clock means future curriculum growth (more grammar points × more vocab umbrellas) pushes us back toward the 900 s ceiling.
- The soft-deadline-with-audit-row patch (option b in the post-#71 plan) is far less valuable if the wall-clock fits comfortably under timeout; this should land first.

**Resolution (2026-06-02):**
The serial `for`-over-`batch.drafts` loop is gone, replaced by a three-stage bounded-worker pipeline in `packages/db/src/generation/`, implementing the proposed Phase-A/Phase-B split (and then some):
- **`generator-pool.ts` (`runGeneratorPool`)** — parallel draft generation (the `generateBatch` fan-out).
- **`validator-pool.ts` (`runValidatorPool`)** — Phase A: first-validation of every draft in parallel, returning a `Map<ordinal, ValidatorPoolEntry>`.
- **`outcome-pool.ts` (`runOutcomePool`)** — Phase B: parallel `validateAndInsertWithRetry`, consuming each draft's pre-computed first-validation via the `precomputedFirstValidation` opt (so attempt 0 reuses the Phase-A verdict instead of re-calling Claude). The per-ordinal attempt loop *inside* `validateAndInsertWithRetry` stays sequential by design — the dedup-detection contract needs to observe one INSERT collision before regenerating — which is the entry's "Phase B keeps the sequential insert path."

Each pool is a hand-rolled shared-counter worker pool (`await Promise.all` over N workers pulling `nextOrdinal++`), **not** `p-limit` — equivalent bounded concurrency, but it also cleanly expresses the R4.2 dedup early-bail circuit breaker and R8 per-ordinal validator-parse isolation that were layered on later. Wired in `run-one-cell.ts` (Phase A then Phase B), all three caps default to **5** (`MAX_GENERATOR_CONCURRENCY` / `MAX_VALIDATOR_CONCURRENCY` / `MAX_OUTCOME_CONCURRENCY`), documented as emergency rollback knobs — set any to `1` to recover the old serial behavior for that stage.

Acceptance criteria met:
- **AbortSignal preserved** — threaded from `RunOneCellInput` through both pools into each worker (`if (signal?.aborted) throw …`) and onward to `validateDraft`. The R4.2 early-bail deliberately uses a separate boolean (graceful `return`, cell closes `succeeded`) kept distinct from the fail-closed `signal`.
- **Usage accounting preserved** — `combinedUsage` is aggregated *after* the pool resolves, walking ordinals `0..N` in order (`addUsage(combinedUsage, outcome.extraUsage)`), so totals are deterministic across serial and parallel runs. Covered by `run-one-cell-r5-accounting.test.ts`.
- **Concurrency overlap is tested directly** — `validator-pool.test.ts` and `outcome-pool.test.ts` each have a `'runs in parallel with concurrency=5 (observed overlap)'` case that tracks live in-flight count and asserts `2 ≤ maxInFlight ≤ 5`, plus inverse `concurrency=1` (`maxInFlight === 1`), cap-clamping, out-of-order-completion ordinal-keying, and abort cases. This satisfies the original AC ("assert validate calls overlap in time"). Pool suites: 26 tests, all passing.

**Stale-comment cleanup outstanding:** the comment at `run-one-cell.ts:74-75` still reads "generation loop is still serial; spec covers validator only," which is now inaccurate (the generator pool exists too). Minor doc-in-code fix, not a behavioral gap.

**Owner:** unassigned
**Tracking:** none yet — open a GitHub issue when prioritizing
**References:**
- PR #71 (`d3f3c48`) — Lambda timeout 600 → 900 s; surfaced this slope as the underlying issue.
- `packages/db/src/generation/run-one-cell.ts:397-444` — the loop (original, pre-fix line range).
- `packages/db/src/generation/{generator,validator,outcome}-pool.ts` — the parallel pipeline that replaced it.
- `packages/ai/src/validate.ts:256` — the Claude call paid 50× per cell.
- Anthropic Sonnet 4.6 org rate limits — gating factor on the concurrency cap; pull current value before tuning.
- Commits `d7429c9` (generator pool), `a630ab8` (validator pool + `precomputedFirstValidation`), `d8a3faa` (outcome pool).

---

## ESLint v9 incompatibility breaks `pnpm lint`

- **Status:** resolved 2026-05-03 (during exercise-ui task 33)
- **Discovered:** 2026-05-01 (during exercise-ui task 1)
- **Scope:** repo-wide — `pnpm lint` from the root fails on `main`
- **Severity:** high (the pre-push gate documented in `CLAUDE.md` cannot run cleanly until this is fixed)

**Root cause:**
Next.js 16 deprecated the `next lint` command. The wrapper still passes ESLint v8 options that ESLint v9 has removed:
- `useEslintrc`
- `extensions`
- `resolvePluginsRelativeTo`
- `rulePaths`
- `ignorePath`
- `reportUnusedDisableDirectives`

This causes `pnpm --filter @language-drill/web lint` to fail with an `Invalid Options` error before any rules actually run.

**Verified:** the failure exists on a clean `main` (reproduced by stashing the in-flight exercise-ui changes and re-running `pnpm lint`). It is not introduced by any current spec work.

**Remediation:**
Run the official Next.js codemod to migrate from `next lint` to direct ESLint CLI invocation:

```bash
npx @next/codemod@canary next-lint-to-eslint-cli .
```

This will replace the `next lint` script in `apps/web/package.json` with an `eslint` invocation, generate a flat-config file (`eslint.config.mjs`) compatible with ESLint v9, and migrate any custom rules/plugins.

After running the codemod, verify:
- `pnpm --filter @language-drill/web lint` exits 0
- The flat config preserves the existing rule set (no rules silently dropped)
- `pnpm lint` from the repo root chains correctly through Turborepo

**Why we can't ignore it:**
- `CLAUDE.md` mandates `pnpm lint && pnpm typecheck && pnpm test` pass before every push
- Phase F (`exercise-ui`) and later phases add many new TSX files; without working lint, style/quality regressions will leak into PRs
- CI presumably has the same gate (verify in `.github/workflows/`)

**Owner:** unassigned
**Tracking:** none yet — open a GitHub issue when prioritizing
**References:**
- Next.js migration docs: https://nextjs.org/docs/app/api-reference/cli/next#next-lint
- ESLint v9 flat config: https://eslint.org/docs/latest/use/configure/configuration-files

**Resolution (2026-05-03):**
The codemod was run but only added `eslint-config-next` to root `package.json` — it didn't update `apps/web/package.json` because it found the existing repo-root flat config (`eslint.config.js`, installed by the dependency-audit rollout) and bailed out of generating a new one. Manual fix:
- Changed `apps/web/package.json` `lint` script from `next lint` to `eslint .` so it uses the root flat config directly.
- Added `**/next-env.d.ts` to the root `eslint.config.js` ignores (auto-generated Next.js types use a triple-slash reference that the strict TS rules flag).
- Cleaned up two trivial unused-var lints surfaced by the now-working pipeline (`EvaluationResult` import in `cloze-exercise.test.tsx`; destructured but unused `_exerciseType`/`_vocabActiveCount` props in `coach-rail.tsx` — kept on the `CoachRailProps` interface for the future tracker slot per design.md).

`eslint-config-next` was installed but not yet wired into the flat config. The current `@typescript-eslint/recommended` set is sufficient; if Next.js-specific rules (e.g. `@next/next/no-img-element`) are wanted, that's a follow-up.

`pnpm lint && pnpm typecheck && pnpm test` from repo root all pass. Pre-push gate restored.

---
