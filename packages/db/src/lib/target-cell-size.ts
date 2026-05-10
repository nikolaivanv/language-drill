/**
 * Returns the target pool size for a generation cell based on the cell's
 * 7-day depletion rate (exercises served per week).
 *
 * Four tiers:
 *  - High-traffic  (≥10/wk)  → 200 exercises
 *  - Medium-traffic (≥5/wk)  → 100 exercises
 *  - Low-traffic   (≥1/wk)   →  75 exercises
 *  - Idle          (<1/wk)   →  50 exercises
 *
 * Pure function — no imports, no I/O, no side effects.
 */
export function targetCellSize(depletionRate7d: number): number {
  if (depletionRate7d >= 10) return 200;
  if (depletionRate7d >= 5) return 100;
  if (depletionRate7d >= 1) return 75;
  return 50;
}
