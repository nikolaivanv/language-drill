'use client';

// ---------------------------------------------------------------------------
// Review hub — the home behind the `/review` nav destination.
// ---------------------------------------------------------------------------
// Per-language queue breakdown (polyglot — never blended), item-type mix,
// estimated length, a primary start, focused-subset starts, and an explicit
// "all caught up" empty state with a next-due preview. No streak / XP / points
// (Req 4.5). The active language is the left-nav's single source of truth
// (Req 4.2) — this page never duplicates the switcher.
// ---------------------------------------------------------------------------

import { useMemo } from 'react';
import { useAuth } from '@clerk/nextjs';
import {
  createAuthenticatedFetch,
  useReviewOverview,
  type HubOverview,
} from '@language-drill/api-client';
import type { LearningLanguage, ReviewItemType } from '@language-drill/shared';
import { useActiveLanguage } from '../../../components/shell/active-language-provider';
import { Button, Card } from '../../../components/ui';

const LANGUAGE_LABEL: Record<LearningLanguage, string> = {
  ES: 'español',
  DE: 'Deutsch',
  TR: 'Türkçe',
};

const ITEM_TYPE_LABEL: Record<ReviewItemType, string> = {
  cloze: 'cloze',
  meaning: 'meaning → word',
  recognition: 'recognition',
};

const ITEM_TYPE_BAR: Record<ReviewItemType, string> = {
  cloze: 'bg-ink',
  meaning: 'bg-accent',
  recognition: 'bg-ok',
};

export default function ReviewHubPage() {
  const { activeLanguage } = useActiveLanguage();
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  const overview = useReviewOverview({ fetchFn, language: activeLanguage });

  const langLabel = LANGUAGE_LABEL[activeLanguage];

  return (
    <div className="space-y-s-6">
      <Header language={langLabel} data={overview.data} />

      {overview.isLoading ? (
        <Card>
          <div className="h-[120px] animate-pulse rounded-sm bg-paper-3" />
        </Card>
      ) : overview.error ? (
        <Card>
          <p className="t-body">couldn&apos;t load your review queue.</p>
          <Button
            className="mt-s-3"
            onClick={() => {
              void overview.refetch();
            }}
          >
            retry
          </Button>
        </Card>
      ) : overview.data && overview.data.breakdown.total > 0 ? (
        <QueueView data={overview.data} />
      ) : (
        <EmptyView nextDueAt={overview.data?.nextDueAt ?? null} />
      )}
    </div>
  );
}

function Header({ language, data }: { language: string; data: HubOverview | undefined }) {
  const caughtUp = !data || data.breakdown.total === 0;
  return (
    <header className="space-y-s-2">
      <div className="t-micro text-ink-soft">spaced review · {language}</div>
      <h1 className="t-display-xl">{caughtUp ? 'all caught up.' : 'time to review.'}</h1>
      <p className="t-body-l max-w-[640px]">
        {caughtUp
          ? `nothing's due in ${language}. the scheduler surfaces words again on their own schedule — coming back too soon hurts long-term retention.`
          : 'your queue is built per language so context doesn’t bleed, scaled by FSRS maturity.'}
      </p>
    </header>
  );
}

function QueueView({ data }: { data: HubOverview }) {
  const { breakdown, estimatedMinutes } = data;
  const mixEntries = (Object.entries(breakdown.mix) as [ReviewItemType, number][]).filter(
    ([, v]) => v > 0,
  );
  const mixTotal = mixEntries.reduce((sum, [, v]) => sum + v, 0);

  return (
    <div className="grid gap-s-5 md:grid-cols-[1.4fr_1fr]">
      {/* Breakdown + item-type mix */}
      <Card padding="lg">
        <div className="t-micro text-ink-soft">today&apos;s queue</div>
        <div className="mt-s-3 mb-s-5 grid grid-cols-3 gap-s-4">
          <BigStat n={breakdown.due} label="due reviews" sub="scheduled by FSRS" />
          <BigStat n={breakdown.new} label="new intake" sub="cap 5/day · per lang" />
          <BigStat
            n={breakdown.leech}
            label="leech rescue"
            sub={breakdown.leech > 0 ? 'lapsed ≥ 3×' : 'none'}
          />
        </div>

        <div className="t-small font-medium">item-type mix</div>
        {mixTotal > 0 ? (
          <>
            <div className="mt-s-2 mb-s-3 flex h-[10px] overflow-hidden rounded-r-pill bg-paper-3">
              {mixEntries.map(([k, v]) => (
                <div
                  key={k}
                  className={ITEM_TYPE_BAR[k]}
                  style={{ width: `${(v / mixTotal) * 100}%` }}
                />
              ))}
            </div>
            <div className="flex flex-wrap gap-s-2">
              {mixEntries.map(([k, v]) => (
                <span key={k} className="t-small text-ink-soft">
                  {ITEM_TYPE_LABEL[k]} · {v}
                </span>
              ))}
            </div>
          </>
        ) : null}

        <div className="mt-s-5 flex items-center justify-between border-t border-dashed border-rule pt-s-3">
          <span className="t-small">est. session length</span>
          <span className="t-mono text-ink-soft">~{estimatedMinutes} min</span>
        </div>
      </Card>

      {/* Actions */}
      <div className="flex flex-col gap-s-4">
        <Button href="/review/session" variant="primary" size="lg" className="justify-between">
          <span>start review →</span>
          <span className="t-mono text-[11px] opacity-75">{breakdown.total} items</span>
        </Button>

        <Card>
          <div className="t-small mb-s-2 font-medium">start a focused subset</div>
          <div className="flex flex-col gap-s-2">
            <SubsetButton
              href="/review/session?filter=new"
              label={`new intake only (${breakdown.new})`}
              note="brand-new lemmas"
              disabled={breakdown.new === 0}
            />
            <SubsetButton
              href="/review/session?filter=leech"
              label={`just leeches (${breakdown.leech})`}
              note="rescue mode · alt item types"
              disabled={breakdown.leech === 0}
            />
          </div>
        </Card>
      </div>
    </div>
  );
}

function BigStat({ n, label, sub }: { n: number; label: string; sub: string }) {
  return (
    <div>
      <div className="t-display-m leading-none">{n}</div>
      <div className="mt-s-1 text-[13px] font-medium">{label}</div>
      <div className="t-small">{sub}</div>
    </div>
  );
}

function SubsetButton({
  href,
  label,
  note,
  disabled,
}: {
  href: string;
  label: string;
  note: string;
  disabled: boolean;
}) {
  const content = (
    <span className="flex w-full flex-col items-start text-left">
      <span className="text-[13px]">{label}</span>
      <span className="t-small">{note}</span>
    </span>
  );
  return disabled ? (
    <Button variant="default" disabled className="w-full">
      {content}
    </Button>
  ) : (
    <Button href={href} variant="default" className="w-full">
      {content}
    </Button>
  );
}

function EmptyView({ nextDueAt }: { nextDueAt: string | null }) {
  return (
    <div className="grid gap-s-5 md:grid-cols-2">
      <Card padding="lg" className="text-center">
        <div className="t-display-s mb-s-2">queue empty.</div>
        <p className="t-body mb-s-4">
          {nextDueAt
            ? `next batch surfaces ${new Date(nextDueAt).toLocaleString()}. don’t force it — over-reviewing is the most common SRS mistake.`
            : 'no upcoming reviews scheduled. save more words while reading.'}
        </p>
        <div className="flex justify-center gap-s-2">
          <Button href="/review/bank">browse vocabulary →</Button>
          <Button href="/read" variant="ghost" size="sm">
            read something →
          </Button>
        </div>
      </Card>
      {nextDueAt ? (
        <Card>
          <div className="t-small mb-s-2 font-medium">upcoming</div>
          <div className="t-body">
            next card due{' '}
            <span className="t-mono text-ink-soft">
              {new Date(nextDueAt).toLocaleString()}
            </span>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
