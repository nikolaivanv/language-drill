import { describe, it, expect } from 'vitest';
import { aggregateFluencyStats, median, type FluencyAttemptRow } from './fluency-stats';

const DAY = 86_400_000;
const NOW = new Date('2026-06-13T12:00:00Z');

function row(daysAgo: number, latencyMs: number, correct: boolean): FluencyAttemptRow {
  return { latencyMs, correct, attemptedAt: new Date(NOW.getTime() - daysAgo * DAY) };
}

describe('median', () => {
  it('returns the middle of an odd-length set', () => {
    expect(median([3, 1, 2])).toBe(2);
  });
  it('averages the two middles of an even-length set', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
  it('returns null for an empty set', () => {
    expect(median([])).toBeNull();
  });
});

describe('aggregateFluencyStats', () => {
  it('returns empty buckets and zeroed totals when there are no rows', () => {
    const stats = aggregateFluencyStats([], NOW, 4);
    expect(stats.totalAttempts).toBe(0);
    expect(stats.overallAccuracy).toBe(0);
    expect(stats.overallMedianLatencyMs).toBeNull();
    expect(stats.weeks).toHaveLength(4);
    expect(stats.weeks.every((w) => w.attempts === 0)).toBe(true);
  });

  it('computes overall totals across all rows', () => {
    const rows = [row(0, 1000, true), row(1, 3000, false), row(2, 2000, true)];
    const stats = aggregateFluencyStats(rows, NOW, 4);
    expect(stats.totalAttempts).toBe(3);
    expect(stats.overallAccuracy).toBeCloseTo(2 / 3, 5);
    expect(stats.overallMedianLatencyMs).toBe(2000);
  });

  it('buckets attempts into the correct week (last bucket = current week)', () => {
    // 0 days ago → current week (index weeks-1); 8 days ago → an earlier bucket
    const rows = [row(0, 1000, true), row(8, 5000, true)];
    const stats = aggregateFluencyStats(rows, NOW, 4);
    const last = stats.weeks[stats.weeks.length - 1];
    expect(last.attempts).toBe(1);
    expect(last.medianLatencyMs).toBe(1000);
    const totalBucketed = stats.weeks.reduce((s, w) => s + w.attempts, 0);
    expect(totalBucketed).toBe(2);
  });
});
