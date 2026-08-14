'use client';

import { Suspense, useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useSearchParams } from 'next/navigation';
import { createAuthenticatedFetch, useDiversity } from '@language-drill/api-client';

import { FilterSelect } from '../../../../components/admin/filter-select';
import { DiversityGlossary } from './_components/diversity-glossary';
import { DiversityPointRow } from './_components/diversity-point-row';

const LANGUAGES = ['ES', 'DE', 'TR'];
const LEVELS = ['A1', 'A2', 'B1', 'B2'];
const MECHANISMS = ['variants', 'curated-seeds', 'frequency-band', 'coverage-spec', 'none'];

function DiversityPageInner() {
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  const searchParams = useSearchParams();
  const [params, setParams] = useState<{
    language?: string; level?: string; mechanism?: string; issuesOnly?: boolean;
  }>(() => ({
    language: searchParams.get('language') ?? undefined,
    level: searchParams.get('level') ?? undefined,
    mechanism: searchParams.get('mechanism') ?? undefined,
    issuesOnly: searchParams.get('issuesOnly') === 'true' || undefined,
  }));
  const diversity = useDiversity({ fetchFn, params });

  const setParam = (k: 'language' | 'level' | 'mechanism', v: string) =>
    setParams((p) => ({ ...p, [k]: v || undefined }));

  if (diversity.isLoading)
    return <p className="text-[13px] text-ink-soft">Loading…</p>;
  if (diversity.isError || !diversity.data)
    return <p className="text-[13px] text-ink-soft">Failed to load diversity data.</p>;

  const { items, total } = diversity.data;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-[24px] font-semibold text-ink">Diversity</h1>
      <DiversityGlossary />

      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect aria-label="language" value={params.language ?? ''}
          onChange={(e) => setParam('language', e.target.value)}>
          <option value="">All languages</option>
          {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
        </FilterSelect>
        <FilterSelect aria-label="level" value={params.level ?? ''}
          onChange={(e) => setParam('level', e.target.value)}>
          <option value="">All levels</option>
          {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
        </FilterSelect>
        <FilterSelect aria-label="mechanism" value={params.mechanism ?? ''}
          onChange={(e) => setParam('mechanism', e.target.value)}>
          <option value="">All mechanisms</option>
          {MECHANISMS.map((m) => <option key={m} value={m}>{m}</option>)}
        </FilterSelect>
        <label className="flex items-center gap-1 text-[12px] text-ink-soft">
          <input type="checkbox" aria-label="issues only"
            checked={!!params.issuesOnly}
            onChange={(e) =>
              setParams((p) => ({ ...p, issuesOnly: e.target.checked || undefined }))
            } />
          only points with issues
        </label>
      </div>

      <p className="text-[12px] text-ink-soft">{items.length} of {total}</p>

      {items.length === 0 ? (
        <p className="text-[13px] text-ink-soft">No points match.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((p) => <DiversityPointRow key={p.key} point={p} />)}
        </ul>
      )}
    </div>
  );
}

export default function DiversityPage() {
  return (
    <Suspense fallback={<div className="p-s-6" />}>
      <DiversityPageInner />
    </Suspense>
  );
}
