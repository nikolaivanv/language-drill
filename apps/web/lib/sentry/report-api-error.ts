import * as Sentry from '@sentry/nextjs';

type ApiError = Error & {
  status?: number;
  body?: { code?: string } | null;
};

/**
 * Forward a failed API query/mutation to Sentry.
 *
 * The app handles these rejections gracefully (error cards, retry), so they
 * never surface as unhandled exceptions — Sentry's automatic instrumentation
 * never sees them. Wired as the QueryClient's MutationCache/QueryCache
 * `onError`, this is the one place that makes user-facing API failures visible.
 *
 * Expected, handled-by-design product states are skipped so the inbox stays
 * signal, not noise:
 *   - 429: the user hit their daily practice cap (a normal state, not a fault).
 *   - 503 GLOBAL_CAPACITY: the deliberate global soft-cap brake.
 *   - 404 TOPIC_NOT_FOUND: no theory page has been generated for this slug yet;
 *     `useTheoryTopic` deliberately renders this as the empty state, not a fault.
 *   - RedeemError: an invite that's already-used / expired / invalid. The
 *     post-signup redeem flow surfaces every outcome as a banner — a user
 *     pasting a stale code is normal, not a fault. `useRedeemInvite` throws a
 *     fresh `RedeemError` (name === 'RedeemError') with no status/body, so it
 *     matches none of the code-based rules above.
 *
 * Everything else is captured — genuine 5xx (including the 502 AI_UNAVAILABLE
 * outage), network failures, and response-parse errors. Sentry groups identical
 * errors, so an outage reads as one issue with a count spike rather than a
 * flood, complementing the backend CloudWatch alarm with the per-user view.
 */
export function reportApiError(error: unknown): void {
  try {
    if (!(error instanceof Error)) return;
    const { status, body } = error as ApiError;
    const code = body && typeof body === 'object' ? body.code : undefined;

    // Expected/handled-by-design — don't report.
    if (status === 429) return;
    if (status === 503 && code === 'GLOBAL_CAPACITY') return;
    if (status === 404 && code === 'TOPIC_NOT_FOUND') return;
    if (error.name === 'RedeemError') return;

    Sentry.withScope((scope) => {
      scope.setTag('source', 'api');
      if (typeof status === 'number') scope.setTag('status', String(status));
      if (code) scope.setTag('code', code);
      Sentry.captureException(error);
    });
  } catch {
    // Never throw from a reporter — a reporting failure must not worsen the
    // user's situation.
  }
}
