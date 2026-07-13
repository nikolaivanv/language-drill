import { describe, it, expect } from 'vitest';
import { parseWordHints } from './word-hint';

describe('parseWordHints', () => {
  it('keeps well-formed units and drops malformed ones', () => {
    const out = parseWordHints({
      units: [
        { text: 'The', hintable: false },
        { text: 'students', hintable: true, lemma: 'öğrenci' },
        { text: 'account for', hintable: true, lemma: 'hesaba katmak' },
        { text: 42, hintable: true },            // malformed → dropped
        { hintable: true, lemma: 'x' },          // no text → dropped
      ],
    });
    expect(out).toEqual([
      { text: 'The', hintable: false },
      { text: 'students', hintable: true, lemma: 'öğrenci' },
      { text: 'account for', hintable: true, lemma: 'hesaba katmak' },
    ]);
  });

  it('drops lemma when a unit is not hintable', () => {
    const out = parseWordHints({ units: [{ text: 'the', hintable: false, lemma: 'nope' }] });
    expect(out).toEqual([{ text: 'the', hintable: false }]);
  });

  it('returns [] for non-object / missing units', () => {
    expect(parseWordHints(null)).toEqual([]);
    expect(parseWordHints({})).toEqual([]);
  });
});
