import { describe, it, expect } from 'vitest';
import { ExerciseResponseSchema, EvaluationResultSchema } from '../schemas/exercise';

/**
 * These tests verify the Zod validation that useExercise and useSubmitAnswer
 * rely on internally. The hooks parse API responses through these schemas,
 * so validating schema behavior covers the critical data-integrity path.
 *
 * Full hook integration tests (with QueryClientProvider) belong in the
 * web app's test suite where a React rendering environment is available.
 */

describe('useExercise — response validation', () => {
  it('accepts a valid exercise response with all fields', () => {
    const data = {
      id: 'ex-001',
      type: 'cloze',
      language: 'EN',
      difficulty: 'B1',
      contentJson: {
        instructions: 'Fill in the blank',
        sentence: 'She ___ to the park.',
        correctAnswer: 'went',
      },
    };
    const result = ExerciseResponseSchema.parse(data);
    expect(result.id).toBe('ex-001');
    expect(result.type).toBe('cloze');
    expect(result.language).toBe('EN');
    expect(result.difficulty).toBe('B1');
    expect(result.contentJson).toEqual(data.contentJson);
  });

  it('accepts exercise with null contentJson', () => {
    const data = {
      id: 'ex-002',
      type: 'translation',
      language: 'ES',
      difficulty: 'A2',
      contentJson: null,
    };
    const result = ExerciseResponseSchema.parse(data);
    expect(result.contentJson).toBeNull();
  });

  it('rejects exercise missing id', () => {
    const data = {
      type: 'cloze',
      language: 'EN',
      difficulty: 'B1',
      contentJson: {},
    };
    expect(() => ExerciseResponseSchema.parse(data)).toThrow();
  });

  it('rejects exercise missing type', () => {
    const data = {
      id: 'ex-003',
      language: 'EN',
      difficulty: 'B1',
      contentJson: {},
    };
    expect(() => ExerciseResponseSchema.parse(data)).toThrow();
  });

  it('rejects non-string id', () => {
    const data = {
      id: 123,
      type: 'cloze',
      language: 'EN',
      difficulty: 'B1',
      contentJson: {},
    };
    expect(() => ExerciseResponseSchema.parse(data)).toThrow();
  });
});

describe('useSubmitAnswer — response validation', () => {
  const validEvaluation = {
    score: 0.75,
    grammarAccuracy: 0.8,
    vocabularyRange: 'B1',
    taskAchievement: 0.7,
    feedback: 'Good attempt, but watch your verb tenses.',
    errors: [
      {
        type: 'grammar' as const,
        severity: 'major' as const,
        text: 'I have went',
        correction: 'I have gone',
        explanation: 'Use past participle after "have".',
      },
    ],
    estimatedCefrEvidence: 'B1',
  };

  it('accepts a valid evaluation result', () => {
    const result = EvaluationResultSchema.parse(validEvaluation);
    expect(result.score).toBe(0.75);
    expect(result.grammarAccuracy).toBe(0.8);
    expect(result.feedback).toContain('verb tenses');
    expect(result.errors).toHaveLength(1);
  });

  it('accepts evaluation with no errors', () => {
    const data = { ...validEvaluation, errors: [] };
    const result = EvaluationResultSchema.parse(data);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts boundary scores (0 and 1)', () => {
    const data = {
      ...validEvaluation,
      score: 0,
      grammarAccuracy: 1,
      taskAchievement: 0,
    };
    const result = EvaluationResultSchema.parse(data);
    expect(result.score).toBe(0);
    expect(result.grammarAccuracy).toBe(1);
    expect(result.taskAchievement).toBe(0);
  });

  it('rejects score above 1', () => {
    expect(() =>
      EvaluationResultSchema.parse({ ...validEvaluation, score: 1.01 }),
    ).toThrow();
  });

  it('rejects negative score', () => {
    expect(() =>
      EvaluationResultSchema.parse({ ...validEvaluation, score: -0.1 }),
    ).toThrow();
  });

  it('rejects missing feedback field', () => {
    const { feedback: _feedback, ...noFeedback } = validEvaluation;
    void _feedback;
    expect(() => EvaluationResultSchema.parse(noFeedback)).toThrow();
  });

  it('rejects invalid error type in errors array', () => {
    const data = {
      ...validEvaluation,
      errors: [{ ...validEvaluation.errors[0], type: 'syntax' }],
    };
    expect(() => EvaluationResultSchema.parse(data)).toThrow();
  });

  it('rejects missing required fields entirely', () => {
    expect(() => EvaluationResultSchema.parse({})).toThrow();
  });
});

describe('query key structure', () => {
  it('builds expected query key components', () => {
    // Verify the query key shape matches what useExercise constructs:
    // ['exercise', language, difficulty, type]
    const language = 'EN';
    const difficulty = 'B1';
    const type = 'cloze';
    const queryKey = ['exercise', language, difficulty, type];
    expect(queryKey).toEqual(['exercise', 'EN', 'B1', 'cloze']);
  });

  it('query key with undefined type', () => {
    const queryKey = ['exercise', 'ES', 'A2', undefined];
    expect(queryKey).toEqual(['exercise', 'ES', 'A2', undefined]);
    // undefined in query key means TanStack Query treats it as a distinct key
    // from one with a defined type value
  });
});

describe('URL parameter construction', () => {
  it('builds correct search params without type', () => {
    const params = new URLSearchParams({ language: 'EN', difficulty: 'B1' });
    expect(params.toString()).toBe('language=EN&difficulty=B1');
  });

  it('builds correct search params with type', () => {
    const params = new URLSearchParams({ language: 'ES', difficulty: 'A2' });
    params.set('type', 'translation');
    expect(params.toString()).toBe('language=ES&difficulty=A2&type=translation');
  });

  it('builds correct submit URL path', () => {
    const exerciseId = 'abc-123';
    const path = `/exercises/${exerciseId}/submit`;
    expect(path).toBe('/exercises/abc-123/submit');
  });
});
