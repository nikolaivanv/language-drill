/**
 * CloudWatch EMF emitter for the exercise generation Lambda. Mirrors
 * `theory-generation/metrics.ts`. Emits an application-level `CellFailed`
 * metric over `console.log` stdout — CloudWatch Logs auto-extracts EMF records
 * into metrics, so there is no blocking PutMetricData round-trip.
 *
 * This is the application-failure signal, distinct from the Lambda runtime
 * `Errors` metric: a cell that `runOneCell` resolves as `status='failed'` is a
 * terminal *outcome*, not an unhandled throw (those go to the DLQ instead). The
 * `GenerationCellFailuresAlarm` (CDK) watches the emitted metric.
 */
import type { CellResult } from '@language-drill/db';

const NAMESPACE = 'LanguageDrill/Generation';
const METRIC_NAME = 'CellFailed';
const COST_METRIC_NAME = 'CellCostUsd';

/**
 * Emit a single `CellFailed` EMF data point for a terminal cell outcome.
 * - 'failed' → 1 (the alarm sums these over a day).
 * - 'succeeded' → 0 — emitted so the alarm distinguishes "all passing" from
 *   "no runs at all".
 * - 'skipped-cost-cap' → no emit: a deliberate budget stop is not a failure.
 *
 * The `env` dimension must match the alarm's `dimensionsMap.env`
 * ('prod' / 'dev'), or the alarm watches a stream nothing writes to.
 */
export function emitCellOutcomeMetric(
  status: CellResult['status'],
  env: string,
): void {
  if (status === 'skipped-cost-cap') return;
  const value = status === 'failed' ? 1 : 0;
  console.log(
    JSON.stringify({
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [
          {
            Namespace: NAMESPACE,
            Dimensions: [['env']],
            Metrics: [{ Name: METRIC_NAME }],
          },
        ],
      },
      env,
      [METRIC_NAME]: value,
    }),
  );
}

/**
 * Emit a single `CellCostUsd` EMF data point for a cell's Anthropic spend, so
 * CloudWatch can alarm on the daily SUM (`GenerationDailyCostAlarm`). This is
 * the only place the pipeline's own `estimateCostUsd` figure becomes an
 * observable metric — `generation_jobs.cost_usd_estimate` is written per job
 * but read by nothing, which is why the 2026-07-07 $117 overspend fired no
 * alert. Emitted for EVERY terminal outcome (including `failed` and
 * `skipped-cost-cap`): the caller passes the cost derived from the result's
 * accumulated `tokenUsage`, so a failed cell that already burned tokens still
 * contributes its spend (a zero-usage skip emits 0, harmless).
 *
 * The `env` dimension must match the alarm's `dimensionsMap.env`
 * ('prod' / 'dev'), or the alarm watches a stream nothing writes to.
 */
export function emitCellCostMetric(costUsd: number, env: string): void {
  console.log(
    JSON.stringify({
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [
          {
            Namespace: NAMESPACE,
            Dimensions: [['env']],
            Metrics: [{ Name: COST_METRIC_NAME, Unit: 'None' }],
          },
        ],
      },
      env,
      [COST_METRIC_NAME]: costUsd,
    }),
  );
}
