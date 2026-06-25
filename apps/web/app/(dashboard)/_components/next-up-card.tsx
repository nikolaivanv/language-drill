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

import type { TodayPlanResponse } from '@language-drill/api-client';
import type { LearningLanguage } from '@language-drill/shared';
import { Button } from '../../../components/ui';
import { cn } from '../../../lib/cn';
import { composeSubtitle, composeTitle } from '../_lib/timeline-labels';
import { reasonHint } from '../_lib/reason-hint';

type Props = {
  data: TodayPlanResponse | undefined;
  language: LearningLanguage;
};

export function NextUpCard({ data, language: _language }: Props) {
  if (!data || data.code === 'INSUFFICIENT_POOL') return null;
  const next = data.items.find((item) => item.status === 'queued');
  if (!next) return null;

  const drillHref = `/drill?start=quick`;
  const title = composeTitle(next.index, data.items.length, next.type);
  const subtitle = composeSubtitle(
    next.grammarPointName,
    next.topicHint,
    next.type,
    next.itemCount,
  );
  const hint = reasonHint(next.reason);

  return (
    <div className="relative flex flex-col items-start gap-s-3 rounded-r-lg border border-rule bg-card px-[18px] py-[16px] shadow-1">
      <div className="w-full min-w-0">
        {/* Raw micro utilities (not `t-micro`) so text-accent-2 applies. */}
        <div className="text-[11px] font-medium uppercase leading-[1.4] tracking-[1.2px] text-accent-2">
          next up
        </div>
        <div className="t-display-s mt-[2px]">{title}</div>
        <p className="t-small mt-[2px]">
          {subtitle} · {next.estimatedMinutes} min
        </p>
        {hint && (
          <p
            className={cn(
              't-micro mt-s-1 text-ink-mute',
              next.reason === 'error-fix' && 'text-accent-2',
            )}
          >
            {hint}
          </p>
        )}
      </div>
      <Button
        variant="primary"
        size="md"
        href={drillHref}
        className="flex-none after:absolute after:inset-0"
      >
        start →
      </Button>
    </div>
  );
}
