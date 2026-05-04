// ---------------------------------------------------------------------------
// TimelineItem — one row of the today's-plan vertical rail
// ---------------------------------------------------------------------------
// The rail circle, the body (title + subtitle + chip), the planned-time, and
// the optional `start →` primary button live here. The connecting line is
// rendered inline (under the circle) when the item is not the last in the rail.
//
// `status === 'next-up'` is a render-only flag derived in the parent; the wire
// schema only carries `done | queued`. See design.md §"Component 5" for the
// rationale.
// ---------------------------------------------------------------------------

import type { ExerciseType } from '@language-drill/shared';
import { Button, Chip } from '../../../components/ui';
import { cn } from '../../../lib/cn';
import { composeSubtitle, composeTitle } from '../_lib/timeline-labels';

export type TimelineItemStatus = 'done' | 'queued' | 'next-up';

type Props = {
  index: number;
  type: ExerciseType;
  topicHint: string | null;
  itemCount: number;
  estimatedMinutes: number;
  status: TimelineItemStatus;
  isLast: boolean;
  href: string | null;
};

export function TimelineItem({
  index,
  type,
  topicHint,
  itemCount,
  estimatedMinutes,
  status,
  isLast,
  href,
}: Props) {
  const title = composeTitle(index, type);
  const subtitle = composeSubtitle(topicHint, type, itemCount);
  const isDone = status === 'done';
  const isNextUp = status === 'next-up';
  const numberLabel = String(index).padStart(2, '0');

  return (
    <li
      aria-label={`${index}. ${title}, ${status}`}
      className="flex gap-[18px]"
    >
      {/* Rail: circle + (optional) connecting line */}
      <div className="flex flex-shrink-0 flex-col items-center">
        <div
          className={cn(
            'flex h-[38px] w-[38px] items-center justify-center rounded-full border-[1.5px] font-mono text-[12px] font-semibold',
            isDone && 'border-ok bg-ok text-paper',
            isNextUp &&
              'border-accent bg-accent text-paper shadow-[0_0_0_4px_var(--color-accent-soft)]',
            !isDone && !isNextUp && 'border-ink bg-paper text-ink',
          )}
          aria-hidden
        >
          {isDone ? '✓' : numberLabel}
        </div>
        {!isLast && (
          <div className="my-s-1 min-h-[28px] w-[1.5px] flex-1 bg-rule" />
        )}
      </div>

      {/* Body */}
      <div
        className={cn(
          'flex-1 pb-s-6',
          isDone && 'opacity-55',
        )}
      >
        <div className="flex items-start justify-between gap-s-4">
          <div className="flex-1">
            <div className="flex items-center gap-s-3">
              <h3
                className={cn(
                  't-display-s',
                  isDone && 'line-through',
                )}
              >
                {title}
              </h3>
              {isNextUp && <Chip variant="accent">next up</Chip>}
              {isDone && <Chip variant="ok">done</Chip>}
            </div>
            <p className="t-body mt-s-1">{subtitle}</p>
          </div>

          <div className="flex flex-shrink-0 items-center gap-s-3">
            <span className="t-mono text-[12px] text-ink-mute">
              {estimatedMinutes} min
            </span>
            {isNextUp && href && (
              <Button variant="primary" size="md" href={href}>
                start →
              </Button>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}
