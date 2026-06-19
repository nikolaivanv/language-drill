import { describe, expect, it } from 'vitest';
import { rankRecurringErrors, attachGrammarPointNames, type RecurringErrorInput, type RecurringErrorTheme } from './recurring';

const NOW = new Date('2026-06-19T00:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

const row = (over: Partial<RecurringErrorInput>): RecurringErrorInput => ({
  hostGrammarPointKey: 'tr-a1-locative',
  errorGrammarPointKey: null,
  errorType: 'grammar',
  severity: 'major',
  wrongText: 'pazarda',
  correction: 'pazara',
  occurredAt: daysAgo(1),
  ...over,
});

describe('rankRecurringErrors', () => {
  it('groups by (grammarPoint, errorType) and counts', () => {
    const themes = rankRecurringErrors(
      [row({}), row({}), row({ errorType: 'spelling', wrongText: 'mürdür', correction: 'müdür' })],
      NOW,
    );
    const locativeGrammar = themes.find((t) => t.grammarPointKey === 'tr-a1-locative' && t.errorType === 'grammar');
    expect(locativeGrammar?.count).toBe(2);
    expect(themes.find((t) => t.errorType === 'spelling')?.count).toBe(1);
  });

  it('prefers errorGrammarPointKey over host when present', () => {
    const themes = rankRecurringErrors([row({ errorGrammarPointKey: 'tr-a1-accusative' })], NOW);
    expect(themes[0].grammarPointKey).toBe('tr-a1-accusative');
  });

  it('ranks a recent theme above an older theme with equal count', () => {
    const themes = rankRecurringErrors(
      [
        row({ hostGrammarPointKey: 'old', occurredAt: daysAgo(40) }),
        row({ hostGrammarPointKey: 'old', occurredAt: daysAgo(40) }),
        row({ hostGrammarPointKey: 'recent', occurredAt: daysAgo(1) }),
        row({ hostGrammarPointKey: 'recent', occurredAt: daysAgo(1) }),
      ],
      NOW,
    );
    expect(themes[0].grammarPointKey).toBe('recent');
  });

  it('exposes the most recent row as the sample and tracks majorCount', () => {
    const themes = rankRecurringErrors(
      [
        row({ occurredAt: daysAgo(5), wrongText: 'old', severity: 'minor' }),
        row({ occurredAt: daysAgo(1), wrongText: 'new' }),
      ],
      NOW,
    );
    expect(themes[0].sample.wrongText).toBe('new');
    expect(themes[0].majorCount).toBe(1);
    expect(themes[0].lastOccurredAt).toEqual(daysAgo(1));
  });

  it('honors the limit option', () => {
    const rows = ['a', 'b', 'c', 'd', 'e', 'f'].map((k) => row({ hostGrammarPointKey: k }));
    expect(rankRecurringErrors(rows, NOW, { limit: 3 })).toHaveLength(3);
  });
});

describe('attachGrammarPointNames', () => {
  const theme = (over: Partial<RecurringErrorTheme> = {}): RecurringErrorTheme => ({
    grammarPointKey: 'tr-a1-locative',
    errorType: 'grammar',
    count: 2,
    majorCount: 1,
    lastOccurredAt: new Date('2026-06-19T00:00:00Z'),
    sample: { wrongText: 'pazarda', correction: 'pazara' },
    score: 1,
    grammarPointName: null,
    ...over,
  });

  it('resolves each theme key to a display name', () => {
    const resolve = (k: string | null) => (k === 'tr-a1-locative' ? 'Locative case' : null);
    const out = attachGrammarPointNames([theme()], resolve);
    expect(out[0].grammarPointName).toBe('Locative case');
  });

  it('passes a null key through to the resolver and keeps null', () => {
    const resolve = (k: string | null) => (k === null ? null : 'x');
    const out = attachGrammarPointNames([theme({ grammarPointKey: null })], resolve);
    expect(out[0].grammarPointName).toBeNull();
  });

  it('does not mutate the input themes', () => {
    const input = [theme({ grammarPointName: null })];
    attachGrammarPointNames(input, () => 'Name');
    expect(input[0].grammarPointName).toBeNull();
  });
});
