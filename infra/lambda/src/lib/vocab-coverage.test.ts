import { describe, expect, it } from 'vitest';
import {
  deriveWordCoverage,
  normalizeWord,
  pickWordStat,
  summarizeCoverage,
  type ExerciseWordStat,
} from './vocab-coverage';

describe('deriveWordCoverage', () => {
  it('maps stat presence + score to a state', () => {
    expect(deriveWordCoverage(undefined)).toBe('not-yet');
    expect(deriveWordCoverage({ attempts: 0, bestScore: null })).toBe('untested');
    expect(deriveWordCoverage({ attempts: 3, bestScore: 0.9 })).toBe('practiced-strong');
    expect(deriveWordCoverage({ attempts: 2, bestScore: 0.5 })).toBe('practiced-weak');
    expect(deriveWordCoverage({ attempts: 1, bestScore: 0.7 })).toBe('practiced-strong');
  });
});

describe('normalizeWord', () => {
  it('lowercases, trims, and drops a leading article', () => {
    expect(normalizeWord('  La Manzana ')).toBe('manzana');
    expect(normalizeWord('el pan')).toBe('pan');
    expect(normalizeWord('comer')).toBe('comer');
  });
});

describe('pickWordStat', () => {
  it('matches by lemma, then displayForm', () => {
    const byWord = new Map<string, ExerciseWordStat>([
      ['manzana', { attempts: 1, bestScore: 0.8 }],
    ]);
    expect(pickWordStat({ displayForm: 'la manzana', lemma: 'manzana' }, byWord)).toEqual({
      attempts: 1,
      bestScore: 0.8,
    });
    expect(pickWordStat({ displayForm: 'el pan', lemma: 'pan' }, byWord)).toBeUndefined();
  });
});

describe('summarizeCoverage', () => {
  it('counts available and practiced', () => {
    expect(
      summarizeCoverage(['not-yet', 'untested', 'practiced-weak', 'practiced-strong']),
    ).toEqual({ total: 4, available: 3, practiced: 2 });
  });
});
