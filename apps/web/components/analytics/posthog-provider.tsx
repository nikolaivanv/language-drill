'use client';

import { useEffect, useRef } from 'react';
import { useConsent } from '../consent/consent-provider';
import { initAnalytics, optInAnalytics, optOutAnalytics } from '../../lib/analytics/posthog';
import { track } from '../../lib/analytics/track';
import { useIdentify } from './use-identify';
import { usePageviews } from './use-pageviews';

/**
 * Drives PostHog lifecycle from the analytics consent category. Renders children
 * unconditionally; analytics simply never initializes until consent is granted.
 */
export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const { state, ready } = useConsent();
  const consented = state?.analytics === true;
  const revoked = state?.analytics === false;

  // Tracks the settled consented value after hydration. `undefined` means we
  // haven't seen the first settled run yet, so we can distinguish the
  // "returning user reload" case (null → true without a user gesture) from an
  // actual in-session grant (false → true via user interaction).
  const prevConsentedRef = useRef<boolean | undefined>(undefined);

  useEffect(() => {
    // Wait for the consent state to be hydrated from localStorage before acting.
    if (!ready) return;

    const prev = prevConsentedRef.current;
    const isFirstSettledRun = prev === undefined;

    if (consented) {
      initAnalytics();
      optInAnalytics();
      // Only emit consent_updated for an actual in-session grant (false → true).
      // On the first settled run after a reload, prev is undefined; a returning
      // user has consented already stored, so we do NOT emit here — we only
      // initialize. On subsequent renders where consent flips true from false,
      // prev will be false, which is the real user-grant case.
      if (!isFirstSettledRun && prev === false) {
        track('consent_updated', { analytics: true });
      }
    } else if (revoked) {
      optOutAnalytics();
    }

    prevConsentedRef.current = consented;
  }, [ready, consented, revoked]);

  return (
    <>
      <AnalyticsEffects />
      {children}
    </>
  );
}

/** Hosts app-wide analytics side-effects (identity stitching + manual pageviews). */
function AnalyticsEffects() {
  useIdentify();
  usePageviews();
  return null;
}

export default PostHogProvider;
