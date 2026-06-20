import { describe, it, expect } from 'vitest';
import { bucketWeekly, resolveErrorTrend, buildErrorTrends, type ErrorRow, type AttemptRow } from './error-trends';

const NOW = new Date('2026-06-20T00:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe('bucketWeekly', () => {
  it('counts timestamps into oldest→newest weekly buckets', () => {
    const out = bucketWeekly([daysAgo(1), daysAgo(1), daysAgo(9)], NOW, 4);
    // 4 buckets: [21-28d, 14-21d, 7-14d, 0-7d]; one at 9d (bucket idx 2), two at 1d (idx 3)
    expect(out).toEqual([0, 0, 1, 2]);
  });
  it('drops timestamps outside the window', () => {
    expect(bucketWeekly([daysAgo(40)], NOW, 4)).toEqual([0, 0, 0, 0]);
  });
});

describe('resolveErrorTrend', () => {
  it('quiet when no errors in the recent 2 weeks', () => {
    const r = resolveErrorTrend([3, 2, 0, 0], [10, 10, 10, 10], daysAgo(16), NOW);
    expect(r.status).toBe('quiet');
    expect(r.quietWeeks).toBeGreaterThanOrEqual(2);
  });
  it('improving when recent rate <= 60% of earlier rate', () => {
    // earlier (first 6 of 8): high rate; recent (last 2): low rate
    const r = resolveErrorTrend([5, 5, 5, 5, 5, 5, 1, 0], [10, 10, 10, 10, 10, 10, 10, 10], daysAgo(6), NOW);
    expect(r.status).toBe('improving');
    expect(r.toRatePct).toBeLessThan(r.fromRatePct as number);
  });
  it('recurring when recent rate is not meaningfully lower', () => {
    const r = resolveErrorTrend([2, 2, 2, 2, 2, 2, 3, 3], [10, 10, 10, 10, 10, 10, 10, 10], daysAgo(2), NOW);
    expect(r.status).toBe('recurring');
    expect(r.lastSeenDaysAgo).toBe(2);
  });
});

describe('buildErrorTrends', () => {
  const err = (over: Partial<ErrorRow>): ErrorRow => ({
    grammarPointKey: 'tr-a1-locative', errorType: 'grammar', severity: 'major',
    wrongText: 'pazarda', correction: 'pazara', occurredAt: daysAgo(2), ...over,
  });
  const att = (key: string, d: number): AttemptRow => ({ grammarPointKey: key, attemptedAt: daysAgo(d) });

  it('groups by (grammar point, error type), keeps only >=2 errors, attaches sample/first/last', () => {
    const themes = buildErrorTrends(
      [err({ occurredAt: daysAgo(20) }), err({ occurredAt: daysAgo(2), wrongText: 'recent', correction: 'fix' })],
      [att('tr-a1-locative', 20), att('tr-a1-locative', 2)],
      NOW,
    );
    expect(themes).toHaveLength(1);
    expect(themes[0].grammarPointKey).toBe('tr-a1-locative');
    expect(themes[0].totalErrors).toBe(2);
    expect(themes[0].sample).toEqual({ wrongText: 'recent', correction: 'fix' }); // most recent
    expect(themes[0].weeklyErrors).toHaveLength(8);
  });

  it('drops single-occurrence themes', () => {
    expect(buildErrorTrends([err({})], [att('tr-a1-locative', 2)], NOW)).toEqual([]);
  });

  it('orders recurring before improving before quiet', () => {
    const recurring = [err({ grammarPointKey: 'rec', occurredAt: daysAgo(2) }), err({ grammarPointKey: 'rec', occurredAt: daysAgo(1) })];
    const quiet = [err({ grammarPointKey: 'qui', occurredAt: daysAgo(30) }), err({ grammarPointKey: 'qui', occurredAt: daysAgo(28) })];
    const themes = buildErrorTrends([...quiet, ...recurring], [att('rec', 2), att('rec', 1)], NOW);
    expect(themes[0].grammarPointKey).toBe('rec');
  });
});
