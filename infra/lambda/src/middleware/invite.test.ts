import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono, type MiddlewareHandler } from 'hono';

// Mock the db module before importing the middleware
vi.mock('../db', () => ({
  db: {
    select: vi.fn(),
  },
}));

import { inviteMiddleware } from './invite';
import { db } from '../db';

const mockDb = db as unknown as {
  select: ReturnType<typeof vi.fn>;
};

type Env = { Variables: { userId: string } };

function createApp() {
  const app = new Hono<Env>();

  // Simulate auth middleware setting userId
  app.use('*', async (c, next) => {
    c.set('userId', 'user_123');
    await next();
  });

  app.use('*', inviteMiddleware as unknown as MiddlewareHandler<Env>);
  app.get('/test', (c) => c.json({ ok: true }));
  return app;
}

describe('inviteMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 when a valid invite row is found', async () => {
    const mockChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: 'inv_1', usedBy: 'user_123' }]),
    };
    mockDb.select.mockReturnValue(mockChain);

    const app = createApp();
    const res = await app.request('/test');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it('returns 403 when no invite row is found', async () => {
    const mockChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    mockDb.select.mockReturnValue(mockChain);

    const app = createApp();
    const res = await app.request('/test');

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ error: 'Forbidden', code: 'NO_INVITE' });
  });
});
