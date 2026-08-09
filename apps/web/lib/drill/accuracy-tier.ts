// Accuracy tiers for the CONJUGATION practice recap only.
//
// The main session debrief is movement-keyed (see lib/drill/movement-summary.ts):
// accuracy drives nothing adaptive there, and putting a percentage beside a
// mastery verdict is what let "you got 5 of 5 · accuracy 100%" sit above a
// "slipped" row. Conjugation practice is client-local and tracks no mastery, so
// accuracy is the only signal it has — hence this survives, scoped to it.
//
// Tier boundaries:
//   accuracy >= 0.8        → 'high' → "nice work."
//   0.5 <= accuracy < 0.8  → 'mid'  → "good attempt."
//   accuracy < 0.5         → 'low'  → "back next time?"
//   attemptedCount <= 0    → 'low'  (no-items fallback)

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
