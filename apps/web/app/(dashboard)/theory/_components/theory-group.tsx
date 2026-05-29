'use client';

import { useId, useState } from 'react';
import { cn } from '../../../../lib/cn';
import type { TopicGroup } from '../../../../lib/theory-library/group-sort';
import { TheoryTopicRow } from './theory-topic-row';

type TheoryGroupProps = {
  group: TopicGroup;
  query: string;
  /**
   * Mobile renders an accordion (collapsible). `defaultOpen` seeds the initial
   * open state (the page opens the largest groups by default). Desktop ignores
   * collapse and always shows the rows in a card frame.
   */
  isMobile: boolean;
  defaultOpen: boolean;
};

/**
 * A single group section: header (label + count) followed by its topic rows.
 * Desktop = a card-framed always-open list; mobile = a collapsible accordion
 * (Requirements 3.6, 7.1, 7.2).
 */
export function TheoryGroup({
  group,
  query,
  isMobile,
  defaultOpen,
}: TheoryGroupProps) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  const rows = group.topics.map((topic) => (
    <TheoryTopicRow key={topic.id} topic={topic} query={query} />
  ));

  if (isMobile) {
    return (
      <section className="theory-group theory-group-accordion">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={panelId}
          className="flex w-full items-baseline justify-between border-b border-rule bg-transparent px-[18px] py-[10px] text-left text-ink"
        >
          <span className="flex items-baseline gap-2">
            <span style={{ fontFamily: 'var(--t-display)', fontSize: 17, fontWeight: 500 }}>
              {group.label}
            </span>
            <span className="t-mono text-[10px] text-ink-mute">{group.topics.length}</span>
          </span>
          <span
            aria-hidden="true"
            className="text-[11px] text-ink-mute transition-transform duration-150"
            style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}
          >
            ›
          </span>
        </button>
        {open && <div id={panelId}>{rows}</div>}
      </section>
    );
  }

  return (
    <section className="theory-group" style={{ marginTop: 24 }}>
      <header className="flex items-baseline justify-between px-1 pb-2">
        <h2 className="t-display-m" style={{ margin: 0, fontSize: 22 }}>
          {group.label}
        </h2>
        <span className="t-mono text-[11px] text-ink-mute">{group.topics.length}</span>
      </header>
      <div
        className={cn(
          'overflow-hidden rounded-r-lg border border-rule bg-card',
        )}
      >
        {rows}
      </div>
    </section>
  );
}
