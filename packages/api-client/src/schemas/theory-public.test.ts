import { describe, it, expect } from 'vitest';
import {
  PublicTopicListResponseSchema,
  PublicTopicEnvelopeSchema,
} from './theory-public';

describe('PublicTopicListResponseSchema', () => {
  it('accepts a topic row', () => {
    const parsed = PublicTopicListResponseSchema.parse({
      topics: [
        { id: 'a2-ser-vs-estar', title: 'Ser vs estar', cefr: 'A2', subtitle: 'Two verbs.', category: 'pairs', order: 7, hasConjugationDrill: true },
      ],
    });
    expect(parsed.topics[0].hasConjugationDrill).toBe(true);
  });

  it('accepts a null order', () => {
    const parsed = PublicTopicListResponseSchema.parse({
      topics: [{ id: 'x', title: 'X', cefr: 'A1', subtitle: 's', category: 'other', order: null, hasConjugationDrill: false }],
    });
    expect(parsed.topics[0].order).toBeNull();
  });

  it('rejects a row missing the drill flag, rather than defaulting it', () => {
    // A silent default would render a drill card for a topic with no pool.
    expect(() =>
      PublicTopicListResponseSchema.parse({
        topics: [{ id: 'x', title: 'X', cefr: 'A1', subtitle: 's', category: 'other', order: 1 }],
      }),
    ).toThrow();
  });
});

describe('PublicTopicEnvelopeSchema', () => {
  it('validates only the envelope and passes the article through untouched', () => {
    // The article taxonomy is validated by parseTheoryTopicJson, which is the
    // one validator for it. Duplicating TheoryBlockJson in Zod would give two
    // definitions that can disagree.
    const parsed = PublicTopicEnvelopeSchema.parse({
      id: 'es-a2-ser-vs-estar',
      title: 'Ser vs estar',
      subtitle: 'Two verbs.',
      cefr: 'A2',
      sections: [{ id: 'short', title: 'Short', body: [{ kind: 'paragraph', text: [] }] }],
      related: { buildsOn: [], leadsTo: [], siblings: [] },
      hasConjugationDrill: false,
      quickCheck: [],
    });
    expect(parsed.hasConjugationDrill).toBe(false);
  });

  it('accepts a related ref and a quick-check item', () => {
    const parsed = PublicTopicEnvelopeSchema.parse({
      id: 'es-a2-ser-vs-estar',
      title: 'T',
      subtitle: 's',
      cefr: 'A2',
      sections: [],
      related: {
        buildsOn: [{ topicId: 'a1-noun-gender', title: 'Noun gender', cefr: 'A1' }],
        leadsTo: [],
        siblings: [],
      },
      hasConjugationDrill: true,
      quickCheck: [
        { sentence: 'Ayer ___ aquí.', instructions: 'Type it.', correctAnswer: 'estuve', acceptableAnswers: ['estube'] },
      ],
    });
    expect(parsed.related.buildsOn[0].topicId).toBe('a1-noun-gender');
    expect(parsed.quickCheck[0].topicHint).toBeUndefined();
  });

  it('rejects a quick-check item with no correct answer', () => {
    expect(() =>
      PublicTopicEnvelopeSchema.parse({
        id: 'x', title: 'T', subtitle: 's', cefr: 'A2', sections: [],
        related: { buildsOn: [], leadsTo: [], siblings: [] },
        hasConjugationDrill: false,
        quickCheck: [{ sentence: 'a ___ b', instructions: 'Type it.', acceptableAnswers: [] }],
      }),
    ).toThrow();
  });
});
