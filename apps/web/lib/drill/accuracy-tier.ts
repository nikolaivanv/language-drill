// Single source of truth for the three header tiers used on the post-session
// debrief screen. Reused by the header (title), the Debrief tab narrative, and
// the what's-next router (high → /progress, else → /drill).
//
// Tier boundaries match Req 3.2–3.4:
//   accuracy ≥ 0.8           → 'high' → "nice work."
//   0.5 ≤ accuracy < 0.8     → 'mid'  → "good attempt."
//   accuracy < 0.5           → 'low'  → "back next time?"
//   attemptedCount ≤ 0       → 'low'  (all-skipped fallback)

export type AccuracyTier = 'high' | 'mid' | 'low';

export function accuracyTier(
  correctCount: number,
  attemptedCount: number,
): AccuracyTier {
  if (attemptedCount <= 0) return 'low';
  const ratio = correctCount / attemptedCount;
  if (ratio >= 0.8) return 'high';
  if (ratio >= 0.5) return 'mid';
  return 'low';
}

export const TIER_TITLE: Record<AccuracyTier, string> = {
  high: 'nice work.',
  mid: 'good attempt.',
  low: 'back next time?',
};
