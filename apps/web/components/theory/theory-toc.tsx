import { useState } from 'react';
import type { LearningLanguage } from '@language-drill/shared';
import type { AuthenticatedFetch } from '@language-drill/api-client';
import { useTheoryTopics } from '../../lib/hooks/use-theory-topics';
import { filterTopics, highlightMatch } from '../../lib/theory-library/group-sort';
import { useIsMobile } from '../../lib/responsive';
import { cn } from '../../lib/cn';
import type { TheoryTopic } from './types';

// Above this many topics the flat list becomes a scroll-hunt, so we surface a
// text filter. Below it, the list fits at a glance and the filter would just be
// chrome.
const TOPICS_FILTER_THRESHOLD = 8;

type TheoryTocProps = {
  topic: TheoryTopic;
  activeSectionId: string;
  onJump: (sectionId: string) => void;
  language: LearningLanguage;
  /**
   * The slug of the topic currently on screen (the id the parent navigates
   * with — `internalTopicId` in the panel, the route `topicId` on the detail
   * page). Used to highlight the current topic in the list and keep it in
   * place. NOT `topic.id`: DB-backed content JSON can carry a language-prefixed
   * id (`es-b2-…`) that wouldn't match the un-prefixed list/route slugs.
   */
  currentTopicId: string;
  onSwitchTopic: (topicId: string) => void;
  fetchFn?: AuthenticatedFetch;
};

export function TheoryToc({
  topic,
  activeSectionId,
  onJump,
  language,
  currentTopicId,
  onSwitchTopic,
  fetchFn,
}: TheoryTocProps) {
  const { topics: allTopics } = useTheoryTopics({ language, fetchFn });
  // The current topic stays IN the list (highlighted) rather than being
  // filtered out, so browsing topic-by-topic keeps your place instead of
  // hiding where you are. The block only earns its keep when there is at least
  // one *other* topic to switch to.
  const hasOtherTopics = allTopics.some((t) => t.id !== currentTopicId);
  // A text filter earns its place only once the list is long enough to scroll.
  const [topicQuery, setTopicQuery] = useState('');
  const showFilter = allTopics.length > TOPICS_FILTER_THRESHOLD;
  const visibleTopics = showFilter ? filterTopics(allTopics, topicQuery) : allTopics;
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
    showFilter && topicQuery.trim() !== '' && visibleTopics.length === 0;

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

      {!isMobile && hasOtherTopics && (
        <div className="theory-other">
          <div className="t-micro">all topics</div>
          {showFilter && filterInput}
          {visibleTopics.map((t) => {
            const isCurrent = t.id === currentTopicId;
            return (
              <button
                key={t.id}
                type="button"
                className={cn('theory-otherbtn', isCurrent && 'active')}
                aria-current={isCurrent ? 'true' : undefined}
                onClick={() => onSwitchTopic(t.id)}
              >
                {topicLabel(t.title)}
              </button>
            );
          })}
          {showEmptyHint && emptyHint}
        </div>
      )}
    </nav>
  );
}
