'use client';

import { useUser } from '@clerk/nextjs';
import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function SentryUserContext(): null {
  const { isLoaded, user } = useUser();

  useEffect(() => {
    // Wait for Clerk to hydrate. Without this guard, the first render would
    // call setUser(null) and any error in that window would be falsely
    // attributed to an anonymous user.
    if (!isLoaded) return;

    if (user) {
      Sentry.setUser({ id: user.id });
    } else {
      Sentry.setUser(null);
    }
  }, [isLoaded, user?.id]);

  return null;
}
