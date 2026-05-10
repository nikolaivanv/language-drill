import { describe, it, expect } from 'vitest';
import { PoolStatusItemSchema, GenerationStatsSchema } from './pool-status';

describe('PoolStatusItemSchema', () => {
  const baseItem = {
    language: 'EN',
    level: 'B1',
    type: 'cloze',
    grammarPointKey: 'present-perfect',
    approved: 10,
    flagged: 2,
    rejected: 1,
    lastRefilledAt: null,
    depletionRate7d: 0.3,
    targetSize: 20,
  };

  it('parses a valid PoolStatusItem with lastRefilledAt: null', () => {
    const result = PoolStatusItemSchema.safeParse(baseItem);
    expect(result.success).toBe(true);
  });

  it('parses a valid PoolStatusItem with a lastRefilledAt timestamp', () => {
    const result = PoolStatusItemSchema.safeParse({
      ...baseItem,
      lastRefilledAt: '2026-05-10T12:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a PoolStatusItem missing the grammarPointKey field', () => {
    const { grammarPointKey: _omitted, ...withoutKey } = baseItem;
    const result = PoolStatusItemSchema.safeParse(withoutKey);
    expect(result.success).toBe(false);
  });
});

describe('GenerationStatsSchema', () => {
  const baseStats = {
    costThisWeekUsd: 1.25,
    costThisMonthUsd: 4.75,
    jobsThisWeek: {
      succeeded: 18,
      failed: 2,
      running: 1,
      queued: 3,
    },
    approvalRates: [],
  };

  it('parses a valid GenerationStats with empty approvalRates', () => {
    const result = GenerationStatsSchema.safeParse(baseStats);
    expect(result.success).toBe(true);
  });

  it('parses a valid GenerationStats with one approvalRates entry', () => {
    const result = GenerationStatsSchema.safeParse({
      ...baseStats,
      approvalRates: [
        {
          language: 'EN',
          level: 'B1',
          type: 'cloze',
          approvedCount: 8,
          flaggedCount: 1,
          rejectedCount: 1,
          approvalRate: 0.8,
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a GenerationStats where an approvalRates entry has approvedCount as a string', () => {
    const result = GenerationStatsSchema.safeParse({
      ...baseStats,
      approvalRates: [
        {
          language: 'EN',
          level: 'B1',
          type: 'cloze',
          approvedCount: '5',
          flaggedCount: 1,
          rejectedCount: 1,
          approvalRate: 0.5,
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});
