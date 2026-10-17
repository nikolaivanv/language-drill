import { describe, expect, it } from 'vitest';
import { VOCAB_GROUP_LABELS, VOCAB_POS, parseVocabPos } from './vocab-pos';

describe('parseVocabPos', () => {
  it('accepts the six classes in any casing and with whitespace', () => {
    expect(parseVocabPos('verb')).toBe('verb');
    expect(parseVocabPos(' Verb ')).toBe('verb');
    expect(parseVocabPos('NOUN')).toBe('noun');
    expect(parseVocabPos('phrase')).toBe('phrase');
  });

  it('rejects unknown values and non-strings', () => {
    expect(parseVocabPos('adj')).toBeNull();
    expect(parseVocabPos('')).toBeNull();
    expect(parseVocabPos(undefined)).toBeNull();
    expect(parseVocabPos(3)).toBeNull();
  });

  it('exposes the closed lists', () => {
    expect(VOCAB_POS).toEqual(['noun', 'verb', 'adjective', 'adverb', 'phrase', 'other']);
    expect(VOCAB_GROUP_LABELS).toEqual(['verbs', 'describing', 'adverbs', 'connectors', 'expressions']);
  });
});
