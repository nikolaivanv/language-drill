'use client';

import * as React from 'react';
import type { ExerciseContent } from '@language-drill/shared';
import type {
  FluencyAttemptRequest,
  FluencyAttemptResponse,
} from '@language-drill/api-client';
import { FluencyItem, type FluencyVerdict } from './fluency-item';

export type FluencyExercise = {
  id: string;
  type: string;
  language: string;
  difficulty: string;
  grammarPointKey: string | null;
  contentJson: ExerciseContent;
};

export interface FluencyRunnerProps {
  exercises: FluencyExercise[];
  onSubmitAttempt: (input: FluencyAttemptRequest) => Promise<FluencyAttemptResponse>;
  onDone: () => void;
}

export function FluencyRunner({ exercises, onSubmitAttempt, onDone }: FluencyRunnerProps) {
  const [index, setIndex] = React.useState(0);
  const [verdict, setVerdict] = React.useState<FluencyVerdict>(null);
  const [elapsedMs, setElapsedMs] = React.useState(0);
  const startRef = React.useRef<number>(Date.now());
  const submittingRef = React.useRef(false);
  const intervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  const current = exercises[index];

  // (Re)start the timer when a new item appears; tick ~10/s while unanswered.
  React.useEffect(() => {
    startRef.current = Date.now();
    setElapsedMs(0);
    setVerdict(null);
    submittingRef.current = false;
    intervalRef.current = setInterval(() => setElapsedMs(Date.now() - startRef.current), 100);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [index]);

  async function handleSubmit(answer: string) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    const latencyMs = Date.now() - startRef.current;
    setElapsedMs(latencyMs);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    try {
      const res = await onSubmitAttempt({ exerciseId: current.id, answer, latencyMs });
      setVerdict({ correct: res.correct, correctAnswer: res.correctAnswer });
    } catch {
      // Network error — leave the item answerable and restart the timer from
      // now, so a retry's latency reflects fresh think-time rather than
      // accumulating the time the frozen timer sat after the failed submit.
      startRef.current = Date.now();
      setElapsedMs(0);
      if (!intervalRef.current) {
        intervalRef.current = setInterval(() => setElapsedMs(Date.now() - startRef.current), 100);
      }
    } finally {
      submittingRef.current = false;
    }
  }

  function handleNext() {
    if (index + 1 >= exercises.length) {
      onDone();
      return;
    }
    setIndex((i) => i + 1);
  }

  if (!current) return null;

  return (
    <FluencyItem
      content={current.contentJson}
      elapsedMs={elapsedMs}
      verdict={verdict}
      onSubmit={handleSubmit}
      onNext={handleNext}
      isLast={index + 1 >= exercises.length}
    />
  );
}
