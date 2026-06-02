/**
 * CloudWatch Embedded Metric Format (EMF) emitter for the theory generation
 * Lambda. Emits an application-level `CellFailed` metric over the existing
 * `console.log` stdout channel — CloudWatch Logs auto-extracts EMF records
 * into metrics, so there is no blocking `PutMetricData` round-trip (Req 3.3,
 * NFR Performance).
 *
 * This is the application-failure signal, distinct from the Lambda runtime
 * `Errors` metric: a cell that `runOneTheoryCell` resolves as `status='failed'`
 * is a terminal *outcome*, not an unhandled throw. The handler wires this into
 * each terminal-result branch; the new `TheoryGenerationCellFailuresAlarm`
 * (CDK) watches the emitted metric. See the spec design Component 4.
 */

import type { TheoryCellResult } from '@language-drill/db';

const NAMESPACE = 'LanguageDrill/TheoryGeneration';
const METRIC_NAME = 'CellFailed';

/**
 * Emit a single `CellFailed` EMF data point for a terminal cell outcome.
 *
 * - `'failed'` → `CellFailed: 1` (the alarm sums these over a day).
 * - `'succeeded'` → `CellFailed: 0` — emitted deliberately so the alarm can
 *   distinguish "all-passing" from "no runs at all" rather than relying on
 *   metric absence (Req 3.2).
 * - `'skipped-cost-cap'` → no emit: a deliberate budget stop is not a failure
 *   (Req 3.1).
 *
 * The `env` dimension must match the alarm's `dimensionsMap.env` exactly
 * (`'prod'` / `'dev'`), or the alarm watches a stream nothing writes to.
 */
export function emitCellOutcomeMetric(
  status: TheoryCellResult['status'],
  env: string,
): void {
  if (status === 'skipped-cost-cap') return; // Req 3.1 — not a failure
  const value = status === 'failed' ? 1 : 0; // Req 3.1 / 3.2
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
