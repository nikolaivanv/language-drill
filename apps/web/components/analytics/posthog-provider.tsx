'use client';

import { useEffect } from 'react';
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
  const { state } = useConsent();
  const consented = state?.analytics === true;
  const revoked = state?.analytics === false;

  useEffect(() => {
    if (consented) {
      initAnalytics();
      optInAnalytics();
      // Capture-allowed now; record the opt-in. A revoke is recorded by opt-out itself.
      track('consent_updated', { analytics: true });
    } else if (revoked) {
      optOutAnalytics();
    }
  }, [consented, revoked]);

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
