import { describe, it, expect, beforeEach } from 'vitest';
import { getConsent, setConsent, hasConsent, CONSENT_VERSION } from './consent';

const KEY = 'drill-cookie-consent';

describe('consent module', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to no consent when nothing stored', () => {
    expect(getConsent()).toBeNull();
    expect(hasConsent('analytics')).toBe(false);
  });

  it('persists and reads back a choice', () => {
    const state = setConsent({ analytics: true });
    expect(state.analytics).toBe(true);
    expect(state.version).toBe(CONSENT_VERSION);
    expect(getConsent()?.analytics).toBe(true);
    expect(hasConsent('analytics')).toBe(true);
  });

  it('treats a stale version as unset (re-prompt)', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ analytics: true, version: CONSENT_VERSION - 1, timestamp: 'x' }),
    );
    expect(getConsent()).toBeNull();
    expect(hasConsent('analytics')).toBe(false);
  });

  it('rejecting persists analytics=false (not unset)', () => {
    setConsent({ analytics: false });
    expect(getConsent()?.analytics).toBe(false);
    expect(hasConsent('analytics')).toBe(false);
  });
});
