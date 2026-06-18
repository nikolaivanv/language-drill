'use client';

import { Suspense, useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useSearchParams } from 'next/navigation';
import {
  createAuthenticatedFetch,
  useCurriculum,
  useGenerationStats,
  usePoolStatus,
  useTheoryCoverage,
  useTheoryPoolStatus,
} from '@language-drill/api-client';
import type { PoolStatusTheoryItem } from '@language-drill/api-client';
import { ExerciseType } from '@language-drill/shared';
import { PoolCoverageTable } from './_components/pool-coverage-table';
import { GrammarPointCombobox } from '../../../../components/admin/grammar-point-combobox';
import { FilterSelect } from '../../../../components/admin/filter-select';

type Tab = 'exercises' | 'theory';
const EXERCISE_TYPES = Object.values(ExerciseType);
const THEORY_LANGUAGES = ['ES', 'DE', 'TR'] as const;
const THEORY_LEVELS = ['A1', 'A2', 'B1', 'B2'] as const;

function theoryStatusRank(i: PoolStatusTheoryItem): number {
  if (!i.hasApprovedPage && i.flaggedCount === 0) return 0; // missing
  if (i.flaggedCount > 0) return 1; // flagged (incl. approved-with-flags)
  return 2; // approved, clean
}

function theoryContentHref(i: PoolStatusTheoryItem): string {
  return `/admin/content?tab=theory&language=${encodeURIComponent(i.language)}&level=${encodeURIComponent(i.level)}&grammarPoint=${encodeURIComponent(i.grammarPointKey)}`;
}

function TheoryStatusBadge({ item }: { item: PoolStatusTheoryItem }) {
  if (item.hasApprovedPage) {
    return (
      <span className="text-[12px] text-ink-soft">
        ✓ approved{item.flaggedCount > 0 ? ` · ⚠ ${item.flaggedCount} flagged` : ''}
      </span>
    );
  }
  if (item.flaggedCount > 0) {
    return <span className="text-[12px] text-amber-700">⚠ {item.flaggedCount} flagged</span>;
  }
  return <span className="text-[12px] text-red-700">✗ missing</span>;
}

function PoolPageInner() {
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>(searchParams.get('tab') === 'theory' ? 'theory' : 'exercises');
  const [filters, setFilters] = useState<{ language?: string; level?: string; type?: string; grammarPoint?: string }>({});

  const poolStatus = usePoolStatus({ fetchFn, params: { language: filters.language, level: filters.level }, enabled: tab === 'exercises' });
  const stats = useGenerationStats({ fetchFn, enabled: tab === 'exercises' });
  const theory = useTheoryCoverage({ fetchFn, enabled: tab === 'theory' });
  const theoryPool = useTheoryPoolStatus({
    fetchFn,
    params: { language: filters.language, level: filters.level },
    enabled: tab === 'theory',
  });
  const curriculum = useCurriculum({ fetchFn, params: { language: filters.language, level: filters.level } });
  const grammarOptions = useMemo(
    () => (curriculum.data?.items ?? []).map((e: { key: string; name: string }) => ({ key: e.key, name: e.name })),
    [curriculum.data],
  );
  const theoryItems = useMemo(() => {
    const filtered = (theoryPool.data ?? []).filter(
      (i) => !filters.grammarPoint || i.grammarPointKey === filters.grammarPoint,
    );
    // Surface gaps first: missing → flagged → approved, then by key.
    return [...filtered].sort((a, b) => theoryStatusRank(a) - theoryStatusRank(b) || a.grammarPointKey.localeCompare(b.grammarPointKey));
  }, [theoryPool.data, filters.grammarPoint]);

  const setFilter = (key: keyof typeof filters, value: string) => {
    setFilters((f) => {
      const next = { ...f, [key]: value || undefined };
      if (key === 'language' || key === 'level') next.grammarPoint = undefined;
      return next;
    });
  };
  const clearFilters = () => setFilters({});
  const hasFilters = Boolean(filters.language || filters.level || filters.type || filters.grammarPoint);

  // pool-status filters language/level server-side; type + grammar point are client-side.
  const items = (poolStatus.data ?? []).filter(
    (i) => (!filters.type || i.type === filters.type) && (!filters.grammarPoint || i.grammarPointKey === filters.grammarPoint),
  );
  const approvalRates = (stats.data?.approvalRates ?? []).filter(
    (r) =>
      (!filters.language || r.language === filters.language) &&
      (!filters.level || r.level === filters.level) &&
      (!filters.type || r.type === filters.type),
  );

  const byKey = new Map<string, { approved: number; flagged: number; total: number }>();
  for (const row of theory.data?.rows ?? []) byKey.set(`${row.language}:${row.level}`, row);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-[24px] font-semibold text-ink">Pool</h1>

      <div className="flex gap-2" role="tablist">
        <button role="tab" id="tab-exercises" aria-controls="pool-panel" aria-selected={tab === 'exercises'}
          onClick={() => setTab('exercises')}
          className={tab === 'exercises' ? 'font-semibold text-ink' : 'text-ink-soft'}>Exercises</button>
        <button role="tab" id="tab-theory" aria-controls="pool-panel" aria-selected={tab === 'theory'}
          onClick={() => setTab('theory')}
          className={tab === 'theory' ? 'font-semibold text-ink' : 'text-ink-soft'}>Theory</button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <FilterSelect aria-label="language" value={filters.language ?? ''} onChange={(e) => setFilter('language', e.target.value)}>
          <option value="">All languages</option>
          {THEORY_LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
        </FilterSelect>
        <FilterSelect aria-label="level" value={filters.level ?? ''} onChange={(e) => setFilter('level', e.target.value)}>
          <option value="">All levels</option>
          {THEORY_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
        </FilterSelect>
        {tab === 'exercises' ? (
          <FilterSelect aria-label="type" value={filters.type ?? ''} onChange={(e) => setFilter('type', e.target.value)}>
            <option value="">All types</option>
            {EXERCISE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </FilterSelect>
        ) : null}
        <div className="min-w-[220px]">
          <GrammarPointCombobox options={grammarOptions} value={filters.grammarPoint ?? ''} onChange={(key) => setFilter('grammarPoint', key)} />
        </div>
        {hasFilters ? (
          <button type="button" onClick={clearFilters} className="text-[13px] text-ink-soft hover:text-ink">clear filters</button>
        ) : null}
      </div>

      <div id="pool-panel" role="tabpanel" aria-labelledby={tab === 'exercises' ? 'tab-exercises' : 'tab-theory'} className="flex flex-col gap-4">
        {tab === 'exercises' ? (
          poolStatus.isLoading ? <p className="text-ink-soft text-[13px]">Loading…</p>
          : poolStatus.isError ? <p className="text-ink-soft text-[13px]">Failed to load pool status.</p>
          : (
            <>
              {items.length === 0 ? (
                <p className="text-ink-soft text-[13px]">No matching cells.</p>
              ) : (
                <PoolCoverageTable items={items} />
              )}
              <section className="flex flex-col gap-2">
                <h2 className="text-ink-soft text-[12px]">Generation quality (30d)</h2>
                {approvalRates.length === 0 ? (
                  <p className="text-ink-soft text-[13px]">No generation jobs in the past 30 days.</p>
                ) : (
                  <table className="text-[13px]">
                    <thead>
                      <tr><th>Language</th><th>Level</th><th>Type</th><th>Approved</th><th>Flagged</th><th>Rejected</th>
                        <th title="Slots where all dedup retries collided — already included in Rejected.">Dedup</th>
                        <th title="approved / (approved + flagged + (rejected − dedup))">Rate %</th></tr>
                    </thead>
                    <tbody>
                      {approvalRates.map((row) => (
                        <tr key={`${row.language}:${row.level}:${row.type}`}>
                          <td>{row.language}</td><td>{row.level}</td><td>{row.type}</td>
                          <td>{row.approvedCount}</td><td>{row.flaggedCount}</td><td>{row.rejectedCount}</td>
                          <td>{row.dedupGivenUpCount}</td><td>{(row.approvalRate * 100).toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            </>
          )
        ) : (
          <div className="flex flex-col gap-4">
            {theory.isLoading ? <p className="text-ink-soft text-[13px]">Loading…</p>
              : theory.isError ? <p className="text-ink-soft text-[13px]">Failed to load theory coverage.</p>
              : (
                <table className="text-[13px]">
                  <thead>
                    <tr><th>Language</th>{THEORY_LEVELS.map((l) => <th key={l}>{l}</th>)}</tr>
                  </thead>
                  <tbody>
                    {THEORY_LANGUAGES.map((language) => (
                      <tr key={language}>
                        <td>{language}</td>
                        {THEORY_LEVELS.map((level) => {
                          const row = byKey.get(`${language}:${level}`);
                          if (!row || row.total === 0) return <td key={level}>—</td>;
                          const badge = row.approved === row.total ? '✓' : row.approved > 0 ? '⚠' : '✗';
                          const bg = row.approved === row.total ? 'bg-green-100' : row.approved > 0 ? 'bg-amber-100' : 'bg-red-100';
                          return (
                            <td key={level} className={bg}>
                              {row.approved}/{row.total} {badge}
                              {row.flagged > 0 && <span className="t-micro"> +{row.flagged} flagged</span>}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            <section className="flex flex-col gap-2">
              <h2 className="text-ink-soft text-[12px]">Grammar points</h2>
              {theoryPool.isLoading ? <p className="text-ink-soft text-[13px]">Loading…</p>
                : theoryPool.isError ? <p className="text-ink-soft text-[13px]">Failed to load theory pool status.</p>
                : theoryItems.length === 0 ? <p className="text-ink-soft text-[13px]">No matching grammar points.</p>
                : (
                  <ul className="flex flex-col gap-1">
                    {theoryItems.map((i) => (
                      <li key={`${i.language}:${i.grammarPointKey}`} className="flex items-center gap-2 flex-wrap border-b border-rule py-1 text-[13px]">
                        <span className="font-mono text-ink">{i.grammarPointKey}</span>
                        <span className="text-ink-soft">{i.name}</span>
                        <TheoryStatusBadge item={i} />
                        {(i.hasApprovedPage || i.flaggedCount > 0) ? (
                          <a className="text-accent-2 underline" href={theoryContentHref(i)}>view →</a>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

export default function PoolPage() {
  return (
    <Suspense fallback={<div className="p-s-6" />}>
      <PoolPageInner />
    </Suspense>
  );
}
