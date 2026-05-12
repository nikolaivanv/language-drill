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
