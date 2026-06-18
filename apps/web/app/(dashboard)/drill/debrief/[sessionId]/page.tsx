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
import { DebriefLoadError } from '../_components/debrief-load-error';
import { DebriefSkeleton } from '../_components/debrief-skeleton';

interface DebriefPageProps {
  params: Promise<{ sessionId: string }>;
}

// A genuine 404 from the debrief endpoint means the session row was not found
// for (id ∧ userId ∧ completedAt). Everything else — 5xx, network, client-side
// schema parse failure — is a load failure: the user almost certainly owns
// the session and completed it, the request just didn't succeed. Distinct UI
// + retry. See design.md §"Network failure / 5xx fetch".
function isNotFoundError(error: Error | null): boolean {
  return (error as { status?: number } | null)?.status === 404;
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
        isNotFoundError(query.error) ? (
          <DebriefNotFound />
        ) : (
          <DebriefLoadError onRetry={() => query.refetch()} />
        )
      ) : (
        <>
          <DebriefHeader debrief={query.data} />
          <DebriefTabs active={tab} onChange={setTab}>
            {tab === 'debrief' ? (
              <DebriefTab debrief={query.data} />
            ) : (
              <ReviewTab items={query.data.items} fetchFn={fetchFn} />
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
