'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { LearningLanguage } from '@language-drill/shared';
import type { AuthenticatedFetch } from '@language-drill/api-client';
import { Chip } from '../ui/chip';
import { cn } from '../../lib/cn';
import { useTheoryTopics } from '../../lib/hooks/use-theory-topics';
import { groupTopics, highlightMatch } from '../../lib/theory-library/group-sort';

// ---------------------------------------------------------------------------
// Topic switcher (mobile)
// ---------------------------------------------------------------------------
//
// Replaces the old second horizontal ribbon (a flat scroll of "other topics"
// that looked identical to the in-page section strip and didn't scale past a
// handful of items). The topic *title* in the header opens this searchable
// bottom sheet instead: vertical, grouped by category, filterable — the right
// pattern for dozens of topics, and visually nothing like the section strip so
// the two navigation jobs can't be confused.
//
// Mounted in-place by its caller (the panel / detail page) inside a
// `position: relative` host, so it overlays just that surface and stays within
// the panel's focus trap. The caller owns the open/close state and routes
// `onPick` to its own topic-switch handler (`setInternalTopicId` for the
// in-drill panel, `router.push` for the standalone page).
//
// Mastery bars from the design prototype are intentionally omitted: the theory
// list endpoint carries no per-topic mastery, so the row shows the CEFR level
// chip and a "viewing" marker for the current topic and nothing it can't back
// with real data.

/**
 * End-of-topic affordance (mobile): a full-width button rendered after the
 * sections that opens the same {@link TopicSwitcherSheet} the title-tap opens.
 * Gives the reader a way to jump topics once they've scrolled past the header.
 */
export function TheoryBrowseAllButton({
  count,
  onClick,
}: {
  count: number;
  onClick: () => void;
}) {
  return (
    <div className="theory-browse-all-wrap">
      <button type="button" className="theory-browse-all" onClick={onClick}>
        <span>browse all topics</span>
        <span className="t-mono theory-browse-all-count">{count}</span>
      </button>
    </div>
  );
}

type TopicSwitcherSheetProps = {
  language: LearningLanguage;
  /** The topic currently open behind the sheet — marked "viewing". */
  currentTopicId: string;
  onPick: (topicId: string) => void;
  onClose: () => void;
  fetchFn?: AuthenticatedFetch;
};

export function TopicSwitcherSheet({
  language,
  currentTopicId,
  onPick,
  onClose,
  fetchFn,
}: TopicSwitcherSheetProps) {
  const { topics } = useTheoryTopics({ language, fetchFn });
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Esc closes the sheet (and is stopped from reaching the host panel's own Esc
  // handler, which the panel guards on `switcherOpen`); focus lands on the
  // search box once the slide-in settles.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    const focusId = window.setTimeout(() => inputRef.current?.focus(), 80);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      window.clearTimeout(focusId);
    };
  }, [onClose]);

  // Group by category in curriculum order; a non-empty query collapses to a
  // single "results" group (reuses the library's tested grouping logic).
  const groups = useMemo(
    () => groupTopics(topics, 'category', 'curriculum', query),
    [topics, query],
  );

  const renderTitle = (title: string) => {
    const hit = highlightMatch(title, query);
    if (!hit) return title;
    // Wrap the split title in a single inline element. `.theory-switcher-row-title`
    // is a flex row with `gap` (separating the title from the "viewing" badge), so
    // returning before/<mark>/after as bare siblings would make each a flex item and
    // insert that gap *inside* the word (e.g. "Pers onal" instead of "Personal").
    return (
      <span className="theory-switcher-row-text">
        {hit.before}
        <mark className="theory-switcher-mark">{hit.match}</mark>
        {hit.after}
      </span>
    );
  };

  return (
    <div className="theory-switcher">
      <div className="theory-switcher-scrim" onClick={onClose} />
      <div
        className="theory-switcher-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="switch topic"
      >
        <div className="theory-switcher-grab" aria-hidden="true" />
        <div className="theory-switcher-head">
          <div className="theory-switcher-head-row">
            <div className="t-micro">switch topic · {topics.length} total</div>
            <button
              type="button"
              className="theory-close"
              onClick={onClose}
              aria-label="close"
            >
              ×
            </button>
          </div>
          <div className="theory-switcher-search">
            <svg
              width="15"
              height="15"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <circle cx="7" cy="7" r="4.5" />
              <path d="M10.5 10.5l3 3" />
            </svg>
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="search all topics…"
              aria-label="search all topics"
            />
            {query && (
              <button
                type="button"
                className="theory-switcher-clear"
                onClick={() => setQuery('')}
                aria-label="clear search"
              >
                ×
              </button>
            )}
          </div>
        </div>

        <div className="theory-switcher-body">
          {groups.length === 0 ? (
            <div className="theory-switcher-empty t-small">
              no topics match &ldquo;{query}&rdquo;
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.id} className="theory-switcher-group">
                <div className="theory-switcher-group-head">
                  <span>{g.label}</span>
                  <span className="t-mono">{g.topics.length}</span>
                </div>
                {g.topics.map((t) => {
                  const isCurrent = t.id === currentTopicId;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      className={cn(
                        'theory-switcher-row',
                        isCurrent && 'is-current',
                      )}
                      aria-current={isCurrent ? 'true' : undefined}
                      onClick={() => onPick(t.id)}
                    >
                      <span className="theory-switcher-row-main">
                        <span className="theory-switcher-row-title">
                          {renderTitle(t.title)}
                          {isCurrent && (
                            <span className="theory-switcher-here">viewing</span>
                          )}
                        </span>
                      </span>
                      <Chip className="theory-switcher-level">{t.cefr}</Chip>
                      <span className="theory-switcher-go" aria-hidden="true">
                        →
                      </span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
