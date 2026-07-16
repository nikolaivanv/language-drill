'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LearningLanguage } from '@language-drill/shared';
import type { AuthenticatedFetch } from '@language-drill/api-client';
import { useTheoryTopic } from '../../lib/hooks/use-theory-topic';
import { useTheoryTopics } from '../../lib/hooks/use-theory-topics';
import { Chip } from '../ui/chip';
import { TheoryContent } from './theory-content';
import { TheoryEmpty } from './theory-empty';
import { TheoryToc } from './theory-toc';
import {
  TheoryBrowseAllButton,
  TopicSwitcherSheet,
} from './topic-switcher-sheet';
import { TheoryTitleSwitch } from './theory-title-switch';
import { TheoryHubLink } from './theory-hub-link';
import { useBodyScrollLock } from '../../lib/hooks/use-body-scroll-lock';
import { useFocusTrap } from '../../lib/hooks/use-focus-trap';
import { useScrollSpy } from '../../lib/hooks/use-scroll-spy';
import { useIsMobile } from '../../lib/responsive';

type TheoryPanelProps = {
  topicId: string;
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
  const [internalTopicId, setInternalTopicId] = useState<string>(topicId);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const isMobile = useIsMobile();

  const { topic, isLoading, isError } = useTheoryTopic({
    language,
    topicId: internalTopicId,
    fetchFn,
  });
  // Count for the "browse all topics" affordance (shares the react-query cache
  // with the switcher sheet, so no extra fetch).
  const { topics: allTopics } = useTheoryTopics({ language, fetchFn });
  const sectionIds = topic ? topic.sections.map((s) => s.id) : [];

  const switchTopic = useCallback((id: string) => {
    setInternalTopicId(id);
    setSwitcherOpen(false);
  }, []);

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

  // Esc closes the panel (FR-8.1) — but only when the topic switcher isn't
  // open. While the switcher is up, its own Esc handler closes the sheet first
  // (and stops propagation), so this guard keeps a single Esc from collapsing
  // the whole panel out from under it.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !switcherOpen) onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, switcherOpen]);

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
              {topic && isMobile ? (
                <TheoryTitleSwitch
                  title={topic.title}
                  cefr={topic.cefr}
                  titleId="theory-title"
                  onOpen={() => setSwitcherOpen(true)}
                />
              ) : (
                <>
                  <h2 id="theory-title" className="t-display-l">
                    {topic ? topic.title : 'theory'}
                  </h2>
                  {topic && <Chip>{topic.cefr}</Chip>}
                </>
              )}
              {topic && (
                // `internalTopicId` is the route/lookup SLUG (e.g.
                // `b1-present-subjunctive`) — the exact id the same-page drawer
                // resolved against. `topic.id` is the content-JSON id, which
                // for DB-backed topics carries the language prefix
                // (`es-b1-present-subjunctive`) and 404s at `/theory/<id>`.
                <TheoryHubLink topicId={internalTopicId} title={topic.title} />
              )}
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
              currentTopicId={internalTopicId}
              onSwitchTopic={switchTopic}
              fetchFn={fetchFn}
            />
            <TheoryContent
              topic={topic}
              scrollRef={scrollRef}
              language={language}
              onSwitchTopic={switchTopic}
              footer={
                isMobile ? (
                  <TheoryBrowseAllButton
                    count={allTopics.length}
                    onClick={() => setSwitcherOpen(true)}
                  />
                ) : undefined
              }
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
            onSwitchTopic={switchTopic}
            fetchFn={fetchFn}
          />
        )}

        {topic && switcherOpen && (
          <TopicSwitcherSheet
            language={language}
            currentTopicId={topic.id}
            onPick={switchTopic}
            onClose={() => setSwitcherOpen(false)}
            fetchFn={fetchFn}
          />
        )}
      </aside>
    </div>,
    document.body,
  );
}
