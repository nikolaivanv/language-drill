import { beforeSend } from './before-send';

export type SentryEnvironment = 'production' | 'preview' | 'development';

// IMPORTANT: every env var must be read via a LITERAL `process.env.X`
// expression. Next.js's DefinePlugin only inlines literal accesses into
// the browser bundle — `process.env[key]` or `process.env?.[key]` defeats
// inlining and the value disappears at runtime. The closure wrapper
// defers evaluation so the try/catch can actually catch a throw on the
// process access itself (rare, but possible on exotic embeddings).
function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

export function resolveEnvironment(): SentryEnvironment {
  // NEXT_PUBLIC_VERCEL_ENV is inlined into the browser bundle (must be
  // added to Vercel referencing $VERCEL_ENV). The non-prefixed VERCEL_ENV
  // is the server-side fallback for Server Components / Route Handlers /
  // Edge runtimes.
  const env =
    safe(() => process.env.NEXT_PUBLIC_VERCEL_ENV) ??
    safe(() => process.env.VERCEL_ENV);
  if (env === 'production' || env === 'preview' || env === 'development') {
    return env;
  }
  return 'development';
}

export function resolveRelease(): string | undefined {
  return (
    safe(() => process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA) ??
    safe(() => process.env.VERCEL_GIT_COMMIT_SHA)
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
  const dsn = safe(() => process.env.NEXT_PUBLIC_SENTRY_DSN);
  return {
    dsn,
    environment: resolveEnvironment(),
    release: resolveRelease(),
    sendDefaultPii: false,
    enabled: !!dsn,
    beforeSend,
  };
}
