import { CefrLevel, READ_CEFR_TOP_RANK } from '@language-drill/shared';

// ---------------------------------------------------------------------------
// calibrationCopy — derive the user-facing strings used by the empty-view
// step 2 ("how it works" list) and the calibration strip on the annotated
// view (Requirements 3.4, 6.2).
// ---------------------------------------------------------------------------
// Pure mapping kept separate from any React tree so it stays SSR-safe and
// trivially unit-testable. Returns `null` `topRank` when the user has no
// language profile yet (Requirement 3.4 fallback).
// ---------------------------------------------------------------------------

export type CalibrationCopy = {
  eyebrow: string;
  explanation: string;
  topRank: number | null;
};

export function calibrationCopy(level: CefrLevel | null): CalibrationCopy {
  if (level === null) {
    return {
      eyebrow: 'your calibration',
      explanation: 'showing words above your current band',
      topRank: null,
    };
  }
  const topRank = READ_CEFR_TOP_RANK[level];
  return {
    eyebrow: `~${level}+ calibration`,
    explanation: `showing words rarer than top-${topRank} · refined by your known set`,
    topRank,
  };
}
