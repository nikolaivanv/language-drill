'use client';

// ---------------------------------------------------------------------------
// TodayTimeline — orchestrator that picks one of five renderings:
//   - 5 skeleton rows         (isLoading)
//   - <TimelineErrorCard>     (error)
//   - <PoolNotReadyCard>      (data.code === 'INSUFFICIENT_POOL')
//   - <AllDoneCard>           (every item done AND summary present)
//   - the visible <ol> rail   (default)
//
// All page-level switch logic lives here so the page itself stays trivial.
// ---------------------------------------------------------------------------

import type { TodayPlanResponse } from '@language-drill/api-client';
import type { LearningLanguage } from '@language-drill/shared';
import {
  composeSubtitle,
  composeTitle,
} from '../_lib/timeline-labels';
import {
  AllDoneCard,
  PoolNotReadyCard,
  TimelineErrorCard,
} from './state-cards';
import {
  TimelineItem,
  type TimelineItemStatus,
} from './timeline-item';
import { FreeWritingBlock } from './free-writing-block';

type Props = {
  data: TodayPlanResponse | undefined;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
  language: LearningLanguage;
};

export function TodayTimeline({
  data,
  isLoading,
  error,
  onRetry,
  language,
}: Props) {
  if (isLoading) {
    return <TimelineSkeleton />;
  }

  if (error) {
    return <TimelineErrorCard error={error} onRetry={onRetry} />;
  }

  if (!data) {
    // No data, no error, not loading — defensive fallback (shouldn't happen
    // with TanStack Query but keeps the type narrowing happy).
    return <TimelineSkeleton />;
  }

  // data is present from here on. The free-writing block is independent of the
  // quick-drill rail's state — it renders in every data-present branch.
  const freeWritingBlock = data.freeWriting ? (
    <FreeWritingBlock estimatedMinutes={data.freeWriting.estimatedMinutes} />
  ) : null;

  if (data.code === 'INSUFFICIENT_POOL') {
    return (
      <>
        <PoolNotReadyCard language={language} />
        {freeWritingBlock}
      </>
    );
  }

  // Spine CTA: keep one-tap launch now that bare /drill is the hub.
  const drillHref = `/drill?start=quick`;
  const allDone =
    data.items.length > 0 && data.items.every((item) => item.status === 'done');

  if (allDone && data.summary) {
    return (
      <>
        <AllDoneCard summary={data.summary} href={drillHref} />
        {freeWritingBlock}
      </>
    );
  }

  // Default render: the vertical rail. The first non-`done` item is the
  // `next-up`; the rest stay `queued`.
  let nextUpAssigned = false;
  const itemsWithStatus = data.items.map((item) => {
    let status: TimelineItemStatus = item.status;
    if (item.status === 'queued' && !nextUpAssigned) {
      status = 'next-up';
      nextUpAssigned = true;
    }
    return { item, status };
  });

  return (
    <>
      <ol className="m-0 list-none p-0">
        {itemsWithStatus.map(({ item, status }, idx) => (
          <TimelineItem
            key={item.index}
            index={item.index}
            type={item.type}
            topicHint={item.topicHint}
            itemCount={item.itemCount}
            estimatedMinutes={item.estimatedMinutes}
            status={status}
            isLast={idx === itemsWithStatus.length - 1}
            href={status === 'next-up' ? drillHref : null}
          />
        ))}
      </ol>

      {/* Screen-reader summary of the whole plan. The visual rail above is
          fully accessible on its own, but a single flat list lets a SR user
          skim the day without navigating into each row. (Req 3.6) */}
      <ol aria-label="today's plan summary" className="sr-only">
        {itemsWithStatus.map(({ item, status }) => (
          <li key={item.index}>
            {item.index}. {composeTitle(item.index, item.type)} —{' '}
            {composeSubtitle(item.topicHint, item.type, item.itemCount)} ·{' '}
            {item.estimatedMinutes} min · {status}
          </li>
        ))}
      </ol>
      {freeWritingBlock}
    </>
  );
}

function TimelineSkeleton() {
  return (
    <ol className="m-0 list-none space-y-s-2 p-0" aria-hidden>
      {[0, 1, 2, 3, 4].map((i) => (
        <li
          key={i}
          className="h-[68px] animate-pulse rounded-r-md bg-paper-2"
        />
      ))}
    </ol>
  );
}
