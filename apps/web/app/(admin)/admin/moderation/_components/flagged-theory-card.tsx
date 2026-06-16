import { parseTheoryTopicJson, REASON_LABELS, type GenerationReasonCode } from '@language-drill/shared';
import type { LearningLanguage } from '@language-drill/shared';
import type { FlaggedTheory } from '@language-drill/api-client';
import { Button } from '../../../../../components/ui';
import { renderTheoryTopicJson } from '../../../../../components/theory/render-json';
import { TheorySections } from '../../../../../components/theory/theory-sections';

function reasonLabel(code: string, detail?: string): string {
  const label = REASON_LABELS[code as GenerationReasonCode] ?? code;
  return detail ? `${label}: ${detail}` : label;
}

function TheoryBody({ content, language }: { content: unknown; language: string }) {
  try {
    const topic = renderTheoryTopicJson(parseTheoryTopicJson(content));
    return (
      <TheorySections
        topic={topic}
        language={language as LearningLanguage}
        onSwitchTopic={() => {}}
      />
    );
  } catch {
    return (
      <pre className="text-[12px] whitespace-pre-wrap break-words">
        {JSON.stringify(content, null, 2)}
      </pre>
    );
  }
}

export function FlaggedTheoryCard({
  item, onResolve, pending, demoted,
}: {
  item: FlaggedTheory;
  onResolve: (action: 'approve' | 'reject') => void;
  pending: boolean;
  demoted: boolean;
}) {
  return (
    <div className="border border-rule rounded-r-sm p-4 flex flex-col gap-3 bg-paper">
      <div className="flex items-center gap-2 text-[13px] text-ink-soft flex-wrap">
        <span className="font-medium text-ink">theory</span>
        <span>· {item.language}</span>
        <span>· {item.level}</span>
        <span>· {item.grammarPointKey}</span>
        {item.qualityScore !== null ? <span>· q={item.qualityScore.toFixed(2)}</span> : null}
      </div>
      <div className="flex gap-2 flex-wrap">
        {item.flaggedReasons.map((r, i) => (
          <span key={i} className="text-[12px] bg-paper-2 text-ink px-2 py-px rounded-full">
            ⚠ {reasonLabel(r.code, r.detail)}
          </span>
        ))}
      </div>
      <TheoryBody content={item.contentJson} language={item.language ?? 'ES'} />
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
