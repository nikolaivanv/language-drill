import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { beforeSend } from '../before-send';
import {
  getSharedSentryOptions,
  resolveEnvironment,
  resolveRelease,
} from '../shared-options';

const ENV_KEYS = [
  'VERCEL_ENV',
  'VERCEL_GIT_COMMIT_SHA',
  'NEXT_PUBLIC_VERCEL_ENV',
  'NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA',
  'NEXT_PUBLIC_SENTRY_DSN',
] as const;

const snapshot: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    snapshot[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const original = snapshot[key];
    if (original === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = original;
    }
  }
});

describe('resolveEnvironment', () => {
  it.each(['production', 'preview', 'development'] as const)(
    'returns "%s" when VERCEL_ENV matches',
    (env) => {
      process.env.VERCEL_ENV = env;
      expect(resolveEnvironment()).toBe(env);
    },
  );

  it('defaults to "development" when VERCEL_ENV is unset', () => {
    expect(resolveEnvironment()).toBe('development');
  });

  it('defaults to "development" when VERCEL_ENV is an unknown value', () => {
    process.env.VERCEL_ENV = 'staging';
    expect(resolveEnvironment()).toBe('development');
  });

  it('prefers NEXT_PUBLIC_VERCEL_ENV over VERCEL_ENV (browser path)', () => {
    process.env.NEXT_PUBLIC_VERCEL_ENV = 'preview';
    process.env.VERCEL_ENV = 'production';
    expect(resolveEnvironment()).toBe('preview');
  });

  it('falls back to VERCEL_ENV when only the non-prefixed var is set (server path)', () => {
    process.env.VERCEL_ENV = 'production';
    expect(resolveEnvironment()).toBe('production');
  });
});

describe('resolveRelease', () => {
  it('returns the git SHA when VERCEL_GIT_COMMIT_SHA is set', () => {
    process.env.VERCEL_GIT_COMMIT_SHA = 'abc1234';
    expect(resolveRelease()).toBe('abc1234');
  });

  it('returns undefined when both forms are unset', () => {
    expect(resolveRelease()).toBeUndefined();
  });

  it('prefers NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA over VERCEL_GIT_COMMIT_SHA', () => {
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA = 'deadbeef';
    process.env.VERCEL_GIT_COMMIT_SHA = 'cafebabe';
    expect(resolveRelease()).toBe('deadbeef');
  });
});

describe('getSharedSentryOptions', () => {
  it('disables the SDK when NEXT_PUBLIC_SENTRY_DSN is unset', () => {
    const opts = getSharedSentryOptions();
    expect(opts.dsn).toBeUndefined();
    expect(opts.enabled).toBe(false);
  });

  it('enables the SDK when NEXT_PUBLIC_SENTRY_DSN is set', () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://abc@o1.ingest.sentry.io/1';
    const opts = getSharedSentryOptions();
    expect(opts.dsn).toBe('https://abc@o1.ingest.sentry.io/1');
    expect(opts.enabled).toBe(true);
  });

  it('always sets sendDefaultPii to false', () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://abc@o1.ingest.sentry.io/1';
    expect(getSharedSentryOptions().sendDefaultPii).toBe(false);
  });

  it('reflects resolveEnvironment and resolveRelease', () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.VERCEL_GIT_COMMIT_SHA = 'deadbeef';
    const opts = getSharedSentryOptions();
    expect(opts.environment).toBe('preview');
    expect(opts.release).toBe('deadbeef');
  });

  it('exposes the shared beforeSend function (reference identity)', () => {
    expect(getSharedSentryOptions().beforeSend).toBe(beforeSend);
  });
});
