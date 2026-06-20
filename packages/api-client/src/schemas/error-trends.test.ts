import { describe, it, expect } from 'vitest';
import { ErrorTrendsResponseSchema } from './error-trends';

const theme = {
  grammarPointKey: 'tr-a1-locative', grammarPointName: 'Locative case', errorType: 'grammar',
  sample: { wrongText: 'pazarda', correction: 'pazara' },
  firstSeen: '2026-05-20T00:00:00.000Z', lastSeen: '2026-06-18T00:00:00.000Z',
  totalErrors: 6, weeklyErrors: [0, 1, 2, 1, 1, 0, 1, 0],
  status: 'recurring' as const, lastSeenDaysAgo: 2, fromRatePct: null, toRatePct: null, quietWeeks: null,
};

describe('ErrorTrendsResponseSchema', () => {
  it('parses a valid response', () => {
    const parsed = ErrorTrendsResponseSchema.parse({ themes: [theme] });
    expect(parsed.themes[0].status).toBe('recurring');
  });
  it('accepts the improving variant with rate fields', () => {
    const parsed = ErrorTrendsResponseSchema.parse({ themes: [{ ...theme, status: 'improving', fromRatePct: 60, toRatePct: 12 }] });
    expect(parsed.themes[0].toRatePct).toBe(12);
  });
  it('accepts the dormant variant with quietWeeks', () => {
    const parsed = ErrorTrendsResponseSchema.parse({ themes: [{ ...theme, status: 'dormant', quietWeeks: 6 }] });
    expect(parsed.themes[0].status).toBe('dormant');
    expect(parsed.themes[0].quietWeeks).toBe(6);
  });
  it('rejects an unknown status', () => {
    expect(() => ErrorTrendsResponseSchema.parse({ themes: [{ ...theme, status: 'nope' }] })).toThrow();
  });
});
