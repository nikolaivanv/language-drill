import { describe, it, expect } from 'vitest';
import { diffDictation } from './dictation-diff.js';

describe('diffDictation', () => {
  it('perfect match → 1.0 accuracies, no differences', () => {
    const r = diffDictation('Hola mundo.', 'Hola mundo.');
    expect(r.rawCharAccuracy).toBe(1);
    expect(r.wordAccuracy).toBe(1);
    expect(r.differences).toHaveLength(0);
    expect(r.segments).toEqual([{ kind: 'match', text: 'Hola mundo.' }]);
  });

  it('is case- and whitespace-insensitive for word matching', () => {
    const r = diffDictation('Hola  mundo', 'hola mundo');
    expect(r.wordAccuracy).toBe(1);
    expect(r.differences).toHaveLength(0);
  });

  it('flags a word-boundary substitution', () => {
    const r = diffDictation('el tiempo lo cura todo', 'el tiempo locura todo');
    expect(r.wordAccuracy).toBeCloseTo(4 / 5, 5); // 4 of 5 reference words matched
    const subs = r.differences.filter((d) => d.expected && d.got);
    expect(subs.length).toBeGreaterThanOrEqual(1);
    expect(r.differences.map((d) => d.got).join(' ')).toContain('locura');
  });

  it('flags a missing word (deletion) with empty got', () => {
    const r = diffDictation('me he dado cuenta', 'me dado cuenta');
    expect(r.differences.some((d) => d.expected === 'he' && d.got === '')).toBe(true);
  });

  it('rawCharAccuracy drops with character edits', () => {
    const r = diffDictation('heridas', 'eridas');
    expect(r.rawCharAccuracy).toBeCloseTo(6 / 7, 5);
  });

  it('assigns stable incrementing ids to differences in reading order', () => {
    const r = diffDictation('a b c d', 'a x c y');
    expect(r.differences.map((d) => d.id)).toEqual([1, 2]);
  });
});
