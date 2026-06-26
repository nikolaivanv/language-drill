import type { ContentExercise } from '@language-drill/api-client';
import { Button } from '../../../../../components/ui';
import { ContentFieldView } from '../../../../../components/admin/content-field-view';

export function ContentExerciseCard({
  item, onResolve, pending, demoted,
}: {
  item: ContentExercise;
  onResolve: (action: 'demote' | 'reject') => void;
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
        <span>· {item.generationSource}</span>
        {item.modelId ? <span>· {item.modelId}</span> : null}
      </div>
      {item.coverageTags ? (
        <p className="text-[12px] text-ink-soft break-words">coverage: {JSON.stringify(item.coverageTags)}</p>
      ) : null}
      <ContentFieldView content={item.contentJson} />
      {demoted ? (
        <p className="text-[12px] text-ink-soft">Demoted — sent back to the review queue.</p>
      ) : null}
      <div className="flex gap-2">
        <Button variant="primary" size="sm" disabled={pending} onClick={() => onResolve('demote')}>Demote</Button>
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => onResolve('reject')}>Reject</Button>
      </div>
    </div>
  );
}
