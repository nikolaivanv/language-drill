'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LearningLanguage } from '@language-drill/shared';
import type { AuthenticatedFetch } from '@language-drill/api-client';
import { type TheoryTopicId } from '../../content/theory';
import { useTheoryTopic } from '../../lib/hooks/use-theory-topic';
import { Chip } from '../ui/chip';
import { TheoryContent } from './theory-content';
import { TheoryEmpty } from './theory-empty';
import { TheoryToc } from './theory-toc';
import { useBodyScrollLock } from './use-body-scroll-lock';
import { useFocusTrap } from './use-focus-trap';
import { useScrollSpy } from './use-scroll-spy';

type TheoryPanelProps = {
  topicId: TheoryTopicId;
  language: LearningLanguage;
  triggerEl: HTMLElement | null;
  onClose: () => void;
  fetchFn?: AuthenticatedFetch;
};

export function TheoryPanel({
  topicId,
  language,
  triggerEl,
  onClose,
  fetchFn,
}: TheoryPanelProps) {
  const [internalTopicId, setInternalTopicId] = useState<TheoryTopicId>(topicId);
  const panelRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  const { topic, isLoading, isError } = useTheoryTopic({
    language,
    topicId: internalTopicId,
    fetchFn,
  });
  const sectionIds = topic ? topic.sections.map((s) => s.id) : [];

  // Hooks must be called unconditionally before any early returns.
  const activeSectionId = useScrollSpy(sectionIds, scrollRef);
  useFocusTrap(true, panelRef);
  useBodyScrollLock(true);

  const handleJump = useCallback((id: string) => {
    const root = scrollRef.current;
    if (!root) return;
    const target = root.querySelector(`#${CSS.escape(id)}`);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  // Esc closes the panel (FR-8.1).
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Belt-and-braces: ensure the close button is focused on first mount.
  // (`useFocusTrap` also focuses the first focusable element, which is the
  // close button — but this stays explicit so future re-orderings inside
  // the header can't accidentally land focus elsewhere.)
  useEffect(() => {
    closeBtnRef.current?.focus();
  }, []);

  // Restore focus to the trigger pill on unmount (FR-9.3). Captured at mount
  // time — `triggerEl` doesn't change while the panel is open.
  useEffect(() => {
    return () => {
      triggerEl?.focus();
    };
  }, []);

  // Sync internal topic when the parent reopens with a new id.
  useEffect(() => {
    setInternalTopicId(topicId);
  }, [topicId]);

  // Reset scroll position whenever the active topic changes (FR-8.5).
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [internalTopicId]);

  // Server-render guard: <TheoryPanel> is mounted only in response to user
  // interaction, so this branch is mostly defensive.
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="theory-overlay" onClick={onClose}>
      <aside
        ref={panelRef}
        className="theory-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="theory-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="theory-header">
          <div>
            <div className="t-micro">theory · reference</div>
            <div className="theory-header-row">
              <h2 id="theory-title" className="t-display-l">
                {topic ? topic.title : 'theory'}
              </h2>
              {topic && <Chip>{topic.cefr}</Chip>}
            </div>
            {topic && <div className="t-small">{topic.subtitle}</div>}
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            className="theory-close"
            onClick={onClose}
            aria-label="close"
          >
            ×
          </button>
        </header>

        {topic ? (
          <div className="theory-body">
            <TheoryToc
              topic={topic}
              activeSectionId={activeSectionId}
              onJump={handleJump}
              language={language}
              onSwitchTopic={setInternalTopicId}
              fetchFn={fetchFn}
            />
            <TheoryContent
              topic={topic}
              scrollRef={scrollRef}
              language={language}
              onSwitchTopic={setInternalTopicId}
              onClose={onClose}
            />
          </div>
        ) : isLoading ? (
          <div className="theory-loading">
            <span className="t-small">loading theory…</span>
          </div>
        ) : isError ? (
          <div className="theory-error">
            <span className="t-small">couldn&apos;t load theory — try again</span>
          </div>
        ) : (
          <TheoryEmpty
            attemptedTopicId={internalTopicId}
            language={language}
            onSwitchTopic={setInternalTopicId}
            fetchFn={fetchFn}
          />
        )}
      </aside>
    </div>,
    document.body,
  );
}
