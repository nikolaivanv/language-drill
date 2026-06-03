# Eval-harness gate outcome — Haiku 4.5 evaluation swap (Task 28)

**Date:** 2026-05-30
**Decision:** ✅ **PASS — ship Haiku 4.5. Do NOT revert the `MODEL` constant.**
**Requirement:** Req 3.2 / 3.3 (eval-harness-gated model swap; the bar: revert if **>5% drop in aggregate score agreement** OR **any error-detection regression** vs the Sonnet baseline).

---

## What was run

Production Langfuse + Anthropic + Neon credentials were pulled from AWS Secrets Manager (`eu-central-1`, prefix `language-drill/`) and passed inline to the package scripts.

```bash
# 1. Build a 25-item dataset from real production evaluate traces (Sonnet baseline).
#    Reads prod traces + Neon; NO Anthropic spend.
pnpm --filter @language-drill/ai eval:export \
  --from 2026-03-01 --to 2026-05-30 --sample 25 --seed 42 \
  --dataset haiku-eval-gate-20260530
#  → fetched=110 sampled=25 created=25 (0 missingInDb, 0 errors)

# 2. Run the Haiku candidate (current MODEL = claude-haiku-4-5-20251001) against it,
#    holding the prompt constant at the prod evaluation prompt to isolate the model.
LANGFUSE_ENV=prod pnpm --filter @language-drill/ai eval \
  --dataset haiku-eval-gate-20260530 \
  --candidate "langfuse:evaluate-system-prompt@production" \
  --run-name haiku-4-5-vs-sonnet-20260530 --allow-prod --limit 25
#  → 25 items, 0 errors. JSON: packages/ai/eval-runs/haiku-4-5-vs-sonnet-20260530.json
```

`pnpm eval` runs `evaluateAnswer`, which uses the `MODEL` constant in `packages/ai/src/evaluate.ts` — already swapped to Haiku 4.5 in Task 3 — so the run *is* the Haiku candidate. `--candidate` overrides only the system-prompt body (not the model), so passing the prod `evaluate-system-prompt@production` body isolates the Sonnet→Haiku model change.

## Harness limitation found (and worked around)

The built-in `pnpm eval` diff came back **vacuous** — `score`/`grammar`/`taskAchievement` deltas all `0.0000`, CEFR agreement `0.0%`. Root cause: `eval-export` sets `expectedOutput: trace.output`, but the prod evaluate traces carry **no root-level `output`** (the structured result was recorded on a nested observation, not the trace root), so every dataset item's `expected` is `null` and `computeDiff` skips all items (returns zeros when `comparableCount === 0`). This is a harness gap, not a quality signal — see tech-debt note below.

The Sonnet baseline **is** recoverable: the submit route stores it in Neon at `user_exercise_history.response_json.evaluation` (the exporter reads that row but keeps only `userAnswer`). The 25 Haiku `actual` outputs were joined to those stored Sonnet baselines by `submissionId` and compared directly.

## Result — Haiku 4.5 vs Sonnet baseline (25/25 paired)

| Metric | Sonnet (baseline) | Haiku 4.5 (candidate) | Verdict |
|---|---|---|---|
| Mean `score` | 0.876 | 0.864 (−0.012, ≈1.4% lower) | within bar |
| **Score pass/fail agreement** (boundary 0.5) | — | **25/25 = 100%** (0 sign-flips) | **no >5% drop** ✅ |
| `score` \|Δ\| | — | mean 0.024 / max 0.200 | tight |
| `grammarAccuracy` \|Δ\| | — | mean 0.024 / max 0.200 | tight |
| `taskAchievement` \|Δ\| | — | mean 0.014 / max 0.150 | tight |
| CEFR (`estimatedCefrEvidence`) agreement | — | **25/25 = 100%** | exact |
| **Error-detection regression** | 4 items had ≥1 error | **0/4 missed** (Haiku flagged errors on all 4) | **no regression** ✅ |
| Latency (Haiku) | n/a (baseline not captured) | p50 2769 ms / p95 4848 ms | — |
| Cost (Haiku, 25 calls) | — | $0.30 total (≈$0.012/call) | — |

## Decision rationale

Both revert triggers are clear of the bar:
- **Aggregate score agreement: 100%** (no sign-flips), mean score down only ~1.4% — far below the ">5% drop" threshold.
- **Error detection: 0 regressions** — on every item where Sonnet flagged errors, Haiku flagged errors too.

→ **Ship Haiku 4.5.** The change remains revertible by restoring the single `MODEL` constant in `packages/ai/src/evaluate.ts` if a future, larger eval contradicts this.

## Follow-up (tech debt, not blocking)

`eval-export` should also copy the source trace's structured output into `expectedOutput` (or recover it from `response_json.evaluation`) so `pnpm eval`'s built-in diff isn't vacuous for evaluate traces. Until then, the Neon-recovery method above is required for a meaningful evaluate-surface gate.

## Artifacts

- Langfuse dataset: `haiku-eval-gate-20260530` (prod project), dataset run `haiku-4-5-vs-sonnet-20260530`.
- Local summary JSON: `packages/ai/eval-runs/haiku-4-5-vs-sonnet-20260530.json` (note: its built-in `score`/`cefr` fields are the vacuous zeros — the real comparison is the table above).
