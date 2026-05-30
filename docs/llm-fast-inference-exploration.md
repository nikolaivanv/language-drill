# Fast-Inference Exploration — Groq / Cerebras

**Status:** deferred (captured 2026-05-30, during the `llm-latency-optimizations` spec)
**Scope:** descriptive only — this document touches no runtime code path and introduces no credentials.
**Origin:** Requirement 5 of the [`llm-latency-optimizations` spec](../.claude/specs/llm-latency-optimizations/requirements.md) (see "Requirement 5 — Document the postponed Groq / Cerebras exploration"). The three shipped latency changes from that spec — deep-card streaming, the Haiku evaluation swap, and SDK timeout/retry tuning — all stayed inside the Anthropic stack. This is the writeup of the one idea we considered and chose **not** to pursue yet, so the reasoning and the evaluation plan aren't lost.

---

## The opportunity

[Groq](https://groq.com) and [Cerebras](https://cerebras.ai) sell **very-high-throughput inference** — hundreds to low-thousands of output tokens per second on open-weight models (Llama, Qwen, and similar families), well above typical hosted-Claude generation speed. For a generation-bound call, that throughput is the whole latency story.

The key property: **the throughput advantage scales with output size.** The win is (roughly) proportional to how many tokens the model has to *emit*, because faster tokens/sec compounds over a longer output. That ranks our two AI surfaces:

| Surface | Output size | How much a faster decoder helps |
|---|---|---|
| **Deep annotation** (`/read/annotate-span`) | ~500–1500 output tokens (a full `DeepCard`: definition, morphology, synonyms, collocations…) | **Most.** Long, structured output — the surface that would benefit the most from a faster decoder. |
| **Answer evaluation** (`POST /exercises/:id/submit`) | bounded, ~≤1024 tokens of structured scoring JSON | Less. The output is small and bounded, so there's less decode time to compress; the Haiku 4.5 swap (this spec, Req 3) already addresses its latency and cost. |

So if we ever adopt fast inference, **deep cards are the natural first candidate**, not evaluation.

Note that deep-card *perceived* latency is already largely solved by streaming (this spec, Req 1): the first field now renders in well under a second regardless of decoder speed. Fast inference would shorten the **time to the fully assembled card**, not the time-to-first-field. That makes it an incremental win on an already-improved surface — part of why it's deferred rather than urgent.

---

## Why it's deferred

It's a meaningful re-platforming of a core AI call for an incremental, already-partially-captured win. Concretely, the trade-offs below are non-trivial and the streaming work already removed the most painful symptom (the ~8–13 s blank-spinner wait). Deferring keeps the change surface of this spec small, reversible, and inside one provider.

---

## Trade-offs to weigh before adopting

1. **Non-Claude model families.** Groq/Cerebras serve open-weight models (Llama, Qwen, etc.), not Claude. Every prompt in `packages/ai` (`annotate.ts`, `read-span.ts`, `prompts.ts`, the generation/validation/theory prompts) was authored and tuned against Claude. A different family is a different instruction-follower — tool-use formatting, JSON adherence, and the quality of pedagogical explanations would all need re-checking, not assumed.

2. **Loss of Anthropic prompt caching.** We rely on Anthropic **ephemeral prompt caching** for ~80% prompt-token cost reduction within a session (the cached system prompt = language profile + format). That mechanism is Anthropic-specific. A different provider means re-evaluating the cost model from scratch — the headline throughput win could be partly or fully offset on the *cost* axis once cache misses are priced in.

3. **Prompt re-tuning + re-validation.** Beyond authoring, the **content pipeline has guardrails** (the cloze validator, `pnpm revalidate:cloze`, theory validation) calibrated to Claude's output distribution. A model swap on a generation surface would need a re-pass over those, and a swap on evaluation would need the quality gate below before it could ship.

4. **New provider / secret / observability wiring.** A new provider means a new SDK or HTTP client, new secrets in AWS Secrets Manager (per-env, `language-drill/` + `language-drill-dev/`), new IAM grants on the relevant Lambda, and new **Langfuse** instrumentation so traces, cost, and latency still land in one place. The current `createObservedClaudeClient` Langfuse-proxy wrapper is Anthropic-shaped; a second provider needs an equivalent path.

5. **Availability / maturity risk.** These are newer, capacity-constrained platforms relative to Anthropic. Rate limits, regional availability (our Lambdas run in `eu-central-1`), model deprecation cadence, and uptime are all unknowns to validate before a user-facing surface depends on them. A fallback-to-Claude path would likely be required, which adds its own complexity.

---

## Evaluation plan (before any adoption)

Any candidate Groq/Cerebras model must be **benchmarked head-to-head through the existing `pnpm eval` harness** — the same gate used for the Haiku swap (this spec, Req 3) — before it ships. The harness already measures the three axes that matter here:

```bash
# 1. Sample real evaluation traces from Langfuse over a date window into a
#    Langfuse dataset (joined to user_exercise_history for answer + exercise).
pnpm eval:export

# 2. Run the candidate model against that dataset; each per-item trace is
#    linked to the run, and a quality / cost / latency summary is written to
#    ./eval-runs/<runName>.json.
pnpm eval
```

Compare the candidate's `./eval-runs/*.json` summary against the current-Claude baseline on **quality, cost, and latency together** — a throughput win that regresses quality or (after losing prompt caching) raises cost is not a win. The same ship/revert discipline as the Haiku decision applies: a clear quality bar, decided before the run, that makes adoption a measurable call rather than a judgment one.

For deep cards specifically, "quality" also means the streamed/assembled `DeepCard` still validates against `DeepCardSchema` / `parseSpanResult` and that morphology/synonym/collocation sections stay pedagogically sound — the final-validation authority of the streaming design (Req 1.3) must hold regardless of provider.

---

## Why the Vercel AI Gateway isn't a natural fit

The [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) is an attractive way to reach multiple providers (including Groq/Cerebras) behind one API with failover and unified observability — **but our LLM calls don't run on Vercel.**

Both latency-sensitive AI surfaces execute in **AWS Lambda**, not in the Next.js app:

- Answer evaluation runs in the Hono API Lambda (`infra/lambda`).
- Deep annotation runs in the dedicated streaming Lambda behind a Function URL (`infra/lambda/src/annotate-stream`).

The Vercel frontend (`apps/web`) only ever talks to those Lambdas; it never calls an LLM itself (a deliberate architecture choice — the mobile app needs the same backend, and rate-limiting/metering live at the Lambda boundary). Routing a Lambda-originated call through a Vercel-hosted gateway would add a cross-cloud network hop and a second platform dependency on the **hot path** of a latency-optimization effort — the opposite of the goal. If we adopt fast inference, the call should go **direct from Lambda to the provider** (or via a provider-native gateway), with Langfuse as the existing observability layer.

---

## References

- Spec: [`llm-latency-optimizations` — requirements.md](../.claude/specs/llm-latency-optimizations/requirements.md) (Req 5), [design.md](../.claude/specs/llm-latency-optimizations/design.md) (Component 8)
- Eval harness usage: root `CLAUDE.md` → `pnpm eval:export` / `pnpm eval`
- Observability boundaries: [`docs/llm-observability.md`](./llm-observability.md) (Langfuse is the single LLM-trace inbox; Lambda errors stay in CloudWatch)
- Anthropic prompt caching & cost posture: root `CLAUDE.md` → "Content Strategy" / "Prompt caching"
