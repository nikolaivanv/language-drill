import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAuthenticatedFetch } from './fetchClient';

// ---------------------------------------------------------------------------
// fetch mock
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;
const mockFetch = vi.fn<typeof fetch>();

beforeEach(() => {
  mockFetch.mockReset();
  globalThis.fetch = mockFetch as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createAuthenticatedFetch', () => {
  it('throws an auth-expired error without sending the request when there is no session', async () => {
    // An expired session resolves `getToken` to null. Sending the request
    // anyway earns a 401 from the API Gateway JWT authorizer, which rejects
    // *before* the Lambda — so Hono, which owns CORS, never runs and the 401
    // carries no `Access-Control-Allow-Origin`. The browser then discards it
    // and hands JS an opaque `TypeError: Failed to fetch`, leaving the app
    // unable to tell "signed out" from "network down". Fail loudly instead.
    const authFetch = createAuthenticatedFetch(async () => null);

    await expect(authFetch('/profiles/languages')).rejects.toMatchObject({
      name: 'AuthExpiredError',
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('attaches the bearer token and calls through when a session exists', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ profiles: [] }));
    const authFetch = createAuthenticatedFetch(async () => 'tok_123');

    await authFetch('/profiles/languages');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const headers = mockFetch.mock.calls[0]![1]!.headers as Record<
      string,
      string
    >;
    expect(headers['Authorization']).toBe('Bearer tok_123');
  });

  it('sends to an overridden base URL, stripping its trailing slash', async () => {
    // Function URLs are emitted with a trailing slash; joining it naively
    // with `/exercises/...` would produce `//exercises/...` and a 404.
    mockFetch.mockResolvedValue(jsonResponse({}));
    const authFetch = createAuthenticatedFetch(async () => 'tok_123', {
      baseUrl: 'https://abc.lambda-url.eu-central-1.on.aws/',
    });

    await authFetch('/exercises/ex-1/submit', { method: 'POST' });

    expect(mockFetch.mock.calls[0]![0]).toBe(
      'https://abc.lambda-url.eu-central-1.on.aws/exercises/ex-1/submit',
    );
  });

  it('falls back to the default API base when the override is empty', async () => {
    // An unset NEXT_PUBLIC_EVAL_SUBMIT_URL arrives as '' — it must not turn
    // every submit into a same-origin request to the Next.js host.
    mockFetch.mockResolvedValue(jsonResponse({}));
    const defaultFetch = createAuthenticatedFetch(async () => 'tok_123');
    const emptyOverride = createAuthenticatedFetch(async () => 'tok_123', { baseUrl: '' });

    await defaultFetch('/exercises/ex-1/submit');
    await emptyOverride('/exercises/ex-1/submit');

    expect(mockFetch.mock.calls[1]![0]).toBe(mockFetch.mock.calls[0]![0]);
  });
});
