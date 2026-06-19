'use client';

// ---------------------------------------------------------------------------
// Dashboard page — Phase D editorial layout
// ---------------------------------------------------------------------------
// Composes the four sections in order:
//   1. <DashboardHeader>      — greeting + framing paragraph + total minutes
//   2. <TodayTimeline>        — 5-item rail (or one of four state cards)
//   3. <hr className="border-rule" />
//   4. <SkillSnapshotGrid>    — 6-axis weakest-first snapshot
//   5. <ReadCollectCard>      — promotional CTA for /read
//
// All data fans out from two parallel TanStack Query hooks; per-section error
// boundaries live inside the orchestrators (a failed timeline doesn't break
// the snapshot, etc).
// ---------------------------------------------------------------------------

import { useMemo } from 'react';
import { useAuth, useUser } from '@clerk/nextjs';
import {
  createAuthenticatedFetch,
  useInsightsErrors,
  useProgressRadar,
  useTodayPlan,
} from '@language-drill/api-client';
import { useActiveLanguage } from '../../../components/shell/active-language-provider';
import { useIsMobile } from '../../../lib/responsive';
import { DashboardHeader } from '../_components/dashboard-header';
import { NextUpCard } from '../_components/next-up-card';
import { ReadCollectCard } from '../_components/read-collect-card';
import { SkillSnapshotGrid } from '../_components/skill-snapshot-grid';
import { TodayTimeline } from '../_components/today-timeline';
import { WorkOnThese } from '../_components/work-on-these';

export default function DashboardPage() {
  const { activeLanguage } = useActiveLanguage();
  const { getToken } = useAuth();
  const { user } = useUser();
  const fetchFn = useMemo(
    () => createAuthenticatedFetch(getToken),
    [getToken],
  );

  // Both queries fire in parallel on mount via TanStack Query.
  const todayPlan = useTodayPlan({ fetchFn, language: activeLanguage });
  const radar = useProgressRadar({ fetchFn, language: activeLanguage });
  const insights = useInsightsErrors({ fetchFn, language: activeLanguage });

  const isMobile = useIsMobile();

  return (
    <div className="space-y-s-7">
      <DashboardHeader
        language={activeLanguage}
        firstName={user?.firstName ?? null}
        axes={radar.data?.axes}
        totalEstimatedMinutes={todayPlan.data?.totalEstimatedMinutes ?? null}
      />
      {/* Mobile-only one-tap CTA directly under the greeting (Req 4.2). */}
      {isMobile && (
        <NextUpCard data={todayPlan.data} language={activeLanguage} />
      )}
      <TodayTimeline
        data={todayPlan.data}
        isLoading={todayPlan.isLoading}
        error={todayPlan.error}
        onRetry={() => {
          void todayPlan.refetch();
        }}
        language={activeLanguage}
      />
      <hr className="border-rule" />
      <WorkOnThese themes={insights.data?.themes ?? []} />
      <SkillSnapshotGrid
        data={radar.data}
        isLoading={radar.isLoading}
        error={radar.error}
        onRetry={() => {
          void radar.refetch();
        }}
        language={activeLanguage}
      />
      <ReadCollectCard />
    </div>
  );
}
