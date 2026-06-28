'use client';

import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { useSearchParams } from 'next/navigation';
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
import { TheoryPanel, TheoryTrigger } from '../../../../components/theory';
import {
  topicIdForGrammarPointKey,
  exerciseTypeHasTheory,
} from '../../../../lib/theory-topic-map';
import { ExercisePane } from '../_components/exercise-pane';
import { DrillMeta } from '../_components/drill-meta';
import { FlagExerciseControl } from '../_components/flag-exercise-control';
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

function ConjugationPageContent() {
  const { getToken } = useAuth();
  const searchParams = useSearchParams();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  const { activeLanguage } = useActiveLanguage();
  const [grammarPointKey] = useState<string | null>(() => {
    const g = searchParams.get('grammarPoint');
    return g && g.length > 0 ? g : null;
  });

  // The learner's recorded baseline for the active language (identity), used as
  // the level default + the DrillMeta drift signal. Null when no profile yet.
  const { data: profilesData } = useLanguageProfiles({ fetchFn });
  const profiles = profilesData?.profiles ?? [];
  const baseline =
    (profiles.find((p) => p.language === activeLanguage)?.proficiencyLevel as
      | CefrLevel
      | undefined) ?? null;

  // The session-scoped level override. Null until the user picks one, then the
  // chosen level wins; effective difficulty falls back baseline → B1.
  const [level, setLevel] = useState<CefrLevel | null>(null);
  const difficulty = level ?? baseline ?? CefrLevel.B1;

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

  // Theory panel host (open topic + the trigger element for focus return).
  const [openTopicId, setOpenTopicId] = useState<string | null>(null);
  const [triggerEl, setTriggerEl] = useState<HTMLElement | null>(null);

  // useExercise is a TanStack `useQuery`. The backend returns a *random*
  // exercise per call, but the query is pinned (`staleTime: Infinity`,
  // `refetchOnWindowFocus: false`) so the task stays stable mid-answer.
  // Advancing to a new exercise is therefore an explicit `refetch()`.
  const { data: exercise, isError, error, refetch } = useExercise({
    language: activeLanguage,
    difficulty,
    type: ExerciseType.CONJUGATION,
    fetchFn,
    ...(grammarPointKey ? { grammarPointKey } : {}),
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
      setSubmission({
        kind: 'evaluated',
        result,
        meta: {},
        submissionId: (result as { submissionId?: string }).submissionId,
      });
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

  // Theory topic for the current exercise's grammar point (null when the type
  // can't have theory or the key doesn't map). TheoryTrigger self-hides when
  // the resolved topic has no content, so a non-null id here is safe.
  const theoryTopicId =
    exercise && exerciseTypeHasTheory(exercise.type)
      ? topicIdForGrammarPointKey(exercise.grammarPointKey ?? null, activeLanguage)
      : null;

  const topicTrigger = theoryTopicId ? (
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
      {/* Title owns its own line so the meta controls below never compete with
          it on the baseline (DRILL-UI: open up before the title). */}
      <h1 className="t-display-l mb-s-4">conjugation warm-up</h1>

      {/* One meta row: writable level pill (+ drift/reset) and the read-only
          theory link, with the rapid-fire deep-link pushed to the far right. */}
      <div className="mb-s-6 flex flex-wrap items-center gap-s-3">
        <DrillMeta
          level={difficulty}
          baseline={baseline}
          onLevelChange={setLevel}
          topic={topicTrigger}
        />
        <Link
          href="/fluency?type=conjugation"
          className="ml-auto t-small text-ink-2 no-underline transition-colors hover:text-ink"
        >
          drill these fast <span className="lk-arr" aria-hidden="true">→</span>
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

      {effectiveSubmission.kind === 'evaluated' &&
        effectiveSubmission.submissionId && (
          <FlagExerciseControl
            exerciseId={exercise.id}
            submissionId={effectiveSubmission.submissionId}
            fetchFn={fetchFn}
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
    </div>
  );
}

// `useSearchParams()` forces this client page out of static prerendering;
// Next.js requires the bailout to sit under a Suspense boundary.
export default function ConjugationPage() {
  return (
    <Suspense fallback={<div className="t-body" style={{ padding: 24 }}>loading…</div>}>
      <ConjugationPageContent />
    </Suspense>
  );
}
