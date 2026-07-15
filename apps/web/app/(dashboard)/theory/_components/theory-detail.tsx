'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { track } from '../../../../lib/analytics/track';
import Link from 'next/link';
import {
  getTheoryCategory,
  resolveTheoryCategory,
  FALLBACK_CATEGORY_ID,
  type LearningLanguage,
} from '@language-drill/shared';
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
import { RelatedTopics } from '../../../../components/theory/related-topics';
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
 * modal's close affordances), and without the dialog portal / focus-trap /
 * scroll-lock.
 *
 * Topic switching happens *in place* (like the panel), NOT via `router.push`.
 * Navigating between `/theory/[topicId]` values remounts this whole page, which
 * blanks the TOC to a loading spinner and resets its scroll on every switch. So
 * the displayed topic is local state seeded from the route param, advanced on
 * switch, with the URL kept in sync via the History API (shallow — no Next
 * navigation, no remount). `keepPreviousData` on `useTheoryTopic` then keeps the
 * previous article on screen while the next loads, so the nav never unmounts.
 * Deep links, refresh, and back/forward still resolve the right topic.
 *
 * Scroll-spy trap (design §Component 10): `useScrollSpy` uses `scrollRef` as
 * its IntersectionObserver root with a -20%/-60% rootMargin, which only works
 * when that element is the scroll container. So the sections are wrapped in a
 * `.theory-scroll` (overflow-y:auto) div and that element is the spy root — the
 * page body must not be the scroller for the content column.
 */
export function TheoryDetail({ topicId, language, fetchFn }: TheoryDetailProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const isMobile = useIsMobile();

  // The topic currently on screen. Seeded from the route param, then advanced
  // in place on switches so the surrounding nav never unmounts.
  const [activeTopicId, setActiveTopicId] = useState(topicId);

  // A fresh route render (deep link / hard navigation into the page) reseeds
  // the displayed topic. Our own in-place switches don't change the prop, so
  // this never fights them.
  useEffect(() => {
    setActiveTopicId(topicId);
  }, [topicId]);

  // Back/forward across in-place switches only moves the History entry (Next
  // isn't driving it), so sync the displayed topic from the URL on popstate.
  useEffect(() => {
    const onPopState = () => {
      const match = window.location.pathname.match(/\/theory\/([^/]+)/);
      if (match) setActiveTopicId(decodeURIComponent(match[1]));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const { topic, related, isLoading, isError, isPlaceholder } = useTheoryTopic({
    language,
    topicId: activeTopicId,
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

  // Targeted-drill key for the loaded topic. Derived from the displayed topic's
  // slug (the canonical `theory_topics.topic_id`, e.g. `a2-ser-vs-estar`) — NOT
  // from `topic.id`: DB-backed content JSON embeds the FULL grammar-point key
  // there (`es-a2-ser-vs-estar`), which would double the language prefix. Gated
  // on `topic` so the block only mounts alongside a loaded article.
  const drillKey = topic ? grammarPointKeyForTopicId(activeTopicId, language) : null;

  // Sibling-group heading for the related-topics block ("more in moods &
  // conditionals"). Null when the point's category is the 'other' fallback —
  // the server sends no siblings for it anyway.
  const relatedCategoryId = drillKey ? resolveTheoryCategory(drillKey) : FALLBACK_CATEGORY_ID;
  const relatedCategoryLabel =
    relatedCategoryId === FALLBACK_CATEGORY_ID ? null : getTheoryCategory(relatedCategoryId).label;

  const handleJump = useCallback((id: string) => {
    const root = scrollRef.current;
    if (!root) return;
    const target = root.querySelector(`#${CSS.escape(id)}`);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  const goToTopic = useCallback((nextTopicId: string) => {
    setSwitcherOpen(false);
    setActiveTopicId(nextTopicId);
    // Shallow URL sync: update the address bar without a Next navigation (which
    // would remount the page and blank the TOC). Integrates with the App Router
    // per Next's supported History-API usage, so usePathname / deep links stay
    // correct.
    if (typeof window !== 'undefined') {
      window.history.pushState(
        null,
        '',
        `/theory/${encodeURIComponent(nextTopicId)}`,
      );
    }
  }, []);

  // Reset scroll to the top whenever the displayed topic changes (mirrors the
  // panel). Only the content scroller resets — the TOC keeps its position.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [activeTopicId]);

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
            currentTopicId={activeTopicId}
            onSwitchTopic={goToTopic}
            fetchFn={fetchFn}
          />
          <div
            ref={scrollRef}
            className={`theory-scroll${isPlaceholder ? ' theory-scroll--switching' : ''}`}
          >
            <TheorySections
              topic={topic}
              language={language}
              onSwitchTopic={goToTopic}
            />
            {drillKey && (
              <DrillThisPoint grammarPointKey={drillKey} fetchFn={fetchFn} />
            )}
            {related && (
              <RelatedTopics
                related={related}
                categoryLabel={relatedCategoryLabel}
                onSwitchTopic={goToTopic}
              />
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
          attemptedTopicId={activeTopicId}
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
