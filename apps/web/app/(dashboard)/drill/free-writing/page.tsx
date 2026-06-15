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
import { FwResults } from './_components/fw-results';
import { FwCorrections } from './_components/fw-corrections';
import { FwCompare } from './_components/fw-compare';
import './free-writing.css';

type Stage = 'brief' | 'composer' | 'results' | 'corrections' | 'compare';

export default function FreeWritingPage() {
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  const { activeLanguage } = useActiveLanguage();

  // Resolve difficulty from the user's profile for the active language,
  // defaulting to B1 — mirrors drill/page.tsx's approach exactly.
  const { data: profilesData } = useLanguageProfiles({ fetchFn });
  const profiles = profilesData?.profiles ?? [];
  const difficulty =
    (profiles.find((p) => p.language === activeLanguage)?.proficiencyLevel as CefrLevel) ??
    CefrLevel.B1;

  const [stage, setStage] = useState<Stage>('brief');
  // History of surfaces visited within a single graded result, so the deep
  // surfaces (corrections/compare) can return to wherever they were reached
  // from — compare is reachable from both results and corrections.
  const [, setHistory] = useState<Stage[]>([]);
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

  const submit = useSubmitFreeWriting({ fetchFn });

  if (!exercise) {
    return (
      <div className="t-body" style={{ padding: 24 }}>
        loading…
      </div>
    );
  }

  const content = exercise.contentJson as FreeWritingContent;

  // Navigate forward to `next`, remembering the current surface so `back` can
  // return to it.
  const go = (next: Stage) => {
    setHistory((h) => [...h, stage]);
    setStage(next);
  };

  // Pop back to the previously visited surface.
  const back = () => {
    setHistory((h) => {
      const prev = h[h.length - 1];
      if (prev) setStage(prev);
      return h.slice(0, -1);
    });
  };

  const onGrade = async () => {
    const answer = text;
    try {
      const result = await submit.mutateAsync({ exerciseId: exercise.id, answer });
      // Snapshot the exact submitted text alongside the result so the
      // corrections/compare surfaces locate error spans in the graded string,
      // never the still-editable live draft.
      setSubmittedText(answer);
      setEvaluation(result);
      // Fresh history per graded result: back from a deep surface must never
      // land on the already-graded composer.
      setHistory([]);
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
    setHistory([]);
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
        />
      );
    case 'composer':
      return (
        <FwComposer
          content={content}
          value={text}
          onChange={setText}
          examMode={examMode}
          submitting={submit.isPending}
          onGrade={onGrade}
        />
      );
    case 'results':
      return evaluation ? (
        <FwResults
          evaluation={evaluation}
          onCorrections={() => go('corrections')}
          onCompare={() => go('compare')}
          onAnother={reset}
        />
      ) : null;
    case 'corrections':
      return evaluation ? (
        <FwCorrections
          evaluation={evaluation}
          original={submittedText}
          onCompare={() => go('compare')}
          onBack={back}
        />
      ) : null;
    case 'compare':
      return evaluation ? (
        <FwCompare evaluation={evaluation} original={submittedText} onBack={back} />
      ) : null;
  }
}
