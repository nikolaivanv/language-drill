import { describe, it, expect } from 'vitest';
import {
  FluencySessionResponseSchema,
  FluencyAttemptResponseSchema,
  FluencyStatsResponseSchema,
} from './fluency';

describe('fluency schemas', () => {
  it('parses a session response', () => {
    const parsed = FluencySessionResponseSchema.parse({
      language: 'ES',
      exercises: [
        { id: '00000000-0000-0000-0000-000000000000', type: 'cloze', language: 'ES', difficulty: 'B1', grammarPointKey: null, contentJson: { type: 'cloze' } },
      ],
    });
    expect(parsed.exercises).toHaveLength(1);
  });

  it('parses an attempt response', () => {
    const parsed = FluencyAttemptResponseSchema.parse({ correct: true, correctAnswer: 'está', latencyMs: 1200 });
    expect(parsed.correct).toBe(true);
  });

  it('parses a stats response', () => {
    const parsed = FluencyStatsResponseSchema.parse({
      language: 'ES',
      totalAttempts: 2,
      overallAccuracy: 0.5,
      overallMedianLatencyMs: 1500,
      weeks: [{ weeksAgo: 0, attempts: 2, medianLatencyMs: 1500, accuracy: 0.5 }],
    });
    expect(parsed.weeks).toHaveLength(1);
    expect(parsed.overallMedianLatencyMs).toBe(1500);
  });

  it('accepts a null overall median (no data)', () => {
    const parsed = FluencyStatsResponseSchema.parse({
      language: 'ES', totalAttempts: 0, overallAccuracy: 0, overallMedianLatencyMs: null, weeks: [],
    });
    expect(parsed.overallMedianLatencyMs).toBeNull();
  });
});
