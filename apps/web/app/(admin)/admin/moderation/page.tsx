'use client';

import { useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import {
  createAuthenticatedFetch,
  useFlaggedExercises,
  useFlaggedTheory,
  useResolveFlaggedExercise,
  useResolveFlaggedTheory,
  type FlaggedExerciseFilters,
} from '@language-drill/api-client';
import { FlaggedExerciseCard } from './_components/flagged-exercise-card';
import { FlaggedTheoryCard } from './_components/flagged-theory-card';

type Tab = 'exercises' | 'theory';

export default function ModerationPage() {
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  const [tab, setTab] = useState<Tab>('exercises');
  const [filters, setFilters] = useState<FlaggedExerciseFilters>({});
  const [demotedId, setDemotedId] = useState<string | null>(null);

  const exercises = useFlaggedExercises({ fetchFn, filters, enabled: tab === 'exercises' });
  const theory = useFlaggedTheory({
    fetchFn,
    filters: { language: filters.language, level: filters.level, grammarPoint: filters.grammarPoint },
    enabled: tab === 'theory',
  });
  const resolveExercise = useResolveFlaggedExercise({ fetchFn });
  const resolveTheory = useResolveFlaggedTheory({ fetchFn });

  const setFilter = (key: keyof FlaggedExerciseFilters, value: string) =>
    setFilters((f) => ({ ...f, [key]: value || undefined }));

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-[24px] font-semibold text-ink">Moderation</h1>

      <div className="flex gap-2" role="tablist">
        <button
          role="tab"
          aria-selected={tab === 'exercises'}
          onClick={() => setTab('exercises')}
          className={tab === 'exercises' ? 'font-semibold text-ink' : 'text-ink-soft'}
        >
          Exercises{exercises.data ? ` (${exercises.data.total})` : ''}
        </button>
        <button
          role="tab"
          aria-selected={tab === 'theory'}
          onClick={() => setTab('theory')}
          className={tab === 'theory' ? 'font-semibold text-ink' : 'text-ink-soft'}
        >
          Theory{theory.data ? ` (${theory.data.total})` : ''}
        </button>
      </div>

      <div className="flex gap-2 flex-wrap text-[13px]">
        <select aria-label="language" value={filters.language ?? ''} onChange={(e) => setFilter('language', e.target.value)}>
          <option value="">All languages</option>
          <option value="ES">ES</option>
          <option value="DE">DE</option>
          <option value="TR">TR</option>
        </select>
        <select aria-label="level" value={filters.level ?? ''} onChange={(e) => setFilter('level', e.target.value)}>
          <option value="">All levels</option>
          <option value="A1">A1</option>
          <option value="A2">A2</option>
          <option value="B1">B1</option>
          <option value="B2">B2</option>
        </select>
        {tab === 'exercises' ? (
          <input
            aria-label="type"
            placeholder="type (e.g. cloze)"
            value={filters.type ?? ''}
            onChange={(e) => setFilter('type', e.target.value)}
          />
        ) : null}
        <input
          aria-label="grammar point"
          placeholder="grammar point"
          value={filters.grammarPoint ?? ''}
          onChange={(e) => setFilter('grammarPoint', e.target.value)}
        />
      </div>

      {tab === 'exercises' ? (
        <Section
          loading={exercises.isLoading}
          error={exercises.isError}
          count={exercises.data?.items.length ?? 0}
          total={exercises.data?.total ?? 0}
        >
          {exercises.data?.items.map((item) => (
            <FlaggedExerciseCard
              key={item.id}
              item={item}
              pending={resolveExercise.isPending}
              demoted={demotedId === item.id}
              onResolve={async (action) => {
                const outcome = await resolveExercise.mutateAsync({ id: item.id, action });
                setDemotedId(outcome === 'demoted' ? item.id : null);
              }}
            />
          ))}
        </Section>
      ) : (
        <Section
          loading={theory.isLoading}
          error={theory.isError}
          count={theory.data?.items.length ?? 0}
          total={theory.data?.total ?? 0}
        >
          {theory.data?.items.map((item) => (
            <FlaggedTheoryCard
              key={item.id}
              item={item}
              pending={resolveTheory.isPending}
              demoted={demotedId === item.id}
              onResolve={async (action) => {
                const outcome = await resolveTheory.mutateAsync({ id: item.id, action });
                setDemotedId(outcome === 'demoted' ? item.id : null);
              }}
            />
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({
  loading, error, count, total, children,
}: {
  loading: boolean; error: boolean; count: number; total: number; children: React.ReactNode;
}) {
  if (loading) return <p className="text-ink-soft text-[13px]">Loading…</p>;
  if (error) return <p className="text-ink-soft text-[13px]">Failed to load flagged items.</p>;
  if (count === 0) return <p className="text-ink-soft text-[13px]">No flagged items.</p>;
  return (
    <div className="flex flex-col gap-3">
      {count < total ? <p className="text-[12px] text-ink-soft">Showing {count} of {total}.</p> : null}
      {children}
    </div>
  );
}
