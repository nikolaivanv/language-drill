'use client';

// ---------------------------------------------------------------------------
// NextUpCard — mobile-only "next up" CTA (Requirement 4.2)
// ---------------------------------------------------------------------------
// Surfaces the first not-yet-done plan item as a single prominent, tappable
// card directly under the greeting so a phone user can start practising in one
// tap. Reuses the timeline-label composers and the same `/drill?start=quick`
// route the timeline's next-up row links to. Renders nothing when there is no
// actionable item (no plan, insufficient pool, or every item done). The page
// gates this behind `useIsMobile()`.
// ---------------------------------------------------------------------------

import Link from 'next/link';
import type { TodayPlanResponse } from '@language-drill/api-client';
import type { LearningLanguage } from '@language-drill/shared';
import { composeSubtitle, composeTitle } from '../_lib/timeline-labels';

type Props = {
  data: TodayPlanResponse | undefined;
  language: LearningLanguage;
};

export function NextUpCard({ data, language: _language }: Props) {
  if (!data || data.code === 'INSUFFICIENT_POOL') return null;
  const next = data.items.find((item) => item.status === 'queued');
  if (!next) return null;

  const drillHref = `/drill?start=quick`;
  const title = composeTitle(next.index, next.type);
  const subtitle = composeSubtitle(next.topicHint, next.type, next.itemCount);

  return (
    <Link
      href={drillHref}
      aria-label={`next up: ${title}, start`}
      className="flex items-center justify-between gap-s-4 rounded-r-md border border-accent bg-accent-soft px-[18px] py-[16px] transition-colors hover:border-accent-2"
    >
      <div className="min-w-0">
        <div className="t-micro" style={{ color: 'var(--color-accent-2)' }}>
          next up
        </div>
        <div className="t-display-s mt-[2px]">{title}</div>
        <p className="t-small mt-[2px]">
          {subtitle} · {next.estimatedMinutes} min
        </p>
      </div>
      <span
        aria-hidden
        className="t-body flex-none font-medium"
        style={{ color: 'var(--color-accent-2)' }}
      >
        start →
      </span>
    </Link>
  );
}
