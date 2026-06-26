'use client';

// ---------------------------------------------------------------------------
// Review session page (Req 10.1, 10.2, 10.3, 10.5, 10.6)
// ---------------------------------------------------------------------------
// Reducer-driven, one-item-at-a-time flow. On mount it starts a session for the
// active language (honoring a focused-subset / passage filter from the query
// string), queues all items up-front, then walks them: item pane → submit →
// inline feedback → next. A burndown (never a score or streak) tracks progress
// (10.1); each submit shows immediate feedback before advancing (10.2) with
// keyboard advance handled by the feedback panel (10.3); desktop renders the
// split item+rail layout, mobile stacks with a sticky bottom bar (10.5); and
// completing the last item routes to the summary (10.6). All grading is local
// and free — no metering.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useReducer } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useRouter, useSearchParams } from 'next/navigation';
import type { LearningLanguage } from '@language-drill/shared';
import {
  createAuthenticatedFetch,
  useStartReviewSession,
  useSubmitReviewItem,
  type ReviewFilter,
  type ReviewItem,
} from '@language-drill/api-client';
import { useActiveLanguage } from '../../../../components/shell';
import { track } from '../../../../lib/analytics/track';
import { useIsMobile } from '../../../../lib/responsive';
import { Button, Card } from '../../../../components/ui';
import { ClozeItem } from '../_components/cloze-item';
import { MeaningItem } from '../_components/meaning-item';
import { RecognitionItem } from '../_components/recognition-item';
import { ReviewFeedback } from '../_components/review-feedback';
import {
  initialReviewSessionState,
  reviewSessionReducer,
  selectCurrentReviewItem,
  selectIsLastReviewItem,
  selectReviewProgressFraction,
  type ReviewSubmissionMeta,
} from '../_state/review-session-reducer';

const LANGUAGE_LABEL: Record<LearningLanguage, string> = {
  ES: 'español',
  DE: 'Deutsch',
  TR: 'Türkçe',
};

// Map the query string to the server `ReviewFilter` union. The hub links
// `?filter=new|leech`; "review this passage" links `?readEntryId=…` (Req 13.1);
// a grammar deep-link uses `?grammarPoint=…`. Anything else → the full queue.
function parseFilter(params: URLSearchParams): ReviewFilter {
  const readEntryId = params.get('readEntryId');
  if (readEntryId) return { readEntryId };
  const grammarPoint = params.get('grammarPoint');
  if (grammarPoint) return { grammarPoint };
  const filter = params.get('filter');
  if (filter === 'new' || filter === 'leech' || filter === 'all') return filter;
  return 'all';
}

export default function ReviewSessionPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { getToken } = useAuth();
  const { activeLanguage } = useActiveLanguage();
  const isMobile = useIsMobile();

  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  const startMutation = useStartReviewSession({ fetchFn });
  const submitMutation = useSubmitReviewItem({ fetchFn });

  const filter = useMemo(
    () => parseFilter(new URLSearchParams(searchParams?.toString() ?? '')),
    [searchParams],
  );

  const [state, dispatch] = useReducer(reviewSessionReducer, initialReviewSessionState);

  // `mutate` is referentially stable across renders (TanStack v5), so the
  // start callback only changes when the session parameters do.
  const { mutate: startMutate } = startMutation;
  const startSession = useCallback(() => {
    dispatch({ type: 'CREATE_REQUESTED' });
    startMutate(
      { language: activeLanguage, filter },
      {
        onSuccess: (session) => {
          track('vocab_review_started', { language: activeLanguage });
          dispatch({ type: 'CREATE_SUCCEEDED', session });
        },
        onError: (error) => dispatch({ type: 'CREATE_FAILED', error }),
      },
    );
  }, [activeLanguage, filter, startMutate]);

  // Start on mount. No once-guard: `next dev` runs React in StrictMode, which
  // mounts → unmounts → remounts. A mutation fired in the *first* pass is torn
  // down by the cleanup, and its result (plus the per-call onSuccess) is
  // abandoned — the surviving observer would sit on `pending` forever. Letting
  // the effect re-fire on the remount means the live observer owns the
  // in-flight mutation, so its onSuccess actually dispatches. `startSession` is
  // stable across ordinary re-renders (deps are the session params only), so
  // this fires once per real mount in production and twice only under
  // StrictMode's intentional double-invoke.
  useEffect(() => {
    startSession();
  }, [startSession]);

  const currentItem = selectCurrentReviewItem(state);

  const handleSubmit = useCallback(
    (answer: string, meta: { hintsUsed: number }) => {
      if (state.kind !== 'inSession' || !currentItem) return;
      dispatch({ type: 'ITEM_SUBMITTING' });
      const submissionMeta: ReviewSubmissionMeta = { answer, hintsUsed: meta.hintsUsed };
      submitMutation.mutate(
        {
          stateId: currentItem.stateId,
          itemType: currentItem.itemType,
          answer,
          surface:
            currentItem.itemType === 'cloze'
              ? currentItem.occurrence?.surface
              : undefined,
          hintsUsed: meta.hintsUsed,
          sessionId: state.session.id,
        },
        {
          onSuccess: (result) => dispatch({ type: 'ITEM_EVALUATED', result, meta: submissionMeta }),
          onError: (error) => dispatch({ type: 'ITEM_ERROR', error }),
        },
      );
    },
    [state, currentItem, submitMutation],
  );

  const handleNext = useCallback(() => {
    if (state.kind !== 'inSession') return;
    if (selectIsLastReviewItem(state)) {
      dispatch({ type: 'COMPLETE_REQUESTED' });
      router.push(`/review/summary/${state.session.id}`);
      return;
    }
    dispatch({ type: 'ITEM_NEXT' });
  }, [state, router]);

  const handleRetry = useCallback(() => dispatch({ type: 'ITEM_RETRY' }), []);
  const handleSkip = useCallback(() => dispatch({ type: 'ITEM_SKIP' }), []);

  const langLabel = LANGUAGE_LABEL[activeLanguage];

  // -- idle (pre-start) / creating / start error / empty ------------------
  if (state.kind === 'idle' || state.kind === 'creating') {
    return (
      <SessionFrame>
        <Card padding="lg">
          <div className="h-[200px] animate-pulse rounded-sm bg-paper-3" />
        </Card>
      </SessionFrame>
    );
  }

  if (state.kind === 'createError') {
    return (
      <SessionFrame>
        <Card padding="lg">
          <p className="t-body">couldn&apos;t start your review session.</p>
          <div className="mt-s-3 flex gap-s-2">
            <Button onClick={startSession}>retry</Button>
            <Button href="/review" variant="ghost">
              back to hub
            </Button>
          </div>
        </Card>
      </SessionFrame>
    );
  }

  if (
    (state.kind === 'inSession' || state.kind === 'completing') &&
    state.items.length === 0
  ) {
    return (
      <SessionFrame>
        <Card padding="lg" className="text-center">
          <p className="t-display-s mb-s-2">nothing to review.</p>
          <p className="t-body mb-s-4">your queue is empty for {langLabel} right now.</p>
          <Button href="/review">back to hub →</Button>
        </Card>
      </SessionFrame>
    );
  }

  if (state.kind === 'completing') {
    return (
      <SessionFrame>
        <Card padding="lg">
          <p className="t-body">wrapping up…</p>
        </Card>
      </SessionFrame>
    );
  }

  // -- inSession ----------------------------------------------------------
  const total = state.items.length;
  const position = state.index + 1;
  const progress = selectReviewProgressFraction(state);
  const isLast = selectIsLastReviewItem(state);
  const submission = state.perItemSubmission;
  const isSubmitting = submission.kind === 'submitting';
  const isLocked = isSubmitting;

  const distractors = currentItem
    ? state.items.filter((i) => i.stateId !== currentItem.stateId).map((i) => i.gloss)
    : [];

  const main = (
    <div className="flex flex-col gap-s-5">
      {submission.kind === 'evaluated' ? (
        <ReviewFeedback
          result={submission.result}
          onNext={handleNext}
          nextLabel={isLast ? 'finish →' : 'next item →'}
        />
      ) : submission.kind === 'error' ? (
        <Card padding="lg" className="bg-[var(--color-accent-soft)]">
          <p className="t-body font-medium">that item didn&apos;t grade.</p>
          <p className="t-small text-ink-mute mt-s-1">{submission.error.message}</p>
          <div className="mt-s-4 flex gap-s-2">
            <Button onClick={handleRetry}>try again</Button>
            <Button variant="ghost" onClick={handleSkip} disabled={isLast}>
              skip →
            </Button>
          </div>
        </Card>
      ) : currentItem ? (
        <ItemPane
          item={currentItem}
          distractors={distractors}
          isLocked={isLocked}
          isSubmitting={isSubmitting}
          onSubmit={handleSubmit}
        />
      ) : null}
    </div>
  );

  return (
    <SessionFrame>
      <Burndown langLabel={langLabel} position={position} total={total} progress={progress} />

      {isMobile ? (
        main
      ) : (
        <div className="grid gap-s-6 md:grid-cols-[1fr_300px]">
          {main}
          <SessionRail item={currentItem} />
        </div>
      )}

      {/* Mobile sticky bar: burndown + exit always reachable (Req 10.5). */}
      {isMobile && (
        <div className="sticky bottom-0 -mx-s-4 mt-s-4 flex items-center justify-between gap-s-3 border-t border-rule bg-paper px-s-4 py-s-3">
          <span className="t-small text-ink-soft">
            {position} / {total}
          </span>
          <Button href="/review" variant="ghost" size="sm">
            save &amp; exit
          </Button>
        </div>
      )}
    </SessionFrame>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SessionFrame({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-[900px] space-y-s-5">{children}</div>;
}

function Burndown({
  langLabel,
  position,
  total,
  progress,
}: {
  langLabel: string;
  position: number;
  total: number;
  progress: number;
}) {
  return (
    <div className="space-y-s-2">
      <div className="h-[3px] overflow-hidden rounded-pill bg-paper-3">
        <div
          className="h-full bg-accent transition-[width] duration-300"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>
      <div className="flex items-center justify-between">
        <span className="t-micro text-ink-soft">
          review · {langLabel} · item {position} of {total}
        </span>
        <Button href="/review" variant="ghost" size="sm">
          save &amp; exit
        </Button>
      </div>
    </div>
  );
}

function ItemPane({
  item,
  distractors,
  isLocked,
  isSubmitting,
  onSubmit,
}: {
  item: ReviewItem;
  distractors: string[];
  isLocked: boolean;
  isSubmitting: boolean;
  onSubmit: (answer: string, meta: { hintsUsed: number }) => void;
}) {
  // `key` forces fresh local state (input, hint level, selection) per item.
  switch (item.itemType) {
    case 'cloze':
      return (
        <ClozeItem
          key={item.stateId}
          item={item}
          isLocked={isLocked}
          isSubmitting={isSubmitting}
          onSubmit={onSubmit}
        />
      );
    case 'meaning':
      return (
        <MeaningItem
          key={item.stateId}
          item={item}
          isLocked={isLocked}
          isSubmitting={isSubmitting}
          onSubmit={onSubmit}
        />
      );
    case 'recognition':
      return (
        <RecognitionItem
          key={item.stateId}
          item={item}
          distractors={distractors}
          isLocked={isLocked}
          isSubmitting={isSubmitting}
          onSubmit={onSubmit}
        />
      );
    default: {
      const _exhaustive: never = item.itemType;
      throw new Error(`unknown review item type: ${String(_exhaustive)}`);
    }
  }
}

function SessionRail({ item }: { item: ReviewItem | null }) {
  if (!item) return null;
  return (
    <aside className="flex flex-col gap-s-4">
      <Card>
        <div className="t-micro text-ink-soft mb-s-2">this card</div>
        <div className="t-display-s">{item.lemma}</div>
        <p className="t-small text-ink-soft mt-s-1">
          {[item.pos, item.cefr].filter(Boolean).join(' · ')}
        </p>
        <div className="mt-s-3 border-t border-dashed border-rule pt-s-3">
          <p className="t-small text-ink-mute">
            graded locally · this rep feeds your progress radar.
          </p>
        </div>
      </Card>
    </aside>
  );
}
