'use client';

import type { ErrorTrendsResponse, ErrorTrendTheme } from '@language-drill/api-client';
import { Card } from '../../../../components/ui/card';

// ---------------------------------------------------------------------------
// HistoryTab — error-resolution view for the History tab on /progress.
// Renders per-theme: grammar-point name, slip sample, weekly sparkline,
// and a status line (recurring / improving / quiet).
// Design reference: design.md §"Component 8 — HistoryTab"
// ---------------------------------------------------------------------------

export interface HistoryTabProps {
  data: ErrorTrendsResponse | undefined;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
}

function statusLine(t: ErrorTrendTheme): string {
  if (t.status === 'improving') {
    return `improving · ${t.fromRatePct}% → ${t.toRatePct}% error rate`;
  }
  if (t.status === 'quiet') {
    return `quiet · no slips in ${t.quietWeeks} week${t.quietWeeks === 1 ? '' : 's'}`;
  }
  if (t.status === 'dormant') {
    return `dormant · not drilled in ${t.quietWeeks} week${t.quietWeeks === 1 ? '' : 's'}`;
  }
  return `still recurring · last seen ${t.lastSeenDaysAgo}d ago`;
}

function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  return (
    <div aria-hidden style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 18 }}>
      {values.map((v, i) => (
        <div
          key={i}
          style={{
            width: 4,
            height: `${Math.max(2, (v / max) * 18)}px`,
            background: v > 0 ? 'var(--color-accent)' : 'var(--color-rule)',
          }}
        />
      ))}
    </div>
  );
}

function themeLabel(t: ErrorTrendTheme): string {
  return t.grammarPointName ?? t.grammarPointKey ?? `${t.errorType} errors`;
}

export function HistoryTab({ data, isLoading, error, onRetry }: HistoryTabProps) {
  if (isLoading) return <p className="t-body">loading…</p>;
  if (error) {
    return (
      <div className="flex flex-col gap-s-2">
        <p className="t-body">couldn&apos;t load error history.</p>
        <button type="button" className="t-small underline self-start" onClick={onRetry}>
          retry
        </button>
      </div>
    );
  }

  const themes = data?.themes ?? [];

  if (themes.length === 0) {
    return (
      <div style={{ marginTop: 28 }}>
        <Card padding="lg" className="text-center">
          <div className="t-small" style={{ color: 'var(--color-ink-mute)' }}>
            no recurring errors yet — keep drilling and this fills in.
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 28, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p className="t-micro">are you fixing these?</p>
      {themes.map((t) => (
        <Card key={`${t.grammarPointKey ?? '∅'}:${t.errorType}`} padding="md">
          <div className="flex items-baseline justify-between gap-s-3">
            <span className="text-[14px] font-medium">{themeLabel(t)}</span>
            <span className="t-mono text-[12px] text-ink-soft">
              {t.sample.wrongText} → {t.sample.correction}
            </span>
          </div>
          <div className="mt-s-2 flex items-center justify-between gap-s-3">
            <Sparkline values={t.weeklyErrors} />
            <span className="t-micro text-ink-soft">{statusLine(t)}</span>
          </div>
        </Card>
      ))}
    </div>
  );
}
