'use client';

import { use, useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import {
  createAuthenticatedFetch,
  useSessionDebrief,
} from '@language-drill/api-client';
import { accuracyTier } from '../../../../../lib/drill/accuracy-tier';
import { DebriefHeader } from '../_components/debrief-header';
import { DebriefTabs, type DebriefTabId } from '../_components/debrief-tabs';
import { DebriefTab } from '../_components/debrief-tab';
import { ReviewTab } from '../_components/review-tab';
import { DebriefFooter } from '../_components/debrief-footer';
import { DebriefNotFound } from '../_components/debrief-not-found';
import { DebriefSkeleton } from '../_components/debrief-skeleton';

interface DebriefPageProps {
  params: Promise<{ sessionId: string }>;
}

export default function DebriefPage({ params }: DebriefPageProps) {
  const { sessionId } = use(params);
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);

  const query = useSessionDebrief({ sessionId, fetchFn });
  const [tab, setTab] = useState<DebriefTabId>('debrief');

  return (
    <div className="mx-auto max-w-[920px] px-s-6">
      {query.isPending ? (
        <DebriefSkeleton />
      ) : query.isError ? (
        <DebriefNotFound />
      ) : (
        <>
          <DebriefHeader debrief={query.data} />
          <DebriefTabs active={tab} onChange={setTab}>
            {tab === 'debrief' ? (
              <DebriefTab debrief={query.data} />
            ) : (
              <ReviewTab items={query.data.items} />
            )}
          </DebriefTabs>
          <DebriefFooter
            tier={accuracyTier(
              query.data.correctCount,
              query.data.attemptedCount,
            )}
          />
        </>
      )}
    </div>
  );
}
