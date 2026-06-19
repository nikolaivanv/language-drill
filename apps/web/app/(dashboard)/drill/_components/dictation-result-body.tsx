import { Card, Chip } from '../../../../components/ui';
import type { DictationResult } from '@language-drill/shared';

/**
 * Presentational body for a graded dictation result — the accuracy line, the
 * colored diff prose, the per-difference cards, and the criteria rows. Shared
 * by the live results view (`DictationResults`, inside its FeedbackShell) and
 * the post-session debrief renderer (`DictationBody`), so the two surfaces
 * can't drift. Pure: the only prop is the result.
 */
export function DictationResultBody({ result }: { result: DictationResult }) {
  return (
    <div className="flex flex-col gap-s-4">
      {result.summary && <p className="t-body">{result.summary}</p>}
      <p className="t-small text-ink-mute">
        raw {Math.round(result.rawCharAccuracy * 100)}% → adjusted{' '}
        {Math.round(result.adjustedCharAccuracy * 100)}% ·{' '}
        {Math.round(result.wordAccuracy * 100)}% words
      </p>

      <p className="t-body leading-loose">
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
              <span className="line-through text-ink-mute">{seg.got}</span>{' '}
              <span className="text-[var(--color-ok)]">{seg.expected}</span>{' '}
            </span>
          );
        })}
      </p>

      {result.differences.length > 0 && (
        <div className="flex flex-col gap-s-2">
          {result.differences.map((d) => (
            <Card key={d.id} padding="sm">
              <div className="flex flex-wrap items-center gap-s-2">
                <Chip>{d.category}</Chip>
                <span className="t-mono t-small">
                  <span className="line-through text-ink-mute">
                    {d.got || '∅'}
                  </span>{' '}
                  → <span className="text-[var(--color-ok)]">{d.expected}</span>
                </span>
                <Chip>{d.kind === 'accepted' ? 'aceptado' : d.severity}</Chip>
              </div>
              <p className="t-small text-ink-soft mt-s-2">{d.note}</p>
            </Card>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-s-1">
        {result.criteria.map((c) => (
          <div key={c.id} className="flex items-baseline gap-s-2 t-small">
            <span className="flex-1">{c.label}</span>
            <span className="t-mono text-ink-mute">
              {Math.round(c.score * 100)}%
            </span>
            <Chip>{c.cefr}</Chip>
          </div>
        ))}
      </div>
    </div>
  );
}
