import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the db module so getEffectivePlan can be tested without a real DB.
const mockLimit = vi.fn();
const mockWhere = vi.fn(() => ({ limit: mockLimit }));
const mockFrom = vi.fn(() => ({ where: mockWhere }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));
vi.mock('../db', () => ({ db: { select: () => mockSelect() } }));
vi.mock('@language-drill/db', () => ({ users: { id: 'id', plan: 'plan' } }));

describe('plan resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_USER_IDS = 'admin_1, admin_2';
  });
  afterEach(() => {
    delete process.env.ADMIN_USER_IDS;
  });

  it('isAdmin matches trimmed comma-separated ids', async () => {
    const { isAdmin } = await import('./plan');
    expect(isAdmin('admin_1')).toBe(true);
    expect(isAdmin('admin_2')).toBe(true);
    expect(isAdmin('someone_else')).toBe(false);
  });

  it('effectivePlanFor boosts admins regardless of stored plan', async () => {
    const { effectivePlanFor } = await import('./plan');
    expect(effectivePlanFor('admin_1', 'free')).toBe('boosted');
    expect(effectivePlanFor('user_x', 'boosted')).toBe('boosted');
    expect(effectivePlanFor('user_x', 'free')).toBe('free');
  });

  it('getEffectivePlan reads stored plan then applies admin override', async () => {
    const { getEffectivePlan } = await import('./plan');
    mockLimit.mockResolvedValueOnce([{ plan: 'free' }]);
    expect(await getEffectivePlan('user_x')).toBe('free');

    mockLimit.mockResolvedValueOnce([{ plan: 'boosted' }]);
    expect(await getEffectivePlan('user_x')).toBe('boosted');
    expect(mockSelect).toHaveBeenCalledTimes(2);

    // admins resolve boosted WITHOUT touching the DB (short-circuit).
    mockSelect.mockClear();
    expect(await getEffectivePlan('admin_1')).toBe('boosted');
    expect(mockSelect).not.toHaveBeenCalled();
  });
});
