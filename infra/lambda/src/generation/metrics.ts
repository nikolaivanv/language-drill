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
