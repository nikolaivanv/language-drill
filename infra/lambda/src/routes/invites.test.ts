import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const mockLimit = vi.fn();
const mockWhere = vi.fn(() => ({ limit: mockLimit }));
const mockFrom = vi.fn(() => ({ where: mockWhere }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));

// Redemption now runs both writes inside a single `db.transaction`. The
// invite claim is a conditional UPDATE … WHERE used_by IS NULL whose
// affected rows are read via `.returning()`; `mockClaimReturning` lets each
// test simulate winning ([{ id }]) or losing ([]) the claim race. The user
// plan UPDATE awaits `.where(...)` directly (no `.returning()`).
const mockClaimReturning = vi.fn();
const mockTxUpdate = vi.fn(() => ({
  set: () => ({
    where: () => {
      const p = Promise.resolve() as Promise<unknown> & {
        returning: typeof mockClaimReturning;
      };
      p.returning = mockClaimReturning;
      return p;
    },
  }),
}));
const mockTransaction = vi.fn(
  async (fn: (tx: { update: typeof mockTxUpdate }) => unknown) =>
    fn({ update: mockTxUpdate }),
);
vi.mock('../db', () => ({
  db: { select: () => mockSelect(), transaction: (fn: never) => mockTransaction(fn) },
}));
vi.mock('@language-drill/db', () => ({
  invitations: { id: 'id', code: 'code', usedBy: 'used_by', usedAt: 'used_at', expiresAt: 'expires_at', revokedAt: 'revoked_at' },
  users: { id: 'id', plan: 'plan' },
}));

const authEnv = {
  event: { requestContext: { authorizer: { jwt: { claims: { sub: 'user_1' } } } } },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyJson = Record<string, any>;

describe('POST /invites/redeem', () => {
  let app: Hono;
  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('./invites');
    app = new Hono();
    app.route('/', mod.default);
  });

  const post = (body: unknown) =>
    app.request('/invites/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, authEnv);

  it('rejects an unknown code with kind=invalid', async () => {
    mockLimit.mockResolvedValueOnce([]); // no invitation row
    const res = await post({ code: 'AAAA1111' });
    expect(res.status).toBe(404);
    expect(((await res.json()) as AnyJson).kind).toBe('invalid');
  });

  it('rejects an expired code with kind=expired', async () => {
    mockLimit.mockResolvedValueOnce([
      { id: 'i1', usedBy: null, revokedAt: null, expiresAt: new Date(Date.now() - 1000) },
    ]);
    const res = await post({ code: 'AAAA1111' });
    expect(res.status).toBe(410);
    expect(((await res.json()) as AnyJson).kind).toBe('expired');
  });

  it('rejects a code already used by someone else with kind=used', async () => {
    mockLimit.mockResolvedValueOnce([
      { id: 'i1', usedBy: 'other_user', revokedAt: null, expiresAt: null },
    ]);
    const res = await post({ code: 'AAAA1111' });
    expect(res.status).toBe(409);
    expect(((await res.json()) as AnyJson).kind).toBe('used');
  });

  it('is a no-op success if the same user already redeemed it', async () => {
    mockLimit.mockResolvedValueOnce([
      { id: 'i1', usedBy: 'user_1', revokedAt: null, expiresAt: null },
    ]);
    const res = await post({ code: 'AAAA1111' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as AnyJson).plan).toBe('boosted');
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('claims a valid code, sets plan=boosted, returns limits', async () => {
    mockLimit.mockResolvedValueOnce([
      { id: 'i1', usedBy: null, revokedAt: null, expiresAt: null },
    ]);
    mockClaimReturning.mockResolvedValueOnce([{ id: 'i1' }]); // claim won
    const res = await post({ code: 'AAAA1111' });
    expect(res.status).toBe(200);
    const body = await res.json() as AnyJson;
    expect(body.plan).toBe('boosted');
    expect(body.limits.evaluation).toBe(500);
    expect(mockTxUpdate).toHaveBeenCalledTimes(2); // invitation claim + user plan
  });

  it('returns 409 used when the conditional claim affects zero rows (lost the race)', async () => {
    // The pre-write SELECT sees an unused code, but a concurrent redemption
    // claims it before our UPDATE … WHERE used_by IS NULL runs, so the claim
    // affects zero rows. We must NOT boost the user.
    mockLimit.mockResolvedValueOnce([
      { id: 'i1', usedBy: null, revokedAt: null, expiresAt: null },
    ]);
    mockClaimReturning.mockResolvedValueOnce([]); // claim lost
    const res = await post({ code: 'AAAA1111' });
    expect(res.status).toBe(409);
    expect(((await res.json()) as AnyJson).kind).toBe('used');
    expect(mockTxUpdate).toHaveBeenCalledTimes(1); // claim attempted, user plan skipped
  });

  it('400s on a malformed code', async () => {
    const res = await post({ code: 'short' });
    expect(res.status).toBe(400);
  });

  it('treats a revoked code as invalid (opaque 404)', async () => {
    mockLimit.mockResolvedValueOnce([
      { id: 'i1', usedBy: null, revokedAt: new Date(), expiresAt: null },
    ]);
    const res = await post({ code: 'AAAA1111' });
    expect(res.status).toBe(404);
    expect(((await res.json()) as AnyJson).kind).toBe('invalid');
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('normalizes a lowercase code to uppercase before lookup', async () => {
    mockLimit.mockResolvedValueOnce([
      { id: 'i1', usedBy: null, revokedAt: null, expiresAt: null },
    ]);
    mockClaimReturning.mockResolvedValueOnce([{ id: 'i1' }]); // claim won
    const res = await post({ code: 'aaaa1111' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as AnyJson).plan).toBe('boosted');
    expect(mockTxUpdate).toHaveBeenCalledTimes(2);
  });
});
