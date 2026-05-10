import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono, type MiddlewareHandler } from 'hono';
import { adminMiddleware } from './admin';

type Env = { Variables: { userId: string } };

function createApp(userId: string) {
  const app = new Hono<Env>();
  app.use('*', (c, next) => {
    c.set('userId', userId);
    return next();
  });
  app.use('*', adminMiddleware as unknown as MiddlewareHandler<Env>);
  app.get('/test', (c) => c.json({ ok: true }));
  return app;
}

const originalAdminUserIds = process.env.ADMIN_USER_IDS;

beforeEach(() => {
  delete process.env.ADMIN_USER_IDS;
});

afterEach(() => {
  if (originalAdminUserIds !== undefined) {
    process.env.ADMIN_USER_IDS = originalAdminUserIds;
  } else {
    delete process.env.ADMIN_USER_IDS;
  }
});

describe('adminMiddleware', () => {
  it('calls next when userId is in ADMIN_USER_IDS', async () => {
    process.env.ADMIN_USER_IDS = 'user_admin_001';
    const res = await createApp('user_admin_001').request('/test');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it('returns 403 when userId is not in ADMIN_USER_IDS', async () => {
    process.env.ADMIN_USER_IDS = 'user_admin_001';
    const res = await createApp('user_other').request('/test');
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ error: 'Forbidden', code: 'FORBIDDEN' });
  });

  it('returns 403 when ADMIN_USER_IDS is empty string', async () => {
    process.env.ADMIN_USER_IDS = '';
    const res = await createApp('user_admin_001').request('/test');
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ error: 'Forbidden', code: 'FORBIDDEN' });
  });

  it('returns 403 when ADMIN_USER_IDS is not set', async () => {
    const res = await createApp('user_admin_001').request('/test');
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ error: 'Forbidden', code: 'FORBIDDEN' });
  });

  it('allows the correct user when multiple IDs are configured', async () => {
    process.env.ADMIN_USER_IDS = 'user_admin_001,user_admin_002';
    const allowed = await createApp('user_admin_002').request('/test');
    expect(allowed.status).toBe(200);

    const blocked = await createApp('user_other').request('/test');
    expect(blocked.status).toBe(403);
  });

  it('allows dev_user_001 when it is present in ADMIN_USER_IDS', async () => {
    process.env.ADMIN_USER_IDS = 'dev_user_001';
    const res = await createApp('dev_user_001').request('/test');
    expect(res.status).toBe(200);
  });
});
