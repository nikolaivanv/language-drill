# Requirements Document

## Introduction

Phase 2 of the Langfuse integration delivers two capabilities on top of the
Phase-1 read-only tracing layer:

1. **Langfuse prompt registry.** The six system prompts in `packages/ai/src/`
   are mirrored into Langfuse's prompt management. Lambdas fetch the live
   text at runtime with a local cache + in-repo fallback, so a non-engineer
   (or the author on mobile) can roll a new prompt version forward or back
   without a code deploy.
2. **Dataset-driven offline evaluation.** A `pnpm eval` CLI takes a candidate
   prompt source (Langfuse `name@label` or local file) and a Langfuse
   dataset, re-runs evaluations item-by-item, attaches results to the
   dataset run, and prints a quality / cost / latency diff against the
   current production prompt. A companion `pnpm eval:export` CLI samples
   Phase-1 evaluation traces from a date range into a Langfuse dataset.

Phase 1 (read-only tracing, six surfaces, ALS-scoped metadata, Lambda flush
hooks, `*_SYSTEM_PROMPT_VERSION` constants) is implemented and on `main` —
see `.claude/specs/langfuse-implementation-phase-1/`. This spec is strictly
additive on top of it.

This spec implements §7 "Phase 2 — Prompt registry + datasets" of
`docs/llm-observability.md` (FR-7, FR-8). Phase 3 ("Online evals" — LLM-as-
judge against live samples) is explicitly deferred.

## Alignment with Product Vision

Per `.claude/steering/product.md`, the project's defensible edge is "active
production over passive recognition" — and the only AI surface that the
end-user sees directly is **evaluation feedback**. A regression in the
evaluator (the feedback explanation, the score, the CEFR estimate) is a
regression in the product's core value prop.

Phase 2 makes prompt iteration on that surface **safe**:

1. **Edit prompts without a deploy.** Today, even a one-word prompt tweak
   needs a PR + CDK deploy. Phase 2 makes prompt edits an operator action
   in Langfuse, with the next Lambda cold start picking up the change
   (subject to the in-Lambda prompt cache TTL). This matches the steering
   doc's "portfolio-quality observability" line: the product owner can act
   on the data they're already seeing.
2. **Offline eval before promoting a prompt.** Today, a prompt edit ships
   to all users at once. Phase 2 makes it possible to run the candidate
   against a curated dataset of past submissions, compute a structural
   diff vs. the current production prompt, and only promote if quality is
   neutral-or-better and cost is bounded. This directly serves the
   "honest skill-based progress" pitch — a regression in `grammarAccuracy`
   scoring shows up before it reaches a user's progress dashboard.
3. **Reuses the Phase-1 trace sink.** No new infra; dataset items derive
   from the Langfuse traces already flowing from Phase 1. Cost is bounded
   to the Langfuse cloud free tier (50k traces/month — `tech.md` §7).

### Scope

In scope:

- **All six prompts** registered in Langfuse: `evaluate-system-prompt`,
  `annotate-system-prompt`, `generate-system-prompt`,
  `validate-system-prompt`, `theory-generate-system-prompt`,
  `theory-validate-system-prompt`. Static prompts (evaluate, annotate) ship
  as Langfuse `text` prompts; builder-composed prompts (generate, validate,
  theory-\*) ship as Langfuse text prompts with `{{variable}}` placeholders
  and a thin in-code adapter that pre-computes the variables and calls
  `prompt.compile(vars)`.
- **`pnpm eval` runner**, scoped to the **`evaluate` surface only** for
  Phase 2. The other five surfaces register-and-fetch but do not have an
  offline-eval workflow in this phase. Rationale: `evaluate` is the only
  surface where the dataset item shape ((exercise, userAnswer) →
  EvaluationResult) is unambiguous and where structural diffs (score delta,
  error-count delta) work without human grading.
- **`pnpm eval:export` exporter** that samples Phase-1 evaluation traces
  (the ones with `feature='evaluate'`) from a date range into a Langfuse
  dataset, capturing the trace's tool-use output as `expectedOutput` (the
  "current production" reference for diffs).
- **Anthropic prompt-caching invariant preserved.** Builder-composed prompts
  must continue to produce byte-identical strings across consecutive calls
  with the same inputs — fetching from Langfuse cannot break the cache hit
  rate (`generation-prompts.ts:7-8` invariant).

Out of scope (explicit):

- Online evals / LLM-as-judge against live samples (Phase 3).
- A web UI for managing prompts — Phase 2 uses the existing Langfuse UI.
- Human-grading workflow for dataset items — diffs are structural only.
- Migrating the `generate` / `validate` / `theory-*` offline-eval workflows
  (deferred to Phase 2b / Phase 3, scope TBD).
- Sampling from `user_exercise_history` directly — the dataset exporter
  reads Langfuse traces, not the DB. (Phase-1 trace coverage is the source
  of truth for what was "actually evaluated" with metadata.)
- Replacing the Phase-1 `*_SYSTEM_PROMPT_VERSION` constants — they remain
  authoritative in-repo. The Langfuse `version` becomes an additional
  cohort dimension on top of the existing `promptVersion` tag.

## Requirements

### Requirement 1 — All six system prompts registered in Langfuse

**User Story:** As the operator, I want every system prompt the app sends
to Claude to exist as a versioned object in Langfuse, so that I can read
the current production text, compare against past versions, and roll
forward / backward by changing a label — without touching the codebase.

#### Acceptance Criteria

1. WHEN this spec is closed THEN the Langfuse `language-drill-prod` and
   `language-drill-dev` projects SHALL each contain six text prompts named:
   `evaluate-system-prompt`, `annotate-system-prompt`,
   `generate-system-prompt`, `validate-system-prompt`,
   `theory-generate-system-prompt`, `theory-validate-system-prompt`.
2. WHEN a Langfuse prompt is created THEN its body SHALL be byte-identical
   to the matching in-repo `*_SYSTEM_PROMPT` (or, for builder-composed
   prompts, byte-identical to the template string with `{{var}}`
   placeholders unfilled) at the time of registration.
3. WHEN a Langfuse prompt is created THEN it SHALL carry the label
   `production` for the version that matches the in-repo source, AND a
   `prompt-version` metadata field equal to the in-repo
   `*_SYSTEM_PROMPT_VERSION` constant (e.g. `evaluate@2026-05-12`).
4. WHEN a prompt's body is edited in Langfuse and given the `production`
   label THEN the next Lambda cold start in that environment SHALL fetch
   and use the new body for any subsequent Claude call on that surface,
   without redeploying any code.
5. WHEN the Langfuse prompts are registered THEN a one-time bootstrap
   script SHALL be checked in (`packages/db/scripts/bootstrap-prompts.ts`
   or equivalent) that creates them in a given Langfuse project from the
   in-repo strings, so a new environment can be initialised with one
   command. The script SHALL be idempotent — running it twice MUST NOT
   create duplicate prompts.

### Requirement 2 — Runtime fetch with cache + fallback

**User Story:** As an engineer, I want the prompt fetch to be invisible
in the normal request path — fast on a cache hit, harmless on a cache
miss, and fully fault-tolerant when Langfuse is unreachable — so that
adopting the registry can never make user-facing requests slower or less
reliable than they are today.

#### Acceptance Criteria

1. WHEN a Claude call needs a system prompt THEN it SHALL be obtained via
   a `getPromptOrFallback(name: string, fallback: string): Promise<{ text:
   string; version: string | 'fallback' }>` (or builder-composed analogue)
   from `packages/ai/src/prompts-registry.ts`.
2. WHEN `LANGFUSE_PUBLIC_KEY` is unset, OR the Langfuse singleton is null
   (Phase 1 `getLangfuse()`), THEN `getPromptOrFallback` SHALL synchronously
   return `{ text: fallback, version: 'fallback' }` and NOT call the
   Langfuse SDK.
3. WHEN a Langfuse prompt fetch succeeds THEN the resolved
   `{ text, version }` SHALL be cached in-memory at module scope keyed by
   `(name, label)` with a TTL of **60 seconds** (configurable via
   `LANGFUSE_PROMPT_CACHE_TTL_MS`); subsequent calls within the TTL SHALL
   not hit the network.
4. WHEN a Langfuse prompt fetch fails (network error, 4xx, 5xx, timeout)
   THEN `getPromptOrFallback` SHALL return `{ text: fallback, version:
   'fallback' }` and `console.warn` once per cold start (Req 7 AC 2 from
   Phase 1); the user-facing request SHALL succeed on its own merits.
5. WHEN a Langfuse prompt fetch takes longer than **250 ms** THEN it SHALL
   be aborted and fall back as in AC 4 (configurable via
   `LANGFUSE_PROMPT_FETCH_TIMEOUT_MS`). Successful fetches under the
   timeout are still cached per AC 3.
6. WHEN a Claude call's trace is emitted (via the Phase-1 Proxy) THEN the
   `promptVersion` trace tag and metadata SHALL be:
   - `langfuse:<langfuse-version>` when the fetch succeeded
     (e.g. `langfuse:7`),
   - `fallback:<in-repo-version>` when the fetch failed or Langfuse is
     disabled (e.g. `fallback:evaluate@2026-05-12`).
   - The local `*_SYSTEM_PROMPT_VERSION` constant remains the
     `fallback:` value AND is recorded as a separate `localPromptVersion`
     metadata field on every trace, so dashboards can group by either
     dimension.
7. WHEN the Langfuse prompt registry is updated and the cache is still
   warm THEN the in-flight request SHALL still use the cached body (no
   forced invalidation); the new body takes effect after the next
   cache-miss fetch.

### Requirement 3 — Builder-composed prompts use Langfuse template substitution

**User Story:** As the engineer who maintains `generation-prompts.ts`,
`validation-prompts.ts`, and the theory prompt builders, I want the
builders to keep computing their variable inputs locally (CEFR descriptors,
recent stems, prior pool surfaces, draft fields) but defer the final
template assembly to Langfuse's `prompt.compile(vars)`, so that operator
edits to the *template structure* land at runtime without code changes,
while the *data shape* the template needs stays under code review.

#### Acceptance Criteria

1. WHEN a builder-composed prompt is registered in Langfuse (Req 1) THEN
   its body SHALL contain the same `{{variableName}}` placeholders the
   in-repo template uses today (e.g. `{{language}}`, `{{cefrLevel}}`,
   `{{grammarPoint.name}}`, `{{cefrDescriptors}}`, `{{recentStemsBlock}}`,
   `{{priorPoolBlock}}`).
2. WHEN `buildGenerationSystemPrompt(inputs)` runs THEN it SHALL: (a) call
   `getPromptOrFallback('generate-system-prompt', GENERATION_SYSTEM_PROMPT_
   TEMPLATE)`, (b) compute the same variables it computes today (CEFR
   bullets, capped recent stems, capped prior-pool surfaces, etc.) into a
   plain `Record<string, string>`, (c) substitute them into the resolved
   template using Langfuse's `prompt.compile(vars)` if the fetch succeeded
   OR a simple in-code Mustache-equivalent substitution if it fell back,
   and (d) return a single string. The output for identical inputs MUST be
   byte-identical across consecutive calls (`generation-prompts.ts:7-8`
   invariant — required for Anthropic prompt caching).
3. WHEN `buildValidationSystemPrompt`, `buildTheorySystemPrompt`, and
   `buildTheoryValidationSystemPrompt` run THEN they SHALL follow the
   same pattern as AC 2, each fetching its own Langfuse prompt name.
4. WHEN a fetched Langfuse template is missing a required variable (a
   `{{var}}` the builder did NOT compute) OR contains an unknown variable
   the builder DID compute THEN the builder SHALL: (a) emit a one-shot
   `console.warn` identifying the surface and the offending variable name,
   (b) fall back to the in-repo template, and (c) finish the call. The
   user-facing request SHALL succeed.
5. WHEN static prompts (`EVALUATION_SYSTEM_PROMPT`, `ANNOTATE_SYSTEM_PROMPT`)
   are migrated THEN the call site SHALL fetch them via `getPromptOrFallback`
   with no `compile()` step — the resolved text is used verbatim.

### Requirement 4 — Trace tagging for prompt cohorts

**User Story:** As the operator running an A/B between two prompt versions,
I want Langfuse dashboards to distinguish "calls that used `production`"
from "calls that used `candidate-2026-05-20`" without bespoke filters, so
that quality / cost / latency comparisons are one click apart.

#### Acceptance Criteria

1. WHEN a Claude call resolves THEN its Langfuse generation SHALL carry
   the resolved prompt's Langfuse `version` and `label` as `promptVersion`
   metadata + tag, per Req 2 AC 6.
2. WHEN a Claude call resolves on a `fallback:` path THEN the trace SHALL
   still emit `promptVersion=fallback:<*_SYSTEM_PROMPT_VERSION>` plus a
   `level: 'WARNING'` metadata field `promptFallback=true`, so dashboards
   can detect periods of degraded prompt-fetch behaviour.
3. WHEN dashboards group by `promptVersion` THEN both Langfuse-resolved and
   fallback cohorts SHALL be visible side-by-side under the same prompt
   surface, with cell counts per cohort.
4. WHEN a prompt's body is edited in Langfuse (new version created) AND
   the next Lambda cold start fetches it THEN the new cohort SHALL appear
   in dashboards as a distinct `promptVersion` value with no manual
   schema change.

### Requirement 5 — `pnpm eval:export` — sample traces into a Langfuse dataset

**User Story:** As an engineer about to A/B a new evaluator prompt, I want
one command that pulls a representative sample of recent evaluation traces
into a labelled Langfuse dataset, so that any candidate prompt can be
re-run against the same fixed set and compared apples-to-apples.

#### Acceptance Criteria

1. WHEN a developer runs `pnpm eval:export --from <iso-date> --to <iso-date>
   --language <en|es|de|tr> --cefr <A1..C2> --sample <n> --dataset <name>`
   THEN the script SHALL query the Langfuse Trace API for
   `feature='evaluate'` traces in the given date / language / cefr range,
   uniform-random-sample `n` of them, and create one Langfuse dataset item
   per sample.
2. WHEN a dataset item is created THEN its `input` field SHALL be
   `{ exercise, userAnswer, language, difficulty }` (the inputs that
   `evaluateAnswer` would receive), recovered from the trace's recorded
   `input.messages` payload (or, if not present, from the linked
   `submissionId`'s `user_exercise_history` row via the dataset exporter's
   read-only Neon connection — Req 6 AC 3 below).
3. WHEN a dataset item is created THEN its `expectedOutput` field SHALL be
   the trace's recorded tool-use output (the `EvaluationResult` produced by
   the current production prompt) so that diffs use the current prompt as
   the baseline.
4. WHEN a dataset item is created THEN its `metadata` SHALL include the
   original `submissionId`, `language`, `cefrLevel`, `exerciseType`, and
   `localPromptVersion`, so the dataset can be filtered post-hoc.
5. IF the requested sample size exceeds the available traces in the
   window THEN the script SHALL log a warning and create a dataset with
   exactly the traces that exist (no synthetic padding).
6. WHEN the script runs against the `language-drill-prod` Langfuse project
   THEN the dataset SHALL be created in the same project; when run against
   `language-drill-dev`, in the dev project. Environment is selected by
   the same `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` env vars Phase 1
   already plumbs.
7. WHEN the script runs twice with the same `--dataset` name THEN it SHALL
   append to the existing dataset (not error, not duplicate). Items are
   considered duplicates by `metadata.submissionId` and skipped.

### Requirement 6 — `pnpm eval` — run a candidate prompt against a dataset and report a diff

**User Story:** As an engineer iterating on the evaluator prompt, I want to
edit a candidate prompt in Langfuse (or a local file), point the runner
at a dataset and the candidate, and see — in plain text — how the
candidate differs from the current production prompt on score, errors,
cost, and latency, so that I can decide whether to promote it before
shipping it to live users.

#### Acceptance Criteria

1. WHEN a developer runs `pnpm eval --dataset <name> --candidate
   <langfuse-name@label | file:./path/to/prompt.txt>` THEN the runner SHALL
   resolve the candidate prompt text and, for each dataset item, call
   `evaluateAnswer` with that prompt as the system prompt override.
2. WHEN each candidate eval completes THEN the runner SHALL attach the
   resulting trace to the dataset item via Langfuse's
   `datasetItem.link(trace, runName, runMetadata)`, with `runName` set to
   the user-supplied `--run-name` or auto-generated as
   `candidate-<sha256-of-prompt>[0..7]-<iso>`.
3. WHEN the runner finishes the dataset THEN it SHALL print a single-page
   markdown summary table to stdout with columns:
   - `score`: avg delta (candidate − baseline), p95 abs delta, # items
     where sign flipped (passing→failing or vice versa around 0.5).
   - `grammarAccuracy`: avg delta, p95 abs delta.
   - `taskAchievement`: avg delta, p95 abs delta.
   - `errorCount`: avg delta, p95 abs delta.
   - `cefrEvidence`: agreement rate (candidate matches baseline level), avg
     CEFR-step distance.
   - `costUsd`: total candidate, total baseline, delta, % delta.
   - `latencyMs`: p50 candidate / baseline, p95 candidate / baseline.
4. WHEN the runner runs THEN it SHALL also write the same summary as a
   JSON file to `./eval-runs/<runName>.json` for diffing across runs.
5. IF a dataset item's `evaluateAnswer` throws THEN the runner SHALL
   record `{ submissionId, error: err.message }` in the summary's `errors`
   array and continue with the next item; non-zero exit code only if
   `errors.length > 0`.
6. WHEN the runner runs with `--candidate file:./...` THEN the candidate
   prompt SHALL be hashed and the hash recorded in `runMetadata.promptSha`
   so subsequent invocations against the same dataset and the same
   prompt text resolve to the same run.
7. WHEN the runner finishes successfully THEN the Langfuse dataset run
   page SHALL show: one trace per dataset item, each tagged
   `evaluate-eval-run`, all linked to the same `runName`, with the
   summary's overall metrics visible as run-level metadata.

### Requirement 7 — Observability never fails the request (carry-over from Phase 1)

**User Story:** As the engineer on-call, I want a Langfuse prompt-registry
outage to be a non-event — the request still uses the in-repo fallback
and finishes normally — so that adopting the registry cannot itself
become an incident.

#### Acceptance Criteria

1. IF the Langfuse prompt fetch SDK throws OR times out THEN the request
   SHALL fall back to the in-repo string per Req 2 AC 4–5; the
   user-facing response SHALL be byte-identical to today's response.
2. IF the Langfuse SDK throws during `datasetItem.link` in the eval runner
   THEN the runner SHALL log a warning and continue — the trace is still
   emitted, just not attached to the dataset run.
3. WHEN unit tests run with `LANGFUSE_PUBLIC_KEY` unset (default in
   `vitest`) THEN every existing test in `packages/ai`, `infra/lambda`,
   and `packages/db` SHALL continue to pass without modification, AND the
   new prompt-registry tests SHALL pass using a mocked Langfuse SDK.
4. WHEN a CI run executes `pnpm test` THEN it SHALL NOT make outbound
   network calls to Langfuse — all tests use mocks or stubs.

### Requirement 8 — `pnpm eval` is reproducible and isolated

**User Story:** As the developer running an eval, I want results that I
can re-run, diff against, and share, without affecting production traces
or production rate limits, so that "did this prompt change help?" has a
definitive, repeatable answer.

#### Acceptance Criteria

1. WHEN `pnpm eval` runs THEN every Claude call SHALL set
   `LANGFUSE_ENV=dev` (or the value already in env) on its traces, and
   tag them `eval-run` AND `runName=<name>`, so production dashboards
   filter them out by default.
2. WHEN `pnpm eval` runs against the dev Langfuse project THEN it MUST
   use the dev `ANTHROPIC_API_KEY` and dev rate-limit budget (read from
   the same `.env` as `pnpm dev:api`).
3. WHEN `pnpm eval` runs twice in a row against the same dataset and the
   same candidate prompt THEN the summary's per-item deltas SHALL be
   identical to within Anthropic temperature noise (temperature=0 for
   evaluate, so deltas should be zero or tiny). Reproducibility is bounded
   only by Anthropic's own determinism.
4. WHEN `pnpm eval` runs THEN it SHALL refuse to start if
   `LANGFUSE_PUBLIC_KEY` resolves to a `pk_*` token whose project is the
   prod project (detected by reading the prompt's project from the
   bootstrap manifest, see Req 1 AC 5). Override via
   `--allow-prod` for the rare case where prod is intentional.

### Requirement 9 — Reversibility

**User Story:** As the engineer who may need to roll Phase 2 back, I want
the registry to be removable in one PR — delete the registry module, revert
the three call sites, drop the two CLI scripts — without a schema change
or a Phase-1 regression, so that Phase 2 cannot become a one-way door.

#### Acceptance Criteria

1. WHEN this spec is closed THEN removing Phase 2 SHALL require: deleting
   `packages/ai/src/prompts-registry.ts`, reverting the
   `getPromptOrFallback` calls in `evaluate.ts`, `annotate.ts`,
   `generation-prompts.ts`, `validation-prompts.ts`, `theory-prompts.ts`,
   `theory-validation-prompts.ts` back to direct constant reads, and
   deleting the two CLI scripts. No DB schema migration, no CDK change,
   no Phase-1 code touched.
2. WHEN Phase 2 is removed THEN every existing test in `packages/ai`,
   `infra/lambda`, `packages/db` SHALL still pass.
3. WHEN Phase 2 is removed THEN `promptVersion` traces SHALL revert to
   Phase-1 behaviour — the local `*_SYSTEM_PROMPT_VERSION` value, no
   `langfuse:N` prefix.

### Requirement 10 — Documentation and runbook

**User Story:** As the future me (or a contributor onboarding next quarter),
I want a single page that documents how to edit a prompt in Langfuse,
how to run an eval, and what the dashboard cohort tags mean, so that this
workflow is usable months from now without reverse-engineering it.

#### Acceptance Criteria

1. WHEN this spec is closed THEN `docs/llm-observability.md` SHALL gain a
   new "Phase 2 — Prompt registry" section documenting: the six prompt
   names, the `production` / `candidate-*` label convention, the cache
   TTL, the fallback behaviour, and the `pnpm eval:export` / `pnpm eval`
   commands.
2. WHEN this spec is closed THEN `CLAUDE.md` SHALL gain: (a) the two new
   CLI commands to the "Running locally" table, (b) a one-line update to
   the "Prompt Editing" section explaining that Langfuse is now the live
   source and the in-repo string is the fallback (`*_SYSTEM_PROMPT_VERSION`
   constant bumps still required for the local fallback baseline).
3. WHEN this spec is closed THEN the `bootstrap-prompts.ts` script SHALL
   carry a top-of-file comment describing how to run it against a fresh
   Langfuse project (the operator runbook for setting up a new env).

## Non-Functional Requirements

### Performance

- **Cache-hit fetch latency ≤ 1 ms p99.** A cache hit reads a module-scope
  `Map` entry; no I/O.
- **Cache-miss fetch latency ≤ 250 ms hard ceiling** (Req 2 AC 5). On miss,
  the request still completes — fallback path is synchronous.
- **No new latency tax on the user-facing critical path.** The Phase-1
  budget (≤ 25 ms p95 added by tracing on `POST /exercises/:id/submit`)
  SHALL hold; Phase 2 adds at most the cache-miss timeout on a cold
  Lambda's first request per surface, which is bounded by Req 2 AC 5 and
  amortised across the cache lifetime (60 s default).
- **Anthropic prompt-caching hit rate unchanged.** Builder-composed prompt
  outputs MUST be byte-identical across consecutive calls with the same
  inputs (Req 3 AC 2) — otherwise the `cache_control: ephemeral` annotation
  on the system block stops hitting and per-call cost regresses.

### Security

- **No new inbound surface.** Lambdas still only call out to Langfuse and
  Anthropic. No prompt-registry data is ever served back to a client.
- **Langfuse credentials remain in AWS Secrets Manager + `.env`**, scoped
  per environment, identical to Phase 1.
- **Eval-runner safety**: `pnpm eval` refuses to run against the prod
  Langfuse project without an explicit `--allow-prod` flag (Req 8 AC 4),
  so a fat-fingered command can't pollute prod dashboards or spend prod
  Claude budget.
- **No PII added.** Dataset items contain the same `(exercise, userAnswer,
  EvaluationResult)` triple already in the Phase-1 trace stream; no new
  PII is exposed.

### Reliability

- **Observability never breaks the request** (Req 7) — carry-over from
  Phase 1.
- **Bootstrap idempotent** (Req 1 AC 5) — the registration script is the
  reproducible source of truth for "what does a fresh Langfuse project look
  like?" so a new env can be initialised without manual UI clicks.
- **Local fallback is the source of truth at all times.** The in-repo
  `*_SYSTEM_PROMPT` strings MUST remain mergeable, reviewable, and
  type-checked — Langfuse is the *live operational override*, not the
  *primary definition*.

### Usability (operator-facing)

- **Two-command workflow.** Promoting a prompt is, in steady state, two
  commands: `pnpm eval` to verify, click "set production label" in the
  Langfuse UI to ship. No code deploy required.
- **Reproducible eval runs.** Each `pnpm eval` writes a JSON summary
  alongside the Langfuse run; the JSON is git-ignored but a developer can
  diff across runs locally (Req 6 AC 4).
- **Dashboard cohort clarity.** Phase-1 dashboards already group by
  `promptVersion`; Phase 2 adds `promptFallback=true` filtering so the
  operator can spot prompt-fetch outages from a metric, not a CloudWatch
  search.

## Open Questions for Design Phase

These must be answered (or explicitly deferred) when drafting `design.md`:

1. **Production-label convention.** Langfuse supports arbitrary labels;
   options include (a) the literal label `production` (Langfuse's
   default), (b) `prod-<env>` (`prod-prod`, `prod-dev`) for explicitness,
   (c) labels tied to the in-repo `*_VERSION` date. Recommend (a) for
   alignment with Langfuse docs; design phase confirms.
2. **Where the cache lives.** Module-scope `Map` in `prompts-registry.ts`
   is the natural place; alternative is per-Lambda-cold-start with no
   TTL. 60 s TTL keeps prompt promotions visible within a minute without
   thrashing fetches.
3. **What "structural quality diff" computes for the eval runner.**
   Requirements pin score / grammarAccuracy / taskAchievement / errorCount
   / cefrEvidence; design phase decides exact arithmetic (e.g., is CEFR
   distance integer steps in A1..C2 or something fancier?).
4. **Dataset item provenance when the trace lacks `input.messages`.**
   Phase 1 traces store input as `{ system, messages }` (Phase-1 Proxy
   `startLangfuseGeneration`). If a trace was emitted before Phase 1
   stabilised that field, the exporter falls back to the linked
   `submissionId` row in `user_exercise_history` to reconstruct
   `(exercise, userAnswer)`. Design phase confirms the read-only DB
   connection in the exporter is acceptable.
5. **Sampling strategy.** Uniform-random across the date range is the
   default; alternative is stratified sampling by `(language, cefrLevel,
   exerciseType)` to ensure coverage. Defer to design.
6. **Phase 2b scope (defer).** Builder-composed prompts (`generate`,
   `validate`, `theory-*`) get registered + fetched in Phase 2 but do
   NOT get a `pnpm eval`-style offline workflow. When and how to add
   one (per-surface dataset shape; what counts as "quality" for a
   draft generator without a human grader; how to reuse the runner)
   is out of scope here.
