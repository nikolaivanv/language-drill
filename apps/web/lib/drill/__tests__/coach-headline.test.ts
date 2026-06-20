import { describe, it, expect } from 'vitest';
import type { InsightsErrorTheme } from '@language-drill/api-client';
import {
  withinSessionHeadline,
  crossSessionHeadline,
  coachHeadline,
  type SessionError,
} from '../coach-headline';

const err = (over: Partial<SessionError> = {}): SessionError => ({
  grammarPointKey: 'tr-a1-locative',
  errorType: 'grammar',
  severity: 'major',
  text: 'pazarda',
  correction: 'pazara',
  ...over,
});

const theme = (over: Partial<InsightsErrorTheme> = {}): InsightsErrorTheme => ({
  grammarPointKey: 'tr-a1-locative',
  grammarPointName: 'Locative case',
  errorType: 'grammar',
  count: 6,
  majorCount: 4,
  lastOccurredAt: '2026-06-19T00:00:00.000Z',
  sample: { wrongText: 'pazarda', correction: 'pazara' },
  score: 4.2,
  ...over,
});

describe('withinSessionHeadline', () => {
  it('returns null below the repeat threshold', () => {
    expect(withinSessionHeadline([])).toBeNull();
    expect(withinSessionHeadline([err()])).toBeNull();
  });

  it('surfaces a repeated group using the most recent slip', () => {
    expect(
      withinSessionHeadline([err({ text: 'old', correction: 'OLD' }), err({ text: 'pazarda', correction: 'pazara' })]),
    ).toBe('watch · pazarda → pazara · slipped 2× this session');
  });

  it('groups null-grammar-point errors by error type', () => {
    const e = err({ grammarPointKey: null, errorType: 'spelling', text: 'mursdur', correction: 'müdür' });
    expect(withinSessionHeadline([e, e])).toBe('watch · mursdur → müdür · slipped 2× this session');
  });

  it('prefers the larger repeated group', () => {
    const locative = err({ grammarPointKey: 'loc' });
    const accus = err({ grammarPointKey: 'acc', text: 'çantası', correction: 'çantan' });
    const out = withinSessionHeadline([locative, locative, locative, accus, accus]);
    expect(out).toContain('pazarda → pazara');
    expect(out).toContain('3×');
  });

  it('breaks an equal-size tie toward the group with more major errors', () => {
    const major = err({ grammarPointKey: 'x', severity: 'major', text: 'majWrong', correction: 'majRight' });
    const minor = err({ grammarPointKey: 'y', severity: 'minor', text: 'minWrong', correction: 'minRight' });
    // minor group inserted first; the major group must still win the tie.
    const out = withinSessionHeadline([minor, minor, major, major]);
    expect(out).toBe('watch · majWrong → majRight · slipped 2× this session');
  });
});

describe('crossSessionHeadline', () => {
  it('formats the top theme with its grammar point name', () => {
    expect(crossSessionHeadline([theme()])).toBe('lately · Locative case: pazarda → pazara (6×)');
  });

  it('omits the name when null', () => {
    expect(crossSessionHeadline([theme({ grammarPointName: null })])).toBe('lately · pazarda → pazara (6×)');
  });

  it('returns null when no theme meets the repeat threshold', () => {
    expect(crossSessionHeadline([theme({ count: 1 })])).toBeNull();
    expect(crossSessionHeadline([])).toBeNull();
  });
});

describe('coachHeadline', () => {
  it('prefers a within-session pattern over cross-session', () => {
    expect(coachHeadline({ sessionErrors: [err(), err()], themes: [theme()] })).toContain('this session');
  });

  it('falls back to cross-session when no within-session pattern', () => {
    expect(coachHeadline({ sessionErrors: [err()], themes: [theme()] })).toContain('lately');
  });

  it('returns null when neither qualifies', () => {
    expect(coachHeadline({ sessionErrors: [err()], themes: [theme({ count: 1 })] })).toBeNull();
  });
});
