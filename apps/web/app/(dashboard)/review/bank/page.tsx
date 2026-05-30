'use client';

// ---------------------------------------------------------------------------
// Vocabulary bank (Req 12.1, 12.2, 12.6)
// ---------------------------------------------------------------------------
// Browse the saved words for the ACTIVE language, one row per lemma, with
// lemma / gloss · POS / CEFR / status / an SR-stability indicator / next-due
// (12.1). Free-text (lemma+gloss) and status filters — including a leech filter
// that surfaces lapsed words distinctly with a banner + accent indicator (12.2,
// 12.6). Each row deep-links to the word detail (task 48). Per-language only —
// the active language is the left-nav's single source of truth, never blended.
// ---------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import type { LearningLanguage, VocabReviewStatus } from '@language-drill/shared';
import {
  createAuthenticatedFetch,
  useVocabularyBank,
  type BankRow,
} from '@language-drill/api-client';
import { useActiveLanguage } from '../../../../components/shell';
import { Button, Card, Chip } from '../../../../components/ui';

const LANGUAGE_LABEL: Record<LearningLanguage, string> = {
  ES: 'español',
  DE: 'Deutsch',
  TR: 'Türkçe',
};

// 'all' is the sentinel for "no status filter" (the hook omits the param).
type StatusFilter = 'all' | VocabReviewStatus;

const STATUS_FILTERS: { id: StatusFilter; label: string; warn?: boolean }[] = [
  { id: 'all', label: 'all' },
  { id: 'new', label: 'new' },
  { id: 'learning', label: 'learning' },
  { id: 'mature', label: 'mature' },
  { id: 'leech', label: 'leeches', warn: true },
  { id: 'suspended', label: 'suspended' },
  { id: 'known', label: 'known' },
];

const STATUS_CHIP: Record<VocabReviewStatus, 'default' | 'ok' | 'accent' | 'solid'> = {
  new: 'default',
  learning: 'solid',
  mature: 'ok',
  leech: 'accent',
  suspended: 'default',
  known: 'ok',
};

// Stability bar saturates at ~30d (the "comfortably mature" mark in the proto).
function stabilityWidth(stability: number): number {
  return Math.min(100, Math.round((stability / 30) * 100));
}

function formatDue(dueAt: string, now: number): string {
  const due = new Date(dueAt).getTime();
  if (Number.isNaN(due)) return '—';
  if (due <= now) return 'now';
  const days = Math.ceil((due - now) / 86_400_000);
  if (days <= 0) return 'now';
  if (days === 1) return '1d';
  if (days < 30) return `${days}d`;
  return new Date(dueAt).toLocaleDateString();
}

export default function VocabularyBankPage() {
  const { activeLanguage } = useActiveLanguage();
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [q, setQ] = useState('');

  const bank = useVocabularyBank({
    fetchFn,
    language: activeLanguage,
    status: statusFilter === 'all' ? undefined : statusFilter,
    q: q.trim() ? q.trim() : undefined,
  });

  const langLabel = LANGUAGE_LABEL[activeLanguage];
  const rows = bank.data?.rows ?? [];

  return (
    <div className="space-y-s-6">
      <header className="space-y-s-2">
        <p className="t-micro text-ink-soft">vocabulary bank · {langLabel}</p>
        <h1 className="t-display-xl">your words.</h1>
        <p className="t-body max-w-[640px]">
          every lemma you&apos;ve saved or that we&apos;ve added from a passage. one row per lemma
          — surface forms live inside.
        </p>
      </header>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-s-2">
        {STATUS_FILTERS.map((f) => {
          const active = statusFilter === f.id;
          return (
            <button
              key={f.id}
              type="button"
              aria-pressed={active}
              onClick={() => setStatusFilter(f.id)}
              className={[
                'rounded-r-pill border px-s-3 py-[6px] text-[12px] transition-colors',
                active
                  ? 'border-ink bg-ink text-paper'
                  : f.warn
                    ? 'border-rule bg-card text-accent-2 hover:border-ink'
                    : 'border-rule bg-card text-ink-soft hover:border-ink',
              ].join(' ')}
            >
              {f.label}
            </button>
          );
        })}
        <span className="flex-1" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="search lemmas, glosses…"
          aria-label="search vocabulary"
          className="w-[240px] rounded-r-md border border-rule bg-card px-[12px] py-[8px] text-[13px] text-ink outline-none focus:border-ink"
        />
      </div>

      {/* Leech surfacing banner (Req 12.6) */}
      {statusFilter === 'leech' && rows.length > 0 && (
        <Card className="border-l-[3px] border-l-accent bg-[var(--color-accent-soft)]">
          <p className="t-body font-medium">
            these {rows.length} word{rows.length === 1 ? '' : 's'} have lapsed ≥ 3 times.
          </p>
          <p className="t-small text-ink-soft mt-s-1">
            open one to reset it or switch its item type — the guided rescue flow lands in a later
            phase.
          </p>
        </Card>
      )}

      {/* Table */}
      {bank.isLoading ? (
        <Card>
          <div className="h-[200px] animate-pulse rounded-sm bg-paper-3" />
        </Card>
      ) : bank.error ? (
        <Card>
          <p className="t-body">couldn&apos;t load your vocabulary.</p>
          <Button
            className="mt-s-3"
            onClick={() => {
              void bank.refetch();
            }}
          >
            retry
          </Button>
        </Card>
      ) : rows.length === 0 ? (
        <Card padding="lg" className="text-center">
          <p className="t-display-s mb-s-2">no words here.</p>
          <p className="t-body mb-s-4">
            {q.trim() || statusFilter !== 'all'
              ? 'nothing matches this filter.'
              : `you haven't saved any ${langLabel} words yet.`}
          </p>
          <Button href="/read" variant="ghost">
            read something →
          </Button>
        </Card>
      ) : (
        <>
          <Card padding="none" className="overflow-hidden">
            <div className="hidden grid-cols-[40px_1.4fr_1.4fr_110px_1fr_64px] gap-s-3 border-b border-rule px-s-4 py-s-2 t-micro text-ink-soft md:grid">
              <span>cefr</span>
              <span>lemma</span>
              <span>gloss · pos</span>
              <span>status</span>
              <span>stability</span>
              <span>next</span>
            </div>
            {rows.map((row, i) => (
              <BankRowItem key={row.stateId} row={row} isLast={i === rows.length - 1} />
            ))}
          </Card>
          <p className="t-small text-ink-mute">
            {rows.length} lemma{rows.length === 1 ? '' : 's'} · sorted by next due
          </p>
        </>
      )}
    </div>
  );
}

function BankRowItem({ row, isLast }: { row: BankRow; isLast: boolean }) {
  // `Date.now()` is read at render time; the bank is a transient browse view so
  // a per-render "now" is fine (no resume/replay concerns here).
  const now = Date.now();
  const due = formatDue(row.dueAt, now);
  const isLeech = row.status === 'leech';
  return (
    <Link
      href={`/review/bank/${row.stateId}`}
      className={[
        'grid grid-cols-[40px_1fr_64px] items-center gap-s-3 px-s-4 py-s-3 transition-colors hover:bg-paper-2',
        'md:grid-cols-[40px_1.4fr_1.4fr_110px_1fr_64px]',
        isLast ? '' : 'border-b border-rule',
      ].join(' ')}
    >
      <span className="t-mono text-[10px] text-ink-mute">{row.cefr ?? '—'}</span>

      <div>
        <div className="t-body">{row.lemma}</div>
        {/* gloss/pos shown inline on mobile (own column on desktop) */}
        <div className="t-small text-ink-mute md:hidden">
          {row.gloss} · {row.pos}
        </div>
      </div>

      <div className="hidden md:block">
        <div className="text-[13px]">{row.gloss}</div>
        <div className="t-small text-ink-mute">{row.pos}</div>
      </div>

      <div className="hidden md:block">
        <Chip variant={STATUS_CHIP[row.status]}>{row.status}</Chip>
      </div>

      <div className="hidden items-center gap-s-2 md:flex">
        <div className="h-[4px] flex-1 rounded-r-pill bg-paper-3">
          <div
            className={`h-full rounded-r-pill ${isLeech ? 'bg-accent' : 'bg-ink'}`}
            style={{ width: `${stabilityWidth(row.stability)}%` }}
          />
        </div>
        <span className="t-mono w-[36px] text-right text-[10px] text-ink-mute">
          {row.stability.toFixed(1)}d
        </span>
      </div>

      <span
        className={`t-mono text-[12px] ${due === 'now' ? 'text-accent-2' : 'text-ink-soft'}`}
      >
        {due}
      </span>
    </Link>
  );
}
