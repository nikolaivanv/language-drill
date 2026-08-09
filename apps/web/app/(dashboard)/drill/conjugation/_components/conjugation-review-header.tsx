import { accuracyTier, TIER_TITLE } from '../../../../../lib/drill/accuracy-tier';

// Header for the conjugation practice recap. Deliberately NOT the debrief
// header: that one reports skill movement, and conjugation practice is
// client-local with no mastery data to report. Accuracy is the only signal
// this surface has. No percentage is rendered — the tier carries the verdict.

export interface ConjugationReviewHeaderProps {
  correctCount: number;
  totalCount: number;
  durationSeconds: number;
}

/** `m:ss` — minutes unpadded, seconds zero-padded. */
function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function ConjugationReviewHeader({
  correctCount,
  totalCount,
  durationSeconds,
}: ConjugationReviewHeaderProps) {
  const title = TIER_TITLE[accuracyTier(correctCount, totalCount)];

  return (
    <header>
      <div className="t-micro">session done · {formatDuration(durationSeconds)}</div>
      <h1 className="t-display-xl mt-s-1">{title}</h1>
      <p className="t-body-l mt-s-3">you got {correctCount} of {totalCount}</p>
    </header>
  );
}
