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
  it('recurring (not improving) when the earlier window has no attempts — honesty rate-guard', () => {
    // No earlier baseline to compare against: a null earlier rate must NOT be
    // read as "improving". Recent: 6 errors / 20 attempts; earlier: 0/0 → null.
    const r = resolveErrorTrend([0, 0, 0, 0, 0, 0, 3, 3], [0, 0, 0, 0, 0, 0, 10, 10], daysAgo(1), NOW);
    expect(r.status).toBe('recurring');
  });
  it('dormant when no errors and no recent attempts', () => {
    // Old errors + old attempts, but nothing in the last 2 weeks
    const r = resolveErrorTrend([2, 2, 0, 0, 0, 0, 0, 0], [10, 10, 0, 0, 0, 0, 0, 0], daysAgo(50), NOW);
    expect(r.status).toBe('dormant');
    expect(r.quietWeeks).toBeGreaterThanOrEqual(6);
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

  it('orders recurring → improving → quiet → dormant', () => {
    const rec = [err({ grammarPointKey: 'rec', occurredAt: daysAgo(2) }), err({ grammarPointKey: 'rec', occurredAt: daysAgo(1) })];
    const imp = [
      err({ grammarPointKey: 'imp', occurredAt: daysAgo(21) }),
      err({ grammarPointKey: 'imp', occurredAt: daysAgo(21) }),
      err({ grammarPointKey: 'imp', occurredAt: daysAgo(21) }),
      err({ grammarPointKey: 'imp', occurredAt: daysAgo(3) }),
    ];
    // qui: old errors, but recent attempts with no errors → quiet
    const qui = [err({ grammarPointKey: 'qui', occurredAt: daysAgo(40) }), err({ grammarPointKey: 'qui', occurredAt: daysAgo(38) })];
    // dor: old errors, NO attempts ever → dormant
    const dor = [err({ grammarPointKey: 'dor', occurredAt: daysAgo(50) }), err({ grammarPointKey: 'dor', occurredAt: daysAgo(48) })];
    const attempts = [
      att('rec', 2),
      att('rec', 1),
      ...Array.from({ length: 6 }, () => att('imp', 21)), // earlier window
      ...Array.from({ length: 6 }, () => att('imp', 3)), // recent window
      // qui gets recent attempts (within last 2 weeks) so recentAttempts > 0 → quiet
      att('qui', 3),
      att('qui', 1),
    ];
    const themes = buildErrorTrends([...dor, ...qui, ...imp, ...rec], attempts, NOW);
    expect(themes.map((t) => t.grammarPointKey)).toEqual(['rec', 'imp', 'qui', 'dor']);
    expect(themes.map((t) => t.status)).toEqual(['recurring', 'improving', 'quiet', 'dormant']);
  });

  it('handles a null grammar point (groups under the no-point sentinel)', () => {
    const themes = buildErrorTrends(
      [err({ grammarPointKey: null, occurredAt: daysAgo(2) }), err({ grammarPointKey: null, occurredAt: daysAgo(1) })],
      [],
      NOW,
    );
    expect(themes).toHaveLength(1);
    expect(themes[0].grammarPointKey).toBeNull();
  });
});
