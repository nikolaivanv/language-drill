'use client';

import { useRouter } from 'next/navigation';
import { Button } from '../../../../../components/ui';
import type { AccuracyTier } from '../../../../../lib/drill/accuracy-tier';

// ---------------------------------------------------------------------------
// DebriefFooter — three-button action footer at the bottom of the debrief
// page. Routes are fixed in v1 (Req 6.2–6.4); the `tier` prop is accepted
// now so future copy variations (e.g., "celebrate" CTA on high tier) can
// land without a breaking signature change.
// ---------------------------------------------------------------------------

export interface DebriefFooterProps {
  // Reserved for future tier-keyed copy variants — see component-doc note above.
  tier: AccuracyTier;
}

export function DebriefFooter(_props: DebriefFooterProps) {
  const router = useRouter();

  return (
    // Desktop: a right-aligned action row at the end of the page. Mobile
    // (≤760px): a sticky bottom action bar — the primary "another session"
    // CTA plus the two secondary actions, each ≥44px tall (Req 7.5, 11.1).
    <div className="mt-s-7 pt-s-5 border-t border-rule flex justify-between items-center mobile:sticky mobile:bottom-0 mobile:z-40 mobile:mt-0 mobile:flex-col mobile:items-stretch mobile:gap-[8px] mobile:bg-paper mobile:py-[12px]">
      <Button
        variant="ghost"
        className="mobile:min-h-[44px]"
        onClick={() => router.push('/progress')}
      >
        see your progress →
      </Button>
      <div className="flex gap-s-3 mobile:gap-[8px]">
        <Button
          variant="ghost"
          className="mobile:min-h-[44px] mobile:flex-1"
          onClick={() => router.push('/')}
        >
          done
        </Button>
        <Button
          variant="primary"
          className="mobile:min-h-[44px] mobile:flex-1"
          onClick={() => router.push('/drill?start=quick')}
        >
          another session
        </Button>
      </div>
    </div>
  );
}
