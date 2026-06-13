'use client';

import type { FluencyStatsResponse } from '@language-drill/api-client';

export interface FluencyTabProps {
  data: FluencyStatsResponse | undefined;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
}

function fmtSeconds(ms: number | null): string {
  return ms === null ? '—' : `${(ms / 1000).toFixed(1)}s`;
}

export function FluencyTab({ data, isLoading, error, onRetry }: FluencyTabProps) {
  if (isLoading) return <p className="t-body">loading…</p>;
  if (error) {
    return (
      <div className="flex flex-col gap-s-2">
        <p className="t-body">couldn't load fluency stats.</p>
        <button type="button" className="t-small underline self-start" onClick={onRetry}>
          retry
        </button>
      </div>
    );
  }
  if (!data || data.totalAttempts === 0) {
    return (
      <p className="t-body text-ink-mute">
        no fluency drills yet — run a timed session from the drill page to start tracking how
        fast you produce things you already know.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-s-4" style={{ marginTop: 16 }}>
      <div className="flex flex-col gap-s-1">
        <p className="t-display-m">{fmtSeconds(data.overallMedianLatencyMs)}</p>
        <p className="t-small text-ink-mute">
          median response time · {Math.round(data.overallAccuracy * 100)}% accurate ·{' '}
          {data.totalAttempts} timed answers
        </p>
      </div>
      <div className="flex flex-col gap-s-2">
        <p className="t-small text-ink-mute">weekly median (most recent last)</p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          {data.weeks.map((w) => (
            <div key={w.weeksAgo} style={{ textAlign: 'center' }}>
              <div
                aria-hidden
                style={{
                  width: 18,
                  height: w.medianLatencyMs ? Math.min(120, w.medianLatencyMs / 50) : 2,
                  background: 'var(--color-ink-soft)',
                }}
              />
              <span className="t-small text-ink-mute">{fmtSeconds(w.medianLatencyMs)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
