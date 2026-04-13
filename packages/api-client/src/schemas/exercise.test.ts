import { describe, it, expect } from 'vitest';
import {
  ExerciseResponseSchema,
  EvaluationResultSchema,
  ApiErrorSchema,
} from './exercise';

describe('ExerciseResponseSchema', () => {
  it('parses a valid exercise response', () => {
    const data = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      type: 'cloze',
      language: 'EN',
      difficulty: 'B1',
      contentJson: { instructions: 'Fill in the blank', sentence: 'I ___ to the store' },
    };
    const result = ExerciseResponseSchema.parse(data);
    expect(result.id).toBe(data.id);
    expect(result.type).toBe('cloze');
    expect(result.language).toBe('EN');
    expect(result.difficulty).toBe('B1');
    expect(result.contentJson).toEqual(data.contentJson);
  });

  it('accepts any contentJson shape', () => {
    const data = {
      id: 'abc',
      type: 'translation',
      language: 'ES',
      difficulty: 'A2',
      contentJson: null,
    };
    const result = ExerciseResponseSchema.parse(data);
    expect(result.contentJson).toBeNull();
  });

  it('rejects missing required fields', () => {
    expect(() => ExerciseResponseSchema.parse({ id: 'abc' })).toThrow();
    expect(() => ExerciseResponseSchema.parse({})).toThrow();
  });
});

describe('EvaluationResultSchema', () => {
  const validEvaluation = {
    score: 0.85,
    grammarAccuracy: 0.9,
    vocabularyRange: 'B1',
    taskAchievement: 0.8,
    feedback: 'Good work!',
    errors: [
      {
        type: 'grammar' as const,
        severity: 'minor' as const,
        text: 'I goed',
        correction: 'I went',
        explanation: 'Irregular past tense',
      },
    ],
    estimatedCefrEvidence: 'B1',
  };

  it('parses a valid evaluation result', () => {
    const result = EvaluationResultSchema.parse(validEvaluation);
    expect(result.score).toBe(0.85);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].type).toBe('grammar');
  });

  it('accepts empty errors array', () => {
    const data = { ...validEvaluation, errors: [] };
    const result = EvaluationResultSchema.parse(data);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects score out of range', () => {
    expect(() =>
      EvaluationResultSchema.parse({ ...validEvaluation, score: 1.5 }),
    ).toThrow();
    expect(() =>
      EvaluationResultSchema.parse({ ...validEvaluation, score: -0.1 }),
    ).toThrow();
  });

  it('rejects invalid error type', () => {
    const data = {
      ...validEvaluation,
      errors: [{ ...validEvaluation.errors[0], type: 'unknown' }],
    };
    expect(() => EvaluationResultSchema.parse(data)).toThrow();
  });

  it('rejects invalid error severity', () => {
    const data = {
      ...validEvaluation,
      errors: [{ ...validEvaluation.errors[0], severity: 'critical' }],
    };
    expect(() => EvaluationResultSchema.parse(data)).toThrow();
  });
});

describe('ApiErrorSchema', () => {
  it('parses a valid error response', () => {
    const data = {
      error: 'Not found',
      code: 'NOT_FOUND',
    };
    const result = ApiErrorSchema.parse(data);
    expect(result.error).toBe('Not found');
    expect(result.code).toBe('NOT_FOUND');
    expect(result.details).toBeUndefined();
  });

  it('parses error with details', () => {
    const data = {
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: { field: 'answer', message: 'required' },
    };
    const result = ApiErrorSchema.parse(data);
    expect(result.details).toEqual({ field: 'answer', message: 'required' });
  });

  it('rejects missing required fields', () => {
    expect(() => ApiErrorSchema.parse({ error: 'oops' })).toThrow();
    expect(() => ApiErrorSchema.parse({ code: 'ERR' })).toThrow();
  });
});
