'use client';

import Link from 'next/link';
import type { CefrLevel, LearningLanguage } from '@language-drill/shared';
import type { AuthenticatedFetch, DebriefItem } from '@language-drill/api-client';
import { Button } from '../../../../../components/ui';
import { ConjugationReviewHeader } from './conjugation-review-header';
import { ReviewItemCard } from '../../debrief/_components/review-item-card';

export interface ConjugationReviewProps {
  /** Items answered in this open-ended sitting, in answer order. */
  items: DebriefItem[];
  language: LearningLanguage;
  difficulty: CefrLevel;
  durationSeconds: number;
  fetchFn: AuthenticatedFetch;
  /** Restart the loop with a fresh exercise + empty review. */
  onPracticeMore: () => void;
}

// The conjugation "finish session" recap. Built from a client-accumulated
// item list — no server session, so it uses its own accuracy-based header
// (ConjugationReviewHeader) instead of the movement-driven debrief header;
// per-item detail still reuses the real ReviewItemCard presenter.
export function ConjugationReview({
  items,
  durationSeconds,
  fetchFn,
  onPracticeMore,
}: ConjugationReviewProps) {
  const correctCount = items.filter((i) => i.status === 'correct').length;

  return (
    <div className="p-s-6">
      <ConjugationReviewHeader
        correctCount={correctCount}
        totalCount={items.length}
        durationSeconds={durationSeconds}
      />

      <div className="mt-s-6 flex flex-col gap-s-3">
        {items.map((item, index) => (
          <ReviewItemCard
            key={`${item.exerciseId}-${index}`}
            index={index}
            item={item}
            fetchFn={fetchFn}
          />
        ))}
      </div>

      <div className="mt-s-7 flex flex-col gap-s-3 border-t border-rule pt-s-5">
        <Button variant="primary" onClick={onPracticeMore}>
          practice more
        </Button>
        <Link
          href="/"
          className="inline-flex items-center justify-center rounded-md border border-rule-strong px-[18px] py-[10px] t-small font-medium text-ink-2 no-underline transition-colors hover:bg-paper-2"
        >
          done
        </Link>
        <Link
          href="/progress"
          className="self-center t-small text-ink-soft underline underline-offset-2 transition-colors hover:text-ink"
        >
          see your progress <span className="lk-arr" aria-hidden="true">→</span>
        </Link>
      </div>
    </div>
  );
}
