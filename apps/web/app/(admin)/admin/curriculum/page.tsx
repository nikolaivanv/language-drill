'use client';

import { useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { createAuthenticatedFetch, useCurriculum, type CurriculumEntry } from '@language-drill/api-client';
import { Chip } from '../../../../components/ui';

const LANGUAGES = ['ES', 'DE', 'TR'];
const LEVELS = ['A1', 'A2', 'B1', 'B2'];
const KINDS = ['grammar', 'vocab', 'dictation', 'free-writing'];

export default function CurriculumPage() {
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  const [params, setParams] = useState<{ language?: string; level?: string; kind?: string }>({});
  const [text, setText] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const curriculum = useCurriculum({ fetchFn, params });

  const setParam = (k: 'language' | 'level' | 'kind', v: string) =>
    setParams((p) => ({ ...p, [k]: v || undefined }));

  if (curriculum.isLoading) return <p className="text-ink-soft text-[13px]">Loading…</p>;
  if (curriculum.isError || !curriculum.data)
    return <p className="text-ink-soft text-[13px]">Failed to load the curriculum.</p>;

  const { items, total, curriculumVersionByLanguage } = curriculum.data;
  const q = text.trim().toLowerCase();
  const visible = q
    ? items.filter((e) => e.key.toLowerCase().includes(q) || e.name.toLowerCase().includes(q))
    : items;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-[24px] font-semibold text-ink">Curriculum</h1>
      <p className="text-[12px] text-ink-soft">
        Versions — ES {curriculumVersionByLanguage.ES} · DE {curriculumVersionByLanguage.DE} · TR{' '}
        {curriculumVersionByLanguage.TR}
      </p>

      <div className="flex gap-2 flex-wrap items-center text-[13px]">
        <select aria-label="language" value={params.language ?? ''} onChange={(e) => setParam('language', e.target.value)}>
          <option value="">All languages</option>
          {LANGUAGES.map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
        <select aria-label="level" value={params.level ?? ''} onChange={(e) => setParam('level', e.target.value)}>
          <option value="">All levels</option>
          {LEVELS.map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
        <select aria-label="kind" value={params.kind ?? ''} onChange={(e) => setParam('kind', e.target.value)}>
          <option value="">All kinds</option>
          {KINDS.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
        <input
          aria-label="filter"
          placeholder="filter by key or name"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>

      <p className="text-[12px] text-ink-soft">
        {visible.length} of {total}
      </p>

      {visible.length === 0 ? (
        <p className="text-ink-soft text-[13px]">No entries match.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {visible.map((e) => (
            <li key={e.key} className="flex flex-col gap-1 border-b border-rule py-1">
              <button
                type="button"
                className="flex gap-2 items-center flex-wrap text-left text-[13px]"
                onClick={() => setOpen(open === e.key ? null : e.key)}
              >
                <span className="font-mono text-ink">{e.key}</span>
                <span className="text-ink-soft">[{e.kind}]</span>
                <span className="text-ink">{e.name}</span>
                <span className="text-ink-soft">{e.cefrLevel}</span>
                {e.clozeUnsuitable && <Chip>cloze-unsuitable</Chip>}
                {e.sentenceConstructionSuitable && <Chip>SC</Chip>}
                {e.conjugationSuitable && <Chip>conjugation</Chip>}
                {e.coverageSpec && <Chip>coverage</Chip>}
                {e.targetOverride !== null && <Chip>target {e.targetOverride}</Chip>}
              </button>
              {open === e.key && <CurriculumDetail entry={e} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CurriculumDetail({ entry }: { entry: CurriculumEntry }) {
  const poolHref = `/admin/content?language=${entry.language}&level=${entry.cefrLevel}&grammarPoint=${encodeURIComponent(entry.key)}`;
  return (
    <div className="flex flex-col gap-1 text-[12px] text-ink-soft pl-2">
      <p className="text-ink">{entry.description}</p>
      {entry.examplesPositive.length > 0 && (
        <p className="flex gap-1 flex-wrap items-center">
          Positive:{' '}
          {entry.examplesPositive.map((ex) => (
            <Chip key={ex} variant="ok">{ex}</Chip>
          ))}
        </p>
      )}
      {entry.examplesNegative.length > 0 && (
        <p className="flex gap-1 flex-wrap items-center">
          Negative:{' '}
          {entry.examplesNegative.map((ex) => (
            <Chip key={ex}>{ex}</Chip>
          ))}
        </p>
      )}
      {entry.commonErrors.length > 0 && <p>Common errors: {entry.commonErrors.join(' · ')}</p>}
      {entry.prerequisiteKeys.length > 0 && <p>Prerequisites: {entry.prerequisiteKeys.join(', ')}</p>}
      {entry.coverageSpec && (
        <p>
          Coverage:{' '}
          {entry.coverageSpec.axes
            .map((a) => `${a.name} {${Object.entries(a.floors).map(([k, v]) => `${k}:${v}`).join(', ')}}`)
            .join(' · ')}
        </p>
      )}
      {entry.freeWritingRegister && <p>Free-writing register: {entry.freeWritingRegister}</p>}
      <p>Drives: {entry.exerciseTypes.join(', ')}</p>
      <a className="text-accent underline" href={poolHref}>
        View pool content →
      </a>
    </div>
  );
}
