'use client';

import { use, useMemo } from 'react';
import { useAuth } from '@clerk/nextjs';
import { createAuthenticatedFetch } from '@language-drill/api-client';
import { useActiveLanguage } from '../../../../components/shell/active-language-provider';
import { TheoryDetail } from '../_components/theory-detail';

interface TheoryDetailPageProps {
  params: Promise<{ topicId: string }>;
}

/**
 * Deep-linkable theory detail route (Requirement 6.1, 6.4). Reads and decodes
 * the `topicId` slug from the route params (Next encodes path segments, so a
 * direct deep link / refresh must be decoded back to the stored id), wires the
 * active language + authenticated fetch, and hands off to `TheoryDetail` for
 * all fetching / rendering / not-found handling.
 */
export default function TheoryDetailPage({ params }: TheoryDetailPageProps) {
  const { topicId } = use(params);
  const { activeLanguage } = useActiveLanguage();
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);

  return (
    <TheoryDetail
      topicId={decodeURIComponent(topicId)}
      language={activeLanguage}
      fetchFn={fetchFn}
    />
  );
}
