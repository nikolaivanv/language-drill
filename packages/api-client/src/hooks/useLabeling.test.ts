import { describe, it, expect } from 'vitest';
import { LABEL_TAGS } from '@language-drill/shared';
import { LabelQueueResponseSchema, LabelingStatsSchema } from '../schemas/labeling';

describe('labeling schemas', () => {
  const item = {
    submissionId: '11111111-1111-4111-8111-111111111111',
    exerciseId: '22222222-2222-4222-8222-222222222222',
    language: 'ES',
    cefrLevel: 'B1',
    exerciseType: 'cloze',
    grammarPointKey: 'es.b1.preterite-vs-imperfect',
    learnerView: 'Fill the blank\nAyer ___ al mercado.',
    referenceAnswers: { correctAnswer: 'fui' },
    userAnswer: 'iba',
    evaluation: { score: 0.4, feedback: 'iba is imperfect', errors: [] },
    score: 0.4,
    evaluatedAt: '2026-09-20T12:00:00.000Z',
    optionsRevealed: false,
  };

  it('parses a queue response', () => {
    const parsed = LabelQueueResponseSchema.parse({ items: [item], remaining: 42, dropped: 0 });
    expect(parsed.items[0].learnerView).toContain('Ayer');
    expect(parsed.remaining).toBe(42);
  });

  it('tolerates a null grammar point and a null evaluatedAt', () => {
    expect(() =>
      LabelQueueResponseSchema.parse({
        items: [{ ...item, grammarPointKey: null, evaluatedAt: null }],
        remaining: 0,
        dropped: 0,
      }),
    ).not.toThrow();
  });

  it('accepts every tag in the shared vocabulary — a missing one throws in prod', () => {
    const stats = {
      strata: [{ stratum: 'random', count: 10, gradeOkRate: 0.8, feedbackOkRate: 0.9 }],
      tags: LABEL_TAGS.map((tag) => ({ tag, count: 1 })),
      labeledToday: 3,
    };
    expect(LabelingStatsSchema.parse(stats).tags).toHaveLength(LABEL_TAGS.length);
  });

  it('parses a queue response carrying dropped rows', () => {
    const parsed = LabelQueueResponseSchema.parse({ items: [item], remaining: 42, dropped: 2 });
    expect(parsed.dropped).toBe(2);
  });

  it('rejects a queue response missing dropped rather than defaulting it to 0', () => {
    expect(() => LabelQueueResponseSchema.parse({ items: [item], remaining: 42 })).toThrow();
  });
});
