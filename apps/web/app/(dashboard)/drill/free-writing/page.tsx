'use client';
import { useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { CefrLevel, ExerciseType, type FreeWritingContent } from '@language-drill/shared';
import {
  useExercise,
  useSubmitFreeWriting,
  useLanguageProfiles,
  createAuthenticatedFetch,
  type FreeWritingEvaluationResponse,
} from '@language-drill/api-client';
// One extra `../` compared to drill/page.tsx because we are one level deeper:
// (dashboard)/drill/free-writing/page.tsx vs (dashboard)/drill/page.tsx
import { useActiveLanguage } from '../../../../components/shell';
import { FwBrief } from './_components/fw-brief';
import { FwComposer } from './_components/fw-composer';
import { FwGraded } from './_components/fw-graded';
import './free-writing.css';

type Stage = 'brief' | 'composer' | 'results';

export default function FreeWritingPage() {
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  // Grading an essay takes ~50s — past API Gateway's 30s cap — so the submit
  // goes to the eval-submit Function URL. Unset (local dev) → regular API.
  const submitFetchFn = useMemo(
    () =>
      createAuthenticatedFetch(getToken, {
        baseUrl: process.env.NEXT_PUBLIC_EVAL_SUBMIT_URL,
      }),
    [getToken],
  );
  const { activeLanguage } = useActiveLanguage();

  // Resolve difficulty from the user's profile for the active language,
  // defaulting to B1 — mirrors drill/page.tsx's approach exactly.
  const { data: profilesData } = useLanguageProfiles({ fetchFn });
  const profiles = profilesData?.profiles ?? [];
  const difficulty =
    (profiles.find((p) => p.language === activeLanguage)?.proficiencyLevel as CefrLevel) ??
    CefrLevel.B1;

  const [stage, setStage] = useState<Stage>('brief');
  const [examMode, setExamMode] = useState(false);
  const [text, setText] = useState('');
  const [submittedText, setSubmittedText] = useState('');
  const [evaluation, setEvaluation] = useState<FreeWritingEvaluationResponse | null>(null);

  const { data: exercise } = useExercise({
    language: activeLanguage,
    difficulty,
    type: ExerciseType.FREE_WRITING,
    fetchFn,
  });

  const submit = useSubmitFreeWriting({ fetchFn: submitFetchFn });

  if (!exercise) {
    return (
      <div className="t-body" style={{ padding: 24 }}>
        loading…
      </div>
    );
  }

  const content = exercise.contentJson as FreeWritingContent;

  const onGrade = async () => {
    const answer = text;
    try {
      const result = await submit.mutateAsync({ exerciseId: exercise.id, answer });
      // Snapshot the exact submitted text alongside the result so the
      // corrections/compare surfaces locate error spans in the graded string,
      // never the still-editable live draft.
      setSubmittedText(answer);
      setEvaluation(result);
      setStage('results');
    } catch (err) {
      // Stay on the composer — the user can try again.
      console.error('[FreeWritingPage] grading failed:', err);
    }
  };

  const reset = () => {
    setText('');
    setSubmittedText('');
    setEvaluation(null);
    setStage('brief');
  };

  switch (stage) {
    case 'brief':
      return (
        <FwBrief
          content={content}
          examMode={examMode}
          onToggleExam={() => setExamMode((v) => !v)}
          onBegin={() => setStage('composer')}
          historyHref="/drill/free-writing/history"
        />
      );
    case 'composer':
      return (
        <FwComposer
          content={content}
          language={activeLanguage}
          value={text}
          onChange={setText}
          examMode={examMode}
          submitting={submit.isPending}
          onGrade={onGrade}
          exerciseId={exercise.id}
          fetchFn={fetchFn}
        />
      );
    case 'results':
      // FwGraded owns the results → corrections → compare back stack; keyed per
      // result so a new essay starts on its scorecard, never on a deep surface.
      return evaluation ? (
        <FwGraded
          key={evaluation.submissionId ?? submittedText}
          evaluation={evaluation}
          original={submittedText}
          onAnother={reset}
        />
      ) : null;
  }
}
