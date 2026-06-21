'use client';

import { useEffect, useRef } from 'react';
import { useAuth } from '@clerk/nextjs';
import { identifyUser, resetUser } from '../../lib/analytics/posthog';

/** Stitches PostHog identity to the Clerk user; resets on sign-out. */
export function useIdentify(): void {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const wasSignedIn = useRef(false);

  useEffect(() => {
    if (!isLoaded) return;
    if (isSignedIn && userId) {
      identifyUser(userId);
      wasSignedIn.current = true;
    } else if (wasSignedIn.current) {
      resetUser();
      wasSignedIn.current = false;
    }
  }, [isLoaded, isSignedIn, userId]);
}
