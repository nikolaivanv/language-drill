'use client';

import { use, useMemo } from 'react';
import { useAuth } from '@clerk/nextjs';
import { createAuthenticatedFetch } from '@language-drill/api-client';
import { FwAttempt } from '../../_components/fw-attempt';
import '../../free-writing.css';

interface FreeWritingAttemptPageProps {
  params: Promise<{ submissionId: string }>;
}

export default function FreeWritingAttemptPage({ params }: FreeWritingAttemptPageProps) {
  const { submissionId } = use(params);
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);

  // Keyed so navigating between attempts resets the surfaces' back stack.
  return (
    <FwAttempt key={submissionId} submissionId={decodeURIComponent(submissionId)} fetchFn={fetchFn} />
  );
}
