import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

const analytics = vi.hoisted(() => ({
  initAnalytics: vi.fn(),
  optInAnalytics: vi.fn(),
  optOutAnalytics: vi.fn(),
}));
vi.mock('../../../lib/analytics/posthog', () => analytics);
const track = vi.hoisted(() => vi.fn());
vi.mock('../../../lib/analytics/track', () => ({ track }));
vi.mock('../use-identify', () => ({ useIdentify: vi.fn() }));
vi.mock('../use-pageviews', () => ({ usePageviews: vi.fn() }));

import { ConsentProvider, useConsent } from '../../consent/consent-provider';
import { PostHogProvider } from '../posthog-provider';

// Storage key + shape used by apps/web/lib/consent/consent.ts
const CONSENT_KEY = 'drill-cookie-consent';
const CONSENT_VERSION = 1;

function Grant() {
  const { update } = useConsent();
  return (
    <>
      <button onClick={() => update({ analytics: true })}>grant</button>
      <button onClick={() => update({ analytics: false })}>revoke</button>
    </>
  );
}

function tree() {
  return render(
    <ConsentProvider>
      <Grant />
      <PostHogProvider>
        <span>app</span>
      </PostHogProvider>
    </ConsentProvider>,
  );
}

describe('PostHogProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('renders children and does not init without consent', () => {
    tree();
    expect(screen.getByText('app')).toBeInTheDocument();
    expect(analytics.initAnalytics).not.toHaveBeenCalled();
    expect(analytics.optInAnalytics).not.toHaveBeenCalled();
  });

  it('inits + opts in + emits consent_updated on grant', async () => {
    tree();
    await act(async () => { screen.getByText('grant').click(); });
    expect(analytics.initAnalytics).toHaveBeenCalledTimes(1);
    expect(analytics.optInAnalytics).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith('consent_updated', { analytics: true });
  });

  it('inits + opts in but does NOT emit consent_updated for a returning consented user', async () => {
    // Pre-seed localStorage as if the user previously granted consent (returning user reload).
    localStorage.setItem(
      CONSENT_KEY,
      JSON.stringify({ analytics: true, version: CONSENT_VERSION, timestamp: new Date().toISOString() }),
    );
    await act(async () => { tree(); });
    expect(analytics.initAnalytics).toHaveBeenCalledTimes(1);
    expect(analytics.optInAnalytics).toHaveBeenCalledTimes(1);
    // Must NOT emit — the stored consent is a reload, not an in-session user grant.
    expect(track).not.toHaveBeenCalledWith('consent_updated', expect.anything());
  });

  it('opts out on revoke without emitting an event', async () => {
    tree();
    await act(async () => { screen.getByText('grant').click(); });
    track.mockClear();
    await act(async () => { screen.getByText('revoke').click(); });
    expect(analytics.optOutAnalytics).toHaveBeenCalledTimes(1);
    expect(track).not.toHaveBeenCalled();
  });
});
