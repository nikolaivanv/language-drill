import type { LearningLanguage } from '@language-drill/shared';
import type { AuthenticatedFetch } from '@language-drill/api-client';
import { type TheoryTopicId } from '../../content/theory';
import { useTheoryTopics } from '../../lib/hooks/use-theory-topics';
import { cn } from '../../lib/cn';
import type { TheoryTopic } from './types';

type TheoryTocProps = {
  topic: TheoryTopic;
  activeSectionId: string;
  onJump: (sectionId: string) => void;
  language: LearningLanguage;
  onSwitchTopic: (topicId: TheoryTopicId) => void;
  fetchFn?: AuthenticatedFetch;
};

export function TheoryToc({
  topic,
  activeSectionId,
  onJump,
  language,
  onSwitchTopic,
  fetchFn,
}: TheoryTocProps) {
  const { topics: allTopics } = useTheoryTopics({ language, fetchFn });
  const others = allTopics.filter((t) => t.id !== topic.id);

  return (
    <nav className="theory-toc" aria-label="theory sections">
      <div className="t-micro">jump to</div>
      <ul>
        {topic.sections.map((s) => {
          const isActive = s.id === activeSectionId;
          return (
            <li key={s.id}>
              <button
                type="button"
                className={cn(isActive && 'active')}
                aria-current={isActive ? 'true' : undefined}
                onClick={() => onJump(s.id)}
              >
                {s.title}
              </button>
            </li>
          );
        })}
      </ul>

      {others.length > 0 && (
        <div className="theory-other">
          <div className="t-micro">other topics</div>
          {others.map((t) => (
            <button
              key={t.id}
              type="button"
              className="theory-otherbtn"
              onClick={() => onSwitchTopic(t.id as TheoryTopicId)}
            >
              → {t.title}
            </button>
          ))}
        </div>
      )}
    </nav>
  );
}
