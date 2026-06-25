'use client';

// ---------------------------------------------------------------------------
// DashboardHeader — editorial header above the timeline
// ---------------------------------------------------------------------------
// Renders the "today's plan." heading with total planned minutes, then a
// framing paragraph derived from the radar axes or plan items.
// ---------------------------------------------------------------------------

import type { PlanReason, RadarAxis } from '@language-drill/api-client';
import { computeFraming, composePlanFraming } from '../_lib/framing-rules';

type Props = {
  axes: RadarAxis[] | undefined;
  totalEstimatedMinutes: number | null;
  planItems?: { reason: PlanReason | null; grammarPointName: string | null }[];
};

export function DashboardHeader({
  axes,
  totalEstimatedMinutes,
  planItems,
}: Props) {
  const framing =
    planItems && planItems.length > 0
      ? composePlanFraming(planItems)
      : computeFraming(axes);

  return (
    <header className="space-y-s-4">
      <div className="flex items-baseline justify-between gap-s-6 mobile:flex-col mobile:items-start mobile:gap-s-2">
        <h1 className="t-display-xl">today&apos;s plan.</h1>
        {totalEstimatedMinutes === null ? (
          <span
            aria-hidden
            className="h-[14px] w-[112px] animate-pulse rounded-sm bg-paper-3"
          />
        ) : (
          <span className="t-mono text-ink-mute whitespace-nowrap">
            ~{totalEstimatedMinutes} min planned
          </span>
        )}
      </div>

      <p className="t-body-l text-ink-2">{framing.paragraph}</p>
    </header>
  );
}
