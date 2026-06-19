'use client';

import { useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { CefrLevel, ExerciseType } from '@language-drill/shared';
import {
  useExercise,
  useSubmitAnswer,
  useLanguageProfiles,
  createAuthenticatedFetch,
} from '@language-drill/api-client';
// One extra `../` compared to drill/page.tsx because we are one level deeper:
// (dashboard)/drill/conjugation/page.tsx vs (dashboard)/drill/page.tsx
import { useActiveLanguage } from '../../../../components/shell';
import { ExercisePane } from '../_components/exercise-pane';
import type { SubmissionMeta, SubmissionState } from '../_components/types';

// ---------------------------------------------------------------------------
// /drill/conjugation — opt-in conjugation warm-up (Plan, Task 16)
// ---------------------------------------------------------------------------
// Conjugation is intentionally NOT part of the adaptive rotation; this
// dedicated page is the only surface for it. It fetches one conjugation
// exercise from the pool, renders it via ExercisePane (which dispatches to
// ConjugationExercise), submits the answer WITHOUT a sessionId (the route
// validates session linkage only when sessionId is provided), shows feedback,
// and lets the user advance to a fresh exercise.
//
// Single-stage: submit → feedback → next. Mirrors free-writing/page.tsx's
// difficulty/fetchFn resolution but is simpler (no multi-stage navigation).
// ---------------------------------------------------------------------------

export default function ConjugationPage() {
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  const { activeLanguage } = useActiveLanguage();

  // Resolve difficulty from the user's profile for the active language,
  // defaulting to B1 — mirrors drill/page.tsx + free-writing/page.tsx exactly.
  const { data: profilesData } = useLanguageProfiles({ fetchFn });
  const profiles = profilesData?.profiles ?? [];
  const difficulty =
    (profiles.find((p) => p.language === activeLanguage)?.proficiencyLevel as CefrLevel) ??
    CefrLevel.B1;

  const [submission, setSubmission] = useState<SubmissionState>({ kind: 'idle' });

  // useExercise is a TanStack `useQuery`. The backend returns a *random*
  // exercise per call, but the query is pinned (`staleTime: Infinity`,
  // `refetchOnWindowFocus: false`) so the task stays stable mid-answer.
  // Advancing to a new exercise is therefore an explicit `refetch()`.
  const { data: exercise, isError, error, refetch } = useExercise({
    language: activeLanguage,
    difficulty,
    type: ExerciseType.CONJUGATION,
    fetchFn,
  });

  const submit = useSubmitAnswer({ fetchFn });

  const onSubmit = async (answer: string, _meta: SubmissionMeta) => {
    if (!exercise) return;
    setSubmission({ kind: 'submitting' });
    try {
      // No sessionId — the submit route validates session linkage only when a
      // sessionId is provided, and conjugation lives outside any drill session.
      const result = await submit.mutateAsync({ exerciseId: exercise.id, answer });
      setSubmission({ kind: 'evaluated', result, meta: {} });
    } catch (err) {
      setSubmission({
        kind: 'error',
        error: err instanceof Error ? err : new Error(String(err)),
      });
    }
  };

  const onNext = () => {
    // Reset feedback, then pull a fresh exercise. Advancing is an explicit
    // refetch — submitting deliberately does NOT swap the task (see
    // useSubmitAnswer), so the graded prompt + answer stay put under the
    // feedback until the user chooses to move on.
    setSubmission({ kind: 'idle' });
    void refetch();
  };

  // Empty-pool / 404: the API returns 404 NO_EXERCISES when nothing matches the
  // (language, difficulty, conjugation) filter. createAuthenticatedFetch throws
  // an Error whose `body.code` is 'NO_EXERCISES', surfaced here via `isError`.
  // Show a friendly message rather than spinning forever.
  if (isError) {
    const isNoExercises =
      (error as { body?: { code?: string } } | undefined)?.body?.code === 'NO_EXERCISES';
    return (
      <div className="p-s-6">
        <h1 className="t-display-l mb-s-4">conjugation warm-up</h1>
        <p className="t-body text-ink-mute">
          {isNoExercises
            ? 'no conjugation exercises yet for this language and level — check back soon.'
            : 'could not load a conjugation exercise. try again in a moment.'}
        </p>
      </div>
    );
  }

  if (!exercise) {
    return (
      <div className="t-body" style={{ padding: 24 }}>
        loading…
      </div>
    );
  }

  return (
    <div className="p-s-6">
      <h1 className="t-display-l mb-s-6">conjugation warm-up</h1>
      <ExercisePane
        exercise={exercise}
        language={activeLanguage}
        submission={submission}
        onSubmit={onSubmit}
        onNext={onNext}
        nextLabel="next"
      />
    </div>
  );
}
