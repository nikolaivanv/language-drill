import { describe, it, expect } from 'vitest';
import { letterCountLabel } from '../syllabify';

describe('letterCountLabel', () => {
  it('returns "0 letters" for an empty string', () => {
    expect(letterCountLabel('')).toBe('0 letters');
  });

  it('returns "1 letters" for a single character', () => {
    expect(letterCountLabel('a')).toBe('1 letters');
  });

  it('returns "10 letters" for "aprovechar"', () => {
    expect(letterCountLabel('aprovechar')).toBe('10 letters');
  });
});
