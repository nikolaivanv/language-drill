'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
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
  useExercise,
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
import { Button, Card } from '../../../components/ui';
import { coachMessage } from '../../../lib/drill/coach-messages';
import { CoachRail } from './_components/coach-rail';
import { DrillLayout } from './_components/drill-layout';
import { ExercisePane } from './_components/exercise-pane';
import type { SubmissionMeta, SubmissionState } from './_components/types';

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

function SubmissionErrorCard({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const isRateLimit = error.message.includes('429') || /rate limit/i.test(error.message);
  const message = isRateLimit
    ? "You've reached your daily practice limit. Come back tomorrow!"
    : `Failed to submit answer: ${error.message}`;
  return (
    <Card
      padding="lg"
      className={isRateLimit ? 'bg-[var(--color-hilite-soft)]' : 'bg-[var(--color-accent-soft)]'}
    >
      <p className="t-body">{message}</p>
      <div className="mt-s-3">
        <Button variant="default" onClick={onRetry}>try again</Button>
      </div>
    </Card>
  );
}

export default function PracticePage() {
  const { getToken } = useAuth();
  const router = useRouter();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);

  const { data: profilesData } = useLanguageProfiles({ fetchFn });
  const profiles = profilesData?.profiles ?? [];

  const [language, setLanguage] = useState<Language>(Language.EN);
  const [difficulty, setDifficulty] = useState<CefrLevel>(CefrLevel.B1);
  const [submission, setSubmission] = useState<SubmissionState>({ kind: 'idle' });

  // activeLanguage drives theory scope + renderers' accent picker.
  // `language` (above) is the page-local exercise filter.
  const { activeLanguage } = useActiveLanguage();
  const [openTopicId, setOpenTopicId] = useState<TheoryTopicId | null>(null);
  const [triggerEl, setTriggerEl] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setOpenTopicId(null);
  }, [activeLanguage]);

  const initializedRef = useRef(false);
  useEffect(() => {
    if (profiles.length > 0 && !initializedRef.current) {
      initializedRef.current = true;
      const first = profiles[0];
      setLanguage(first.language as Language);
      setDifficulty((first.proficiencyLevel as CefrLevel) ?? CefrLevel.B1);
    }
  }, [profiles]);

  const { data: exercise, isLoading, error, refetch } = useExercise({
    language,
    difficulty,
    fetchFn,
  });
  const submitMutation = useSubmitAnswer({ fetchFn });

  function handleSubmit(answer: string, meta: SubmissionMeta) {
    if (!exercise || !answer.trim()) return;
    setSubmission({ kind: 'submitting' });
    submitMutation.mutate(
      { exerciseId: exercise.id, answer: answer.trim() },
      {
        onSuccess: (result) =>
          setSubmission({ kind: 'evaluated', result: result as EvaluationResult, meta }),
        onError: (err) => setSubmission({ kind: 'error', error: err as Error }),
      },
    );
  }

  function handleNext() {
    setSubmission({ kind: 'idle' });
    submitMutation.reset();
    refetch();
  }

  function handleRetry() {
    setSubmission({ kind: 'idle' });
    submitMutation.reset();
  }

  function handleLanguageChange(newLang: Language) {
    setLanguage(newLang);
    const matching = profiles.find((p) => p.language === newLang);
    if (matching) setDifficulty(matching.proficiencyLevel as CefrLevel);
  }

  // Map current exercise's topicHint → known theory topic id for activeLanguage.
  const exerciseContent =
    exercise && !isLoading && !error ? (exercise.contentJson as ExerciseContent) : null;
  const theoryTopicId = exerciseContent
    ? topicIdForHint(exerciseContent.topicHint, activeLanguage)
    : null;

  const exerciseTypeForRail: ExerciseType =
    exerciseContent && 'type' in exerciseContent ? exerciseContent.type : ExerciseType.CLOZE;

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
      onDifficultyChange={setDifficulty}
      onAddLanguage={() => router.push('/onboarding')}
    />
  );

  if (!exercise && !error && profiles.length === 0) {
    return (
      <div className="p-s-6">
        <h1 className="t-display-l mb-s-6">practice</h1>
        {selectors}
      </div>
    );
  }

  const is404 =
    !!error &&
    (error.message.includes('404') || error.message.toLowerCase().includes('not found'));

  const main = (
    <>
      {selectors}

      {error && !isLoading && is404 && (
        <Card padding="lg" className="bg-paper-2">
          <p className="t-body">
            no exercises available for {LANGUAGE_NAMES[language] ?? language} at {difficulty}
          </p>
          <p className="t-small text-ink-mute mt-s-2">try a different difficulty</p>
        </Card>
      )}

      {error && !isLoading && !is404 && (
        <Card padding="lg" className="bg-[var(--color-accent-soft)]">
          <p className="t-body">{error.message}</p>
        </Card>
      )}

      {exercise && !isLoading && !error && (
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
            exercise={exercise}
            language={activeLanguage}
            submission={submission}
            onSubmit={handleSubmit}
            onNext={handleNext}
          />
          {submission.kind === 'error' && (
            <div className="mt-s-4">
              <SubmissionErrorCard error={submission.error} onRetry={handleRetry} />
            </div>
          )}
        </>
      )}
    </>
  );

  return (
    <>
      <DrillLayout
        rail={
          exercise ? (
            <CoachRail message={coachMsg} exerciseType={exerciseTypeForRail} />
          ) : null
        }
        main={main}
        progressFraction={0}
        isLoading={isLoading}
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
