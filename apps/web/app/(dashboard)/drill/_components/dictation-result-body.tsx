import type {
  DictationDifference,
  DictationResult,
} from '@language-drill/shared';

/** Pill treatment for a difference's severity tag (prototype `.corr-sev`). */
function severityPill(d: DictationDifference): { label: string; cls: string } {
  if (d.kind === 'accepted') {
    return { label: 'aceptado', cls: 'bg-ok-soft text-ok' };
  }
  if (d.severity === 'high') {
    return { label: 'high', cls: 'bg-accent-soft text-accent-2' };
  }
  if (d.severity === 'low') {
    return { label: 'low', cls: 'bg-hilite-soft text-[#8a6d1f]' };
  }
  return { label: d.severity ?? '', cls: 'bg-paper-3 text-ink-2' };
}

/**
 * Presentational body for a graded dictation result — the accuracy line, the
 * colored diff prose, the per-difference cards, and the criteria rows. Shared
 * by the live results view (`DictationResults`, inside its FeedbackShell) and
 * the post-session debrief renderer (`DictationBody`), so the two surfaces
 * can't drift. Pure: the only prop is the result.
 */
export function DictationResultBody({ result }: { result: DictationResult }) {
  return (
    <div className="flex flex-col gap-s-5">
      {result.summary && <p className="t-body-l text-ink-2">{result.summary}</p>}
      <p className="t-mono text-[12px] tracking-[0.3px] text-ink-mute">
        raw {Math.round(result.rawCharAccuracy * 100)}%{' '}
        <span className="text-rule-strong">→</span> adjusted{' '}
        {Math.round(result.adjustedCharAccuracy * 100)}% ·{' '}
        {Math.round(result.wordAccuracy * 100)}% words
      </p>

      {/* Corrected sentence — set in the display serif (prototype `.dict-diff`). */}
      <p
        className="text-ink"
        style={{ fontFamily: 'var(--font-display)', fontSize: 22, lineHeight: 1.45 }}
      >
        {result.diff.map((seg, i) => {
          if (seg.kind === 'match') {
            return <span key={i}>{seg.text} </span>;
          }
          if (seg.kind === 'accepted') {
            return (
              <span
                key={i}
                className="border-b-2 border-dotted border-[var(--color-ok)]"
              >
                {seg.got}{' '}
              </span>
            );
          }
          // error segment
          return (
            <span key={i}>
              <span className="text-ink-mute line-through decoration-2">
                {seg.got}
              </span>{' '}
              <span className="font-semibold text-ok">{seg.expected}</span>{' '}
            </span>
          );
        })}
      </p>

      {result.differences.length > 0 && (
        <div className="flex flex-col gap-s-3">
          {result.differences.map((d) => {
            const sev = severityPill(d);
            return (
              <div key={d.id} className="rounded-md border border-rule p-s-4">
                <div className="flex flex-wrap items-center gap-s-2">
                  <span className="rounded-pill bg-paper-2 px-[12px] py-[5px] text-[12px] font-semibold text-ink-2">
                    {d.category}
                  </span>
                  <span className="t-mono inline-flex items-center gap-[9px] text-[14px]">
                    <span className="text-ink-mute line-through decoration-2">
                      {d.got || '∅'}
                    </span>
                    <span aria-hidden className="text-ink-mute">
                      →
                    </span>
                    <span className="text-ok">{d.expected}</span>
                  </span>
                  <span
                    className={`ml-auto rounded-pill px-[13px] py-[5px] text-[11px] font-semibold tracking-[0.4px] ${sev.cls}`}
                  >
                    {sev.label}
                  </span>
                </div>
                <p className="mt-s-3 text-[14px] leading-relaxed text-ink-soft">
                  {d.note}
                </p>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-col">
        {result.criteria.map((c) => (
          <div
            key={c.id}
            className="flex items-center gap-s-4 border-t border-rule py-s-3 first:border-t-0"
          >
            <span className="flex-1 text-[15px] text-ink-2">{c.label}</span>
            <span className="t-mono text-[14px] text-ink-mute">
              {Math.round(c.score * 100)}%
            </span>
            <span className="rounded-pill bg-paper-3 px-[10px] py-[4px] text-[12px] font-semibold text-ink-2">
              {c.cefr}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
