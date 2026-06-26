'use client';

import type { FreeWritingEvaluationResponse } from '@language-drill/api-client';
import { CEFRBadge, CriterionRow } from './fw-atoms';

export interface FwResultsProps {
  evaluation: FreeWritingEvaluationResponse;
  onCorrections: () => void;
  onCompare: () => void;
  onAnother: () => void;
}

const WHAT_THIS_FEEDS = [
  'Writing CEFR',
  'grammar radar',
  'vocab depth',
  'pragmatics',
  'IELTS / DELE readiness',
];

export function FwResults({ evaluation, onCorrections, onCompare, onAnother }: FwResultsProps) {
  const avg =
    evaluation.criteria.reduce((s, c) => s + c.score, 0) / evaluation.criteria.length;

  return (
    <div>
      {/* Header microcopy */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 14,
        }}
      >
        <div className="t-micro">free writing · graded</div>
      </div>

      {/* Two-column layout */}
      <div
        style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 32 }}
        className="fw-brief-grid"
      >
        {/* ── Left column — scorecard ─────────────────────────────────────── */}
        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'space-between',
              gap: 16,
            }}
          >
            <div>
              <div className="t-micro">overall · estimated writing level</div>
              <h1 className="t-display-l" style={{ margin: '4px 0 0', maxWidth: 560 }}>
                {evaluation.headline}
              </h1>
            </div>
            <div style={{ textAlign: 'center', flexShrink: 0 }}>
              <CEFRBadge level={evaluation.overallCefr} lg />
              <div
                className="t-mono"
                style={{ fontSize: 11, color: 'var(--color-ink-mute)', marginTop: 6 }}
              >
                {avg.toFixed(2)} avg
              </div>
            </div>
          </div>

          <p className="t-body-l" style={{ marginTop: 14, maxWidth: 620 }}>
            {evaluation.summary}
          </p>

          {/* Criteria card */}
          <div className="card" style={{ marginTop: 22, padding: '8px 24px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '14px 0 4px',
              }}
            >
              <div className="rv-h">criteria · IELTS-style · 0–1 + CEFR</div>
            </div>
            {evaluation.criteria.map((c) => (
              <CriterionRow key={c.id} c={c} />
            ))}
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 22 }}>
            <button className="btn primary lg" onClick={onCorrections}>
              see corrections →
            </button>
            <button className="btn lg" onClick={onCompare}>
              compare improved version
            </button>
            <button className="btn ghost lg" style={{ marginLeft: 'auto' }} onClick={onAnother}>
              write another
            </button>
          </div>
        </div>

        {/* ── Right rail — "what this feeds" ──────────────────────────────── */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card" style={{ padding: 18, background: 'var(--color-paper-2)' }}>
            <div className="rv-h" style={{ marginBottom: 10 }}>
              what this feeds
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
              {WHAT_THIS_FEEDS.map((label) => (
                <span key={label} className="chip">
                  {label}
                </span>
              ))}
            </div>
            <div
              className="t-small"
              style={{ fontSize: 12, lineHeight: 1.55, color: 'var(--color-ink-soft)' }}
            >
              a paragraph touches grammar, vocabulary, discourse and register at once — the
              richest signal in the app.
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
