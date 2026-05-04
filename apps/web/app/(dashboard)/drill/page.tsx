'use client';

import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import {
  Language,
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
  type TheoryTopicId,
} from '../../../components/theory';
import { topicIdForHint } from '../../../lib/theory-topic-map';
import { Card } from '../../../components/ui';
import { coachMessage } from '../../../lib/drill/coach-messages';
import { DEFAULT_EXERCISE_COUNT } from '../../../lib/drill/session-config';
import { CoachRail } from './_components/coach-rail';
import { DrillLayout } from './_components/drill-layout';
import { ExercisePane } from './_components/exercise-pane';
import {
  initialSessionState,
  selectCurrentItem,
  selectIsLastItem,
  selectProgressFraction,
  sessionReducer,
} from './_components/session-reducer';
import { SessionSummary } from './_components/session-summary';
import { SubmissionErrorCard } from './_components/submission-error-card';
import type { SubmissionMeta } from './_components/types';

interface SelectorsProps {
  language: Language;
  difficulty: CefrLevel;
  profiles: { language: string; proficiencyLevel: string }[];
  onLanguageChange: (lang: Language) => void;
  onDifficultyChange: (level: CefrLevel) => void;
  onAddLanguage: () => void;
}

function Selectors(p: SelectorsProps) {
  return (
    <div className="mb-s-6 flex gap-s-4">
      <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
        Language
        <select
          value={p.language}
          onChange={(e) => {
            const v = e.target.value;
            if (v === '__add') {
              e.target.value = p.language;
              p.onAddLanguage();
              return;
            }
            p.onLanguageChange(v as Language);
          }}
          className="rounded border border-gray-300 bg-white px-3 py-2"
        >
          {p.profiles.map((pr) => (
            <option key={pr.language} value={pr.language}>
              {LANGUAGE_NAMES[pr.language as Language] ?? pr.language}
            </option>
          ))}
          <option value="__add">+ Add language</option>
        </select>
      </label>
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

export default function PracticePage() {
  const { getToken } = useAuth();
  const router = useRouter();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);

  const { data: profilesData } = useLanguageProfiles({ fetchFn });
  const profiles = profilesData?.profiles ?? [];

  const [language, setLanguage] = useState<Language>(Language.EN);
  const [difficulty, setDifficulty] = useState<CefrLevel>(CefrLevel.B1);
  const [initialized, setInitialized] = useState(false);
  const [state, dispatch] = useReducer(sessionReducer, initialSessionState);

  const { activeLanguage } = useActiveLanguage();
  const [openTopicId, setOpenTopicId] = useState<TheoryTopicId | null>(null);
  const [triggerEl, setTriggerEl] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setOpenTopicId(null);
  }, [activeLanguage]);

  // Initialize selectors from the first profile once profiles load. We gate
  // the session-creation effect below on `initialized` so it doesn't fire
  // before the user's real (language, difficulty) lands in state.
  useEffect(() => {
    if (profiles.length > 0 && !initialized) {
      const first = profiles[0];
      setLanguage(first.language as Language);
      setDifficulty((first.proficiencyLevel as CefrLevel) ?? CefrLevel.B1);
      setInitialized(true);
    }
  }, [profiles, initialized]);

  const createSession = useCreateSession({ fetchFn });
  const submitMutation = useSubmitAnswer({ fetchFn });
  const completeSession = useCompleteSession({ fetchFn });

  function fireCompleteSession(sessionId: string) {
    completeSession.mutate(
      { sessionId },
      {
        onSuccess: (summary) =>
          dispatch({ type: 'COMPLETE_SUCCEEDED', summary }),
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
      { language, difficulty, exerciseCount: DEFAULT_EXERCISE_COUNT },
      {
        onSuccess: (data) => dispatch({ type: 'CREATE_SUCCEEDED', session: data }),
        onError: (err) => dispatch({ type: 'CREATE_FAILED', error: err as Error }),
      },
    );
  }, [initialized, state.kind, language, difficulty, createSession]);

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

  function handleLanguageChange(newLang: Language) {
    setLanguage(newLang);
    const matching = profiles.find((p) => p.language === newLang);
    if (matching) setDifficulty(matching.proficiencyLevel as CefrLevel);
    submitMutation.reset();
    dispatch({ type: 'RESET' });
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
  const theoryTopicId = exerciseContent
    ? topicIdForHint(exerciseContent.topicHint, activeLanguage)
    : null;

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
      language={language}
      difficulty={difficulty}
      profiles={profiles}
      onLanguageChange={handleLanguageChange}
      onDifficultyChange={handleDifficultyChange}
      onAddLanguage={() => router.push('/onboarding')}
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

  const main = (
    <>
      {selectors}

      {insufficient && (
        <Card padding="lg" className="bg-paper-2">
          <p className="t-body">
            no exercises available for {LANGUAGE_NAMES[language] ?? language} at {difficulty}
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
          {theoryTopicId && (
            <div className="mb-s-3 flex justify-end">
              <TheoryTrigger
                topicId={theoryTopicId}
                language={activeLanguage}
                onOpen={(id, el) => {
                  setOpenTopicId(id);
                  setTriggerEl(el);
                }}
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

      {state.kind === 'summary' && (
        <SessionSummary
          summary={state.summary}
          onAnother={() => dispatch({ type: 'RESET' })}
          onDone={() => router.push('/')}
        />
      )}
    </>
  );

  return (
    <>
      <DrillLayout
        rail={
          currentItem ? (
            <CoachRail message={coachMsg} exerciseType={exerciseTypeForRail} />
          ) : null
        }
        main={main}
        progressFraction={selectProgressFraction(state)}
        isLoading={state.kind === 'creating' || state.kind === 'completing'}
      />
      {openTopicId && (
        <TheoryPanel
          topicId={openTopicId}
          language={activeLanguage}
          triggerEl={triggerEl}
          onClose={() => setOpenTopicId(null)}
        />
      )}
    </>
  );
}
