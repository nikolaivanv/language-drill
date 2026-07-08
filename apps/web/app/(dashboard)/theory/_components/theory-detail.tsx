'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { track } from '../../../../lib/analytics/track';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { LearningLanguage } from '@language-drill/shared';
import type { AuthenticatedFetch } from '@language-drill/api-client';
import { useTheoryTopic } from '../../../../lib/hooks/use-theory-topic';
import { useTheoryTopics } from '../../../../lib/hooks/use-theory-topics';
import { useScrollSpy } from '../../../../lib/hooks/use-scroll-spy';
import { useIsMobile } from '../../../../lib/responsive';
import { useSuppressShellFooter } from '../../../../components/shell/shell-footer-context';
import { AppFooter } from '../../../../components/shell/app-footer';
import { Chip } from '../../../../components/ui/chip';
import { TheoryToc } from '../../../../components/theory/theory-toc';
import { TheorySections } from '../../../../components/theory/theory-sections';
import { TheoryEmpty } from '../../../../components/theory/theory-empty';
import { TheoryTitleSwitch } from '../../../../components/theory/theory-title-switch';
import {
  TheoryBrowseAllButton,
  TopicSwitcherSheet,
} from '../../../../components/theory/topic-switcher-sheet';
import { grammarPointKeyForTopicId } from '../../../../lib/theory-topic-map';
import { DrillThisPoint } from './drill-this-point';

type TheoryDetailProps = {
  topicId: string;
  language: LearningLanguage;
  fetchFn: AuthenticatedFetch;
};

/**
 * Full-page theory topic detail (Requirement 6). Reuses the in-drill panel's
 * internals — `useTheoryTopic`, `useScrollSpy`, `TheoryToc`, `TheorySections`,
 * `TheoryEmpty` — but with page chrome (back-to-library link instead of the
 * modal's close affordances) and router-based topic switching, and without the
 * dialog portal / focus-trap / scroll-lock.
 *
 * Scroll-spy trap (design §Component 10): `useScrollSpy` uses `scrollRef` as
 * its IntersectionObserver root with a -20%/-60% rootMargin, which only works
 * when that element is the scroll container. So the sections are wrapped in a
 * `.theory-scroll` (overflow-y:auto) div and that element is the spy root — the
 * page body must not be the scroller for the content column.
 */
export function TheoryDetail({ topicId, language, fetchFn }: TheoryDetailProps) {
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const isMobile = useIsMobile();

  const { topic, isLoading, isError } = useTheoryTopic({
    language,
    topicId,
    fetchFn,
  });

  // The loaded article lives in a viewport-tall internal scroller
  // (`.theory-scroll`), so the shell footer would be parked permanently below
  // it. Suppress it and render our own footer at the end of that scroller so it
  // reveals only when the reader reaches the bottom of the article. In the
  // loading / error / empty states there is no internal scroller, so we leave
  // the shell footer alone.
  useSuppressShellFooter(Boolean(topic));

  const trackedTopicId = useRef<string | null>(null);
  useEffect(() => {
    if (topic && trackedTopicId.current !== topic.id) {
      trackedTopicId.current = topic.id;
      track('theory_page_opened', { language, cefr: topic.cefr });
    }
  }, [topic, language]);
  // Count for the "browse all topics" affordance (shares the react-query cache
  // with the switcher sheet, so no extra fetch).
  const { topics: allTopics } = useTheoryTopics({ language, fetchFn });

  const sectionIds = topic ? topic.sections.map((s) => s.id) : [];
  // Hook called unconditionally (empty ids until the topic loads).
  const activeSectionId = useScrollSpy(sectionIds, scrollRef);

  // Targeted-drill key for the loaded topic. Derived from the route's topicId
  // (the canonical `theory_topics.topic_id` slug, e.g. `a2-ser-vs-estar`) —
  // NOT from `topic.id`: DB-backed content JSON embeds the FULL grammar-point
  // key there (`es-a2-ser-vs-estar`), which would double the language prefix.
  // Gated on `topic` so the block only mounts alongside a loaded article.
  const drillKey = topic ? grammarPointKeyForTopicId(topicId, language) : null;

  const handleJump = useCallback((id: string) => {
    const root = scrollRef.current;
    if (!root) return;
    const target = root.querySelector(`#${CSS.escape(id)}`);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  const goToTopic = useCallback(
    (nextTopicId: string) => {
      setSwitcherOpen(false);
      router.push(`/theory/${nextTopicId}`);
    },
    [router],
  );

  // Reset scroll to the top whenever the topic changes (mirrors the panel).
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [topicId]);

  return (
    // The fixed-height container is required only for the loaded article (its
    // internal `.theory-scroll` scrolls and drives scroll-spy). The
    // loading/error/empty states have no internal scroller, so the fixed
    // height would clip their content over the shell footer — `--flow` lets
    // the box grow with content instead.
    <div className={`theory-detail${topic ? '' : ' theory-detail--flow'}`}>
      <header className="theory-detail-header">
        <Link href="/theory" className="theory-detail-back t-small text-ink-soft hover:text-ink">
          ← theory library
        </Link>
        <div className="t-micro" style={{ marginTop: 8 }}>
          theory · reference
        </div>
        <div className="theory-detail-title-row" style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 4 }}>
          {topic && isMobile ? (
            <TheoryTitleSwitch
              title={topic.title}
              cefr={topic.cefr}
              onOpen={() => setSwitcherOpen(true)}
            />
          ) : (
            <>
              <h1 className="t-display-l" style={{ margin: 0 }}>
                {topic ? topic.title : 'theory'}
              </h1>
              {topic && <Chip>{topic.cefr}</Chip>}
            </>
          )}
        </div>
        {topic && (
          <div className="t-small" style={{ marginTop: 4 }}>
            {topic.subtitle}
          </div>
        )}
      </header>

      {topic ? (
        <div className="theory-detail-body theory-body">
          <TheoryToc
            topic={topic}
            activeSectionId={activeSectionId}
            onJump={handleJump}
            language={language}
            onSwitchTopic={goToTopic}
            fetchFn={fetchFn}
          />
          <div ref={scrollRef} className="theory-scroll">
            <TheorySections
              topic={topic}
              language={language}
              onSwitchTopic={goToTopic}
            />
            {drillKey && (
              <DrillThisPoint grammarPointKey={drillKey} fetchFn={fetchFn} />
            )}
            {isMobile && (
              <TheoryBrowseAllButton
                count={allTopics.length}
                onClick={() => setSwitcherOpen(true)}
              />
            )}
            <div style={{ height: 40 }} aria-hidden="true" />
            <AppFooter />
          </div>
        </div>
      ) : isLoading ? (
        <div className="theory-loading">
          <span className="t-small" role="status">
            loading theory…
          </span>
        </div>
      ) : isError ? (
        <div className="theory-error">
          <span className="t-small">couldn&apos;t load theory — try again</span>
        </div>
      ) : (
        <TheoryEmpty
          attemptedTopicId={topicId}
          language={language}
          onSwitchTopic={goToTopic}
          fetchFn={fetchFn}
        />
      )}

      {topic && switcherOpen && (
        <TopicSwitcherSheet
          language={language}
          currentTopicId={topic.id}
          onPick={goToTopic}
          onClose={() => setSwitcherOpen(false)}
          fetchFn={fetchFn}
        />
      )}
    </div>
  );
}
