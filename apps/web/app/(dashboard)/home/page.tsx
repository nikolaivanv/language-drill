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
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { useQueryClient } from '@tanstack/react-query';
import {
  createAuthenticatedFetch,
  useCurriculumMap,
  useGetPreferences,
  useInsightsErrors,
  useProgressRadar,
  useTodayPlan,
  useUpdatePreferences,
} from '@language-drill/api-client';
import { composePathCue } from '../_lib/path-cue';
import { type DailyGoal } from '@language-drill/shared';
import { useActiveLanguage } from '../../../components/shell/active-language-provider';
import { useIsMobile } from '../../../lib/responsive';
import { DailyLoadControl } from '../_components/daily-load-control';
import { DashboardHeader } from '../_components/dashboard-header';
import { NextUpCard } from '../_components/next-up-card';
import { ReadCollectCard } from '../_components/read-collect-card';
import { SkillSnapshotGrid } from '../_components/skill-snapshot-grid';
import { TodayTimeline } from '../_components/today-timeline';
import { WorkOnThese } from '../_components/work-on-these';

export default function DashboardPage() {
  const { activeLanguage } = useActiveLanguage();
  const { getToken } = useAuth();
  const fetchFn = useMemo(
    () => createAuthenticatedFetch(getToken),
    [getToken],
  );
  const queryClient = useQueryClient();

  // All queries fire in parallel on mount via TanStack Query.
  const todayPlan = useTodayPlan({ fetchFn, language: activeLanguage });
  const radar = useProgressRadar({ fetchFn, language: activeLanguage });
  const insights = useInsightsErrors({ fetchFn, language: activeLanguage });
  const prefs = useGetPreferences({ fetchFn });
  const updatePrefs = useUpdatePreferences({ fetchFn });
  const curriculum = useCurriculumMap({ fetchFn, language: activeLanguage });

  const pathCue = composePathCue(curriculum.data);

  const isMobile = useIsMobile();

  const handleDailyGoalSelect = (g: DailyGoal) => {
    updatePrefs.mutate(
      { dailyGoal: g },
      {
        onSuccess: () => {
          // Invalidate the today-plan query so the plan length updates.
          void queryClient.invalidateQueries({
            queryKey: ['todayPlan', activeLanguage],
          });
        },
      },
    );
  };

  return (
    <div className="space-y-s-7">
      <DashboardHeader
        axes={radar.data?.axes}
        totalEstimatedMinutes={todayPlan.data?.totalEstimatedMinutes ?? null}
        planItems={todayPlan.data?.items}
      />
      {/* Mobile-only one-tap CTA directly under the greeting (Req 4.2). */}
      {isMobile && (
        <NextUpCard data={todayPlan.data} language={activeLanguage} />
      )}
      <DailyLoadControl
        current={prefs.data?.dailyGoal ?? null}
        onSelect={handleDailyGoalSelect}
        disabled={updatePrefs.isPending}
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
      {pathCue && (
        <div className="flex items-baseline justify-between gap-s-6 mobile:flex-col mobile:items-start mobile:gap-s-2">
          <p className="t-micro text-ink-mute">
            {"you're around "}
            <span className="font-medium">{pathCue.positionLabel}</span>
            {pathCue.nextName && (
              <>
                {' · next: '}
                <span className="font-medium">{pathCue.nextName}</span>
              </>
            )}
          </p>
          <Link href="/progress" className="link-arrow">
            see the map →
          </Link>
        </div>
      )}
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
