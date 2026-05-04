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
  useProgressRadar,
  useTodayPlan,
} from '@language-drill/api-client';
import { useActiveLanguage } from '../../components/shell/active-language-provider';
import { DashboardHeader } from './_components/dashboard-header';
import { ReadCollectCard } from './_components/read-collect-card';
import { SkillSnapshotGrid } from './_components/skill-snapshot-grid';
import { TodayTimeline } from './_components/today-timeline';

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

  return (
    <div className="space-y-s-7">
      <DashboardHeader
        language={activeLanguage}
        firstName={user?.firstName ?? null}
        axes={radar.data?.axes}
        totalEstimatedMinutes={todayPlan.data?.totalEstimatedMinutes ?? null}
      />
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
