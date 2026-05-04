import type { CompleteSessionResponse } from '@language-drill/api-client';
import { Button, Card } from '../../../../components/ui';
import { coachMessage } from '../../../../lib/drill/coach-messages';

interface SessionSummaryProps {
  summary: CompleteSessionResponse;
  onAnother: () => void;
  onDone: () => void;
}

function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function SessionSummary({ summary, onAnother, onDone }: SessionSummaryProps) {
  const { exerciseCount, correctCount, attemptedCount, skippedCount, durationSeconds } = summary;
  const accuracy = attemptedCount > 0 ? correctCount / attemptedCount : null;
  const accuracyDisplay = accuracy === null ? '—' : `${Math.round(accuracy * 100)}%`;
  const correctLine =
    skippedCount > 0
      ? `${correctCount} of ${exerciseCount} · ${skippedCount} skipped`
      : `${correctCount} of ${exerciseCount}`;

  return (
    <Card padding="lg">
      <div className="t-meta text-ink-soft">{formatDuration(durationSeconds)}</div>
      <div className="t-h2 mt-s-2">{correctLine}</div>
      <div className="t-body mt-s-1 text-ink-soft">{accuracyDisplay}</div>
      <p className="t-body mt-s-3">
        {coachMessage({ kind: 'sessionComplete', accuracy })}
      </p>
      <div className="mt-s-4 flex gap-s-3">
        <Button variant="primary" onClick={onAnother}>another session</Button>
        <Button variant="default" onClick={onDone}>done</Button>
      </div>
    </Card>
  );
}
