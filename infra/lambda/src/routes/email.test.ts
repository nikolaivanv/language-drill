import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// --- db mock: a chainable builder whose terminal calls we control per test ---
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const state: Record<string, any> = {};
vi.mock('../db', () => {
  const chain = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c: any = {};
    c.from = () => c;
    c.where = () => c;
    c.limit = () => Promise.resolve(state.selectRows ?? []);
    c.values = () => c;
    c.onConflictDoUpdate = () => ({ returning: () => Promise.resolve(state.upsertRows ?? []) });
    c.set = () => c;
    c.returning = () => Promise.resolve(state.updateRows ?? []);
    return c;
  };
  return {
    db: {
      select: () => chain(),
      insert: () => chain(),
      update: () => chain(),
    },
  };
});

vi.mock('@language-drill/db', () => ({
  emailPreferences: {
    userId: 'user_id',
    weeklySummary: 'weekly_summary',
    unsubscribeToken: 'unsubscribe_token',
    confirmToken: 'confirm_token',
  },
  users: { id: 'id', email: 'email' },
}));

const sendEmailMock = vi.fn(async () => ({ id: 'eml', delivered: true }));
vi.mock('@language-drill/email', () => ({
  sendEmail: sendEmailMock,
  renderEmail: vi.fn(async () => ({ html: '<p>confirm</p>', text: 'confirm' })),
  ConfirmSubscriptionEmail: vi.fn(() => null),
}));

const authEnv = {
  event: { requestContext: { authorizer: { jwt: { claims: { sub: 'user_1' } } } } },
};

describe('email routes', () => {
  let app: Hono;
  beforeEach(async () => {
    vi.clearAllMocks();
    for (const k of Object.keys(state)) delete state[k];
    const mod = await import('./email');
    app = new Hono();
    app.route('/', mod.default);
  });

  it('GET /me/email-preferences returns off when no row exists', async () => {
    state.selectRows = [];
    const res = await app.request('/me/email-preferences', undefined, authEnv);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ weeklySummary: 'off' });
  });

  it('POST /email/weekly-summary { enabled: true } sets pending and sends a confirm email to the real address', async () => {
    state.selectRows = [{ email: 'user_1@example.com' }];
    state.upsertRows = [{ weeklySummary: 'pending', confirmToken: 'tok' }];
    const res = await app.request(
      '/email/weekly-summary',
      { method: 'POST', body: JSON.stringify({ enabled: true }), headers: { 'Content-Type': 'application/json' } },
      authEnv,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ weeklySummary: 'pending' });
    expect(sendEmailMock).toHaveBeenCalledOnce();
    expect(sendEmailMock).toHaveBeenCalledWith(expect.objectContaining({ to: 'user_1@example.com' }));
  });

  it('POST /email/weekly-summary { enabled: false } sets off without sending', async () => {
    state.upsertRows = [{ weeklySummary: 'off', confirmToken: null }];
    const res = await app.request(
      '/email/weekly-summary',
      { method: 'POST', body: JSON.stringify({ enabled: false }), headers: { 'Content-Type': 'application/json' } },
      authEnv,
    );
    expect(await res.json()).toEqual({ weeklySummary: 'off' });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('GET /email/confirm flips pending→confirmed and returns HTML', async () => {
    state.updateRows = [{ userId: 'user_1' }];
    const res = await app.request('/email/confirm?token=abc');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
  });

  it('GET /email/confirm with an unknown token returns a friendly 200 HTML page', async () => {
    state.updateRows = [];
    const res = await app.request('/email/confirm?token=nope');
    expect(res.status).toBe(200);
  });

  it('GET /email/unsubscribe sets off and returns HTML', async () => {
    state.updateRows = [{ userId: 'user_1' }];
    const res = await app.request('/email/unsubscribe?token=u');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
  });

  it('POST /email/unsubscribe (one-click) returns 200', async () => {
    state.updateRows = [{ userId: 'user_1' }];
    const res = await app.request('/email/unsubscribe?token=u', { method: 'POST' });
    expect(res.status).toBe(200);
  });
});
