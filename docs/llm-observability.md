# LLM Observability with Langfuse

Status: proposal — not yet implemented.
Owner: see git blame.
Last updated: 2026-05-11.

## 1. Why

We call Claude in four distinct places, each with its own prompt surface, latency budget, and failure mode:

| Call site | File | Trigger | User-facing? |
|---|---|---|---|
| Answer evaluation | `packages/ai/src/evaluate.ts` → `infra/lambda/src/routes/exercises.ts` | User submits answer | **Yes** — blocks the UI |
| Reading annotation | `packages/ai/src/annotate.ts` → `infra/lambda/src/routes/read.ts` | User opens annotated reading | **Yes** — blocks the UI |
| Exercise generation | `packages/ai/src/generate.ts` → `infra/lambda/src/generation/handler.ts` | Background pre-generation Lambda | No |
| Exercise validation | `packages/ai/src/validate.ts` → generation pipeline | After generation, before write to pool | No |

Right now we have **no per-request visibility**: token counts live only in the Anthropic response and are summed into `generation_jobs.cost_usd_estimate` for one of the four paths. We can't answer questions like:

- Which evaluator prompt version regressed grammar accuracy?
- What's the cache-hit rate on the evaluation system prompt across a day?
- Which generation prompts produce the most validation rejections, and is that worth the cost?
- Are p95 latencies on `evaluateAnswer` blowing past the 3 s UI budget for any language?
- For a single failed user submission, what exactly did we send Claude and what came back?

These all need persisted, structured traces. The goal of this work is to make them answerable in a dashboard within minutes, without grepping CloudWatch.

## 2. Vision

Adopt **Langfuse cloud** (self-hostable later) as the single sink for every Claude call the app makes — both user-facing and background. Every trace carries enough metadata to:

1. **Iterate on prompts safely.** Tag traces with a `promptVersion` so a prompt change shows up as a new cohort in cost/latency/quality charts, side-by-side with the previous one.
2. **Spot cost regressions early.** Daily and per-feature dashboards for total spend, cache-read ratio, and cost per evaluated answer. Alert if any metric drifts ≥30% week-over-week.
3. **Debug individual failures.** From a user-reported "the feedback was wrong" report, jump from `submissionId` (already in our DB) to the exact prompt, tool-call output, and parsed result in Langfuse in one click.
4. **Build evals.** Sample traces from the evaluation pipeline into Langfuse datasets, hand-grade a slice, then re-run new prompts against the same dataset before shipping.
5. **Compare models.** Make it cheap to swap Sonnet ↔ Haiku ↔ Opus for any single call site and view the diff in quality/cost/latency without writing custom code.

Non-goal: replace the existing `cost-model.ts` / `generation_jobs.cost_usd_estimate` accounting. Those are authoritative for billing/rate-limiting and stay. Langfuse is a **secondary, analytics-grade** sink.

## 3. Requirements

### 3.1 Functional

- **FR-1 Coverage.** Every call to `client.messages.create` in `packages/ai` is traced, including the background generation/validation pipeline.
- **FR-2 Metadata.** Each trace carries: `userId` (or `dev_user_001` locally), `language`, `cefrLevel`, `exerciseType`, `promptVersion`, `model`, `temperature`, `requestId` (Lambda request id), and `feature` (`evaluate` | `annotate` | `generate` | `validate`).
- **FR-3 Usage capture.** Token usage is reported as four separate counts (input, cache-write, cache-read, output) so the existing `ClaudeUsageBreakdown` mapping in `packages/ai/src/cost-model.ts` is preserved. Cache-read ratio must be visible per call site.
- **FR-4 Tool-use payloads.** The structured tool-use input (`submit_evaluation`, `submit_annotation`, `submit_*_draft`, validation tool) is captured as the trace output, not the raw `content` array.
- **FR-5 Linkability.** From any user submission, support recovering the corresponding trace by `submissionId` (stored as a Langfuse trace tag). Same for `exerciseId` for generation/validation.
- **FR-6 Local dev parity.** Local Lambda dev (`pnpm dev:api` with `dev_user_001`) traces flow to Langfuse exactly like production — gated only by `LANGFUSE_PUBLIC_KEY` being present. No-op when keys are absent.
- **FR-7 Prompt registry (phase 2).** System prompts (`EVALUATION_SYSTEM_PROMPT`, generation prompt builders, validation prompt template) are registered as **named, versioned prompts in Langfuse** and fetched at runtime so a non-engineer (incl. me on mobile) can A/B prompts without a deploy. Fall back to the in-repo string if Langfuse is unreachable.
- **FR-8 Dataset support (phase 2).** A CLI/script can export a sample of evaluation traces from a date range into a Langfuse dataset for offline eval, and re-run a candidate prompt against that dataset.

### 3.2 Non-functional

- **NFR-1 Latency budget.** Tracing must add ≤25 ms p95 to any user-facing call. Use Langfuse's async/batched ingestion (no awaiting flushes in the request path); explicitly `flushAsync` at Lambda invocation end to avoid losing traces on cold-process exit.
- **NFR-2 No new failure mode.** A Langfuse outage or 5xx must never fail an evaluation or generation. All SDK calls are wrapped so a thrown observability error is logged and swallowed.
- **NFR-3 No PII leakage to Langfuse beyond what's necessary.** Send `userId` (Clerk's opaque `user_xxx`), not email/name. User answer text is in scope (we need it to debug feedback quality) but flag this in CLAUDE.md and in the privacy policy.
- **NFR-4 Cost ceiling.** Tracing must stay on Langfuse cloud free tier (50k traces/month) at current usage projections through Phase 2. Re-evaluate when crossing 25k/month — that's the trigger to enable sampling for the highest-volume call site (generation) and/or self-host.
- **NFR-5 Reversibility.** The integration must be a single thin wrapper around `createClaudeClient`. Removing Langfuse means deleting that wrapper and one env-var check — no schema changes, no caller changes.

## 4. Architecture

### 4.1 Integration point

One wrapper in `packages/ai/src/observability.ts`:

```ts
export function createObservedClaudeClient(apiKey: string): Anthropic {
  if (!process.env.LANGFUSE_PUBLIC_KEY) {
    return new Anthropic({ apiKey });
  }
  // observeAnthropic returns a drop-in replacement that emits traces.
  return observeAnthropic(new Anthropic({ apiKey }));
}
```

Replace `createClaudeClient` callers in `infra/lambda/src/{routes,generation}/*` with `createObservedClaudeClient`. No changes to `evaluate.ts`, `annotate.ts`, `generate.ts`, `validate.ts` — they keep taking an `Anthropic` and stay unit-testable without observability.

### 4.2 Trace metadata injection

Langfuse contexts are async-local-storage scoped. Add a `withLlmTrace(metadata, fn)` helper used at each call site:

```ts
// In exercises.ts submit handler:
await withLlmTrace(
  {
    feature: 'evaluate',
    userId,
    submissionId,
    language: exercise.language,
    cefrLevel: exercise.difficulty,
    exerciseType: exercise.type,
    promptVersion: EVALUATION_SYSTEM_PROMPT_VERSION,
  },
  () => evaluateAnswer(client, input),
);
```

Promote `EVALUATION_SYSTEM_PROMPT_VERSION`, `ANNOTATE_SYSTEM_PROMPT_VERSION`, etc. to named exports in `packages/ai`. Bump manually on every meaningful prompt change.

### 4.3 Flushing in Lambda

API Gateway Lambda is short-lived. The trace exporter must:

- Buffer in-process during the invocation.
- Call `langfuse.flushAsync()` in a Hono `onResponse`/`onClose` hook **before** returning, with a 200 ms timeout.
- For the background generation Lambda (longer-running, SQS-driven), flush at the end of each message handler.

This avoids both data loss (Lambda freeze drops the buffer) and tail latency (synchronous flush on hot path).

### 4.4 Secrets & env

| Variable | Where |
|---|---|
| `LANGFUSE_PUBLIC_KEY` | AWS Secrets Manager `language-drill/LANGFUSE_PUBLIC_KEY` (prod), `.env` (local) |
| `LANGFUSE_SECRET_KEY` | AWS Secrets Manager `language-drill/LANGFUSE_SECRET_KEY` (prod), `.env` (local) |
| `LANGFUSE_BASE_URL` | optional; defaults to `https://cloud.langfuse.com` |
| `LANGFUSE_SAMPLE_RATE` | optional float `[0,1]`; default `1.0` (overrideable for generation if free tier pressure hits) |

Two Langfuse projects: **`language-drill-prod`** and **`language-drill-dev`** — mirrors the existing Clerk / Neon / CDK env split. Local dev points at `language-drill-dev`.

## 5. Tagging schema (frozen at v1)

Every trace must carry these tags so dashboards work without bespoke filters:

- `feature`: `evaluate` | `annotate` | `generate` | `validate`
- `language`: `en` | `es` | `de` | `tr`
- `cefrLevel`: `A1` | `A2` | `B1` | `B2` | `C1` | `C2`
- `exerciseType`: `cloze` | `translation` | `vocab_recall` | `reading` | `null`
- `promptVersion`: free-form, e.g. `evaluate@2026-05-08`
- `model`: literal model id, e.g. `claude-sonnet-4-5`
- `env`: `prod` | `dev`

Per-trace `userId` is set via Langfuse's first-class user field, not a tag (it enables the built-in per-user view).

## 6. Use cases the implementation must support on day one

These are the acceptance criteria. If a dashboard can't answer them in <60 s of clicking, the integration isn't done.

1. **"Show me yesterday's evaluation cost and average score, broken down by language."**
2. **"For submission `sub_abc123`, show the exact prompt, the user's answer, and the tool-use output."** (Driven by submission-id tag.)
3. **"After I bumped `promptVersion` from `evaluate@2026-05-08` to `evaluate@2026-05-09`, did p95 latency or average `grammarAccuracy` change?"**
4. **"Which generation prompt cells (language × difficulty × exerciseType) have a validation-rejection rate >20%?"** (Cross-trace; requires both `generate` and `validate` traces to share an `exerciseId`.)
5. **"What's the cache-read ratio on the evaluation system prompt today vs. last week?"**

## 7. Phase plan

- **Phase 1 — Read-only tracing (1–2 days).** Wrapper client + metadata injection + Lambda flush hook. All four call sites traced. Tags schema v1 frozen. Dashboards for the five use cases above built and pinned. Existing cost model untouched.
- **Phase 2 — Prompt registry + datasets (3–5 days).** Migrate the four system prompts into Langfuse's prompt management. Add a `pnpm eval` script that runs a candidate prompt against a labelled dataset of past submissions and produces a quality/cost/latency diff vs. current.
- **Phase 3 — Online evals (deferred, scope TBD).** Use Langfuse's LLM-as-judge to score a sample of live evaluation outputs against a rubric (e.g., "does the feedback cite a specific error?"). Only worth doing once Phase 2 dataset eval is in routine use.

## 7a. Phase 2 — Prompt registry

Phase 2 makes every system prompt **fetched from Langfuse at runtime**, with
the in-repo `*_SYSTEM_PROMPT` / `*_SYSTEM_PROMPT_TEMPLATE` string acting as a
fail-soft fallback. This is what lets a non-engineer (or me on mobile) iterate
on prompt copy without a deploy, while keeping the build green and the runtime
robust when Langfuse is unreachable.

### 7a.1 Registered prompts

Six prompts are registered, one per Claude surface. Names are the registry
keys — change them only in lockstep with the manifest in
`packages/ai/scripts/bootstrap-prompts.ts` and the call sites under
`packages/ai/src/`.

| Langfuse prompt name | Surface | In-repo fallback constant |
|---|---|---|
| `evaluate-system-prompt` | answer evaluation | `EVALUATION_SYSTEM_PROMPT` |
| `annotate-system-prompt` | reading annotation | `ANNOTATE_SYSTEM_PROMPT` |
| `generate-system-prompt` | exercise generation | `GENERATION_SYSTEM_PROMPT_TEMPLATE` |
| `validate-system-prompt` | exercise validation | `VALIDATION_SYSTEM_PROMPT_TEMPLATE` |
| `theory-generate-system-prompt` | theory generation | `THEORY_SYSTEM_PROMPT_TEMPLATE` |
| `theory-validate-system-prompt` | theory validation | `THEORY_VALIDATION_SYSTEM_PROMPT_TEMPLATE` |

The four `*_TEMPLATE` constants use flat `{{varName}}` placeholders. Each
builder (`buildGenerationSystemPrompt`, `buildValidationSystemPrompt`, etc.)
computes the var bag, then calls `getPromptWithVarsOrFallback(...)`, which
either compiles the Langfuse prompt with those vars or substitutes them into
the in-repo template — both paths produce the same string when the Langfuse
copy is byte-identical to the fallback (asserted by the snapshot parity
tests).

### 7a.2 Label convention

Two labels are reserved:

- **`production`** — the body the runtime fetches. Exactly one version per
  prompt holds this label at any time. Bootstrap registers v1 with
  `['production']` on first run; moving the label to v2 is how you ship a
  prompt change without a deploy.
- **`candidate-<slug>`** — any non-production variant under evaluation. Used
  by `pnpm eval --candidate langfuse:<name>@candidate-foo` to fetch a draft
  prompt by label rather than copy-pasting a file. Free-form slug; pick
  something dashboard-readable (`candidate-2026-05-17-tighter-feedback`).

Operator-facing prompts always carry `production`; experiments carry
`candidate-*`. Nothing in the runtime parses these labels — they are pure
convention enforced by the CLIs and the dashboards.

### 7a.3 Cache TTL — why 5 minutes

Each Lambda process caches the resolved prompt body for **5 minutes**
(`LANGFUSE_PROMPT_CACHE_TTL_MS=300000`) in a module-scope map. Trade-offs:

- **Lower (e.g. 30 s):** dashboard label flips take effect within ~30 s, but
  every cold Lambda + every 30 s window adds a Langfuse round-trip to the hot
  path — capped at 250 ms by the fetch timeout, but still adds tail latency
  the fallback wouldn't add.
- **5 min (current default):** roughly 12 Langfuse calls per process per hour
  per prompt — cheap, well inside free tier, and 5 min is the worst case for
  a prompt edit to roll out. Lambda cold starts evict the cache independently,
  so most real users see the new prompt much sooner.
- **Higher (e.g. 1 hour):** invisible savings, slower rollouts. Not worth it.

Override per environment via `LANGFUSE_PROMPT_CACHE_TTL_MS` in `.env`. The
`LANGFUSE_PROMPT_FETCH_TIMEOUT_MS` knob (default 250 ms) is the hard ceiling
on how long a single fetch can block a Claude call before the registry
gives up and falls back — keep this tight.

### 7a.4 Fallback behaviour

The registry **never throws**. Every fetch path is fail-soft and returns the
in-repo string + `fromFallback: true`. Triggers:

1. `LANGFUSE_PUBLIC_KEY` is unset (local dev / CI without keys).
2. Langfuse returns no production-labeled version for the prompt name.
3. The fetch exceeds `LANGFUSE_PROMPT_FETCH_TIMEOUT_MS`.
4. The Langfuse SDK throws (5xx, network, malformed response, compile error).
5. (Templated only) the compiled Langfuse body still contains a `{{var}}` the
   caller didn't pass — assumed to be a registry/template-drift bug; we
   prefer the in-repo template that we can read in source.

Every fallback bumps `promptFallback=true` and `promptVersion=fallback:<v>`
on the trace, warns **once per process** to stderr (`warnOnce`), and proceeds
as if Langfuse never existed. Dashboards pivot on `promptFallback` to see how
often this fires — a steady non-zero rate means Langfuse is degraded; a one-
off cold-start blip is normal.

### 7a.5 Operator commands

Three CLIs ship from `packages/ai/scripts/`, wired as root-level pnpm
shortcuts so they work from any monorepo directory.

| Command | What it does |
|---|---|
| `pnpm bootstrap-prompts` | Registers any of the six prompts that don't yet exist in the configured Langfuse project (uses the in-repo string/template as v1, labels it `production`). Skips already-existing prompts. Idempotent — safe to re-run. |
| `pnpm bootstrap-prompts --dry-run` | Prints what it would create without writing to Langfuse. Use as a smoke test on a fresh project. |
| `pnpm bootstrap-prompts --check` | **Drift detection**: read-only. For each prompt, fetches the live `production` body and compares byte-for-byte to the in-repo source. Exits 1 with a unified diff if anything has drifted. Run in CI / pre-push to catch silent dashboard-vs-source skew. |
| `pnpm eval:export --from <iso> --to <iso> --sample <n> --dataset <name> [--language <l>] [--cefr <c>] [--seed <int>]` | Pulls evaluation traces from Langfuse in the date window, uniformly samples `n` of them, joins each back to the original `user_exercise_history` row for the user answer + exercise content, and writes the result as items into a Langfuse dataset (dedup'd by `submissionId`). |
| `pnpm eval --dataset <name> --candidate <ref> [--run-name <name>] [--allow-prod] [--limit <n>]` | Runs a candidate prompt against the dataset. `<ref>` is either `file:<path>` (a local txt file) or `langfuse:<name>@<label>` (e.g. a `candidate-*`-labelled draft). Links every per-item trace to the dataset run so the Langfuse UI shows them side-by-side with the baseline. Prints a markdown summary table and writes `./eval-runs/<runName>.json`. Refuses to run with `LANGFUSE_ENV=prod` unless `--allow-prod` is set (Req 8 AC 4 guard). |

### 7a.6 `eval-runs/` artefact

Each `pnpm eval` invocation writes a JSON file to the gitignored
`eval-runs/` directory. The shape (`EvalRunSummary` in
`packages/ai/scripts/eval-run.ts`):

```jsonc
{
  "runName": "candidate-a1b2c3d4-2026-05-17T18-30-00Z",
  "promptSha": "a1b2c3d4",
  "candidateSource": "file:./fixtures/candidate.txt",
  "datasetName": "eval-smoke",
  "startedAt": "2026-05-17T18:30:00.000Z",
  "itemCount": 50,
  "okCount": 49,
  "errorCount": 1,

  "score":           { "avgDelta": 0.04, "p95AbsDelta": 0.18, "signFlips": 2 },
  "grammarAccuracy": { "avgDelta": 0.06, "p95AbsDelta": 0.20, "signFlips": 1 },
  "taskAchievement": { "avgDelta": 0.02, "p95AbsDelta": 0.15, "signFlips": 3 },
  "errorCountDelta": { "avgDelta": -0.3, "p95AbsDelta": 1.0 },

  "cefr":      { "agreementRate": 0.86, "avgDistance": 0.16 },
  "costUsd":   { "candidate": 0.4231, "baseline": null,  "deltaPct": null },
  "latencyMs": { "candidate": { "p50": 1840, "p95": 3120 },
                 "baseline":  { "p50": null, "p95": null } },

  "errors": [{ "itemId": "ds-item-42", "submissionId": "sub_xyz", "error": "..." }],
  "perItem": [/* full ItemResult[] for offline inspection */]
}
```

The `perItem` array carries the raw per-dataset-item record (input, expected
output, actual output, latency, cost). The top-level fields are the
decision-grade summary — pin them in a PR comment when proposing a prompt
change.

### 7a.7 Quality / cost / latency diff metrics

`computeDiff` (in `eval-run.ts`) produces one summary per run. Read the
table left-to-right when deciding whether to ship a candidate.

| Field | What it measures | Decision signal |
|---|---|---|
| `score.avgDelta` | mean `(candidate.score − expected.score)` across all OK items | central tendency of quality change; ±0.05 is in the noise band |
| `score.p95AbsDelta` | p95 of `|candidate − expected|` per item | tail movement; large p95 with small avg = mixed reviews |
| `score.signFlips` | count of items where candidate and baseline land on opposite sides of the 0.5 routing boundary | the only metric that captures "would this answer be routed differently?" |
| `grammarAccuracy.*` / `taskAchievement.*` | same triple, per sub-dimension | drill into which evaluator dimension moved |
| `errorCountDelta.avgDelta` | avg `(candidate.errors.length − expected.errors.length)` | how much more / less error-spotting the candidate does (no sign-flip metric — there's no semantic threshold) |
| `cefr.agreementRate` | fraction of items where candidate's CEFR estimate matches the baseline's | top-level "did we re-grade the level?" rate |
| `cefr.avgDistance` | mean `|cefrIndex(candidate) − cefrIndex(baseline)|` on the `A1=0 … C2=5` scale | how far off the disagreements are |
| `costUsd.candidate` / `.baseline` / `.deltaPct` | rolled-up Anthropic spend over the run | candidate cost is always populated; baseline is `null` today (the exporter doesn't carry usage through — a follow-up enables a true delta) |
| `latencyMs.candidate.{p50,p95}` | timed inside the eval loop | candidate latency is always populated; baseline is `null` today for the same reason as cost |
| `errorCount` / `errors[]` | items where the candidate threw or produced an unparseable tool-use | non-zero `errors[]` exits the CLI with code 1 — never ship a candidate that didn't complete the run |

Until the exporter carries baseline usage and latency through, judge cost
and latency against an explicit re-run of `production` (i.e. run `pnpm eval`
twice on the same dataset, once with `--candidate langfuse:<name>@production`
and once with the proposed candidate, then diff the two summaries).

## 8. Open questions

- **Sampling on generation?** Generation runs in batches and is by far the highest-volume call site. Free-tier impact is the deciding factor — measure for one week at sample rate 1.0 before deciding.
- **Storing user answers verbatim.** Necessary for debugging eval quality, but it's user-generated text in Langfuse cloud. Acceptable for the current single-user portfolio stage; revisit before any public launch and ensure the privacy policy covers it.
- **Trace retention.** Langfuse cloud free tier retains 30 days. Is that enough for our eval-dataset workflow, or do we need to export weekly into S3? Defer until Phase 2.
- **Mobile (Phase 4).** When Expo lands, the mobile app also calls the API and traces flow through it transparently — no extra integration required. Confirm this assumption when Expo work begins.

## 9. Out of scope

- Replacing the existing per-user rate-limiting / cost accounting (`Upstash` counters, `generation_jobs.cost_usd_estimate`).
- Replacing CloudWatch as the runtime/error-log sink.
- Real-time alerting on individual user submissions (no `feedback < 0.5` paging — this is analytics, not ops).
- LangChain. We deliberately use the Anthropic SDK directly; we are not adopting LangChain to get Langfuse.
