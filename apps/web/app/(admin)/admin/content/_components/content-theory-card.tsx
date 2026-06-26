import { parseTheoryTopicJson, type LearningLanguage, Language } from '@language-drill/shared';
import type { ContentTheory } from '@language-drill/api-client';
import { Button } from '../../../../../components/ui';
import { renderTheoryTopicJson } from '../../../../../components/theory/render-json';
import { TheorySections } from '../../../../../components/theory/theory-sections';

const LEARNING_LANGUAGES: readonly string[] = [Language.ES, Language.DE, Language.TR];

function TheoryBody({ content, language }: { content: unknown; language: string }) {
  const lang: LearningLanguage = LEARNING_LANGUAGES.includes(language)
    ? (language as LearningLanguage) : Language.ES;
  try {
    const topic = renderTheoryTopicJson(parseTheoryTopicJson(content));
    return <TheorySections topic={topic} language={lang} onSwitchTopic={() => {}} />;
  } catch {
    return <pre className="text-[12px] whitespace-pre-wrap break-words">{JSON.stringify(content, null, 2)}</pre>;
  }
}

export function ContentTheoryCard({
  item, onResolve, pending, demoted,
}: {
  item: ContentTheory;
  onResolve: (action: 'demote' | 'reject') => void;
  pending: boolean;
  demoted: boolean;
}) {
  return (
    <div className="border border-rule rounded-sm p-4 flex flex-col gap-3 bg-paper">
      <div className="flex items-center gap-2 text-[13px] text-ink-soft flex-wrap">
        <span className="font-medium text-ink">theory</span>
        <span>· {item.language}</span>
        <span>· {item.level}</span>
        <span>· {item.grammarPointKey}</span>
        {item.qualityScore !== null ? <span>· q={item.qualityScore.toFixed(2)}</span> : null}
        <span>· {item.generationSource}</span>
        {item.modelId ? <span>· {item.modelId}</span> : null}
      </div>
      <TheoryBody content={item.contentJson} language={item.language ?? 'ES'} />
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
