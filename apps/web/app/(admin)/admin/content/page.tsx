'use client';

import { useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import {
  createAuthenticatedFetch,
  useContentExercises, useContentTheory,
  useResolveContentExercise, useResolveContentTheory,
  type ContentExerciseParams,
} from '@language-drill/api-client';
import { ContentExerciseCard } from './_components/content-exercise-card';
import { ContentTheoryCard } from './_components/content-theory-card';

type Tab = 'exercises' | 'theory';
const PAGE_SIZE = 25;

export default function ContentPage() {
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  const [tab, setTab] = useState<Tab>('exercises');
  const [filters, setFilters] = useState<{ language?: string; level?: string; type?: string; grammarPoint?: string }>({});
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [demotedId, setDemotedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const exerciseParams: ContentExerciseParams = { ...filters, q: q || undefined, limit: PAGE_SIZE, offset };
  const theoryParams = { language: filters.language, level: filters.level, grammarPoint: filters.grammarPoint, q: q || undefined, limit: PAGE_SIZE, offset };

  const exercises = useContentExercises({ fetchFn, params: exerciseParams, enabled: tab === 'exercises' });
  const theory = useContentTheory({ fetchFn, params: theoryParams, enabled: tab === 'theory' });
  const resolveExercise = useResolveContentExercise({ fetchFn });
  const resolveTheory = useResolveContentTheory({ fetchFn });

  const active = tab === 'exercises' ? exercises : theory;
  const total = active.data?.total ?? 0;

  const switchTab = (next: Tab) => { setTab(next); setOffset(0); setDemotedId(null); setError(null); };
  const setFilter = (key: keyof typeof filters, value: string) => {
    setFilters((f) => ({ ...f, [key]: value || undefined }));
    setOffset(0);
  };
  const onSearch = (value: string) => { setQ(value); setOffset(0); };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-[24px] font-semibold text-ink">Content</h1>
      {error ? <p role="alert" className="text-[13px] text-red-600">{error}</p> : null}

      <div className="flex gap-2" role="tablist">
        <button role="tab" id="tab-exercises" aria-controls="content-panel" aria-selected={tab === 'exercises'}
          onClick={() => switchTab('exercises')}
          className={tab === 'exercises' ? 'font-semibold text-ink' : 'text-ink-soft'}>Exercises</button>
        <button role="tab" id="tab-theory" aria-controls="content-panel" aria-selected={tab === 'theory'}
          onClick={() => switchTab('theory')}
          className={tab === 'theory' ? 'font-semibold text-ink' : 'text-ink-soft'}>Theory</button>
      </div>

      <div className="flex gap-2 flex-wrap text-[13px]">
        <select aria-label="language" value={filters.language ?? ''} onChange={(e) => setFilter('language', e.target.value)}>
          <option value="">All languages</option><option value="ES">ES</option><option value="DE">DE</option><option value="TR">TR</option>
        </select>
        <select aria-label="level" value={filters.level ?? ''} onChange={(e) => setFilter('level', e.target.value)}>
          <option value="">All levels</option><option value="A1">A1</option><option value="A2">A2</option><option value="B1">B1</option><option value="B2">B2</option>
        </select>
        {tab === 'exercises' ? (
          <input aria-label="type" placeholder="type (e.g. cloze)" value={filters.type ?? ''} onChange={(e) => setFilter('type', e.target.value)} />
        ) : null}
        <input aria-label="grammar point" placeholder="grammar point" value={filters.grammarPoint ?? ''} onChange={(e) => setFilter('grammarPoint', e.target.value)} />
        <input aria-label="search" placeholder="search text" value={q} onChange={(e) => onSearch(e.target.value)} />
      </div>

      <div id="content-panel" role="tabpanel" aria-labelledby={tab === 'exercises' ? 'tab-exercises' : 'tab-theory'} className="flex flex-col gap-3">
        {active.isLoading ? <p className="text-ink-soft text-[13px]">Loading…</p>
          : active.isError ? <p className="text-ink-soft text-[13px]">Failed to load content.</p>
          : (active.data?.items.length ?? 0) === 0 ? <p className="text-ink-soft text-[13px]">No matching items.</p>
          : (
            <>
              <p className="text-[12px] text-ink-soft">
                {total} match{total === 1 ? '' : 'es'} · page {Math.floor(offset / PAGE_SIZE) + 1}/{Math.max(1, Math.ceil(total / PAGE_SIZE))}
              </p>
              {tab === 'exercises'
                ? exercises.data?.items.map((item) => (
                    <ContentExerciseCard key={item.id} item={item} pending={resolveExercise.isPending} demoted={demotedId === item.id}
                      onResolve={async (action) => {
                        try {
                          const outcome = await resolveExercise.mutateAsync({ id: item.id, action });
                          setDemotedId(outcome === 'demoted' ? item.id : null); setError(null);
                        } catch { setError('Failed to update item. Please try again.'); }
                      }} />
                  ))
                : theory.data?.items.map((item) => (
                    <ContentTheoryCard key={item.id} item={item} pending={resolveTheory.isPending} demoted={demotedId === item.id}
                      onResolve={async (action) => {
                        try {
                          const outcome = await resolveTheory.mutateAsync({ id: item.id, action });
                          setDemotedId(outcome === 'demoted' ? item.id : null); setError(null);
                        } catch { setError('Failed to update item. Please try again.'); }
                      }} />
                  ))}
              <div className="flex gap-2 items-center text-[13px]">
                <button disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))} className="text-ink-soft disabled:opacity-40">‹ prev</button>
                <button disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset((o) => o + PAGE_SIZE)} className="text-ink-soft disabled:opacity-40">next ›</button>
              </div>
            </>
          )}
      </div>
    </div>
  );
}
