'use client';

import { Suspense, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  CefrLevel,
  LANGUAGE_NAMES,
  ExerciseType,
  type ExerciseContent,
  type EvaluationResult,
} from '@language-drill/shared';
import {
  useCreateSession,
  useCompleteSession,
  useSubmitAnswer,
  useLanguageProfiles,
  createAuthenticatedFetch,
} from '@language-drill/api-client';
import { useActiveLanguage } from '../../../components/shell';
import {
  TheoryPanel,
  TheoryTrigger,
} from '../../../components/theory';
import { topicIdForGrammarPointKey } from '../../../lib/theory-topic-map';
import { useIsMobile } from '../../../lib/responsive';
import { Card } from '../../../components/ui';
import { coachMessage } from '../../../lib/drill/coach-messages';
import { DEFAULT_EXERCISE_COUNT, DICTATION_RUN_COUNT } from '../../../lib/drill/session-config';
import { DrillHub } from './_components/drill-hub';
import { CoachRail } from './_components/coach-rail';
import { CoachCard } from './_components/coach-card';
import { DrillMeta } from './_components/drill-meta';
import { FluencyPromo } from './_components/fluency-promo';
import { SessionDots } from './_components/session-dots';
import { DrillLayout } from './_components/drill-layout';
import {
  DrillActionProvider,
  useDrillAction,
} from './_components/drill-action-context';
import { DrillActionBar } from './_components/drill-action-bar';
import { ExercisePane } from './_components/exercise-pane';
import {
  initialSessionState,
  selectCurrentItem,
  selectIsLastItem,
  selectProgressFraction,
  sessionReducer,
} from './_components/session-reducer';
import { SubmissionErrorCard } from './_components/submission-error-card';
import type { SubmissionMeta } from './_components/types';

function isInsufficientExercises(err: Error): boolean {
  const status = (err as Error & { status?: number }).status;
  const body = (err as Error & { body?: { code?: string } }).body;
  return status === 422 || body?.code === 'INSUFFICIENT_EXERCISES';
}

// Publishes the "item N of M" progress meta to the drill action bar. Lives
// inside DrillActionProvider so it can reach the context.
function DrillMetaSync({ current, total }: { current: number; total: number }) {
  const { setMeta } = useDrillAction();
  useEffect(() => {
    setMeta({ current, total });
    return () => setMeta(null);
  }, [setMeta, current, total]);
  return null;
}

type StartIntent = 'quick' | 'dictation';

function PracticePageContent() {
  const { getToken } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [startIntent, setStartIntent] = useState<StartIntent | null>(() => {
    const s = searchParams.get('start');
    return s === 'quick' || s === 'dictation' ? s : null;
  });
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);

  const { data: profilesData } = useLanguageProfiles({ fetchFn });
  const profiles = profilesData?.profiles ?? [];

  const [difficulty, setDifficulty] = useState<CefrLevel>(CefrLevel.B1);
  const [initialized, setInitialized] = useState(false);
  const [state, dispatch] = useReducer(sessionReducer, initialSessionState);

  const { activeLanguage } = useActiveLanguage();
  const isMobile = useIsMobile();
  const [openTopicId, setOpenTopicId] = useState<string | null>(null);
  const [triggerEl, setTriggerEl] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setOpenTopicId(null);
  }, [activeLanguage]);

  // Initialize difficulty from the profile matching the active language once
  // profiles load. The session-creation effect below is gated on `initialized`
  // so it doesn't fire before the user's real difficulty lands in state.
  useEffect(() => {
    if (profiles.length > 0 && !initialized) {
      const matching = profiles.find((p) => p.language === activeLanguage);
      setDifficulty((matching?.proficiencyLevel as CefrLevel) ?? CefrLevel.B1);
      setInitialized(true);
    }
  }, [profiles, initialized, activeLanguage]);

  const createSession = useCreateSession({ fetchFn });
  const submitMutation = useSubmitAnswer({ fetchFn });
  const completeSession = useCompleteSession({ fetchFn });

  function fireCompleteSession(sessionId: string) {
    completeSession.mutate(
      { sessionId },
      {
        onSuccess: () => router.push(`/drill/debrief/${sessionId}`),
        onError: (err) =>
          dispatch({ type: 'COMPLETE_FAILED', error: err as Error }),
      },
    );
  }

  // Strict-mode double-fire guard for the create-session kickoff. The flag
  // resets whenever we leave `idle` so a subsequent RESET (selector change)
  // can re-fire the effect.
  const sessionKickoffRef = useRef(false);
  useEffect(() => {
    if (!initialized) return;
    if (startIntent === null) return; // no intent → show the hub, don't auto-start
    if (state.kind !== 'idle') {
      sessionKickoffRef.current = false;
      return;
    }
    if (sessionKickoffRef.current) return;
    sessionKickoffRef.current = true;

    dispatch({ type: 'CREATE_REQUESTED' });
    const config =
      startIntent === 'dictation'
        ? {
            language: activeLanguage,
            difficulty,
            exerciseCount: DICTATION_RUN_COUNT,
            exerciseType: ExerciseType.DICTATION,
          }
        : {
            language: activeLanguage,
            difficulty,
            exerciseCount: DEFAULT_EXERCISE_COUNT,
          };
    createSession.mutate(config, {
      onSuccess: (data) => dispatch({ type: 'CREATE_SUCCEEDED', session: data }),
      onError: (err) => dispatch({ type: 'CREATE_FAILED', error: err as Error }),
    });
  }, [initialized, startIntent, state.kind, activeLanguage, difficulty, createSession]);

  function handleSubmit(answer: string, meta: SubmissionMeta) {
    if (state.kind !== 'inSession') return;
    const item = selectCurrentItem(state);
    if (!item || !answer.trim()) return;
    dispatch({ type: 'ITEM_SUBMITTING' });
    submitMutation.mutate(
      {
        exerciseId: item.id,
        answer: answer.trim(),
        sessionId: state.session.id,
      },
      {
        onSuccess: (result) =>
          dispatch({
            type: 'ITEM_EVALUATED',
            result: result as EvaluationResult,
            meta,
          }),
        onError: (err) => dispatch({ type: 'ITEM_ERROR', error: err as Error }),
      },
    );
  }

  function handleNext() {
    if (state.kind !== 'inSession') return;
    if (selectIsLastItem(state)) {
      const sessionId = state.session.id;
      dispatch({ type: 'COMPLETE_REQUESTED' });
      fireCompleteSession(sessionId);
      return;
    }
    setOpenTopicId(null);
    setTriggerEl(null);
    submitMutation.reset();
    dispatch({ type: 'ITEM_NEXT' });
  }

  function handleRetry() {
    submitMutation.reset();
    dispatch({ type: 'ITEM_RETRY' });
  }

  function handleSkip() {
    if (state.kind !== 'inSession') return;
    if (state.perItemSubmission.kind !== 'error') return;
    setOpenTopicId(null);
    setTriggerEl(null);
    submitMutation.reset();
    dispatch({ type: 'ITEM_SKIP' });
  }

  function handleEndSession() {
    if (state.kind !== 'inSession') return;
    const sessionId = state.session.id;
    submitMutation.reset();
    dispatch({ type: 'COMPLETE_REQUESTED' });
    fireCompleteSession(sessionId);
  }

  function handleDifficultyChange(newDifficulty: CefrLevel) {
    setDifficulty(newDifficulty);
    submitMutation.reset();
    dispatch({ type: 'RESET' });
  }

  const currentItem = selectCurrentItem(state);
  const exerciseContent = currentItem
    ? (currentItem.contentJson as ExerciseContent)
    : null;
  const theoryTopicId = topicIdForGrammarPointKey(
    currentItem?.grammarPointKey ?? null,
    activeLanguage,
  );

  const exerciseTypeForRail: ExerciseType =
    exerciseContent && 'type' in exerciseContent
      ? exerciseContent.type
      : ExerciseType.CLOZE;

  const submission =
    state.kind === 'inSession'
      ? state.perItemSubmission
      : ({ kind: 'idle' } as const);

  const coachMsg =
    submission.kind === 'evaluated'
      ? coachMessage({
          kind: 'evaluated',
          type: exerciseTypeForRail,
          score: submission.result.score,
        })
      : coachMessage({ kind: 'idle', type: exerciseTypeForRail });

  // The learner's recorded baseline for the active language — the identity that
  // the session level can drift from. Null when the active language has no
  // profile yet (drift signal then stays hidden). See DRILL-UI-GUIDELINES §4.
  const baseline =
    (profiles.find((p) => p.language === activeLanguage)?.proficiencyLevel as
      | CefrLevel
      | undefined) ?? null;

  // Zero-profiles placeholder (unchanged from prior page)
  if (profiles.length === 0) {
    return (
      <div className="p-s-6">
        <h1 className="t-display-l mb-s-6">practice</h1>
        <DrillMeta
          level={difficulty}
          baseline={null}
          onLevelChange={handleDifficultyChange}
        />
      </div>
    );
  }

  if (state.kind === 'idle' && startIntent === null) {
    return (
      <DrillHub
        difficulty={difficulty}
        baseline={baseline}
        onDifficultyChange={handleDifficultyChange}
        onStartQuick={() => setStartIntent('quick')}
        onStartDictation={() => setStartIntent('dictation')}
      />
    );
  }

  const insufficient =
    state.kind === 'createError' && isInsufficientExercises(state.error);

  const sessionPosition =
    state.kind === 'inSession'
      ? { current: state.index + 1, total: state.items.length }
      : null;

  // The theory topic sits on the meta baseline (in-session only). TheoryTrigger
  // self-hides when the topic isn't mapped/loaded, so DrillMeta tolerates null.
  const topicTrigger =
    state.kind === 'inSession' && currentItem && theoryTopicId ? (
      <TheoryTrigger
        topicId={theoryTopicId}
        language={activeLanguage}
        onOpen={(id, el) => {
          setOpenTopicId(id);
          setTriggerEl(el);
        }}
        fetchFn={fetchFn}
      />
    ) : null;

  const main = (
    <>
      {/* Mobile: the coach rail collapses into a card at the top of content. */}
      {isMobile && currentItem && (
        <div className="mb-s-4">
          <CoachCard message={coachMsg} />
        </div>
      )}

      {/* One aligned meta row: the writable level pill (+ drift/reset) and the
          read-only topic, grouped tight on a single baseline. */}
      <DrillMeta
        level={difficulty}
        baseline={baseline}
        onLevelChange={handleDifficultyChange}
        topic={topicTrigger}
      />

      {insufficient && (
        <Card padding="lg" className="mt-s-6 bg-paper-2">
          <p className="t-body">
            no exercises available for {LANGUAGE_NAMES[activeLanguage] ?? activeLanguage} at {difficulty}
          </p>
          <p className="t-small text-ink-mute mt-s-2">try a different difficulty</p>
        </Card>
      )}

      {state.kind === 'createError' && !insufficient && (
        <Card padding="lg" className="mt-s-6 bg-[var(--color-accent-soft)]">
          <p className="t-body">{state.error.message}</p>
        </Card>
      )}

      {state.kind === 'inSession' && currentItem && (
        // A real break before the prompt — the meta row is context, the prompt
        // is the focal point. (DRILL-UI-GUIDELINES §3: tighten the meta, open
        // up before the title.)
        <div className="mt-s-8 mobile:mt-s-5">
          {/* Mobile: horizontal session-position dots above the prompt. */}
          {isMobile && sessionPosition && (
            <div className="mb-s-4">
              <SessionDots
                current={sessionPosition.current}
                total={sessionPosition.total}
              />
            </div>
          )}
          <ExercisePane
            exercise={currentItem}
            language={activeLanguage}
            submission={state.perItemSubmission}
            onSubmit={handleSubmit}
            onNext={handleNext}
            nextLabel={selectIsLastItem(state) ? 'see results' : 'next'}
          />
          {state.perItemSubmission.kind === 'error' && (
            <div className="mt-s-4">
              <SubmissionErrorCard
                error={state.perItemSubmission.error}
                onRetry={handleRetry}
                onSkip={handleSkip}
                onEndSession={handleEndSession}
              />
            </div>
          )}
        </div>
      )}

      {/* Mobile: promo demoted to the bottom of the scroll, out of the task
          flow (it lives in the coach rail on desktop). */}
      {isMobile && currentItem && <FluencyPromo className="mt-s-7" />}
    </>
  );

  return (
    <DrillActionProvider active={isMobile}>
      <DrillLayout
        rail={
          !isMobile && currentItem ? (
            <CoachRail
              message={coachMsg}
              exerciseType={exerciseTypeForRail}
              sessionCurrent={sessionPosition?.current}
              sessionTotal={sessionPosition?.total}
            />
          ) : null
        }
        main={main}
        actionBar={isMobile ? <DrillActionBar /> : undefined}
        progressFraction={selectProgressFraction(state)}
        isLoading={state.kind === 'creating' || state.kind === 'completing'}
      />
      {isMobile && sessionPosition && (
        <DrillMetaSync
          current={sessionPosition.current}
          total={sessionPosition.total}
        />
      )}
      {openTopicId && (
        <TheoryPanel
          topicId={openTopicId}
          language={activeLanguage}
          triggerEl={triggerEl}
          onClose={() => setOpenTopicId(null)}
          fetchFn={fetchFn}
        />
      )}
    </DrillActionProvider>
  );
}

// `useSearchParams()` forces this client page out of static prerendering;
// Next.js requires the bailout to sit under a Suspense boundary. The default
// export is a thin wrapper; PracticePageContent holds the real page.
export default function PracticePage() {
  return (
    <Suspense fallback={<div className="p-s-6" />}>
      <PracticePageContent />
    </Suspense>
  );
}
