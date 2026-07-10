'use client';

import { useMemo, useCallback } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useQueryClient } from '@tanstack/react-query';
import {
  createAuthenticatedFetch,
  useLanguageProfiles,
  useGetPreferences,
  useUpdateLanguages,
  useProgressRadar,
  useFluencyStats,
  useErrorTrends,
  useCurriculumMap,
  useInsightsErrors,
  useVocabTopics,
  type RadarAxis,
} from '@language-drill/api-client';
import { CefrLevel, Language, type LearningLanguage } from '@language-drill/shared';
import { useActiveLanguage } from '../../../components/shell/active-language-provider';
import { ProgressHeader } from './_components/progress-header';
import { ProgressTabs } from './_components/progress-tabs';
import { MapTab } from './_components/map-tab';
import { WordsTab } from './_components/words-tab';
import { ShapeTab } from './_components/shape-tab';
import { FluencyTab } from './_components/fluency-tab';
import { HistoryTab } from './_components/history-tab';
import { useTabUrlState } from './_lib/use-tab-url-state';
import { withAdvancedLevel } from './_lib/advance-level';

const MS_PER_WEEK = 7 * 86_400_000;

export default function ProgressPage() {
  const { activeLanguage } = useActiveLanguage();
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  const queryClient = useQueryClient();

  // All queries fire in parallel on mount so switching tabs is instant.
  const radar = useProgressRadar({ fetchFn, language: activeLanguage });
  const fluency = useFluencyStats({ fetchFn, language: activeLanguage });
  const history = useErrorTrends({ fetchFn, language: activeLanguage });
  const curriculum = useCurriculumMap({ fetchFn, language: activeLanguage });
  const insights = useInsightsErrors({ fetchFn, language: activeLanguage });
  const vocabTopics = useVocabTopics({ fetchFn, language: activeLanguage });

  // Read proficiency level from the language-profiles cache rather than
  // refetching — the dashboard layout already populated it.
  const languageProfiles = useLanguageProfiles({ fetchFn });
  const prefs = useGetPreferences({ fetchFn });
  const update = useUpdateLanguages({ fetchFn });

  const proficiencyLevel =
    languageProfiles.data?.profiles.find((p) => p.language === activeLanguage)
      ?.proficiencyLevel ?? null;

  const totalEvidence = sumEvidence(radar.data?.axes);
  const weeksActive = computeWeeksActive(radar.data?.axes);

  const { tab, setTab } = useTabUrlState();

  const handleAdvance = useCallback(() => {
    const profiles = languageProfiles.data?.profiles;
    const primaryLanguage = prefs.data?.primaryLanguage;
    const nextLevelRaw = curriculum.data?.levels.find((l) => l.isPreview)?.level;
    if (!profiles || !primaryLanguage || !nextLevelRaw) return;
    // Validate nextLevel is a valid CefrLevel
    const validLevels = Object.values(CefrLevel) as string[];
    if (!validLevels.includes(nextLevelRaw)) return;
    const nextLevel = nextLevelRaw as CefrLevel;
    const nextProfiles = withAdvancedLevel(profiles, activeLanguage, nextLevel);
    // EN rows can't be advanced (PUT accepts learning languages only); filter them out — matches the settings precedent.
    const learningProfiles = nextProfiles.filter(
      (p): p is { language: LearningLanguage; proficiencyLevel: CefrLevel } =>
        p.language !== Language.EN,
    );
    update.mutate(
      { profiles: learningProfiles, primaryLanguage },
      {
        onSuccess: () => {
          for (const key of [
            ['languageProfiles'],
            ['curriculumMap', activeLanguage],
            ['todayPlan', activeLanguage],
            ['progressRadar', activeLanguage],
          ]) {
            void queryClient.invalidateQueries({ queryKey: key });
          }
        },
      },
    );
  }, [languageProfiles.data, prefs.data, curriculum.data, activeLanguage, update, queryClient]);

  // A brand-new user with no exercise history still gets the full tabbed page.
  // The curriculum Map renders from the language's curriculum (every point
  // simply shows as "not started"), and each evidence-driven tab (Shape /
  // Fluency / History) owns its own gentle empty state. We no longer
  // short-circuit the whole page to a single "do your first drill" card.
  return (
    <div>
      <ProgressHeader
        language={activeLanguage}
        proficiencyLevel={proficiencyLevel}
        weeksActive={weeksActive}
      />
      <ProgressTabs active={tab} onChange={setTab}>
        {tab === 'map' && (
          <MapTab
            data={curriculum.data}
            isLoading={curriculum.isLoading}
            error={curriculum.error}
            onRetry={() => { void curriculum.refetch(); }}
            errorThemes={insights.data?.themes ?? []}
            onAdvance={handleAdvance}
            advancing={update.isPending}
          />
        )}
        {tab === 'words' && (
          <WordsTab
            data={vocabTopics.data}
            isLoading={vocabTopics.isLoading}
            isError={vocabTopics.isError}
            onRetry={() => {
              void vocabTopics.refetch();
            }}
          />
        )}
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
        {tab === 'history' && (
          <HistoryTab
            data={history.data}
            isLoading={history.isLoading}
            error={history.error}
            onRetry={() => {
              void history.refetch();
            }}
          />
        )}
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
