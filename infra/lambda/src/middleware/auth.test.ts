import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { authMiddleware } from './auth';

type Env = { Variables: { userId: string } };

function createApp() {
  const app = new Hono<Env>();
  app.use('*', authMiddleware as any);
  app.get('/test', (c) => c.json({ userId: c.get('userId') }));
  return app;
}

describe('authMiddleware', () => {
  it('returns 401 when sub claim is missing', async () => {
    const app = createApp();

    const res = await app.request('/test', undefined, {
      event: {
        requestContext: {
          authorizer: { jwt: { claims: {} } },
        },
      },
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: 'Unauthorized', code: 'MISSING_SUB' });
  });

  it('returns 401 when authorizer is missing entirely', async () => {
    const app = createApp();

    const res = await app.request('/test', undefined, {
      event: { requestContext: {} },
    });

    expect(res.status).toBe(401);
  });

  it('sets userId in context when sub claim is present', async () => {
    const app = createApp();

    const res = await app.request('/test', undefined, {
      event: {
        requestContext: {
          authorizer: {
            jwt: { claims: { sub: 'user_123' } },
          },
        },
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ userId: 'user_123' });
  });
});
