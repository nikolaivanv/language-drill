'use client';

// ---------------------------------------------------------------------------
// state-cards — non-success states for the today timeline
// ---------------------------------------------------------------------------
// Three small cards consolidated in one file (each is < 30 lines and they're
// only ever rendered by `TodayTimeline`):
//
//   - AllDoneCard       — every plan item is done; show the summary
//   - PoolNotReadyCard  — Lambda returned `code: 'INSUFFICIENT_POOL'`
//   - TimelineErrorCard — any other error from the today-plan request
//
// Functionally equivalent to the design's three separate files; consolidated
// only to keep the directory shallow.
// ---------------------------------------------------------------------------

import type { TodayPlanSummary } from '@language-drill/api-client';
import {
  LANGUAGE_NAMES,
  type LearningLanguage,
} from '@language-drill/shared';
import { Button, Card } from '../../../components/ui';

// ---------------------------------------------------------------------------
// AllDoneCard
// ---------------------------------------------------------------------------

type AllDoneCardProps = {
  summary: TodayPlanSummary;
  href: string;
};

export function AllDoneCard({ summary, href }: AllDoneCardProps) {
  return (
    <Card padding="lg">
      <div className="space-y-s-4">
        <h2 className="t-display-m">you&apos;re done for today.</h2>
        <p className="t-body-l">
          {summary.itemCount} of {summary.itemCount} ·{' '}
          {summary.durationMinutes} minutes
        </p>
        <Button variant="default" size="md" href={href}>
          start a fresh session →
        </Button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// PoolNotReadyCard
// ---------------------------------------------------------------------------

type PoolNotReadyCardProps = {
  language: LearningLanguage;
};

export function PoolNotReadyCard({ language }: PoolNotReadyCardProps) {
  const languageName = LANGUAGE_NAMES[language].toLowerCase();
  return (
    <Card padding="lg">
      <p className="t-body-l">
        your {languageName} pool isn&apos;t ready yet — check back tomorrow.
      </p>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// TimelineErrorCard
// ---------------------------------------------------------------------------

type TimelineErrorCardProps = {
  error: Error;
  onRetry: () => void;
};

export function TimelineErrorCard({
  error,
  onRetry,
}: TimelineErrorCardProps) {
  return (
    <Card padding="lg">
      <div className="space-y-s-4">
        <p className="t-body-l">{error.message}</p>
        <Button variant="default" size="md" onClick={onRetry}>
          retry
        </Button>
      </div>
    </Card>
  );
}
