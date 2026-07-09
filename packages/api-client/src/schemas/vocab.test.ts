import { describe, expect, it } from 'vitest';
import {
  VocabTopicsResponseSchema,
  VocabTopicDetailSchema,
} from './vocab';

describe('vocab schemas', () => {
  it('parses a topics response', () => {
    const parsed = VocabTopicsResponseSchema.parse({
      topics: [
        { umbrellaKey: 'es-a1-vocab-food-drink', name: 'Food and drink (A1)', cefrLevel: 'A1', wordCount: 30, available: 12, practiced: 5 },
      ],
    });
    expect(parsed.topics[0].umbrellaKey).toBe('es-a1-vocab-food-drink');
  });

  it('parses a topic detail with word states', () => {
    const parsed = VocabTopicDetailSchema.parse({
      umbrellaKey: 'es-a1-vocab-food-drink',
      name: 'Food and drink (A1)',
      cefrLevel: 'A1',
      words: [
        { lemma: 'pan', displayForm: 'el pan', gloss: 'bread', exampleSentence: 'Compro pan.', freqRank: 300, tier: 'core', state: 'untested' },
        { lemma: 'zumo', displayForm: 'el zumo', gloss: 'juice', exampleSentence: 'Bebo zumo.', freqRank: null, tier: 'extended', state: 'not-yet' },
      ],
    });
    expect(parsed.words[1].freqRank).toBeNull();
    expect(parsed.words[0].state).toBe('untested');
  });

  it('rejects an invalid coverage state', () => {
    expect(() =>
      VocabTopicDetailSchema.parse({
        umbrellaKey: 'x', name: 'x', cefrLevel: 'A1',
        words: [{ lemma: 'a', displayForm: 'a', gloss: 'a', exampleSentence: 'a', freqRank: 1, tier: 'core', state: 'bogus' }],
      }),
    ).toThrow();
  });
});
