'use client';

import { Card } from '../../../../components/ui';
import {
  summarizeFluency,
  formatSeconds,
  type FluencyItemResult,
} from './fluency-metrics';

export interface FluencyDebriefProps {
  results: FluencyItemResult[];
  onRestart: () => void;
}

// End-of-session debrief: headline speed/accuracy metrics for this session, plus
// a scannable per-item recap. All computed client-side from the runner's
// accumulated results — no extra API call. The weekly latency trend lives on the
// progress page.
export function FluencyDebrief({ results, onRestart }: FluencyDebriefProps) {
  const summary = summarizeFluency(results);

  if (summary.count === 0) {
    return (
      <div className="flex flex-col gap-s-3">
        <h1 className="t-display-s">nice — that was fast</h1>
        <p className="t-body text-ink-mute">
          Your latency trend is on the progress page → fluency tab.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-s-5">
      <div className="flex flex-col gap-s-2">
        <h1 className="t-display-s">nice — that was fast</h1>
        <p className="t-display-m">{formatSeconds(summary.medianLatencyMs)}</p>
        <p className="t-small text-ink-mute">
          median this session · {summary.correctCount}/{summary.count} correct · fastest{' '}
          {formatSeconds(summary.fastestMs)} · slowest {formatSeconds(summary.slowestMs)}
        </p>
        <p className="t-small text-ink-mute">
          Your latency trend is on the progress page → fluency tab.
        </p>
      </div>

      <ul className="flex flex-col gap-s-2">
        {results.map((r) => (
          <li key={r.index}>
            <Card
              padding="md"
              className={r.correct ? 'bg-[var(--color-ok-soft)]' : 'bg-[var(--color-accent-soft)]'}
            >
              <div className="flex flex-col gap-s-1">
                <div className="flex items-center justify-between gap-s-3">
                  <span className="t-body">
                    <span aria-hidden="true">{r.correct ? '✓' : '✗'}</span> {r.promptLabel}
                  </span>
                  <span className="t-small text-ink-mute">{formatSeconds(r.latencyMs)}</span>
                </div>
                <p className="t-small text-ink-mute">
                  you: {r.userAnswer}
                  {!r.correct && <> · answer: {r.correctAnswer}</>}
                </p>
              </div>
            </Card>
          </li>
        ))}
      </ul>

      <button
        type="button"
        className="t-small self-start text-ink-mute underline underline-offset-2 hover:text-ink"
        onClick={onRestart}
      >
        drill again
      </button>
    </div>
  );
}
