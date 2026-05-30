'use client';

// ---------------------------------------------------------------------------
// Word detail + actions (Req 12.3, 12.4, 12.5)
// ---------------------------------------------------------------------------
// Re-renders the saved deep-card snapshot, the pooled occurrences (surface,
// sentence, contextual sense, why-this-form), the FSRS scheduler stats, the
// review history, and the grammar points the card feeds (12.3). Header actions
// suspend / unsuspend / mark-known / reset SR / delete, each calling the matching
// mutation (12.4); marking known or suspending ejects the card from future
// queues (server-side), reflected here on refetch (12.5). Delete uses an inline
// two-step confirm, then routes back to the bank.
// ---------------------------------------------------------------------------

import { use, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import type { DeepCard, Occurrence } from '@language-drill/shared';
import {
  createAuthenticatedFetch,
  useDeleteVocabularyWord,
  useUpdateVocabularyWord,
  useVocabularyWord,
  type WordDetail,
  type WordHistoryEntry,
} from '@language-drill/api-client';
import { Button, Card, Chip } from '../../../../../components/ui';

interface DetailPageProps {
  params: Promise<{ stateId: string }>;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}

function dueLabel(iso: string): string {
  const due = new Date(iso).getTime();
  if (Number.isNaN(due)) return '—';
  if (due <= Date.now()) return 'now · in queue';
  return new Date(iso).toLocaleString();
}

export default function WordDetailPage({ params }: DetailPageProps) {
  const { stateId } = use(params);
  const router = useRouter();
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);

  const query = useVocabularyWord({ fetchFn, stateId });
  const updateMutation = useUpdateVocabularyWord({ fetchFn });
  const deleteMutation = useDeleteVocabularyWord({ fetchFn });
  const [confirmDelete, setConfirmDelete] = useState(false);

  const busy = updateMutation.isPending || deleteMutation.isPending;

  if (query.isLoading) {
    return (
      <DetailFrame>
        <div className="h-[120px] animate-pulse rounded-r-lg bg-paper-3" />
        <div className="h-[280px] animate-pulse rounded-r-lg bg-paper-3" />
      </DetailFrame>
    );
  }

  if (query.error || !query.data) {
    return (
      <DetailFrame>
        <Card padding="lg">
          <p className="t-body">couldn&apos;t load this word.</p>
          <div className="mt-s-3 flex gap-s-2">
            <Button
              onClick={() => {
                void query.refetch();
              }}
            >
              retry
            </Button>
            <Button href="/review/bank" variant="ghost">
              back to bank
            </Button>
          </div>
        </Card>
      </DetailFrame>
    );
  }

  const word = query.data;

  function runAction(action: 'suspend' | 'unsuspend' | 'mark_known' | 'reset') {
    updateMutation.mutate({ stateId, action });
  }

  function runDelete() {
    deleteMutation.mutate(
      { stateId },
      { onSuccess: () => router.push('/review/bank') },
    );
  }

  const isSuspended = word.fsrs.state === 'suspended';
  const isKnown = word.fsrs.state === 'known';

  return (
    <DetailFrame>
      {/* Breadcrumb */}
      <nav className="t-small text-ink-mute flex items-center gap-s-2">
        <Link href="/review/bank" className="hover:text-ink">
          ← bank
        </Link>
        <span>›</span>
        <span className="text-ink-soft">{word.lemma}</span>
      </nav>

      {/* Header + actions */}
      <header className="flex flex-wrap items-start justify-between gap-s-4">
        <div>
          <div className="flex flex-wrap items-baseline gap-s-3">
            <h1 className="t-display-xl">{word.lemma}</h1>
            <span className="t-small">{word.pos}</span>
            {word.cefr && <Chip>{word.cefr}</Chip>}
            {word.freqRank != null && <Chip>freq #{word.freqRank}</Chip>}
          </div>
          <div className="mt-s-2 flex items-center gap-s-2">
            <Chip variant={isKnown ? 'ok' : word.fsrs.state === 'leech' ? 'accent' : 'default'}>
              {word.fsrs.state}
            </Chip>
            <span className="t-body">{word.gloss}</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-s-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => runAction(isSuspended ? 'unsuspend' : 'suspend')}
          >
            {isSuspended ? 'unsuspend' : 'suspend'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy || isKnown}
            onClick={() => runAction('mark_known')}
          >
            mark known
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => runAction('reset')}>
            reset SR
          </Button>
          {confirmDelete ? (
            <>
              <Button
                variant="accent"
                size="sm"
                disabled={busy}
                loading={deleteMutation.isPending}
                onClick={runDelete}
              >
                confirm delete
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => setConfirmDelete(false)}
              >
                cancel
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              className="text-accent-2"
              onClick={() => setConfirmDelete(true)}
            >
              delete
            </Button>
          )}
        </div>
      </header>

      {/* Body */}
      <div className="grid gap-s-6 md:grid-cols-[1fr_320px]">
        <div className="space-y-s-5">
          {word.deepCard && (
            <section>
              <h2 className="t-micro text-ink-soft mb-s-2">saved snapshot</h2>
              <Card padding="lg">
                <DeepCardSnapshot card={word.deepCard} />
              </Card>
            </section>
          )}

          <section>
            <h2 className="t-micro text-ink-soft mb-s-2">
              occurrences · {word.occurrences.length} surface form
              {word.occurrences.length === 1 ? '' : 's'} pooled
            </h2>
            {word.occurrences.length === 0 ? (
              <Card>
                <p className="t-small text-ink-mute">no saved sentences for this lemma.</p>
              </Card>
            ) : (
              <div className="space-y-s-3">
                {word.occurrences.map((occ, i) => (
                  <OccurrenceCard key={`${occ.surface}-${i}`} occ={occ} />
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Right rail */}
        <aside className="space-y-s-4">
          <FsrsStatsCard fsrs={word.fsrs} />
          <HistoryCard history={word.history} />
          {word.grammarPoints.length > 0 && (
            <Card className="bg-[var(--color-hilite-soft)]">
              <h2 className="t-micro text-ink-soft mb-s-2">grammar points fed by this card</h2>
              <div className="flex flex-wrap gap-s-1">
                {word.grammarPoints.map((g) => (
                  <Chip key={g}>{g}</Chip>
                ))}
              </div>
            </Card>
          )}
        </aside>
      </div>
    </DetailFrame>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function DetailFrame({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-[960px] space-y-s-5">{children}</div>;
}

function DeepCardSnapshot({ card }: { card: DeepCard }) {
  if (card.type === 'word') {
    return (
      <div className="space-y-s-3">
        <div>
          <p className="t-micro text-ink-soft">{card.definitionLabel}</p>
          <p className="t-body">{card.definition}</p>
        </div>
        <div>
          <p className="t-micro text-ink-soft">contextual sense</p>
          <p className="t-body">{card.contextualSense}</p>
        </div>
        {card.register && (
          <p className="t-small text-ink-mute">register · {card.register}</p>
        )}
        {card.synonyms && card.synonyms.length > 0 && (
          <div className="flex flex-wrap gap-s-1">
            {card.synonyms.map((s) => (
              <Chip key={s.word} title={s.note}>
                {s.word}
              </Chip>
            ))}
          </div>
        )}
      </div>
    );
  }
  if (card.type === 'phrase') {
    return (
      <div className="space-y-s-3">
        <div>
          <p className="t-micro text-ink-soft">idiomatic meaning</p>
          <p className="t-body">{card.idiomaticMeaning}</p>
        </div>
        <div>
          <p className="t-micro text-ink-soft">literal</p>
          <p className="t-body">{card.literal}</p>
        </div>
        <p className="t-small text-ink-mute">register · {card.register}</p>
      </div>
    );
  }
  // sentence
  return (
    <div className="space-y-s-3">
      <div>
        <p className="t-micro text-ink-soft">translation</p>
        <p className="t-body">{card.translation}</p>
      </div>
      {card.grammarNotes.length > 0 && (
        <ul className="t-small text-ink-soft list-disc pl-s-4">
          {card.grammarNotes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function OccurrenceCard({ occ }: { occ: Occurrence }) {
  const parts = occ.sentence.split(occ.surface);
  return (
    <Card>
      <div className="flex items-baseline justify-between gap-s-3">
        <div className="flex items-baseline gap-s-2">
          <span className="t-mono text-[16px] font-semibold text-accent-2">{occ.surface}</span>
          <span className="t-small">&ldquo;{occ.contextualSense}&rdquo;</span>
        </div>
        {occ.source && <span className="t-small italic text-ink-mute">{occ.source}</span>}
      </div>
      <p className="t-body mt-s-2">
        {parts.map((part, j) => (
          <span key={j}>
            {part}
            {j < parts.length - 1 && (
              <span className="rounded-[3px] bg-[var(--color-hilite-soft)] px-1">
                {occ.surface}
              </span>
            )}
          </span>
        ))}
      </p>
      {occ.translation && <p className="t-small italic text-ink-mute mt-s-1">{occ.translation}</p>}
      {occ.whyThisForm && (
        <p className="t-small text-ink-soft mt-s-2 rounded-r-sm bg-paper-2 p-s-2">
          <strong className="text-ink">why this form: </strong>
          {occ.whyThisForm}
        </p>
      )}
    </Card>
  );
}

function FsrsStatsCard({ fsrs }: { fsrs: WordDetail['fsrs'] }) {
  return (
    <Card>
      <h2 className="t-micro text-ink-soft mb-s-3">scheduler state · FSRS</h2>
      <div className="grid grid-cols-2 gap-s-3 text-[12px]">
        <Stat label="stability" value={`${fsrs.stability.toFixed(1)}d`} />
        <Stat label="difficulty" value={fsrs.difficulty.toFixed(1)} />
        <Stat label="reps" value={String(fsrs.reps)} />
        <Stat label="lapses" value={String(fsrs.lapses)} />
        <Stat label="last review" value={formatDate(fsrs.lastReviewedAt)} />
        <Stat
          label="next interval"
          value={fsrs.nextIntervalDays != null ? `${Math.round(fsrs.nextIntervalDays)}d` : '—'}
        />
      </div>
      <div className="mt-s-3 border-t border-dashed border-rule pt-s-3">
        <p className="t-micro text-ink-soft mb-s-1">due</p>
        <p className="t-body text-accent-2">{dueLabel(fsrs.dueAt)}</p>
      </div>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="t-micro text-ink-soft">{label}</div>
      <div className="t-mono">{value}</div>
    </div>
  );
}

const HISTORY_TICK: Record<WordHistoryEntry['outcome'], { mark: string; color: string }> = {
  correct: { mark: '✓', color: 'text-ok' },
  partial: { mark: '~', color: 'text-hilite' },
  incorrect: { mark: '✗', color: 'text-accent' },
};

function HistoryCard({ history }: { history: WordHistoryEntry[] }) {
  return (
    <Card>
      <h2 className="t-micro text-ink-soft mb-s-3">review history</h2>
      {history.length === 0 ? (
        <p className="t-small text-ink-mute">no reviews yet.</p>
      ) : (
        <div className="flex flex-col gap-s-2">
          {history.map((h, i) => {
            const tick = HISTORY_TICK[h.outcome];
            return (
              <div
                key={i}
                className="grid grid-cols-[16px_1fr_auto] items-center gap-s-2 text-[11px]"
              >
                <span className={`font-semibold ${tick.color}`} aria-label={h.outcome}>
                  {tick.mark}
                </span>
                <span>
                  <span className="t-mono text-ink-mute">{h.itemType}</span>
                  {h.surface && <span className="t-mono text-ink-mute"> · {h.surface}</span>}
                </span>
                <span className="t-mono text-ink-mute">{formatDate(h.reviewedAt)}</span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
