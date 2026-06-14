'use client';

import { useMemo } from 'react';
import { useAuth } from '@clerk/nextjs';
import {
  createAuthenticatedFetch,
  useLanguageProfiles,
  useProgressRadar,
  useProgressHeatmap,
  useFluencyStats,
  type RadarAxis,
} from '@language-drill/api-client';
import { useActiveLanguage } from '../../../components/shell/active-language-provider';
import { ProgressHeader } from './_components/progress-header';
import { ProgressTabs } from './_components/progress-tabs';
import { ShapeTab } from './_components/shape-tab';
import { HeatmapTab } from './_components/heatmap-tab';
import { FluencyTab } from './_components/fluency-tab';
import { HistoryTab } from './_components/history-tab';
import { ProgressEmptyState } from './_components/progress-empty-state';
import { useTabUrlState } from './_lib/use-tab-url-state';

const MS_PER_WEEK = 7 * 86_400_000;

export default function ProgressPage() {
  const { activeLanguage } = useActiveLanguage();
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);

  // Both queries fire in parallel on mount so switching tabs is instant.
  const radar = useProgressRadar({ fetchFn, language: activeLanguage });
  const heatmap = useProgressHeatmap({ fetchFn, language: activeLanguage });
  const fluency = useFluencyStats({ fetchFn, language: activeLanguage });

  // Read proficiency level from the language-profiles cache rather than
  // refetching — the dashboard layout already populated it.
  const profiles = useLanguageProfiles({ fetchFn });
  const proficiencyLevel =
    profiles.data?.profiles.find((p) => p.language === activeLanguage)
      ?.proficiencyLevel ?? null;

  const totalEvidence = sumEvidence(radar.data?.axes);
  const weeksActive = computeWeeksActive(radar.data?.axes);

  const { tab, setTab } = useTabUrlState();

  // Page-wide empty state: no exercise history at all in the active language.
  if (radar.data && totalEvidence === 0) {
    return <ProgressEmptyState language={activeLanguage} />;
  }

  return (
    <div>
      <ProgressHeader
        language={activeLanguage}
        proficiencyLevel={proficiencyLevel}
        weeksActive={weeksActive}
      />
      <ProgressTabs active={tab} onChange={setTab}>
        {tab === 'shape' && (
          <ShapeTab
            language={activeLanguage}
            data={radar.data}
            isLoading={radar.isLoading}
            error={radar.error}
            totalEvidence={totalEvidence}
            onRetry={() => {
              void radar.refetch();
            }}
          />
        )}
        {tab === 'heatmap' && (
          <HeatmapTab
            data={heatmap.data}
            isLoading={heatmap.isLoading}
            error={heatmap.error}
            onRetry={() => {
              void heatmap.refetch();
            }}
          />
        )}
        {tab === 'fluency' && (
          <FluencyTab
            data={fluency.data}
            isLoading={fluency.isLoading}
            error={fluency.error}
            onRetry={() => {
              void fluency.refetch();
            }}
          />
        )}
        {tab === 'history' && <HistoryTab />}
      </ProgressTabs>
    </div>
  );
}

function sumEvidence(axes: readonly RadarAxis[] | undefined): number {
  if (!axes) return 0;
  let total = 0;
  for (const a of axes) total += a.evidenceCount;
  return total;
}

function computeWeeksActive(
  axes: readonly RadarAxis[] | undefined,
): number | null {
  if (!axes) return null;
  let earliest = Number.POSITIVE_INFINITY;
  for (const a of axes) {
    if (a.lastPracticedAt === null) continue;
    const t = new Date(a.lastPracticedAt).getTime();
    if (Number.isFinite(t) && t < earliest) earliest = t;
  }
  if (!Number.isFinite(earliest)) return null;
  const weeks = Math.floor((Date.now() - earliest) / MS_PER_WEEK);
  return weeks < 0 ? 0 : weeks;
}
