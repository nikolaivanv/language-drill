import { describe, expect, it } from 'vitest';
import {
  VocabTopicsResponseSchema,
  VocabTopicDetailSchema,
  VocabTopicSummarySchema,
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

describe('VocabTopicSummarySchema group', () => {
  it('defaults group to null for responses from an older API', () => {
    const base = { umbrellaKey: 'k', name: 'n', cefrLevel: 'A1', wordCount: 1, available: 1, practiced: 0 };
    expect(VocabTopicSummarySchema.parse(base).group).toBeNull();
    expect(VocabTopicSummarySchema.parse({ ...base, group: 'connectors' }).group).toBe('connectors');
  });

  it('degrades an unknown group label to null without failing the topic', () => {
    const parsed = VocabTopicSummarySchema.parse({
      umbrellaKey: 'k', name: 'n', cefrLevel: 'A1', wordCount: 3, available: 2, practiced: 1, group: 'bogus',
    });
    expect(parsed.group).toBeNull();
    expect(parsed).toMatchObject({ umbrellaKey: 'k', name: 'n', wordCount: 3, available: 2, practiced: 1 });
  });
});
