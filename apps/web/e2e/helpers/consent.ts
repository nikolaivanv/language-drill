// Seed a recorded cookie-consent choice for the E2E suite.
//
// Without a stored choice the first-visit cookie banner mounts as a fixed card
// pinned to the viewport bottom; it overlaps and intercepts pointer events on
// page content (the "+ save to vocabulary" button, review controls, and even
// the Clerk sign-in "Continue" button), which times out clicks. Seeding a
// "necessary only" choice keeps the banner from ever showing — and, as a bonus,
// keeps PostHog from loading during tests.
//
// The key/shape mirror lib/consent/consent.ts; CONSENT_VERSION is imported from
// there so the two never drift (a version bump invalidates a stale value).

import { CONSENT_VERSION } from '../../lib/consent/consent';

export const CONSENT_KEY = 'drill-cookie-consent';

export const CONSENT_VALUE = JSON.stringify({
  analytics: false,
  version: CONSENT_VERSION,
  // Fixed timestamp — Date.now() isn't needed and a constant keeps the value
  // stable across runs.
  timestamp: '2026-01-01T00:00:00.000Z',
});

/** A storageState `origins` entry that seeds the consent choice for `baseURL`. */
export function consentOrigin(baseURL: string) {
  return {
    origin: new URL(baseURL).origin,
    localStorage: [{ name: CONSENT_KEY, value: CONSENT_VALUE }],
  };
}
