import { describe, it, expect } from 'vitest';
import { parseConfusions } from '../parse-confusions';

describe('parseConfusions', () => {
  it('returns an empty array when no confusion pattern is present', () => {
    expect(parseConfusions('the word is correct')).toEqual([]);
  });

  it('extracts a "vs" pair', () => {
    expect(parseConfusions('try casi vs apenas next time')).toEqual([
      { a: 'casi', b: 'apenas' },
    ]);
  });

  it('extracts a "vs." pair (with trailing period)', () => {
    expect(parseConfusions('casi vs. apenas')).toEqual([
      { a: 'casi', b: 'apenas' },
    ]);
  });

  it('extracts a slash pair without surrounding whitespace', () => {
    expect(parseConfusions('confusables: casi/apenas')).toEqual([
      { a: 'casi', b: 'apenas' },
    ]);
  });

  it('extracts a slash pair with surrounding whitespace', () => {
    expect(parseConfusions('casi / apenas')).toEqual([
      { a: 'casi', b: 'apenas' },
    ]);
  });

  it('extracts an "or" pair', () => {
    expect(parseConfusions('was it casi or apenas?')).toEqual([
      { a: 'casi', b: 'apenas' },
    ]);
  });

  it('does not match "or" inside a longer word like "lover"', () => {
    expect(parseConfusions('lover')).toEqual([]);
  });

  it('dedupes the same pair across different separators (case-insensitive)', () => {
    expect(
      parseConfusions('casi vs apenas. also casi/apenas. or Casi or Apenas.'),
    ).toEqual([{ a: 'casi', b: 'apenas' }]);
  });

  it('dedupes when the order is reversed (a/b same as b/a)', () => {
    expect(parseConfusions('casi vs apenas. apenas vs casi.')).toEqual([
      { a: 'casi', b: 'apenas' },
    ]);
  });

  it('caps results at 3 distinct pairs', () => {
    const feedback = 'a vs b. c/d. e or f. g vs h. i/j.';
    const result = parseConfusions(feedback);
    expect(result).toHaveLength(3);
    expect(result).toEqual([
      { a: 'a', b: 'b' },
      { a: 'c', b: 'd' },
      { a: 'e', b: 'f' },
    ]);
  });

  it('preserves the original casing of the first occurrence', () => {
    expect(parseConfusions('Ser vs Estar. ser vs estar.')).toEqual([
      { a: 'Ser', b: 'Estar' },
    ]);
  });
});
