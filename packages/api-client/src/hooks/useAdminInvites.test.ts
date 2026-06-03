import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useAdminInvites,
  useCreateInvites,
  useRevokeInvite,
} from './useAdminInvites';
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

const INVITE = {
  id: 'inv_1',
  code: 'CODE1',
  usedBy: null,
  usedAt: null,
  expiresAt: null,
  revokedAt: null,
  note: null,
  createdAt: '2026-06-01T00:00:00.000Z',
  status: 'unused',
};

describe('useAdminInvites', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = buildQueryClient();
  });

  it('fetches /admin/invites and unwraps items', async () => {
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse({ items: [INVITE] }));

    const { result } = renderHook(() => useAdminInvites({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchFn.mock.calls[0]?.[0]).toBe('/admin/invites');
    expect(result.current.data).toEqual([INVITE]);
  });
});

describe('useCreateInvites', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = buildQueryClient();
  });

  it('POSTs the body, parses codes, and invalidates ["admin","invites"]', async () => {
    const fetchFn = vi.fn<AuthenticatedFetch>().mockResolvedValue(
      jsonResponse({
        codes: [{ id: 'inv_1', code: 'CODE1', expiresAt: null, note: 'hi' }],
      }),
    );
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useCreateInvites({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    let returned: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined;
    await act(async () => {
      returned = await result.current.mutateAsync({ count: 1, note: 'hi' });
    });

    expect(fetchFn.mock.calls[0]?.[0]).toBe('/admin/invites');
    expect(fetchFn.mock.calls[0]?.[1]?.method).toBe('POST');
    expect(JSON.parse(fetchFn.mock.calls[0]?.[1]?.body as string)).toEqual({
      count: 1,
      note: 'hi',
    });
    expect(returned?.codes).toHaveLength(1);
    expect(
      invalidateSpy.mock.calls.map((c) => (c[0] as { queryKey: unknown }).queryKey),
    ).toEqual(expect.arrayContaining([['admin', 'invites']]));
  });
});

describe('useRevokeInvite', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = buildQueryClient();
  });

  it('POSTs to the revoke path and invalidates ["admin","invites"]', async () => {
    const fetchFn = vi
      .fn<AuthenticatedFetch>()
      .mockResolvedValue(jsonResponse({}));
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useRevokeInvite({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ id: 'inv_9' });
    });

    expect(fetchFn.mock.calls[0]?.[0]).toBe('/admin/invites/inv_9/revoke');
    expect(fetchFn.mock.calls[0]?.[1]?.method).toBe('POST');
    expect(
      invalidateSpy.mock.calls.map((c) => (c[0] as { queryKey: unknown }).queryKey),
    ).toEqual(expect.arrayContaining([['admin', 'invites']]));
  });
});
