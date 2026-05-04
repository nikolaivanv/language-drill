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
    <div className="mt-s-7 pt-s-5 border-t border-rule flex justify-between items-center">
      <Button variant="ghost" onClick={() => router.push('/progress')}>
        see your progress →
      </Button>
      <div className="flex gap-s-3">
        <Button variant="ghost" onClick={() => router.push('/')}>
          done
        </Button>
        <Button variant="primary" onClick={() => router.push('/drill')}>
          another session
        </Button>
      </div>
    </div>
  );
}
