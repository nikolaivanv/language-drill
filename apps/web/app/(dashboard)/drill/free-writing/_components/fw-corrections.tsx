'use client';

import React from 'react';
import type { FreeWritingEvaluationResponse } from '@language-drill/api-client';
import { reconstructMarked } from '../_lib/reconstruct';
import { MarkedProse } from './fw-prose';
import { SevTag, SEVERITY_LABELS } from './fw-atoms';

export interface FwCorrectionsProps {
  evaluation: FreeWritingEvaluationResponse;
  original: string; // the learner's submitted text
  onCompare: () => void;
  onBack: () => void;
}

export function FwCorrections({ evaluation, original, onCompare, onBack }: FwCorrectionsProps) {
  const [active, setActive] = React.useState<number | null>(
    evaluation.errors[0]?.n ?? null,
  );

  const paragraphs = React.useMemo(
    () => reconstructMarked(original, evaluation.errors, evaluation.goodSpans),
    [original, evaluation.errors, evaluation.goodSpans],
  );

  const errs = evaluation.errors;
  const counts = {
    high: errs.filter((e) => e.severity === 'high').length,
    med: errs.filter((e) => e.severity === 'med').length,
    low: errs.filter((e) => e.severity === 'low').length,
  };

  return (
    <div>
      <button
        className="btn ghost sm"
        onClick={onBack}
        style={{ marginBottom: 10 }}
      >
        ← back
      </button>
      <div className="t-micro" style={{ marginBottom: 4 }}>
        free writing · corrections
      </div>
      <div
        className="fw-corrections-head"
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <h1 className="t-display-l" style={{ margin: '2px 0 0' }}>
          {errs.length} things to fix.
        </h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <span className="fw-sev high">
            {counts.high} {SEVERITY_LABELS.high}
          </span>
          <span className="fw-sev med" style={{ marginLeft: 6 }}>
            {counts.med} {SEVERITY_LABELS.med}
          </span>
          <span className="fw-sev low" style={{ marginLeft: 6 }}>
            {counts.low} {SEVERITY_LABELS.low}
          </span>
        </div>
      </div>
      <p className="t-body" style={{ marginTop: 8, maxWidth: 640 }}>
        every error is located in your own text.{' '}
        <span className="fw-good">highlighted</span> spans are things you did well;{' '}
        <span style={{ whiteSpace: 'nowrap' }}>
          <span
            style={{
              color: 'var(--color-ink-mute)',
              textDecoration: 'line-through',
              textDecorationColor: 'var(--color-accent)',
            }}
          >
            struck
          </span>{' '}
          <span style={{ color: 'var(--color-ok)', fontWeight: 500 }}>green</span>
        </span>{' '}
        shows the fix in place.
      </p>

      <div
        className="fw-two-col"
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 360px',
          gap: 32,
          marginTop: 18,
        }}
      >
        {/* marked-up text */}
        <div className="card" style={{ padding: '30px 36px' }}>
          <div className="rv-h" style={{ marginBottom: 14 }}>
            your text · annotated
          </div>
          <MarkedProse paragraphs={paragraphs} activeErr={active} onErr={setActive} />
        </div>

        {/* error list + actions */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card" style={{ padding: '6px 18px' }}>
            {errs.map((e) => (
              <div
                key={e.n}
                className={`fw-errrow ${e.severity}`}
                onClick={() => setActive(e.n)}
                style={
                  active === e.n
                    ? {
                        background: 'var(--color-hilite-soft)',
                        borderRadius: 8,
                        margin: '0 -10px',
                        padding: '13px 10px',
                      }
                    : undefined
                }
              >
                <span className="num">{e.n}</span>
                <div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      marginBottom: 5,
                      flexWrap: 'wrap',
                    }}
                  >
                    <span className="fw-etype">{e.type}</span>
                    <SevTag sev={e.severity} />
                    {e.where && (
                      <span
                        className="t-small"
                        style={{ fontSize: 10.5, marginLeft: 'auto' }}
                      >
                        {e.where}
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      fontSize: 14,
                      fontFamily: 'var(--font-display)',
                      marginBottom: 4,
                    }}
                  >
                    <span
                      style={{
                        color: 'var(--color-ink-mute)',
                        textDecoration: 'line-through',
                        textDecorationColor: 'var(--color-accent)',
                      }}
                    >
                      {e.original}
                    </span>
                    <span style={{ color: 'var(--color-ink-mute)', margin: '0 6px' }}>
                      →
                    </span>
                    <span style={{ color: 'var(--color-ok)', fontWeight: 600 }}>
                      {e.correction}
                    </span>
                  </div>
                  <div className="t-small" style={{ fontSize: 12, lineHeight: 1.5 }}>
                    {e.note}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* radar card omitted — no per-grammar-point deltas available in Phase 1 */}

          <button className="btn primary lg" style={{ width: '100%' }} onClick={onCompare}>
            compare improved version →
          </button>
        </aside>
      </div>
    </div>
  );
}
