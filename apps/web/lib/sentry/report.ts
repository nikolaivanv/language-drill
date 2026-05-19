import * as Sentry from '@sentry/nextjs';

export function reportBoundaryError(
  error: Error & { digest?: string },
  boundary: 'global' | 'segment',
): void {
  try {
    Sentry.withScope((scope) => {
      scope.setTag('boundary', boundary);
      if (error.digest) {
        scope.setTag('digest', error.digest);
      }
      Sentry.captureException(error);
    });
  } catch {
    // Never throw from a reporter — if Sentry itself blew up there's nothing
    // we can do about it that won't make the user's situation worse.
  }
}
