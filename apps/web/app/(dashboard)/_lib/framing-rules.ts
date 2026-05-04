// ---------------------------------------------------------------------------
// Framing rules — deterministic copy generator for the dashboard header
// ---------------------------------------------------------------------------
// No Claude call: the framing paragraph is computed client-side from the
// radar snapshot via a fixed rules table. The exact strings are pinned in
// design.md §"Framing rules table" so they're testable as data.
// ---------------------------------------------------------------------------

import type { RadarAxis } from '@language-drill/api-client';

const GENERIC_PARAGRAPH =
  'a balanced session — production first, then a vocabulary rep.';
const MAINTENANCE_PARAGRAPH =
  'a maintenance session — your shape is in good order, today is just to keep it that way.';

export type FramingResult = { paragraph: string; isGeneric?: true };

/**
 * Pick the axis with the lowest `currentMastery` among those with at least
 * one evidence point. Ties broken by `key.localeCompare` for stability.
 * Returns `null` when `axes` is undefined or no axis qualifies.
 */
export function pickWeakestAxis(
  axes: RadarAxis[] | undefined,
): RadarAxis | null {
  if (!axes) return null;
  const qualified = axes.filter((a) => a.evidenceCount >= 1);
  if (qualified.length === 0) return null;
  return qualified.reduce((min, a) => {
    if (a.currentMastery < min.currentMastery) return a;
    if (a.currentMastery > min.currentMastery) return min;
    return a.key.localeCompare(min.key) < 0 ? a : min;
  });
}

/**
 * Choose the framing paragraph for the dashboard header.
 *
 *   - axes undefined OR no axis with evidence → generic line (Req 2 §4)
 *   - weakest.currentMastery < 0.5            → "leans into production" line
 *   - weakest.currentMastery in [0.5, 0.7)    → "soft spot" line
 *   - every practised axis ≥ 0.7              → maintenance line
 */
export function computeFraming(
  axes: RadarAxis[] | undefined,
): FramingResult {
  const weakest = pickWeakestAxis(axes);
  if (!weakest) return { paragraph: GENERIC_PARAGRAPH, isGeneric: true };

  if (weakest.currentMastery < 0.5) {
    return {
      paragraph: `your ${weakest.label} is the weakest right now. today's plan leans into production, not recognition — a few reps where you have to type, not pick.`,
    };
  }
  if (weakest.currentMastery < 0.7) {
    return {
      paragraph: `your ${weakest.label} is the soft spot. we'll squeeze in one extra rep there today.`,
    };
  }
  return { paragraph: MAINTENANCE_PARAGRAPH };
}
