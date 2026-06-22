import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const mockOnConflictDoUpdate = vi.fn(() => Promise.resolve());
const mockValues = vi.fn(() => ({ onConflictDoUpdate: mockOnConflictDoUpdate }));
const mockInsert = vi.fn(() => ({ values: mockValues }));
const mockUpdateWhere = vi.fn(() => Promise.resolve());
const mockUpdateSet = vi.fn(() => ({ where: mockUpdateWhere }));
const mockUpdate = vi.fn(() => ({ set: mockUpdateSet }));
const mockDeleteWhere = vi.fn(() => Promise.resolve());
const mockDelete = vi.fn(() => ({ where: mockDeleteWhere }));
vi.mock('../../db', () => ({
  db: {
    insert: () => mockInsert(),
    update: () => mockUpdate(),
    delete: () => mockDelete(),
  },
}));
vi.mock('@language-drill/db', () => ({
  users: { id: 'id', email: 'email', plan: 'plan', firstName: 'first_name', lastName: 'last_name' },
  invitations: { usedBy: 'used_by' },
}));

// svix Webhook.verify returns whatever event the current test set, without
// touching the body. The `mock`-prefixed name lets the hoisted vi.mock factory
// reference it (vitest's hoisting exception).
let mockEvent: unknown = {
  type: 'user.created',
  data: {
    id: 'user_new',
    email_addresses: [{ email_address: 'new@example.com' }],
  },
};
vi.mock('svix', () => ({
  Webhook: class {
    verify() {
      return mockEvent;
    }
  },
}));

describe('POST /webhooks/clerk', () => {
  let app: Hono;
  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.CLERK_WEBHOOK_SECRET = 'whsec_test';
    // Reset to the default created event; tests that need another event type
    // reassign `mockEvent` before calling `post()`.
    mockEvent = {
      type: 'user.created',
      data: {
        id: 'user_new',
        email_addresses: [{ email_address: 'new@example.com' }],
      },
    };
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
      body: JSON.stringify({ type: 'event' }),
    });

  it('upserts the user on user.created', async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(((await res.json()) as { received: boolean }).received).toBe(true);
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user_new', email: 'new@example.com' }),
    );
  });

  it('does NOT auto-claim an invitation on user.created', async () => {
    const res = await post();
    expect(res.status).toBe(200);
    // Invites are redeemed explicitly via POST /invites/redeem, never here.
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('stores first/last name on user.created', async () => {
    mockEvent = {
      type: 'user.created',
      data: {
        id: 'user_new',
        email_addresses: [{ email_address: 'new@example.com' }],
        first_name: 'Ada',
        last_name: 'Lovelace',
      },
    };
    const res = await post();
    expect(res.status).toBe(200);
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user_new', email: 'new@example.com', firstName: 'Ada', lastName: 'Lovelace' }),
    );
  });

  it('updates names on user.updated', async () => {
    mockEvent = {
      type: 'user.updated',
      data: {
        id: 'user_x',
        email_addresses: [{ email_address: 'x@example.com' }],
        first_name: 'Grace',
        last_name: 'Hopper',
      },
    };
    const res = await post();
    expect(res.status).toBe(200);
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ firstName: 'Grace', lastName: 'Hopper', email: 'x@example.com' }),
    );
    expect(mockUpdateWhere).toHaveBeenCalled();
  });

  it('deletes the user row on user.deleted (cascades sweep dependent rows)', async () => {
    mockEvent = { type: 'user.deleted', data: { id: 'user_gone', deleted: true } };
    const res = await post();
    expect(res.status).toBe(200);
    expect(((await res.json()) as { received: boolean }).received).toBe(true);
    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockDeleteWhere).toHaveBeenCalledTimes(1);
    // A delete must never look like an upsert.
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('nulls invitations.usedBy before deleting user on user.deleted (right-to-erasure)', async () => {
    mockEvent = { type: 'user.deleted', data: { id: 'user_gone', deleted: true } };
    const res = await post();
    expect(res.status).toBe(200);
    // The handler must update invitations first (no cascade FK — explicit erase)
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdateSet).toHaveBeenCalledWith({ usedBy: null });
    expect(mockUpdateWhere).toHaveBeenCalledTimes(1);
    // Then the user row itself must be deleted
    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockDeleteWhere).toHaveBeenCalledTimes(1);
  });

  it('400s on user.deleted with no user id', async () => {
    mockEvent = { type: 'user.deleted', data: {} };
    const res = await post();
    expect(res.status).toBe(400);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('acknowledges an unhandled event type without writing', async () => {
    mockEvent = { type: 'organization.created', data: { id: 'org_x' } };
    const res = await post();
    expect(res.status).toBe(200);
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });
});
