'use client';

import * as React from 'react';
import type { ReviewItemResult } from '@language-drill/api-client';
import { Button, Card, Chip } from '../../../../components/ui';
import { cn } from '../../../../lib/cn';

// ---------------------------------------------------------------------------
// In-session feedback panel (Req 9.4, 10.2, 10.3)
// ---------------------------------------------------------------------------
// Shown after an item is graded, before advancing. Renders the
// correct/partial/incorrect verdict + the corrected form, the FSRS scheduler
// delta (interval / stability / lifecycle state, before→after), and the "what
// moved" mastery deltas sourced verbatim from the emitted evidence (NOT
// fabricated) (9.4, 10.2). Supports keyboard advance — Enter fires onNext (10.3)
// — alongside the inline "next" CTA. The session page (task 45) owns the split
// layout / mobile sticky bar and decides the nextLabel (last item → finish).
// ---------------------------------------------------------------------------

type ReviewOutcome = ReviewItemResult['outcome'];
type SchedulerDelta = ReviewItemResult['schedulerDelta'];

export interface ReviewFeedbackProps {
  result: ReviewItemResult;
  onNext: () => void;
  /** CTA label; the session page passes "finish →" on the last item. */
  nextLabel?: string;
}

const OUTCOME_LABEL: Record<ReviewOutcome, string> = {
  correct: 'correct.',
  partial: 'close.',
  incorrect: 'not quite.',
};

// Tier background tokens reused from the drill feedback shell vocabulary.
const OUTCOME_BG: Record<ReviewOutcome, string> = {
  correct: 'bg-[var(--color-ok-soft)]',
  partial: 'bg-[var(--color-hilite-soft)]',
  incorrect: 'bg-[var(--color-accent-soft)]',
};

// Lifecycle rank for deciding whether a state transition is a promotion.
const STATE_RANK: Record<string, number> = {
  new: 0,
  learning: 1,
  mature: 2,
  known: 3,
  leech: -1,
  suspended: -1,
};

function round(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function pct(n: number): number {
  return Math.round(n * 100);
}

// "What moved" pill: one grammar point's before→after, displayed as percentages
// with a direction arrow. Sourced from emitted evidence (Req 9.4).
function DeltaPill({
  label,
  from,
  to,
}: {
  label: string;
  from: number;
  to: number;
}) {
  const down = to < from;
  return (
    <span className="inline-flex items-center gap-s-2 px-s-3 py-[5px] rounded-r-pill border border-rule bg-card text-[12px]">
      <span>{label}</span>
      <span className="t-mono text-ink-mute text-[11px]">{pct(from)}%</span>
      <span className={down ? 'text-accent' : 'text-ok'}>{down ? '↓' : '↑'}</span>
      <span
        className={cn('t-mono text-[12px] font-semibold', down ? 'text-accent' : 'text-ok')}
      >
        {pct(to)}%
      </span>
    </span>
  );
}

function SchedulerDeltaGrid({ delta }: { delta: SchedulerDelta }) {
  const promoted = STATE_RANK[delta.stateTo] > STATE_RANK[delta.stateFrom];
  const lapsed = STATE_RANK[delta.stateTo] < STATE_RANK[delta.stateFrom];
  return (
    <div className="grid grid-cols-[72px_1fr] gap-x-s-3 gap-y-s-1 text-[12px]">
      <span className="text-ink-mute">interval</span>
      <span>
        <span className="t-mono text-ink-mute">{round(delta.intervalFrom)}d</span>{' '}
        → <strong className="t-mono">{round(delta.intervalTo)}d</strong>
      </span>
      <span className="text-ink-mute">stability</span>
      <span>
        <span className="t-mono">{round(delta.stabilityFrom)}</span> →{' '}
        <span className="t-mono text-ok">{round(delta.stabilityTo)}</span>
      </span>
      <span className="text-ink-mute">state</span>
      <span className="inline-flex items-center gap-s-2">
        <Chip>{delta.stateFrom}</Chip>
        <span className="text-ink-mute">→</span>
        <Chip variant={promoted ? 'ok' : lapsed ? 'accent' : 'default'}>{delta.stateTo}</Chip>
      </span>
    </div>
  );
}

export function ReviewFeedback({ result, onNext, nextLabel = 'next item →' }: ReviewFeedbackProps) {
  const { outcome, correctAnswer, schedulerDelta, masteryDeltas } = result;

  // Keyboard advance (Req 10.3): Enter → next. A document-level listener keeps
  // working regardless of which (now-disabled) control held focus at grade time.
  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Enter') {
        e.preventDefault();
        onNext();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onNext]);

  const promoted = STATE_RANK[schedulerDelta.stateTo] > STATE_RANK[schedulerDelta.stateFrom];

  return (
    <Card padding="lg" className={cn(OUTCOME_BG[outcome])}>
      <div className="flex flex-wrap items-center gap-s-3">
        <h3 className="t-display-s">{OUTCOME_LABEL[outcome]}</h3>
        {promoted && (
          <Chip variant="ok" aria-label={`promoted to ${schedulerDelta.stateTo}`}>
            promoted → {schedulerDelta.stateTo}
          </Chip>
        )}
      </div>

      {/* Corrected form */}
      <p className="t-body mt-s-3">
        {outcome === 'correct' ? (
          <>
            <span className="text-ok">✓</span> <strong className="t-mono">{correctAnswer}</strong>
          </>
        ) : (
          <>
            answer · <strong className="t-mono">{correctAnswer}</strong>
          </>
        )}
      </p>

      {/* Scheduler delta */}
      <div className="mt-s-4 pt-s-3 border-t border-dashed border-rule">
        <p className="t-micro text-ink-soft mb-s-2">scheduler delta</p>
        <SchedulerDeltaGrid delta={schedulerDelta} />
      </div>

      {/* What moved on the radar (Req 9.4) — only when grammar points moved. */}
      {masteryDeltas.length > 0 && (
        <div className="mt-s-4 pt-s-3 border-t border-dashed border-rule">
          <p className="t-micro text-ink-soft mb-s-2">also moved · review advances the radar</p>
          <div className="flex flex-wrap gap-s-2">
            {masteryDeltas.map((d) => (
              <DeltaPill
                key={d.grammarPoint}
                label={d.grammarPoint}
                from={d.from}
                to={d.to}
              />
            ))}
          </div>
        </div>
      )}

      <div className="mt-s-6 flex items-center justify-between gap-s-3 flex-wrap">
        <p className="t-small text-ink-mute">
          <kbd className="t-mono">↵</kbd> next
        </p>
        <Button variant="accent" onClick={onNext}>
          {nextLabel}
        </Button>
      </div>
    </Card>
  );
}
