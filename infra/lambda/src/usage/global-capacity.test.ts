import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockWhere = vi.fn();
const mockFrom = vi.fn(() => ({ where: mockWhere }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));
vi.mock('../db', () => ({ db: { select: () => mockSelect() } }));
vi.mock('@language-drill/db', () => ({ usageEvents: { createdAt: 'created_at' } }));

describe('checkGlobalCapacity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.AI_KILL_SWITCH;
    delete process.env.AI_GLOBAL_DAILY_CAP;
    mockWhere.mockResolvedValue([{ count: 0 }]);
  });
  afterEach(() => {
    delete process.env.AI_KILL_SWITCH;
    delete process.env.AI_GLOBAL_DAILY_CAP;
  });

  it('returns ok when no controls are configured', async () => {
    const { checkGlobalCapacity } = await import('./global-capacity');
    expect(await checkGlobalCapacity({ plan: 'free', admin: false })).toBe('ok');
  });

  it('kill switch blocks non-admins but exempts admins', async () => {
    process.env.AI_KILL_SWITCH = 'on';
    const { checkGlobalCapacity, __resetCapacityCache } = await import('./global-capacity');
    __resetCapacityCache();
    expect(await checkGlobalCapacity({ plan: 'boosted', admin: false })).toBe('killed');
    expect(await checkGlobalCapacity({ plan: 'boosted', admin: true })).toBe('ok');
  });

  it('soft cap blocks only free users once the global count is exceeded', async () => {
    process.env.AI_GLOBAL_DAILY_CAP = '100';
    mockWhere.mockResolvedValue([{ count: 100 }]);
    const { checkGlobalCapacity, __resetCapacityCache } = await import('./global-capacity');
    __resetCapacityCache();
    expect(await checkGlobalCapacity({ plan: 'free', admin: false })).toBe('capped');
    expect(await checkGlobalCapacity({ plan: 'boosted', admin: false })).toBe('ok');
  });

  it('soft cap allows free users below the cap', async () => {
    process.env.AI_GLOBAL_DAILY_CAP = '100';
    mockWhere.mockResolvedValue([{ count: 99 }]);
    const { checkGlobalCapacity, __resetCapacityCache } = await import('./global-capacity');
    __resetCapacityCache();
    expect(await checkGlobalCapacity({ plan: 'free', admin: false })).toBe('ok');
  });

  it('treats a non-positive cap as "no cap" (does not block free users)', async () => {
    process.env.AI_GLOBAL_DAILY_CAP = '0';
    mockWhere.mockResolvedValue([{ count: 9999 }]);
    const { checkGlobalCapacity, __resetCapacityCache } = await import('./global-capacity');
    __resetCapacityCache();
    expect(await checkGlobalCapacity({ plan: 'free', admin: false })).toBe('ok');
  });
});
