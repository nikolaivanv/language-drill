export const CONSENT_VERSION = 1;
const KEY = 'drill-cookie-consent';

export type ConsentState = {
  analytics: boolean;
  version: number;
  timestamp: string;
};

function storage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null; // privacy mode / blocked
  }
}

export function getConsent(): ConsentState | null {
  const s = storage();
  if (!s) return null;
  const raw = s.getItem(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ConsentState>;
    if (parsed.version !== CONSENT_VERSION || typeof parsed.analytics !== 'boolean') {
      return null; // stale or malformed → treat as unset
    }
    return { analytics: parsed.analytics, version: CONSENT_VERSION, timestamp: parsed.timestamp ?? '' };
  } catch {
    return null;
  }
}

export function setConsent(partial: { analytics: boolean }): ConsentState {
  const state: ConsentState = {
    analytics: partial.analytics,
    version: CONSENT_VERSION,
    timestamp: new Date().toISOString(),
  };
  const s = storage();
  if (s) s.setItem(KEY, JSON.stringify(state));
  return state;
}

export function hasConsent(category: 'analytics'): boolean {
  const c = getConsent();
  if (!c) return false;
  return c[category] === true;
}
