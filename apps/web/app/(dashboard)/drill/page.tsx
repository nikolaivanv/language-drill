'use client';

import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
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
import { DEFAULT_EXERCISE_COUNT } from '../../../lib/drill/session-config';
import { CoachRail } from './_components/coach-rail';
import { CoachCard } from './_components/coach-card';
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
import { FreeWritingEntryCard } from './_components/free-writing-entry-card';
import type { SubmissionMeta } from './_components/types';

interface SelectorsProps {
  difficulty: CefrLevel;
  onDifficultyChange: (level: CefrLevel) => void;
}

function Selectors(p: SelectorsProps) {
  return (
    <div className="mb-s-6 flex gap-s-4">
      <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
        Difficulty
        <select
          value={p.difficulty}
          onChange={(e) => p.onDifficultyChange(e.target.value as CefrLevel)}
          className="rounded border border-gray-300 bg-white px-3 py-2"
        >
          {Object.values(CefrLevel).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

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

export default function PracticePage() {
  const { getToken } = useAuth();
  const router = useRouter();
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
    if (state.kind !== 'idle') {
      sessionKickoffRef.current = false;
      return;
    }
    if (sessionKickoffRef.current) return;
    sessionKickoffRef.current = true;

    dispatch({ type: 'CREATE_REQUESTED' });
    createSession.mutate(
      { language: activeLanguage, difficulty, exerciseCount: DEFAULT_EXERCISE_COUNT },
      {
        onSuccess: (data) => dispatch({ type: 'CREATE_SUCCEEDED', session: data }),
        onError: (err) => dispatch({ type: 'CREATE_FAILED', error: err as Error }),
      },
    );
  }, [initialized, state.kind, activeLanguage, difficulty, createSession]);

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

  const selectors = (
    <Selectors
      difficulty={difficulty}
      onDifficultyChange={handleDifficultyChange}
    />
  );

  // Zero-profiles placeholder (unchanged from prior page)
  if (profiles.length === 0) {
    return (
      <div className="p-s-6">
        <h1 className="t-display-l mb-s-6">practice</h1>
        {selectors}
      </div>
    );
  }

  const insufficient =
    state.kind === 'createError' && isInsufficientExercises(state.error);

  const sessionPosition =
    state.kind === 'inSession'
      ? { current: state.index + 1, total: state.items.length }
      : null;

  const main = (
    <>
      <FreeWritingEntryCard />

      {/* Mobile: the coach rail collapses into a card at the top of content. */}
      {isMobile && currentItem && <CoachCard message={coachMsg} />}

      {selectors}

      {insufficient && (
        <Card padding="lg" className="bg-paper-2">
          <p className="t-body">
            no exercises available for {LANGUAGE_NAMES[activeLanguage] ?? activeLanguage} at {difficulty}
          </p>
          <p className="t-small text-ink-mute mt-s-2">try a different difficulty</p>
        </Card>
      )}

      {state.kind === 'createError' && !insufficient && (
        <Card padding="lg" className="bg-[var(--color-accent-soft)]">
          <p className="t-body">{state.error.message}</p>
        </Card>
      )}

      {state.kind === 'inSession' && currentItem && (
        <>
          {/* Mobile: horizontal session-position dots above the prompt. */}
          {isMobile && sessionPosition && (
            <div className="mb-s-3">
              <SessionDots
                current={sessionPosition.current}
                total={sessionPosition.total}
              />
            </div>
          )}
          {theoryTopicId && (
            <div className="mb-s-3 flex justify-end">
              <TheoryTrigger
                topicId={theoryTopicId}
                language={activeLanguage}
                onOpen={(id, el) => {
                  setOpenTopicId(id);
                  setTriggerEl(el);
                }}
                fetchFn={fetchFn}
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
        </>
      )}

    </>
  );

  return (
    <DrillActionProvider active={isMobile}>
      <DrillLayout
        rail={
          !isMobile && currentItem ? (
            <CoachRail message={coachMsg} exerciseType={exerciseTypeForRail} />
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
