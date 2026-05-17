import { beforeSend } from './before-send';

export type SentryEnvironment = 'production' | 'preview' | 'development';

// Safely read an env var. In the browser, `process` may be undefined or a
// minimal polyfill, so `process.env.X` can throw. Wrap every access.
function readEnv(key: string): string | undefined {
  try {
    return typeof process !== 'undefined' ? process.env?.[key] : undefined;
  } catch {
    return undefined;
  }
}

export function resolveEnvironment(): SentryEnvironment {
  // Prefer the NEXT_PUBLIC_* variant so the value is inlined into the
  // browser bundle by Next.js's DefinePlugin. The non-prefixed VERCEL_ENV
  // is available server-side at runtime and remains the fallback for
  // Server Components / Route Handlers / Edge.
  const env =
    readEnv('NEXT_PUBLIC_VERCEL_ENV') ?? readEnv('VERCEL_ENV');
  if (env === 'production' || env === 'preview' || env === 'development') {
    return env;
  }
  return 'development';
}

export function resolveRelease(): string | undefined {
  // Same prefix logic as resolveEnvironment. Also: withSentryConfig's
  // build-time plugin injects the release into the client bundle via a
  // SENTRY_RELEASE constant the SDK reads automatically, so a missing
  // value here on the client is recoverable.
  return (
    readEnv('NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA') ??
    readEnv('VERCEL_GIT_COMMIT_SHA')
  );
}

export interface SharedSentryOptions {
  dsn: string | undefined;
  environment: SentryEnvironment;
  release: string | undefined;
  sendDefaultPii: false;
  enabled: boolean;
  beforeSend: typeof beforeSend;
}

export function getSharedSentryOptions(): SharedSentryOptions {
  const dsn = readEnv('NEXT_PUBLIC_SENTRY_DSN');
  return {
    dsn,
    environment: resolveEnvironment(),
    release: resolveRelease(),
    sendDefaultPii: false,
    enabled: !!dsn,
    beforeSend,
  };
}
