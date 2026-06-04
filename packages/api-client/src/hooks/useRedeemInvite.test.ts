import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRedeemInvite, RedeemError } from './useRedeemInvite';
import type { AuthenticatedFetch } from '../fetchClient';

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

function buildQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function buildWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

/**
 * Mirrors `createAuthenticatedFetch`: on a non-2xx the wrapper throws a plain
 * `Error` with `.status` and `.body` attached. The hook extracts `body.kind`
 * into a typed `RedeemError`.
 */
function fetchError(status: number, body: unknown): Error {
  const err = new Error(
    body && typeof body === 'object' && 'error' in body
      ? (body as { error: string }).error
      : `Request failed: ${status}`,
  );
  (err as unknown as { status: number }).status = status;
  (err as unknown as { body: unknown }).body = body;
  return err;
}

describe('useRedeemInvite', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = buildQueryClient();
  });

  it('POSTs the code and parses the boosted response, invalidating ["me"]', async () => {
    const fetchFn = vi.fn<AuthenticatedFetch>().mockResolvedValue(
      jsonResponse({
        plan: 'boosted',
        limits: { evaluation: 100, annotation: 50, deepSpan: 25 },
      }),
    );
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useRedeemInvite({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    let returned: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined;
    await act(async () => {
      returned = await result.current.mutateAsync({ code: 'ABC123' });
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]?.[0]).toBe('/invites/redeem');
    expect(fetchFn.mock.calls[0]?.[1]?.method).toBe('POST');
    expect(JSON.parse(fetchFn.mock.calls[0]?.[1]?.body as string)).toEqual({
      code: 'ABC123',
    });
    expect(returned?.plan).toBe('boosted');
    expect(invalidateSpy.mock.calls.map((c) => (c[0] as { queryKey: unknown }).queryKey)).toEqual(
      expect.arrayContaining([['me']]),
    );
  });

  it.each(['invalid', 'expired', 'used'] as const)(
    'maps server kind "%s" into a typed RedeemError',
    async (kind) => {
      const fetchFn = vi
        .fn<AuthenticatedFetch>()
        .mockRejectedValue(fetchError(400, { kind, error: `code is ${kind}` }));

      const { result } = renderHook(() => useRedeemInvite({ fetchFn }), {
        wrapper: buildWrapper(queryClient),
      });

      await expect(
        result.current.mutateAsync({ code: 'X' }),
      ).rejects.toBeInstanceOf(RedeemError);

      try {
        await result.current.mutateAsync({ code: 'X' });
      } catch (e) {
        expect(e).toBeInstanceOf(RedeemError);
        expect((e as RedeemError).kind).toBe(kind);
        expect((e as RedeemError).message).toBe(`code is ${kind}`);
      }
    },
  );

  it('falls back to kind "invalid" when the server omits/uses an unknown kind', async () => {
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockRejectedValue(fetchError(500, { error: 'boom' }));

    const { result } = renderHook(() => useRedeemInvite({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    try {
      await result.current.mutateAsync({ code: 'X' });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(RedeemError);
      expect((e as RedeemError).kind).toBe('invalid');
      expect((e as RedeemError).message).toBe('boom');
    }
  });
});
