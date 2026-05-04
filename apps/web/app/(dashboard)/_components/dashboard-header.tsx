'use client';

// ---------------------------------------------------------------------------
// DashboardHeader — editorial header above the timeline
// ---------------------------------------------------------------------------
// Stable text region: the greeting block + "here's today's plan." subline,
// the framing paragraph derived from the radar axes, and the planned-time
// total in the top-right.
//
// Note: the design originally typed the axes prop as `weakestAxis: RadarAxis
// | null`. Passing the full `axes` array instead lets the component call
// `computeFraming(axes)` directly without the page having to thread a
// pre-computed axis through. Functionally equivalent.
// ---------------------------------------------------------------------------

import type { RadarAxis } from '@language-drill/api-client';
import type { LearningLanguage } from '@language-drill/shared';
import { computeFraming } from '../_lib/framing-rules';
import { GreetingBlock } from './greeting-block';

type Props = {
  language: LearningLanguage;
  firstName: string | null;
  axes: RadarAxis[] | undefined;
  totalEstimatedMinutes: number | null;
};

export function DashboardHeader({
  language,
  firstName,
  axes,
  totalEstimatedMinutes,
}: Props) {
  const framing = computeFraming(axes);

  return (
    <header className="space-y-s-4">
      <GreetingBlock language={language} firstName={firstName} />

      <div className="flex items-baseline justify-between gap-s-4">
        <p className="t-display-l italic">here&apos;s today&apos;s plan.</p>
        {totalEstimatedMinutes === null ? (
          <span
            aria-hidden
            className="h-[14px] w-[112px] animate-pulse rounded-sm bg-paper-3"
          />
        ) : (
          <span className="t-mono text-ink-soft">
            ~{totalEstimatedMinutes} min planned
          </span>
        )}
      </div>

      <p className="t-body-l">{framing.paragraph}</p>
    </header>
  );
}
