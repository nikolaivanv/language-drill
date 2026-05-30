'use client';

import { useCallback, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { LearningLanguage } from '@language-drill/shared';
import type { AuthenticatedFetch } from '@language-drill/api-client';
import { useTheoryTopic } from '../../../../lib/hooks/use-theory-topic';
import { useScrollSpy } from '../../../../lib/hooks/use-scroll-spy';
import { Chip } from '../../../../components/ui/chip';
import { TheoryToc } from '../../../../components/theory/theory-toc';
import { TheorySections } from '../../../../components/theory/theory-sections';
import { TheoryEmpty } from '../../../../components/theory/theory-empty';

type TheoryDetailProps = {
  topicId: string;
  language: LearningLanguage;
  fetchFn: AuthenticatedFetch;
};

/**
 * Full-page theory topic detail (Requirement 6). Reuses the in-drill panel's
 * internals — `useTheoryTopic`, `useScrollSpy`, `TheoryToc`, `TheorySections`,
 * `TheoryEmpty` — but with page chrome (back-to-library link instead of the
 * modal's close/“back to drill”) and router-based topic switching, and without
 * the dialog portal / focus-trap / scroll-lock.
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

  const { topic, isLoading, isError } = useTheoryTopic({
    language,
    topicId,
    fetchFn,
  });

  const sectionIds = topic ? topic.sections.map((s) => s.id) : [];
  // Hook called unconditionally (empty ids until the topic loads).
  const activeSectionId = useScrollSpy(sectionIds, scrollRef);

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
      router.push(`/theory/${nextTopicId}`);
    },
    [router],
  );

  // Reset scroll to the top whenever the topic changes (mirrors the panel).
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [topicId]);

  return (
    <div className="theory-detail">
      <header className="theory-detail-header">
        <Link href="/theory" className="theory-detail-back t-small text-ink-soft hover:text-ink">
          ← theory library
        </Link>
        <div className="t-micro" style={{ marginTop: 8 }}>
          theory · reference
        </div>
        <div className="theory-detail-title-row" style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 4 }}>
          <h1 className="t-display-l" style={{ margin: 0 }}>
            {topic ? topic.title : 'theory'}
          </h1>
          {topic && <Chip>{topic.cefr}</Chip>}
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
            <div style={{ height: 40 }} aria-hidden="true" />
            <div className="theory-footer-cta">
              <Link
                href="/theory"
                className="inline-flex items-center gap-1 rounded-r-md border border-rule bg-card px-3 py-2 text-[13px] text-ink no-underline hover:bg-paper-2"
              >
                ← back to library
              </Link>
            </div>
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
    </div>
  );
}
