'use client';

// ---------------------------------------------------------------------------
// End-of-session summary (Req 11.1, 11.3, 11.4, 11.5, 13.3)
// ---------------------------------------------------------------------------
// An honest, calm debrief of what the session moved — clean/partial/missed
// counts, promoted/lapsed cards and new intake (11.1), the grammar points that
// moved with before→after evidence (11.2), a per-item recap and the next-due
// time (11.3), and next-action CTAs that deep-link to the EXISTING surfaces —
// the bank, the progress radar, the hub (11.5, 13.3). No streak / XP / point
// total / "great job!" — tone is evidence-based (11.4).
// ---------------------------------------------------------------------------

import { use, useMemo } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import type { LearningLanguage } from '@language-drill/shared';
import {
  createAuthenticatedFetch,
  useReviewSummary,
  type ReviewSummary,
  type ReviewSummaryItem,
} from '@language-drill/api-client';
import { useActiveLanguage } from '../../../../../components/shell';
import { Button, Card, Chip } from '../../../../../components/ui';

interface SummaryPageProps {
  params: Promise<{ sessionId: string }>;
}

const LANGUAGE_LABEL: Record<LearningLanguage, string> = {
  ES: 'español',
  DE: 'Deutsch',
  TR: 'Türkçe',
};

function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m === 0) return `${rem}s`;
  return `${m}m ${rem}s`;
}

function pct(n: number): number {
  return Math.round(n * 100);
}

export default function ReviewSummaryPage({ params }: SummaryPageProps) {
  const { sessionId } = use(params);
  const router = useRouter();
  const { getToken } = useAuth();
  const { activeLanguage } = useActiveLanguage();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);

  const query = useReviewSummary({ fetchFn, sessionId });
  const langLabel = LANGUAGE_LABEL[activeLanguage];

  if (query.isLoading) {
    return (
      <SummaryFrame>
        <div className="h-[160px] animate-pulse rounded-lg bg-paper-3" />
        <div className="h-[260px] animate-pulse rounded-lg bg-paper-3" />
      </SummaryFrame>
    );
  }

  if (query.error || !query.data) {
    return (
      <SummaryFrame>
        <Card padding="lg">
          <p className="t-body">couldn&apos;t load this session summary.</p>
          <div className="mt-s-3 flex gap-s-2">
            <Button
              onClick={() => {
                void query.refetch();
              }}
            >
              retry
            </Button>
            <Button href="/review" variant="ghost">
              back to hub
            </Button>
          </div>
        </Card>
      </SummaryFrame>
    );
  }

  return <SummaryView data={query.data} langLabel={langLabel} router={router} />;
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

function SummaryView({
  data,
  langLabel,
  router,
}: {
  data: ReviewSummary;
  langLabel: string;
  router: ReturnType<typeof useRouter>;
}) {
  const {
    total,
    correct,
    partial,
    missed,
    promoted,
    lapsed,
    newCards,
    items,
    grammarDeltas,
    nextDueAt,
    durationSeconds,
  } = data;

  return (
    <SummaryFrame>
      <header className="space-y-s-2">
        <p className="t-micro text-ink-soft">
          session done · {formatDuration(durationSeconds)} · {langLabel}
        </p>
        <h1 className="t-display-xl">
          {correct} of {total} clean.
        </h1>
        <p className="t-body-l max-w-[640px]">
          {partial} partial · {missed} missed. that&apos;s mastery movement — the only metric we
          track here.
        </p>
      </header>

      {/* The three things that moved (Req 11.1) */}
      <div className="grid gap-s-4 md:grid-cols-3">
        <StatCard
          accent="border-l-ok"
          n={promoted.length}
          label="promoted"
          chips={promoted}
          chipVariant="ok"
          note="graduated to a longer interval."
        />
        <StatCard
          accent="border-l-accent"
          n={lapsed.length}
          label="lapsed"
          chips={lapsed}
          chipVariant="accent"
          note={lapsed.length > 0 ? 'surfacing again soon.' : 'nothing slipped.'}
        />
        <StatCard
          accent="border-l-ink"
          n={newCards}
          label="new cards added"
          chips={[]}
          chipVariant="default"
          note="from your saved sentences."
        />
      </div>

      <div className="grid gap-s-6 md:grid-cols-[1.3fr_1fr]">
        {/* Per-item recap (Req 11.3) */}
        <section>
          <h2 className="t-micro text-ink-soft mb-s-2">items, in order</h2>
          <Card padding="none" className="overflow-hidden">
            {items.length === 0 ? (
              <p className="t-small text-ink-mute p-s-4">no items reviewed.</p>
            ) : (
              items.map((it, i) => (
                <ItemRow key={i} item={it} isLast={i === items.length - 1} />
              ))
            )}
          </Card>
        </section>

        {/* Grammar points moved (Req 11.2) */}
        <section>
          <h2 className="t-micro text-ink-soft mb-s-2">grammar points moved</h2>
          <Card>
            {grammarDeltas.length === 0 ? (
              <p className="t-small text-ink-mute">
                no grammar points carried evidence this session.
              </p>
            ) : (
              <div className="flex flex-col gap-s-3">
                {grammarDeltas.map((g) => (
                  <GrammarDeltaBar
                    key={g.grammarPoint}
                    label={g.grammarPoint}
                    from={g.from}
                    to={g.to}
                  />
                ))}
              </div>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="mt-s-3 w-full justify-between"
              onClick={() => router.push('/progress')}
            >
              <span>see full radar</span>
              <span>→</span>
            </Button>
          </Card>
        </section>
      </div>

      {/* Next due + next actions (Req 11.3, 11.5) */}
      <Card padding="lg" className="bg-paper-2">
        <div className="flex flex-wrap items-center justify-between gap-s-4">
          <div>
            <p className="t-small font-medium">
              {nextDueAt
                ? `next batch due ${new Date(nextDueAt).toLocaleString()}.`
                : 'no upcoming reviews scheduled.'}
            </p>
            <p className="t-small text-ink-mute mt-s-1">
              the scheduler decides when these resurface — coming back early hurts retention.
            </p>
          </div>
          <div className="flex gap-s-2">
            <Button variant="ghost" onClick={() => router.push('/review/bank')}>
              browse bank →
            </Button>
            <Button variant="primary" onClick={() => router.push('/review')}>
              done
            </Button>
          </div>
        </div>
      </Card>
    </SummaryFrame>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SummaryFrame({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-[960px] space-y-s-6">{children}</div>;
}

function StatCard({
  accent,
  n,
  label,
  chips,
  chipVariant,
  note,
}: {
  accent: string;
  n: number;
  label: string;
  chips: string[];
  chipVariant: 'ok' | 'accent' | 'default';
  note: string;
}) {
  return (
    <Card className={`border-l-[3px] ${accent}`}>
      <div className="flex items-baseline gap-s-3">
        <span className="t-display-m leading-none">{n}</span>
        <span className="text-[13px] font-medium">{label}</span>
      </div>
      {chips.length > 0 && (
        <div className="mt-s-2 flex flex-wrap gap-s-1">
          {chips.map((c) => (
            <Chip key={c} variant={chipVariant}>
              {c}
            </Chip>
          ))}
        </div>
      )}
      <p className="t-small text-ink-mute mt-s-2">{note}</p>
    </Card>
  );
}

const OUTCOME_TICK: Record<ReviewSummaryItem['outcome'], { mark: string; color: string }> = {
  correct: { mark: '✓', color: 'text-ok' },
  partial: { mark: '~', color: 'text-hilite' },
  incorrect: { mark: '✗', color: 'text-accent' },
};

const ITEM_TYPE_LABEL: Record<ReviewSummaryItem['itemType'], string> = {
  cloze: 'cloze',
  meaning: 'meaning',
  recognition: 'recognition',
};

function ItemRow({ item, isLast }: { item: ReviewSummaryItem; isLast: boolean }) {
  const tick = OUTCOME_TICK[item.outcome];
  return (
    <div
      className={`grid grid-cols-[20px_1fr_auto] items-center gap-s-3 px-s-4 py-s-3 ${
        isLast ? '' : 'border-b border-rule'
      }`}
    >
      <span className={`text-[15px] font-semibold ${tick.color}`} aria-label={item.outcome}>
        {tick.mark}
      </span>
      <div>
        <div className="t-body">{item.lemma}</div>
        {item.surface && (
          <div className="t-small text-ink-mute t-mono">as {item.surface}</div>
        )}
      </div>
      <Chip>{ITEM_TYPE_LABEL[item.itemType]}</Chip>
    </div>
  );
}

function GrammarDeltaBar({ label, from, to }: { label: string; from: number; to: number }) {
  const fromPct = pct(from);
  const toPct = pct(to);
  const down = toPct < fromPct;
  const delta = toPct - fromPct;
  return (
    <div className="border-b border-dashed border-rule pb-s-3 last:border-0 last:pb-0">
      <div className="flex items-baseline justify-between mb-s-1">
        <span className="text-[13px] font-medium">{label}</span>
        <span className={`t-mono text-[12px] ${down ? 'text-accent' : 'text-ok'}`}>
          {fromPct}% → {toPct}% ({delta >= 0 ? '+' : ''}
          {delta})
        </span>
      </div>
      <div className="relative h-[6px] rounded-pill bg-paper-3">
        <div
          className="absolute left-0 top-0 bottom-0 rounded-pill bg-ink-mute opacity-40"
          style={{ width: `${fromPct}%` }}
        />
        <div
          className={`absolute left-0 top-0 bottom-0 rounded-pill ${down ? 'bg-accent' : 'bg-ok'}`}
          style={{ width: `${toPct}%` }}
        />
      </div>
    </div>
  );
}
