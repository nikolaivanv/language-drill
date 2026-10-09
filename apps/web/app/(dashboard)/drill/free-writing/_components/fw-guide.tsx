'use client';

import { useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import type { LearningLanguage } from '@language-drill/shared';
import { useScrollSpy } from '../../../../../lib/hooks/use-scroll-spy';
import { useSuppressShellFooter } from '../../../../../components/shell/shell-footer-context';
import { AppFooter } from '../../../../../components/shell/app-footer';
import { Chip } from '../../../../../components/ui/chip';
import { TheoryToc } from '../../../../../components/theory/theory-toc';
import { TheorySections } from '../../../../../components/theory/theory-sections';
import { renderTheoryTopicJson } from '../../../../../components/theory/render-json';
import {
  getWritingGuide,
  WRITING_GUIDE_BANDS,
  WRITING_GUIDE_BAND_LABELS,
  type WritingGuideBand,
} from '../../../../../content/writing-guides';

export interface FwGuideProps {
  language: LearningLanguage;
  band: WritingGuideBand;
  onBandChange: (band: WritingGuideBand) => void;
}

const noop = () => {};

// How to write a free-writing paragraph in one language at one level band.
// Laid out like the grammar theory detail page (same CSS, TOC, sections) but
// static: the content ships in the bundle. TheoryToc gets no fetchFn, so its
// "all topics" grammar list is hidden and never fetched.
export function FwGuide({ language, band, onBandChange }: FwGuideProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const topic = useMemo(() => renderTheoryTopicJson(getWritingGuide(language, band)), [language, band]);
  const sectionIds = topic.sections.map((s) => s.id);
  const activeSectionId = useScrollSpy(sectionIds, scrollRef);

  // The article scrolls inside `.theory-scroll`; render the footer there.
  useSuppressShellFooter(true);

  const handleJump = useCallback((id: string) => {
    const target = scrollRef.current?.querySelector(`#${CSS.escape(id)}`);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  return (
    <div className="theory-detail">
      <header className="theory-detail-header">
        <Link href="/drill/free-writing" className="theory-detail-back t-small text-ink-soft hover:text-ink">
          ← free writing
        </Link>
        <div className="t-micro" style={{ marginTop: 8 }}>
          free writing · guide
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 10, marginTop: 4 }}>
          <h1 className="t-display-l" style={{ margin: 0 }}>
            {topic.title}
          </h1>
          <Chip>{topic.cefr}</Chip>
        </div>
        <div
          style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginTop: 6 }}
        >
          <div className="t-small" style={{ flex: '1 1 260px' }}>
            {topic.subtitle}
          </div>
          <div role="group" aria-label="level band" style={{ display: 'flex', gap: 6 }}>
            {WRITING_GUIDE_BANDS.map((b) => (
              <button
                key={b}
                type="button"
                className={b === band ? 'btn sm primary' : 'btn sm ghost'}
                aria-pressed={b === band}
                onClick={() => b !== band && onBandChange(b)}
              >
                {WRITING_GUIDE_BAND_LABELS[b]}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="theory-detail-body theory-body">
        <TheoryToc
          topic={topic}
          activeSectionId={activeSectionId}
          onJump={handleJump}
          language={language}
          currentTopicId={topic.id}
          onSwitchTopic={noop}
        />
        <div ref={scrollRef} className="theory-scroll">
          <TheorySections topic={topic} language={language} onSwitchTopic={noop} />
          <div style={{ height: 40 }} aria-hidden="true" />
          <AppFooter />
        </div>
      </div>
    </div>
  );
}
