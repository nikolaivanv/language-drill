import { beforeSend } from './before-send';

export type SentryEnvironment = 'production' | 'preview' | 'development';

export function resolveEnvironment(): SentryEnvironment {
  const env = process.env.VERCEL_ENV;
  if (env === 'production' || env === 'preview' || env === 'development') {
    return env;
  }
  return 'development';
}

export function resolveRelease(): string | undefined {
  return process.env.VERCEL_GIT_COMMIT_SHA;
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
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  return {
    dsn,
    environment: resolveEnvironment(),
    release: resolveRelease(),
    sendDefaultPii: false,
    enabled: !!dsn,
    beforeSend,
  };
}
