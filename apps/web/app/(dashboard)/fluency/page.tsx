'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { ExerciseType } from '@language-drill/shared';
import {
  createAuthenticatedFetch,
  useFluencySession,
  useSubmitFluencyAttempt,
} from '@language-drill/api-client';
import { useActiveLanguage } from '../../../components/shell';
import { FluencyRunner, type FluencyExercise } from './_components/fluency-runner';
import { FluencyDebrief } from './_components/fluency-debrief';
import type { FluencyItemResult } from './_components/fluency-metrics';
import { FluencyModeToggle } from './_components/fluency-mode-toggle';
import { useFluencyModeUrlState } from './_components/use-fluency-mode-url-state';

export default function FluencyPage() {
  const { activeLanguage } = useActiveLanguage();
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);

  const { mode, setMode } = useFluencyModeUrlState();
  const session = useFluencySession({ fetchFn });
  const submitAttempt = useSubmitFluencyAttempt({ fetchFn });
  const [results, setResults] = useState<FluencyItemResult[] | null>(null);

  // Start (or restart) a session for the active language + mode. `session.mutate`
  // is stable across renders (TanStack Query guarantee). Depend on `mode` (a
  // stable string), NOT a freshly-built `types` array, to avoid re-running every
  // render. Conjugation mode sends a single-type filter; `all` omits it.
  const sessionMutate = session.mutate;
  const startSession = useCallback(() => {
    setResults(null);
    sessionMutate({
      language: activeLanguage,
      ...(mode === 'conjugation' ? { types: [ExerciseType.CONJUGATION] } : {}),
    });
  }, [activeLanguage, sessionMutate, mode]);

  useEffect(() => {
    startSession();
  }, [startSession]);

  const insufficientCopy =
    mode === 'conjugation'
      ? 'Master a few more conjugations first — fluency mode re-serves forms you already know, fast. Keep drilling conjugation in normal mode and come back.'
      : 'Master a few more items first — fluency mode re-serves things you already know, fast. Keep drilling in normal mode and come back.';

  const header = (
    <div className="flex flex-col gap-s-3">
      <h1 className="t-display-s">fluency mode</h1>
      <FluencyModeToggle mode={mode} onSelect={setMode} />
    </div>
  );

  if (session.isPending || session.isIdle) {
    return (
      <div className="flex flex-col gap-s-4">
        {header}
        <p className="t-body">loading fluency drill…</p>
      </div>
    );
  }

  // 409 INSUFFICIENT_FLUENCY_POOL surfaces here as a mutation error.
  if (session.isError) {
    return (
      <div className="flex flex-col gap-s-4">
        {header}
        <p className="t-body text-ink-mute">{insufficientCopy}</p>
      </div>
    );
  }

  if (results) {
    return (
      <div className="flex flex-col gap-s-4">
        {header}
        <FluencyDebrief results={results} onRestart={startSession} />
      </div>
    );
  }

  const exercises = (session.data?.exercises ?? []) as FluencyExercise[];

  return (
    <div className="flex flex-col gap-s-4">
      {header}
      <FluencyRunner
        exercises={exercises}
        onSubmitAttempt={(input) => submitAttempt.mutateAsync(input)}
        onDone={(r) => setResults(r)}
      />
    </div>
  );
}
