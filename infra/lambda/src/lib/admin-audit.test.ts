import { describe, it, expect, vi } from 'vitest';
import { recordAdminAction } from './admin-audit';

function fakeDb(insertImpl: (values: unknown) => Promise<unknown>) {
  return {
    insert: vi.fn(() => ({ values: (v: unknown) => insertImpl(v) })),
  } as unknown as Parameters<typeof recordAdminAction>[0];
}

describe('recordAdminAction', () => {
  it('inserts the audit row', async () => {
    const captured: unknown[] = [];
    const db = fakeDb(async (v) => { captured.push(v); return []; });
    await recordAdminAction(db, {
      adminUserId: 'admin-1', action: 'flagged.approve', targetType: 'exercise',
      targetId: 'ex-1', metadata: { outcome: 'approved' },
    });
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      adminUserId: 'admin-1', action: 'flagged.approve', targetType: 'exercise',
      targetId: 'ex-1', metadata: { outcome: 'approved' },
    });
  });

  it('swallows insert errors and logs (never throws)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const db = fakeDb(async () => { throw new Error('db down'); });
    await expect(
      recordAdminAction(db, { adminUserId: 'a', action: 'invite.revoke', targetType: 'invite', targetId: 'i1' }),
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[admin-audit]'),
      expect.objectContaining({ action: 'invite.revoke', err: expect.any(Error) }),
    );
    errorSpy.mockRestore();
  });

  it('defaults metadata to null when omitted', async () => {
    const captured: Array<{ metadata?: unknown }> = [];
    const db = fakeDb(async (v) => { captured.push(v as { metadata?: unknown }); return []; });
    await recordAdminAction(db, { adminUserId: 'a', action: 'invite.create', targetType: 'invite', targetId: null });
    expect(captured[0].metadata).toBeNull();
  });
});
