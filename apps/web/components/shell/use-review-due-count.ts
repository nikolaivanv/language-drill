'use client';

import { useMemo } from 'react';
import { useAuth } from '@clerk/nextjs';
import { createAuthenticatedFetch, useReviewOverview } from '@language-drill/api-client';
import { useActiveLanguage } from './active-language-provider';

// Shared by the desktop rail and the mobile tab-bar to badge the Review
// destination with the active language's actionable review count (Req 13.4).
// Returns the projected session size (due + capped new intake), 0 while
// loading or empty.
export function useReviewDueCount(): number {
  const { activeLanguage } = useActiveLanguage();
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  const overview = useReviewOverview({ fetchFn, language: activeLanguage });
  return overview.data?.breakdown.total ?? 0;
}
