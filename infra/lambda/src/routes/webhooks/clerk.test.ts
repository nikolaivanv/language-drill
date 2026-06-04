import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const mockOnConflictDoUpdate = vi.fn(() => Promise.resolve());
const mockValues = vi.fn(() => ({ onConflictDoUpdate: mockOnConflictDoUpdate }));
const mockInsert = vi.fn(() => ({ values: mockValues }));
const mockUpdate = vi.fn();
vi.mock('../../db', () => ({
  db: { insert: () => mockInsert(), update: () => mockUpdate() },
}));
vi.mock('@language-drill/db', () => ({
  users: { id: 'id', email: 'email', plan: 'plan' },
}));

// svix Webhook.verify returns a user.created event without touching the body.
vi.mock('svix', () => ({
  Webhook: class {
    verify() {
      return {
        type: 'user.created',
        data: {
          id: 'user_new',
          email_addresses: [{ email_address: 'new@example.com' }],
        },
      };
    }
  },
}));

describe('POST /webhooks/clerk', () => {
  let app: Hono;
  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.CLERK_WEBHOOK_SECRET = 'whsec_test';
    const mod = await import('./clerk');
    app = new Hono();
    app.route('/', mod.default);
  });

  const post = () =>
    app.request('/webhooks/clerk', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'svix-id': 'msg_1',
        'svix-timestamp': '1700000000',
        'svix-signature': 'v1,sig',
      },
      body: JSON.stringify({ type: 'user.created' }),
    });

  it('upserts the user on user.created', async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(((await res.json()) as { received: boolean }).received).toBe(true);
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockValues).toHaveBeenCalledWith({ id: 'user_new', email: 'new@example.com' });
  });

  it('does NOT auto-claim an invitation on user.created', async () => {
    const res = await post();
    expect(res.status).toBe(200);
    // Invites are redeemed explicitly via POST /invites/redeem, never here.
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
