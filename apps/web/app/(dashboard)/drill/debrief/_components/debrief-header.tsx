import type { DebriefResponse } from '@language-drill/api-client';
import { movementSummary } from '../../../../../lib/drill/movement-summary';

// Editorial header for the post-session debrief screen. Eyebrow + movement-keyed
// display title + movement subline + a muted factual line. All copy lowercase.
//
// The title reports what the session did to the learner's SKILLS, not what
// fraction of items were right: accuracy is binary at CORRECT_THRESHOLD while
// mastery is continuous, so an accuracy-keyed title could read "nice work ·
// 100%" directly above a "slipped" row in the panel below.

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
  const { exerciseCount, skippedCount, durationSeconds, skillMovements, attemptedCount } =
    debrief;

  const { title, subline } = movementSummary(skillMovements, attemptedCount);

  // Factual, verdict-free. Skips need somewhere to be accounted for.
  const factualLine =
    skippedCount > 0
      ? `${exerciseCount} items · ${skippedCount} skipped`
      : `${exerciseCount} items`;

  return (
    <header>
      <div className="t-micro">session done · {formatDuration(durationSeconds)}</div>
      <h1 className="t-display-xl mt-s-1">{title}</h1>
      <p className="t-body-l mt-s-3">{subline}</p>
      <p className="t-micro text-ink-soft mt-s-2">{factualLine}</p>
    </header>
  );
}
