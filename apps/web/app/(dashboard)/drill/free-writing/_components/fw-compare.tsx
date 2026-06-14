'use client';

import React from 'react';
import type { FreeWritingEvaluationResponse } from '@language-drill/api-client';
import { reconstructMarked } from '../_lib/reconstruct';
import { MarkedProse, ImprovedProse } from './fw-prose';
import { CEFRBadge } from './fw-atoms';

export interface FwCompareProps {
  evaluation: FreeWritingEvaluationResponse;
  original: string;
}

// ── ChangeCard ────────────────────────────────────────────────────────────────
function ChangeCard({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="rv-h" style={{ marginBottom: 10 }}>{title}</div>
      <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 7 }}>
        {items.map((it) => (
          <li key={it} style={{ fontSize: 12.5, color: 'var(--color-ink-2)', display: 'flex', gap: 7, alignItems: 'baseline' }}>
            <span style={{ color: 'var(--color-ok)', flexShrink: 0 }}>↗</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── FwCompare ─────────────────────────────────────────────────────────────────
export function FwCompare({ evaluation, original }: FwCompareProps) {
  const yours = React.useMemo(
    () => reconstructMarked(original, evaluation.errors, evaluation.goodSpans),
    [original, evaluation.errors, evaluation.goodSpans],
  );

  // Derive "what changed" list from real evaluation errors
  const corrections = evaluation.errors.map(
    (e) => `${e.original} → ${e.correction}`,
  );

  return (
    <div>
      <div className="t-micro" style={{ marginBottom: 4 }}>free writing · compare</div>
      <h1 className="t-display-l" style={{ margin: '2px 0 6px' }}>yours, then better.</h1>
      <p className="t-body" style={{ marginTop: 0, maxWidth: 660 }}>
        the same argument with corrections applied and the language lifted. <span className="fw-add">green</span> marks every upgrade — a sharper verb, a tighter connector, a more precise collocation.
      </p>

      <div className="fw-compare" style={{ marginTop: 20 }}>
        {/* original — annotated */}
        <div className="col">
          <div className="head">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="rv-h" style={{ marginBottom: 0 }}>your text</span>
              <CEFRBadge level={evaluation.overallCefr} />
            </div>
            <span
              className="t-mono"
              style={{ fontSize: 11, color: 'var(--color-ink-mute)' }}
            >
              {evaluation.wordCount} words
            </span>
          </div>
          <div className="body">
            <MarkedProse paragraphs={yours} fontSize={17} />
          </div>
        </div>

        {/* improved */}
        <div className="col improved">
          <div className="head">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="rv-h" style={{ marginBottom: 0, color: 'var(--color-ink)' }}>
                improved
              </span>
            </div>
            <span
              className="t-mono"
              style={{ fontSize: 11, color: 'var(--color-ink-soft)' }}
            >
              {evaluation.improvedWordCount} words
            </span>
          </div>
          <div className="body">
            <ImprovedProse improved={evaluation.improved} fontSize={17} />
          </div>
        </div>
      </div>

      {/* what changed — derived from real errors */}
      {corrections.length > 0 ? (
        <div style={{ marginTop: 18 }}>
          <ChangeCard title="corrections" items={corrections} />
        </div>
      ) : (
        <p
          className="t-small"
          style={{ marginTop: 18, color: 'var(--color-ink-mute)' }}
        >
          no corrections needed
        </p>
      )}
    </div>
  );
}
