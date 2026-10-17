'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ExerciseType } from '@language-drill/shared';
import { Button } from '../../../../../components/ui';

// ---------------------------------------------------------------------------
// DebriefFooter — three-action row at the bottom of the debrief page.
//
// Desktop (>760px): `see your progress →` link on the left,
//   [ghost done] [primary practice more] group on the right.
//   Layout: flex items-center justify-between.
//
// Mobile (≤760px): stacked column — primary first, ghost second,
//   then the link centered below.
//
// A targeted session (one grammar point / vocab group and/or one exercise
// type) makes "practice more" start another session with the same filters, and
// a vocab session points "see your progress" at the Words tab. Untargeted
// quick drills keep the hub + overview destinations.
// ---------------------------------------------------------------------------

interface DebriefFooterProps {
  grammarPointKey?: string | null;
  exerciseType?: ExerciseType | null;
}

export function practiceMoreHref({ grammarPointKey, exerciseType }: DebriefFooterProps): string {
  if (!grammarPointKey && !exerciseType) return '/drill';
  const params = new URLSearchParams({ start: 'quick' });
  if (grammarPointKey) params.set('grammarPoint', grammarPointKey);
  if (exerciseType) params.set('exerciseType', exerciseType);
  return `/drill?${params.toString()}`;
}

export function DebriefFooter({ grammarPointKey = null, exerciseType = null }: DebriefFooterProps = {}) {
  const router = useRouter();
  const progressHref =
    exerciseType === ExerciseType.VOCAB_RECALL ? '/progress?tab=words' : '/progress';

  return (
    <div
      className="mt-s-7 pt-s-5 border-t border-rule flex items-center justify-between mobile:flex-col mobile:items-stretch mobile:gap-[8px]"
    >
      {/* Desktop left / mobile last: progress link */}
      <Link
        href={progressHref}
        className="link-arrow mobile:order-last mobile:self-center mobile:pt-s-2"
      >
        see your progress <span className="lk-arr" aria-hidden="true">→</span>
      </Link>

      {/* Desktop right: [ghost done] [primary practice more]
          Mobile: primary first, ghost second (order utilities flip the pair). */}
      <div className="flex gap-s-3 mobile:flex-col mobile:gap-[8px]">
        {/* Desktop: first in DOM = left of pair. Mobile: order-last pushes it below primary. */}
        <Button
          variant="ghost"
          className="mobile:min-h-[44px] mobile:order-last"
          onClick={() => router.push('/')}
        >
          done
        </Button>
        {/* Desktop: second in DOM = right of pair. Mobile: order-first keeps it on top. */}
        <Button
          variant="primary"
          className="mobile:min-h-[44px] mobile:order-first"
          onClick={() => router.push(practiceMoreHref({ grammarPointKey, exerciseType }))}
        >
          practice more
        </Button>
      </div>
    </div>
  );
}
