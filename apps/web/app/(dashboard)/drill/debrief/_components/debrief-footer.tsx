'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '../../../../../components/ui';
import type { AccuracyTier } from '../../../../../lib/drill/accuracy-tier';

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
// The `tier` prop is accepted now so future copy variants (e.g. a celebrate
// CTA on high tier) can land without a breaking signature change.
// ---------------------------------------------------------------------------

export interface DebriefFooterProps {
  // Reserved for future tier-keyed copy variants.
  tier: AccuracyTier;
}

export function DebriefFooter(_props: DebriefFooterProps) {
  const router = useRouter();

  return (
    <div
      className="mt-s-7 pt-s-5 border-t border-rule flex items-center justify-between mobile:flex-col mobile:items-stretch mobile:gap-[8px]"
    >
      {/* Desktop left / mobile last: progress link */}
      <Link
        href="/progress"
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
          onClick={() => router.push('/drill')}
        >
          practice more
        </Button>
      </div>
    </div>
  );
}
