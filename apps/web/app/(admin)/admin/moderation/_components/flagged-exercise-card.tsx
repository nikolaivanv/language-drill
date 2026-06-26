import { formatReason, type GenerationReason } from '@language-drill/shared';
import type { FlaggedExercise } from '@language-drill/api-client';
import { Button } from '../../../../../components/ui';
import { ContentFieldView } from '../../../../../components/admin/content-field-view';
import { LangfuseTracesLink } from '../../../../../components/admin/langfuse-traces-link';
import { cellKeyFor } from '../../../../../lib/admin/langfuse';

export function FlaggedExerciseCard({
  item, onResolve, pending, demoted,
}: {
  item: FlaggedExercise;
  onResolve: (action: 'approve' | 'reject') => void;
  pending: boolean;
  demoted: boolean;
}) {
  return (
    <div className="border border-rule rounded-sm p-4 flex flex-col gap-3 bg-paper">
      <div className="flex items-center gap-2 text-[13px] text-ink-soft flex-wrap">
        <span className="font-medium text-ink">{item.type}</span>
        <span>· {item.language}</span>
        <span>· {item.level}</span>
        <span>· {item.grammarPointKey}</span>
        {item.qualityScore !== null ? <span>· q={item.qualityScore.toFixed(2)}</span> : null}
      </div>
      <div className="flex gap-2 flex-wrap">
        {item.flaggedReasons.map((r, i) => (
          <span key={i} className="text-[12px] bg-paper-2 text-ink px-2 py-px rounded-full">
            ⚠ {formatReason(r as GenerationReason)}
          </span>
        ))}
      </div>
      <LangfuseTracesLink
        cellKey={cellKeyFor({
          language: item.language,
          level: item.level,
          type: item.type,
          grammarPoint: item.grammarPointKey,
        })}
      />
      <ContentFieldView content={item.contentJson} />
      {demoted ? (
        <p className="text-[12px] text-ink-soft">
          An approved item already exists in this cell — this item was rejected instead.
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button variant="primary" size="sm" disabled={pending} onClick={() => onResolve('approve')}>
          Approve
        </Button>
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => onResolve('reject')}>
          Reject
        </Button>
      </div>
    </div>
  );
}
