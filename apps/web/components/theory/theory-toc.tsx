import type { LearningLanguage } from '@language-drill/shared';
import type { AuthenticatedFetch } from '@language-drill/api-client';
import { useTheoryTopics } from '../../lib/hooks/use-theory-topics';
import { useIsMobile } from '../../lib/responsive';
import { cn } from '../../lib/cn';
import type { TheoryTopic } from './types';

type TheoryTocProps = {
  topic: TheoryTopic;
  activeSectionId: string;
  onJump: (sectionId: string) => void;
  language: LearningLanguage;
  onSwitchTopic: (topicId: string) => void;
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
  // Desktop → vertical 240px sidebar. Mobile (≤760px) → horizontal, scrollable
  // tab strip pinned under the sheet header (the strip layout itself is driven
  // by the `.theory-toc` @media overrides in globals.css). The vertical-only
  // "jump to" label and the stacked "other topics" block are dropped on mobile;
  // topic switches fold into the strip as trailing tabs so they stay reachable.
  const isMobile = useIsMobile();

  return (
    <nav
      className={cn('theory-toc', isMobile && 'theory-toc-strip')}
      aria-label="theory sections"
    >
      {!isMobile && <div className="t-micro">jump to</div>}
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
        {isMobile &&
          others.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                className="theory-otherbtn"
                onClick={() => onSwitchTopic(t.id)}
              >
                → {t.title}
              </button>
            </li>
          ))}
      </ul>

      {!isMobile && others.length > 0 && (
        <div className="theory-other">
          <div className="t-micro">other topics</div>
          {others.map((t) => (
            <button
              key={t.id}
              type="button"
              className="theory-otherbtn"
              onClick={() => onSwitchTopic(t.id)}
            >
              → {t.title}
            </button>
          ))}
        </div>
      )}
    </nav>
  );
}
