import { describe, expect, it } from 'vitest';
import { InsightsErrorsResponseSchema } from './insights';

describe('InsightsErrorsResponseSchema', () => {
  const theme = {
    grammarPointKey: 'tr-a1-locative',
    grammarPointName: 'Locative case',
    errorType: 'grammar',
    count: 6,
    majorCount: 4,
    lastOccurredAt: '2026-06-19T00:00:00.000Z',
    sample: { wrongText: 'pazarda', correction: 'pazara' },
    score: 4.2,
  };

  it('parses a valid response', () => {
    const parsed = InsightsErrorsResponseSchema.parse({ themes: [theme] });
    expect(parsed.themes[0].grammarPointName).toBe('Locative case');
  });

  it('accepts null grammar point name/key', () => {
    const parsed = InsightsErrorsResponseSchema.parse({
      themes: [{ ...theme, grammarPointKey: null, grammarPointName: null }],
    });
    expect(parsed.themes[0].grammarPointKey).toBeNull();
  });

  it('rejects a missing sample', () => {
    const bad = { ...theme } as Record<string, unknown>;
    delete bad.sample;
    expect(() => InsightsErrorsResponseSchema.parse({ themes: [bad] })).toThrow();
  });
});
