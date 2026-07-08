'use client';

import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { useSearchParams } from 'next/navigation';
import { CefrLevel, CORRECT_THRESHOLD, ExerciseType } from '@language-drill/shared';
import {
  useExerciseSet,
  useSubmitAnswer,
  useLanguageProfiles,
  createAuthenticatedFetch,
  type DebriefItem,
} from '@language-drill/api-client';
// One extra `../` compared to drill/page.tsx because we are one level deeper:
// (dashboard)/drill/conjugation/page.tsx vs (dashboard)/drill/page.tsx
import { useActiveLanguage } from '../../../../components/shell';
import { TheoryPanel, TheoryTrigger } from '../../../../components/theory';
import {
  topicIdForGrammarPointKey,
  exerciseTypeHasTheory,
} from '../../../../lib/theory-topic-map';
import { Button } from '../../../../components/ui';
import { ExercisePane } from '../_components/exercise-pane';
import { DrillMeta } from '../_components/drill-meta';
import { FlagExerciseControl } from '../_components/flag-exercise-control';
import type { SubmissionMeta, SubmissionState } from '../_components/types';
import { ConjugationReview } from './_components/conjugation-review';

// ---------------------------------------------------------------------------
// /drill/conjugation — opt-in conjugation warm-up (Plan, Task 16)
// ---------------------------------------------------------------------------
// Conjugation is intentionally NOT part of the adaptive rotation; this
// dedicated page is the only surface for it. It fetches a *pre-composed,
// distinct-by-content set* of conjugation exercises (GET /exercises/set) and
// iterates them client-side, so a sitting never repeats the same prompt — the
// pool holds exact-duplicate content rows that the single-row random draw used
// to surface back-to-back. Submissions stay sessionless (no sessionId); the
// finish-session recap is built purely client-side from accumulated answers.
//
// Per item: submit → feedback → next. The last item's "see results" ends the
// sitting; "finish session" ends it early.
// ---------------------------------------------------------------------------

// How many distinct items a conjugation sitting serves before "see results".
const CONJUGATION_SET_COUNT = 10;

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

  // Position within the fetched set. Advancing is a local index step — the items
  // are already loaded, so there is no refetch (and no flash) between prompts.
  const [index, setIndex] = useState(0);
  const [submission, setSubmission] = useState<SubmissionState>({ kind: 'idle' });

  // Theory panel host (open topic + the trigger element for focus return).
  const [openTopicId, setOpenTopicId] = useState<string | null>(null);
  const [triggerEl, setTriggerEl] = useState<HTMLElement | null>(null);

  // Session recap: each evaluated answer accumulates as a DebriefItem so
  // "finish session" / "see results" can show a quick-drill-style review built
  // purely client-side. `finished` swaps the page to the recap.
  const [reviewItems, setReviewItems] = useState<DebriefItem[]>([]);
  const [finished, setFinished] = useState(false);
  const [sessionStart, setSessionStart] = useState(() => Date.now());
  const [finishedAt, setFinishedAt] = useState<number | null>(null);

  // A pre-composed, distinct-by-content set. Pinned (`staleTime: Infinity`) so
  // the items stay stable mid-sitting; a fresh set is an explicit `refetch()`.
  const { data: setData, isError, refetch } = useExerciseSet({
    language: activeLanguage,
    difficulty,
    type: ExerciseType.CONJUGATION,
    count: CONJUGATION_SET_COUNT,
    fetchFn,
    ...(grammarPointKey ? { grammarPointKey } : {}),
  });

  const exercises = setData?.exercises ?? [];
  const submit = useSubmitAnswer({ fetchFn });

  // A grammarPoint-targeted set may have been re-leveled by the server (the
  // point's own CEFR level wins over the requested/profile difficulty — see
  // resolveTargetedDifficulty in the lambda). Reflect that in the level pill
  // and the recap WITHOUT feeding it back into the query input: `difficulty`
  // is part of useExerciseSet's query key, so a setLevel here would spawn a
  // redundant refetch whose transition unmounts the exercise pane (and any
  // in-progress typed answer) mid-session. `setData.difficulty` is optional on
  // the response (compat with an already-deployed API that predates this
  // field), so display falls back to the requested level until it ships.
  const displayLevel =
    grammarPointKey && setData?.difficulty ? setData.difficulty : difficulty;

  const onSubmit = async (answer: string, _meta: SubmissionMeta) => {
    const exercise = exercises[index];
    if (!exercise) return;
    setSubmission({ kind: 'submitting' });
    try {
      // No sessionId — the submit route validates session linkage only when a
      // sessionId is provided, and conjugation lives outside any drill session.
      const result = await submit.mutateAsync({ exerciseId: exercise.id, answer });
      const submissionId = (result as { submissionId?: string }).submissionId;
      setSubmission({ kind: 'evaluated', result, meta: {}, submissionId });
      // Record the attempt for the end-of-session recap.
      setReviewItems((prev) => [
        ...prev,
        {
          exerciseId: exercise.id,
          submissionId: submissionId ?? null,
          type: exercise.type as ExerciseType,
          grammarPointKey: exercise.grammarPointKey ?? null,
          // ExerciseResponse carries no grammar-point name; the recap card
          // tolerates null (it falls back to the key/feature bundle).
          grammarPointName: null,
          contentJson: exercise.contentJson,
          status: result.score >= CORRECT_THRESHOLD ? 'correct' : 'incorrect',
          userAnswer: answer,
          score: result.score,
          evaluation: result,
        },
      ]);
    } catch (err) {
      setSubmission({
        kind: 'error',
        error: err instanceof Error ? err : new Error(String(err)),
      });
    }
  };

  const onFinish = () => {
    setFinishedAt(Date.now());
    setFinished(true);
  };

  const onNext = () => {
    // Last item → end the sitting and show the recap; otherwise step to the next
    // already-loaded prompt and clear the feedback.
    if (index >= exercises.length - 1) {
      onFinish();
      return;
    }
    setIndex((i) => i + 1);
    setSubmission({ kind: 'idle' });
  };

  const onPracticeMore = () => {
    // Fresh distinct set (freshness-ordered → the next least-recently-seen
    // contents, not repeats) and a clean sitting.
    setReviewItems([]);
    setFinished(false);
    setFinishedAt(null);
    setSessionStart(Date.now());
    setIndex(0);
    setSubmission({ kind: 'idle' });
    void refetch();
  };

  const onLevelChange = (next: CefrLevel) => {
    // A new level means a new set — restart the sitting cleanly.
    setLevel(next);
    setIndex(0);
    setReviewItems([]);
    setSubmission({ kind: 'idle' });
  };

  // Theory topic for the current exercise's grammar point (null when the type
  // can't have theory or the key doesn't map). TheoryTrigger self-hides when
  // the resolved topic has no content, so a non-null id here is safe.
  const current = exercises.length > 0 ? exercises[Math.min(index, exercises.length - 1)] : undefined;
  const theoryTopicId =
    current && exerciseTypeHasTheory(current.type)
      ? topicIdForGrammarPointKey(current.grammarPointKey ?? null, activeLanguage)
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

  // Finished: swap the whole surface to the client-built recap.
  if (finished) {
    return (
      <ConjugationReview
        items={reviewItems}
        language={activeLanguage}
        // Display usage: the recap header should report the level the set was
        // ACTUALLY pulled at (the effective, possibly re-leveled one).
        difficulty={displayLevel}
        durationSeconds={
          finishedAt ? Math.max(0, Math.floor((finishedAt - sessionStart) / 1000)) : 0
        }
        fetchFn={fetchFn}
        onPracticeMore={onPracticeMore}
      />
    );
  }

  // Network/5xx while loading the set.
  if (isError) {
    return (
      <div className="p-s-6">
        <h1 className="t-display-l mb-s-4">conjugation warm-up</h1>
        <p className="t-body text-ink-mute">
          could not load conjugation exercises. try again in a moment.
        </p>
      </div>
    );
  }

  if (!setData) {
    return (
      <div className="t-body" style={{ padding: 24 }}>
        loading…
      </div>
    );
  }

  // Empty pool: the set endpoint returns an empty array when nothing matches the
  // (language, difficulty, conjugation) filter.
  if (!current) {
    return (
      <div className="p-s-6">
        <h1 className="t-display-l mb-s-4">conjugation warm-up</h1>
        <p className="t-body text-ink-mute">
          no conjugation exercises yet for this language and level — check back soon.
        </p>
      </div>
    );
  }

  return (
    <div className="p-s-6">
      {/* Title owns its own line so the meta controls below never compete with
          it on the baseline (DRILL-UI: open up before the title). */}
      <h1 className="t-display-l mb-s-4">conjugation warm-up</h1>

      {/* Two stacked meta rows: row 1 = writable level pill (+ drift/reset)
          with the rapid-fire deep-link pushed right; row 2 = the read-only
          theory link on its own line. */}
      <div className="mb-s-6 flex flex-col gap-s-3">
        <div className="flex flex-wrap items-center gap-s-3">
          <DrillMeta level={displayLevel} baseline={baseline} onLevelChange={onLevelChange} />
          <Link
            href="/fluency?type=conjugation"
            className="ml-auto t-small text-ink-2 no-underline transition-colors hover:text-ink"
          >
            drill these fast <span className="lk-arr" aria-hidden="true">→</span>
          </Link>
        </div>
        {topicTrigger && <div>{topicTrigger}</div>}
      </div>

      <ExercisePane
        key={current.id}
        exercise={current}
        language={activeLanguage}
        submission={submission}
        onSubmit={onSubmit}
        onNext={onNext}
        nextLabel={index >= exercises.length - 1 ? 'see results' : 'next'}
      />

      {submission.kind === 'evaluated' && submission.submissionId && (
        <FlagExerciseControl
          exerciseId={current.id}
          submissionId={submission.submissionId}
          fetchFn={fetchFn}
        />
      )}

      {/* End the sitting whenever, once ≥1 item is answered. Right-aligned so it
          sits under the primary next/results control (easier thumb reach on
          mobile, and reads as more organized than a lone left-aligned button). */}
      {reviewItems.length > 0 && (
        <div className="mt-s-6 flex justify-end">
          <Button variant="ghost" onClick={onFinish}>
            finish session
          </Button>
        </div>
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
