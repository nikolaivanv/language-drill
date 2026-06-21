// ---------------------------------------------------------------------------
// Framing rules — deterministic copy generator for the dashboard header
// ---------------------------------------------------------------------------
// No Claude call: the framing paragraph is computed client-side from the
// radar snapshot via a fixed rules table. The exact strings are pinned in
// design.md §"Framing rules table" so they're testable as data.
// ---------------------------------------------------------------------------

import type { PlanReason, RadarAxis } from '@language-drill/api-client';

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

// ---------------------------------------------------------------------------
// composePlanFraming — plan-based framing (primary; radar is the fallback)
// ---------------------------------------------------------------------------

type PlanItem = { reason: PlanReason | null; grammarPointName: string | null };

/**
 * Compose a framing paragraph from the today plan items.
 *
 * Priority:
 *  1. ≥1 `error-fix` items with a named grammar point → lead on those spots.
 *  2. Majority `new` with ≥1 name → "new ground" framing.
 *  3. Majority `review` with ≥1 name → "review pass" framing.
 *  4. Generic reinforce line.
 *
 * Returns `{ paragraph, isGeneric: true }` for empty/undefined input so the
 * caller can decide to fall back to `computeFraming(axes)`.
 */
export function composePlanFraming(
  items: PlanItem[] | undefined,
): FramingResult {
  if (!items || items.length === 0) {
    return { paragraph: GENERIC_PARAGRAPH, isGeneric: true };
  }

  // Branch 1: error-fix items with named grammar points.
  const errorFixNames = [
    ...new Set(
      items
        .filter((i) => i.reason === 'error-fix' && i.grammarPointName)
        .map((i) => i.grammarPointName as string),
    ),
  ].slice(0, 2);

  if (errorFixNames.length >= 1) {
    const nameList =
      errorFixNames.length === 1
        ? errorFixNames[0]
        : `${errorFixNames[0]} and ${errorFixNames[1]}`;
    const plural = errorFixNames.length > 1 ? 's' : '';
    return {
      paragraph: `today leans into ${nameList} — your liveliest error spot${plural}.`,
    };
  }

  const total = items.length;
  const newCount = items.filter((i) => i.reason === 'new').length;
  const reviewCount = items.filter((i) => i.reason === 'review').length;

  // Branch 2: mostly new.
  if (newCount > total / 2) {
    const firstName = items.find(
      (i) => i.reason === 'new' && i.grammarPointName,
    )?.grammarPointName;
    if (firstName) {
      return { paragraph: `today breaks new ground: ${firstName}.` };
    }
  }

  // Branch 3: mostly review.
  if (reviewCount > total / 2) {
    const firstName = items.find(
      (i) => i.reason === 'review' && i.grammarPointName,
    )?.grammarPointName;
    if (firstName) {
      return { paragraph: `today is a review pass — keeping ${firstName} fresh.` };
    }
  }

  // Branch 4: generic reinforce.
  return { paragraph: GENERIC_PARAGRAPH, isGeneric: true };
}
