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
    targetSize: 50,
    generationTarget: 20,
    coverageDistribution: null,
    status: 'never-run',
    lastJob: null,
  };

  it('parses a valid PoolStatusItem with lastRefilledAt: null', () => {
    const result = PoolStatusItemSchema.safeParse(baseItem);
    expect(result.success).toBe(true);
  });

  it('parses a populated lastJob with each scheduler status', () => {
    for (const status of [
      'active',
      'target-reached',
      'low-yield',
      'saturated-dedup',
      'never-run',
      'out-of-scope',
    ]) {
      const result = PoolStatusItemSchema.safeParse({
        ...baseItem,
        status,
        lastJob: {
          approvedCount: 12,
          requestedCount: 30,
          dedupGivenUpCount: 4,
          curriculumVersion: '2026-06-17',
        },
      });
      expect(result.success, `status ${status} should parse`).toBe(true);
    }
  });

  it('parses a lastJob whose curriculumVersion is null (legacy row)', () => {
    const result = PoolStatusItemSchema.safeParse({
      ...baseItem,
      status: 'active',
      lastJob: {
        approvedCount: 1,
        requestedCount: 1,
        dedupGivenUpCount: 0,
        curriculumVersion: null,
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown status value', () => {
    const result = PoolStatusItemSchema.safeParse({ ...baseItem, status: 'paused' });
    expect(result.success).toBe(false);
  });

  it('rejects a PoolStatusItem missing the status field', () => {
    const { status: _omitted, ...withoutStatus } = baseItem;
    const result = PoolStatusItemSchema.safeParse(withoutStatus);
    expect(result.success).toBe(false);
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

  it('rejects a PoolStatusItem missing the generationTarget field', () => {
    const { generationTarget: _omitted, ...withoutTarget } = baseItem;
    const result = PoolStatusItemSchema.safeParse(withoutTarget);
    expect(result.success).toBe(false);
  });

  it('parses a populated coverageDistribution (axis → value → count)', () => {
    const result = PoolStatusItemSchema.safeParse({
      ...baseItem,
      coverageDistribution: {
        person: { '3sg': 12, '2pl': 2 },
        polarity: { affirmative: 13, negative: 1 },
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a coverageDistribution whose counts are not numbers', () => {
    const result = PoolStatusItemSchema.safeParse({
      ...baseItem,
      coverageDistribution: { person: { '3sg': 'lots' } },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a PoolStatusItem missing the coverageDistribution field', () => {
    const { coverageDistribution: _omitted, ...withoutDist } = baseItem;
    const result = PoolStatusItemSchema.safeParse(withoutDist);
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
          dedupGivenUpCount: 0,
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
          dedupGivenUpCount: 0,
          approvalRate: 0.5,
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a GenerationStats where an approvalRates entry is missing dedupGivenUpCount', () => {
    const result = GenerationStatsSchema.safeParse({
      ...baseStats,
      approvalRates: [
        {
          language: 'EN',
          level: 'B1',
          type: 'cloze',
          approvedCount: 5,
          flaggedCount: 1,
          rejectedCount: 1,
          approvalRate: 0.5,
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});
