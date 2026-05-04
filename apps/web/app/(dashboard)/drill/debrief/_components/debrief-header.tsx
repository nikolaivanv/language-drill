import type { DebriefResponse } from '@language-drill/api-client';
import {
  accuracyTier,
  TIER_TITLE,
} from '../../../../../lib/drill/accuracy-tier';

// Editorial header for the post-session debrief screen. Eyebrow + tier-keyed
// display title + accuracy summary. All copy lowercase per Req 3.7.

export interface DebriefHeaderProps {
  debrief: DebriefResponse;
}

/**
 * `m:ss` — minutes are unpadded, seconds are zero-padded. Examples:
 *   0     → "0:00"
 *   5     → "0:05"
 *   60    → "1:00"
 *   3601  → "60:01"
 */
function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function DebriefHeader({ debrief }: DebriefHeaderProps) {
  const {
    correctCount,
    attemptedCount,
    exerciseCount,
    skippedCount,
    durationSeconds,
  } = debrief;

  const tier = accuracyTier(correctCount, attemptedCount);
  const title = TIER_TITLE[tier];

  const accuracyDisplay =
    attemptedCount > 0
      ? `${Math.round((correctCount / attemptedCount) * 100)}%`
      : '—';

  // Body line: "you got X of Y · accuracy Z%[ · N skipped]" (Req 3.1, 3.5)
  const bodyParts = [
    `you got ${correctCount} of ${exerciseCount}`,
    `accuracy ${accuracyDisplay}`,
  ];
  if (skippedCount > 0) {
    bodyParts.push(`${skippedCount} skipped`);
  }
  const bodyLine = bodyParts.join(' · ');

  return (
    <header>
      <div className="t-micro">session done · {formatDuration(durationSeconds)}</div>
      <h1 className="t-display-xl mt-s-1">{title}</h1>
      <p className="t-body-l mt-s-3">{bodyLine}</p>
    </header>
  );
}
