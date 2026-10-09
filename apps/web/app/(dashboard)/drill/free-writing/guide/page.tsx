'use client';

import { Suspense, useMemo } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useRouter, useSearchParams } from 'next/navigation';
import { CefrLevel } from '@language-drill/shared';
import { useLanguageProfiles, createAuthenticatedFetch } from '@language-drill/api-client';
import { useActiveLanguage } from '../../../../../components/shell';
import { FwGuide } from '../_components/fw-guide';
import {
  bandForLevel,
  isWritingGuideBand,
  type WritingGuideBand,
} from '../../../../../content/writing-guides';
import '../free-writing.css';

const GUIDE_PATH = '/drill/free-writing/guide';

function FreeWritingGuide() {
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { activeLanguage } = useActiveLanguage();
  const profiles = useLanguageProfiles({ fetchFn });

  const requested = searchParams.get('band');
  const override = isWritingGuideBand(requested) ? requested : null;

  // Without an explicit band, wait for the profile so the page never renders
  // the default band and then jumps to the learner's real one.
  if (!override && profiles.isPending) {
    return <div className="t-body" style={{ padding: 24 }}>loading…</div>;
  }

  // Same resolution as the free-writing page: profile level for the active
  // language, defaulting to B1 — so the brief and its guide always agree.
  const level =
    (profiles.data?.profiles.find((p) => p.language === activeLanguage)?.proficiencyLevel as CefrLevel) ??
    CefrLevel.B1;
  const band = override ?? bandForLevel(level);

  const onBandChange = (next: WritingGuideBand) => {
    router.replace(`${GUIDE_PATH}?band=${next}`, { scroll: false });
  };

  return <FwGuide language={activeLanguage} band={band} onBandChange={onBandChange} />;
}

// `useSearchParams()` opts this client page out of static prerendering; Next
// requires that bailout to sit under a Suspense boundary.
export default function FreeWritingGuidePage() {
  return (
    <Suspense fallback={<div className="t-body" style={{ padding: 24 }}>loading…</div>}>
      <FreeWritingGuide />
    </Suspense>
  );
}
