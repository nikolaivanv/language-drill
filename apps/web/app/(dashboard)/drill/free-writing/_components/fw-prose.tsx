'use client';

import type { FreeWritingImproved } from '@language-drill/shared';
import { type MarkedSegment, reconstructMarked } from '../_lib/reconstruct';

// ── MarkedProse ──────────────────────────────────────────────────────────────
// Renders paragraphs of MarkedSegment[][]. Error spans show the original
// (struck-through) + correction side-by-side, with a severity-coloured
// superscript number. Clicking an error span calls onErr(errorRef).
export function MarkedProse({
  paragraphs,
  activeErr,
  onErr,
  fontSize,
}: {
  paragraphs: MarkedSegment[][];
  activeErr?: number | null;
  onErr?: (n: number) => void;
  fontSize?: number;
}) {
  return (
    <div className="fw-prose" style={fontSize ? { fontSize } : undefined}>
      {paragraphs.map((para, pi) => (
        <p key={pi}>
          {para.map((seg, si) => {
            if ('good' in seg) {
              return (
                <span key={si} className="fw-good">
                  {seg.good}
                </span>
              );
            }
            if ('errorRef' in seg) {
              const sevCls =
                seg.severity === 'high' ? 'high' : seg.severity === 'med' ? 'med' : 'low';
              return (
                <span
                  key={si}
                  className={`fw-err ${sevCls}${activeErr === seg.errorRef ? ' active' : ''}`}
                  onClick={onErr ? () => onErr(seg.errorRef) : undefined}
                >
                  <span className="old">{seg.original}</span>
                  <span className="new">{seg.correction}</span>
                  <span className="mk">{seg.errorRef}</span>
                </span>
              );
            }
            // plain text segment
            return <span key={si}>{seg.text}</span>;
          })}
        </p>
      ))}
    </div>
  );
}

// ── ImprovedProse ────────────────────────────────────────────────────────────
// Renders the AI-improved version of the text. Upgrade substrings (good spans)
// are highlighted with the fw-add class (green background) rather than fw-good.
export function ImprovedProse({
  improved,
  fontSize,
}: {
  improved: FreeWritingImproved;
  fontSize?: number;
}) {
  const paras = reconstructMarked(improved.text, [], improved.upgrades ?? []);
  return (
    <div className="fw-prose" style={fontSize ? { fontSize } : undefined}>
      {paras.map((para, pi) => (
        <p key={pi}>
          {para.map((seg, si) => {
            if ('good' in seg) {
              // upgrade highlight — use fw-add instead of fw-good
              return (
                <span key={si} className="fw-add">
                  {seg.good}
                </span>
              );
            }
            // plain text
            return <span key={si}>{('text' in seg ? seg.text : '')}</span>;
          })}
        </p>
      ))}
    </div>
  );
}
