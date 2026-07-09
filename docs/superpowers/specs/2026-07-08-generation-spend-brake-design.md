# Generation spend brake + alarm

**Date:** 2026-07-08
**Tech-debt entry:** "No brake or alert on Anthropic API spend in the scheduled generation path" (`docs/tech-debt.md`)
**Scope:** Items 2 (run-level ceiling) + 3 (Anthropic-cost metric & alarm). Items 1 (per-cell cap) and 4 (Anthropic-console alert) remain open follow-ups.

## Problem

The 2026-07-07 ES curriculum initial fill enqueued 187 cells in one nightly run and spent ~$117 against the Anthropic account, draining the credit balance to $0.61, with zero alerts at any layer. Two gaps caused it:

1. **No run-level ceiling** — nothing limits how many cells one scheduler tick enqueues.
2. **Anthropic spend is invisible** — AWS Budgets / Cost Anomaly Detection see AWS spend only; the only generation CloudWatch metric is `CellFailed`, and all 187 jobs *succeeded*. Per-job `cost_usd_estimate` is written to `generation_jobs` and read by nothing.

(The per-cell `maxCostUsd` that already travels in every SQS message is decorative — `runOneCell` never compares against it. That is Item 1, left as a follow-up: with the current three-pool fan-out architecture a single cell is bounded by `count` anyway, so the per-cell overshoot — avg $0.63 vs $0.50 cap — is minor next to the 187-cell fan-out.)

## Design

### 1. Run-level cell-count ceiling (the brake)

`infra/lambda/src/generation/scheduler.ts`, after the per-cell decision loop builds `undersized` and before SQS messages are built:

- Cap = `process.env.SCHEDULER_MAX_CELLS_PER_RUN` parsed as a positive int, else `DEFAULT_MAX_CELLS_PER_RUN = 60`.
- If `undersized.length > cap`: sort by `need` descending, tie-break `cellKey` ascending, `slice(0, cap)`. Emptiest cells fill first; deterministic tie-break keeps it stable.
- Emit a structured log line with `enqueuedThisRun`, `deferredCount`, `cap` when anything is deferred ("Log what was deferred").
- **No persistence.** Deferred cells are still under-target next night → re-enumerated and enqueued, capped again. A ~187-cell initial fill self-spreads over ~4 nights (`ceil(187/60)`).
- The slice happens on `undersized` *before* the coverage-targets `.map()`, so capping composes with the Phase-2 coverage controller (capped cells are never mapped).

Wiring: optional `maxCellsPerRun?: number` prop on `SchedulerLambdaConstruct` → injected as the `SCHEDULER_MAX_CELLS_PER_RUN` env var. Stack passes nothing → code default 60. Changing it is a one-line CDK deploy (env-var change still needs a deploy, but no logic edit).

### 2. Anthropic-cost CloudWatch metric

`emitCellCostMetric(costUsd, env)` in `infra/lambda/src/generation/metrics.ts` (sibling of `emitCellOutcomeMetric`): EMF record, namespace `LanguageDrill/Generation`, metric `CellCostUsd`, dimension `env`. Called from the handler right after `emitCellOutcomeMetric`, using `estimateCostUsd(result.tokenUsage)` — derived from `tokenUsage` (not `result.costUsd`) so **failed** cells' spend is captured (`failClosed` returns `costUsd: 0` but carries the real `tokenUsage`). `skipped-cost-cap` / precheck-fail carry `ZERO_USAGE` → emits 0, harmless.

### 3. Daily-cost alarm

`infra/lib/constructs/generation-lambda.ts`, alongside `GenerationCellFailuresAlarm` (reusing the same `langfuseEnv` dimension and `alarmTopic` SNS action): `dailyCostAlarm` on metric `CellCostUsd`, `statistic=Sum`, `period=1 day`, threshold from new prop `dailyCostAlarmUsd?: number` (default 50), `GREATER_THAN_THRESHOLD`, `treatMissingData=NOT_BREACHING`. Stack passes nothing → default 50. At the 60-cell cap (~$38 expected max/night) $50 gives headroom over a full-cap night while still catching a runaway.

## Tests

- `scheduler.test.ts`: over-cap run slices to N; most-undersized enqueued first; deferred count logged; env-var override respected; at/under cap → no slicing.
- `metrics.test.ts`: `emitCellCostMetric` EMF shape (namespace, metric name, env dimension, value); failed cell emits non-zero cost from `tokenUsage`.
- `generation-lambda.test.ts` / CDK snapshot: new alarm present with correct namespace/statistic/threshold and SNS action.

## Out of scope (follow-ups, keep tech-debt entry open)

- Item 1 — enforce per-cell `maxCostUsd` inside `runOneCell` (mirror the outcome pool's `earlyBailed` circuit breaker for cost).
- Item 4 — Anthropic-console account-level spend alert (manual dashboard step).
