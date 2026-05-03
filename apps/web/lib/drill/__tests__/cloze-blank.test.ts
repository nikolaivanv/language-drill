import { describe, it, expect } from 'vitest';
import { splitClozeSentence } from '../cloze-blank';

describe('splitClozeSentence', () => {
  it('returns the whole sentence as `before` when no blank is present', () => {
    expect(splitClozeSentence('hello world')).toEqual({
      before: 'hello world',
      after: '',
      hasBlank: false,
    });
  });

  it('handles a blank at the start of the sentence', () => {
    expect(splitClozeSentence('___ casa')).toEqual({
      before: '',
      after: ' casa',
      hasBlank: true,
    });
  });

  it('handles a blank at the end of the sentence', () => {
    expect(splitClozeSentence('me gusta ___')).toEqual({
      before: 'me gusta ',
      after: '',
      hasBlank: true,
    });
  });

  it('handles a blank in the middle of the sentence', () => {
    expect(splitClozeSentence('yo ___ pan')).toEqual({
      before: 'yo ',
      after: ' pan',
      hasBlank: true,
    });
  });

  it('only splits on the first blank when multiple are present', () => {
    expect(splitClozeSentence('a ___ b ___ c')).toEqual({
      before: 'a ',
      after: ' b ___ c',
      hasBlank: true,
    });
  });

  it('treats 4 underscores as a single blank (not 3 + 1 leftover)', () => {
    expect(splitClozeSentence('a ____ b')).toEqual({
      before: 'a ',
      after: ' b',
      hasBlank: true,
    });
  });

  it('treats 5 underscores as a single blank', () => {
    expect(splitClozeSentence('a _____ b')).toEqual({
      before: 'a ',
      after: ' b',
      hasBlank: true,
    });
  });

  it('returns no blank for an empty string', () => {
    expect(splitClozeSentence('')).toEqual({
      before: '',
      after: '',
      hasBlank: false,
    });
  });

  it('does not treat 2 underscores as a blank (below 3-underscore threshold)', () => {
    expect(splitClozeSentence('a __ b')).toEqual({
      before: 'a __ b',
      after: '',
      hasBlank: false,
    });
  });
});
