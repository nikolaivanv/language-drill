'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import {
  createAuthenticatedFetch,
  useFluencySession,
  useSubmitFluencyAttempt,
} from '@language-drill/api-client';
import { useActiveLanguage } from '../../../components/shell';
import { FluencyRunner, type FluencyExercise } from './_components/fluency-runner';

export default function FluencyPage() {
  const { activeLanguage } = useActiveLanguage();
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);

  const session = useFluencySession({ fetchFn });
  const submitAttempt = useSubmitFluencyAttempt({ fetchFn });
  const [done, setDone] = useState(false);

  // Start a session on mount / language change. `session.mutate` is stable
  // across renders (TanStack Query guarantee), so omitting it from deps is safe.
  const sessionMutate = session.mutate;
  useEffect(() => {
    setDone(false);
    sessionMutate({ language: activeLanguage });
  }, [activeLanguage, sessionMutate]);

  if (session.isPending || session.isIdle) {
    return <p className="t-body">loading fluency drill…</p>;
  }

  // 409 INSUFFICIENT_FLUENCY_POOL surfaces here as a mutation error.
  if (session.isError) {
    return (
      <div className="flex flex-col gap-s-3">
        <h1 className="t-display-s">fluency mode</h1>
        <p className="t-body text-ink-mute">
          Master a few more items first — fluency mode re-serves things you already know,
          fast. Keep drilling in normal mode and come back.
        </p>
      </div>
    );
  }

  if (done) {
    return (
      <div className="flex flex-col gap-s-3">
        <h1 className="t-display-s">nice — that was fast</h1>
        <p className="t-body text-ink-mute">Your latency trend is on the progress page → fluency tab.</p>
      </div>
    );
  }

  const exercises = (session.data?.exercises ?? []) as FluencyExercise[];

  return (
    <div className="flex flex-col gap-s-4">
      <h1 className="t-display-s">fluency mode</h1>
      <FluencyRunner
        exercises={exercises}
        onSubmitAttempt={(input) => submitAttempt.mutateAsync(input)}
        onDone={() => setDone(true)}
      />
    </div>
  );
}
