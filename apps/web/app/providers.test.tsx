import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { QueryClient } from '@tanstack/react-query';

const { captureException } = vi.hoisted(() => ({
  captureException: vi.fn(),
}));

vi.mock('@sentry/nextjs', () => ({
  captureException,
  withScope: (cb: (s: { setTag: () => void }) => void) => cb({ setTag: () => {} }),
}));

import { AuthExpiredError } from '@language-drill/api-client';

import { createQueryClient } from './providers';

/** Fire the cache-level `onError` the way TanStack Query would. */
function fireQueryError(client: QueryClient, error: unknown): void {
  client.getQueryCache().config.onError?.(error as Error, {} as never);
}

function fireMutationError(client: QueryClient, error: unknown): void {
  // (error, variables, onMutateResult, mutation, context)
  client.getMutationCache().config.onError?.(
    error as Error,
    undefined as never,
    undefined as never,
    {} as never,
    {} as never,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createQueryClient', () => {
  it('reports a genuine query failure to Sentry', () => {
    const client = createQueryClient();

    fireQueryError(client, new Error('Request failed: 500'));

    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it('reports a genuine mutation failure to Sentry', () => {
    const client = createQueryClient();

    fireMutationError(client, new Error('Request failed: 500'));

    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it('routes an expired session to the auth handler instead of Sentry', () => {
    // The reported bug: an expired session surfaced as a dead-end error card.
    // It must instead drive a sign-in redirect, and must not be reported as a
    // fault.
    const onAuthExpired = vi.fn();
    const client = createQueryClient(onAuthExpired);

    fireQueryError(client, new AuthExpiredError());

    expect(onAuthExpired).toHaveBeenCalledTimes(1);
    expect(captureException).not.toHaveBeenCalled();
  });

  it('never retries a request that failed because the session expired', () => {
    // `retry: 1` would otherwise double every auth failure, firing the
    // redirect handler twice as often for no benefit — a retry cannot conjure
    // a session token.
    const client = createQueryClient();
    const retry = client.getDefaultOptions().queries?.retry as (
      failureCount: number,
      error: Error,
    ) => boolean;

    expect(retry(0, new AuthExpiredError())).toBe(false);
    expect(retry(0, new Error('Request failed: 500'))).toBe(true);
  });
});
