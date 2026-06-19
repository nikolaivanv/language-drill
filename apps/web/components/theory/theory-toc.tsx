import { useState } from 'react';
import type { LearningLanguage } from '@language-drill/shared';
import type { AuthenticatedFetch } from '@language-drill/api-client';
import { useTheoryTopics } from '../../lib/hooks/use-theory-topics';
import { filterTopics, highlightMatch } from '../../lib/theory-library/group-sort';
import { useIsMobile } from '../../lib/responsive';
import { cn } from '../../lib/cn';
import type { TheoryTopic } from './types';

// Above this many "other topics" the flat list becomes a scroll-hunt, so we
// surface a text filter. Below it, the list fits at a glance and the filter
// would just be chrome.
const OTHER_TOPICS_FILTER_THRESHOLD = 8;

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
  // A text filter earns its place only once the list is long enough to scroll.
  const [topicQuery, setTopicQuery] = useState('');
  const showFilter = others.length > OTHER_TOPICS_FILTER_THRESHOLD;
  const visibleOthers = showFilter ? filterTopics(others, topicQuery) : others;
  // Desktop → vertical 240px sidebar with section tabs *and* an "other topics"
  // list. Mobile (≤760px) → a single horizontal scroll-spy strip of in-page
  // sections (driven by the `.theory-toc` @media overrides in globals.css), and
  // nothing else: cross-topic switching moves to the title-tap `TopicSwitcherSheet`
  // (owned by the panel / detail page), so the confusing second look-alike
  // ribbon is gone. The vertical-only "jump to" label is also dropped on mobile.
  const isMobile = useIsMobile();

  // Topic label with the active query substring highlighted (shared by the
  // desktop list and the mobile strip).
  const topicLabel = (title: string) => {
    const hit = highlightMatch(title, topicQuery);
    if (!hit) return title;
    return (
      <>
        {hit.before}
        <mark className="theory-otherbtn-hit">{hit.match}</mark>
        {hit.after}
      </>
    );
  };

  const filterInput = (
    <input
      type="search"
      className="theory-topic-filter"
      value={topicQuery}
      onChange={(e) => setTopicQuery(e.target.value)}
      placeholder="filter topics…"
      aria-label="filter topics"
    />
  );

  const emptyHint = (
    <div className="theory-other-empty t-small">no topics match</div>
  );
  const showEmptyHint =
    showFilter && topicQuery.trim() !== '' && visibleOthers.length === 0;

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
      </ul>

      {!isMobile && others.length > 0 && (
        <div className="theory-other">
          <div className="t-micro">other topics</div>
          {showFilter && filterInput}
          {visibleOthers.map((t) => (
            <button
              key={t.id}
              type="button"
              className="theory-otherbtn"
              onClick={() => onSwitchTopic(t.id)}
            >
              {topicLabel(t.title)}
            </button>
          ))}
          {showEmptyHint && emptyHint}
        </div>
      )}
    </nav>
  );
}
