import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockVerifyClerkJwt, mockEnsureUserRow } = vi.hoisted(() => ({
  mockVerifyClerkJwt: vi.fn(),
  mockEnsureUserRow: vi.fn(),
}));

vi.mock('../annotate-stream/jwt', () => ({ verifyClerkJwt: mockVerifyClerkJwt }));
vi.mock('../middleware/auth', () => ({ ensureUserRow: mockEnsureUserRow }));
vi.mock('@language-drill/ai', () => ({ flushObservability: vi.fn(async () => {}) }));

// Stand-in for the shared exercises router: echoes the userId the wrapper
// injected, so these tests cover only what the eval-submit entry point adds.
vi.mock('../routes/exercises', async () => {
  const { Hono } = await import('hono');
  const router = new Hono<{ Variables: { userId: string } }>();
  router.post('/exercises/:id/submit', (c) =>
    c.json({ id: c.req.param('id'), userId: c.get('userId') }),
  );
  router.get('/exercises', (c) => c.json({ leaked: true }));
  return { default: router };
});

import { app } from './handler';

const ORIGIN = 'https://www.langdrill.app';

function post(path: string, headers: Record<string, string> = {}) {
  return app.request(path, {
    method: 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ answer: 'hola' }),
  });
}

describe('eval-submit Function URL handler', () => {
  beforeEach(() => {
    mockVerifyClerkJwt.mockReset();
    mockEnsureUserRow.mockReset();
  });

  it('verifies the bearer token and runs the submit route as that user', async () => {
    mockVerifyClerkJwt.mockResolvedValue('user_123');
    const res = await post('/exercises/ex-1/submit', { Authorization: 'Bearer tok' });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'ex-1', userId: 'user_123' });
    expect(mockVerifyClerkJwt).toHaveBeenCalledWith('Bearer tok');
    expect(mockEnsureUserRow).toHaveBeenCalledWith('user_123');
  });

  it('rejects an invalid token with a 401 that still carries CORS headers', async () => {
    mockVerifyClerkJwt.mockResolvedValue(null);
    const res = await post('/exercises/ex-1/submit', { Authorization: 'Bearer bad' });

    expect(res.status).toBe(401);
    // Without this header the browser discards the 401 and reports an opaque
    // network failure — the whole reason CORS runs before the JWT gate.
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(mockEnsureUserRow).not.toHaveBeenCalled();
  });

  it('404s every other route without touching Clerk', async () => {
    const res = await app.request('/exercises', { headers: { Origin: ORIGIN } });
    expect(res.status).toBe(404);

    const other = await post('/exercises/ex-1/hints', { Authorization: 'Bearer tok' });
    expect(other.status).toBe(404);
    expect(mockVerifyClerkJwt).not.toHaveBeenCalled();
  });

  it('answers the CORS preflight for an allowed origin', async () => {
    const res = await app.request('/exercises/ex-1/submit', {
      method: 'OPTIONS',
      headers: {
        Origin: ORIGIN,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    });

    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(mockVerifyClerkJwt).not.toHaveBeenCalled();
  });

  it('does not grant CORS to an unknown origin', async () => {
    mockVerifyClerkJwt.mockResolvedValue('user_123');
    const res = await post('/exercises/ex-1/submit', {
      Authorization: 'Bearer tok',
      Origin: 'https://evil.example',
    });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});
