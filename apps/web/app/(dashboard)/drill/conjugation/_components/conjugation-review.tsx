'use client';

import Link from 'next/link';
import type { CefrLevel, LearningLanguage } from '@language-drill/shared';
import type {
  AuthenticatedFetch,
  DebriefItem,
  DebriefResponse,
} from '@language-drill/api-client';
import { Button } from '../../../../../components/ui';
import { DebriefHeader } from '../../debrief/_components/debrief-header';
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

// The conjugation "finish session" recap. Reuses the real debrief presenters
// (DebriefHeader + per-item ReviewItemCard) from a client-accumulated item
// list — no server session, so there is intentionally no "what moved" skill
// panel (cross-session movement is server-computed and unavailable here).
export function ConjugationReview({
  items,
  language,
  difficulty,
  durationSeconds,
  fetchFn,
  onPracticeMore,
}: ConjugationReviewProps) {
  const correctCount = items.filter((i) => i.status === 'correct').length;
  // Conjugation has no skips — every accumulated item was attempted. The
  // started/completed timestamps are unused by DebriefHeader (it reads only
  // counts + durationSeconds), so epoch placeholders satisfy the type cheaply.
  const debrief: DebriefResponse = {
    id: 'conjugation-local',
    language,
    difficulty,
    startedAt: new Date(0).toISOString(),
    completedAt: new Date(0).toISOString(),
    durationSeconds,
    exerciseCount: items.length,
    correctCount,
    attemptedCount: items.length,
    skippedCount: 0,
    items,
    skillMovements: [],
  };

  return (
    <div className="p-s-6">
      <DebriefHeader debrief={debrief} />

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
