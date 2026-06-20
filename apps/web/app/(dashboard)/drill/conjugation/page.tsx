'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
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
  // Which exercise the current `submission` belongs to. Advancing pulls a fresh
  // *random* exercise via refetch, and React Query keeps the previous `data` in
  // place while that refetch is in flight — so resetting submission to idle on
  // "next" would briefly re-render the OUTGOING exercise as a blank, unanswered
  // prompt before the new one lands (a visible flash / double-load). Instead we
  // pin the submission to its exercise id and derive `effectiveSubmission`: when
  // a different exercise arrives, the feedback falls back to idle in the *same*
  // render that swaps the prompt — atomic, no intermediate blank flash.
  const [submittedExerciseId, setSubmittedExerciseId] = useState<string | null>(null);

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
    setSubmittedExerciseId(exercise.id);
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
    // Pull a fresh exercise. Deliberately do NOT reset `submission` here: while
    // the refetch is in flight React Query still returns the current exercise,
    // so an eager idle-reset would flash the outgoing prompt blank before the
    // new one lands. The feedback stays pinned (see `effectiveSubmission`) until
    // a different exercise arrives, then clears in the same render as the swap.
    void refetch();
  };

  // The submission is only meaningful for the exercise it was made against. Once
  // a different exercise loads, treat it as idle — this is what makes advancing
  // atomic (new prompt + cleared feedback in one render) instead of a flash.
  const effectiveSubmission: SubmissionState =
    exercise && submittedExerciseId === exercise.id
      ? submission
      : { kind: 'idle' };

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
      <div className="mb-s-6 flex items-baseline justify-between gap-s-4">
        <h1 className="t-display-l">conjugation warm-up</h1>
        <Link
          href="/fluency?type=conjugation"
          className="t-small text-ink-2 no-underline hover:text-accent-2"
        >
          drill these fast →
        </Link>
      </div>
      <ExercisePane
        exercise={exercise}
        language={activeLanguage}
        submission={effectiveSubmission}
        onSubmit={onSubmit}
        onNext={onNext}
        nextLabel="next"
      />
    </div>
  );
}
