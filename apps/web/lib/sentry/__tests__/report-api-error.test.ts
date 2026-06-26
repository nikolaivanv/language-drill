import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture the Sentry calls without a real SDK.
const captureException = vi.fn();
vi.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => captureException(...args),
  withScope: (cb: (scope: { setTag: () => void }) => void) =>
    cb({ setTag: () => {} }),
}));

import { reportApiError } from '../report-api-error';

/** Build an error shaped like the one `createAuthenticatedFetch` throws. */
function apiError(status?: number, code?: string): Error {
  const e = new Error(code ?? `status ${status ?? 'unknown'}`) as Error & {
    status?: number;
    body?: unknown;
  };
  if (status !== undefined) e.status = status;
  if (code !== undefined) e.body = { code };
  return e;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('reportApiError', () => {
  it('captures an unexpected 5xx (including the AI_UNAVAILABLE outage)', () => {
    reportApiError(apiError(502, 'AI_UNAVAILABLE'));
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it('captures a network error with no status', () => {
    reportApiError(new Error('Failed to fetch'));
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it('skips the 429 daily rate limit (expected product state)', () => {
    reportApiError(apiError(429));
    expect(captureException).not.toHaveBeenCalled();
  });

  it('skips 503 GLOBAL_CAPACITY (deliberate global brake)', () => {
    reportApiError(apiError(503, 'GLOBAL_CAPACITY'));
    expect(captureException).not.toHaveBeenCalled();
  });

  it('captures a 503 with a different code (not the expected brake)', () => {
    reportApiError(apiError(503, 'SOMETHING_ELSE'));
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it('skips 404 TOPIC_NOT_FOUND (no theory page generated for this slug yet)', () => {
    reportApiError(apiError(404, 'TOPIC_NOT_FOUND'));
    expect(captureException).not.toHaveBeenCalled();
  });

  it('captures a 404 with a different code (a genuinely missing resource)', () => {
    reportApiError(apiError(404, 'NOT_FOUND'));
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it('ignores non-Error values', () => {
    reportApiError('a string');
    expect(captureException).not.toHaveBeenCalled();
  });

  it.each(['used', 'expired', 'invalid'])(
    'skips a RedeemError (%s) — every invite-redeem outcome is a handled product state',
    (kind) => {
      // `useRedeemInvite` throws a fresh `RedeemError` carrying only `name`,
      // `kind`, and `message` (no status/body), and the redeem UI surfaces all
      // three kinds as a banner. None is a fault.
      const e = new Error('Invite already used') as Error & { kind?: string };
      e.name = 'RedeemError';
      e.kind = kind;
      reportApiError(e);
      expect(captureException).not.toHaveBeenCalled();
    },
  );
});
