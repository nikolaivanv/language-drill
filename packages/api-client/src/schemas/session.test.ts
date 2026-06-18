import { describe, it, expect } from 'vitest';
import { ExerciseType, Language, CefrLevel } from '@language-drill/shared';
import {
  CreateSessionRequestSchema,
  CreateSessionResponseSchema,
  CompleteSessionResponseSchema,
  ResumeSessionResponseSchema,
} from './session';

describe('CreateSessionRequestSchema', () => {
  it('parses a valid create-session request', () => {
    const data = {
      language: 'EN',
      difficulty: 'B1',
      exerciseCount: 10,
    };
    const result = CreateSessionRequestSchema.parse(data);
    expect(result.language).toBe('EN');
    expect(result.difficulty).toBe('B1');
    expect(result.exerciseCount).toBe(10);
  });

  it('rejects exerciseCount = 0', () => {
    expect(() =>
      CreateSessionRequestSchema.parse({
        language: 'EN',
        difficulty: 'B1',
        exerciseCount: 0,
      }),
    ).toThrow();
  });

  it('rejects exerciseCount = 21', () => {
    expect(() =>
      CreateSessionRequestSchema.parse({
        language: 'EN',
        difficulty: 'B1',
        exerciseCount: 21,
      }),
    ).toThrow();
  });

  it('rejects non-nativeEnum language', () => {
    expect(() =>
      CreateSessionRequestSchema.parse({
        language: 'FR',
        difficulty: 'B1',
        exerciseCount: 10,
      }),
    ).toThrow();
  });
});

describe('CreateSessionResponseSchema', () => {
  it('parses a valid create-session response', () => {
    const data = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      exercises: [
        {
          id: 'abc-123',
          type: 'cloze',
          language: 'EN',
          difficulty: 'B1',
          grammarPointKey: 'es-b1-conditional',
          contentJson: { instructions: 'Fill in the blank', sentence: 'I ___ to the store' },
        },
      ],
    };
    const result = CreateSessionResponseSchema.parse(data);
    expect(result.id).toBe(data.id);
    expect(result.exercises).toHaveLength(1);
    expect(result.exercises[0].type).toBe('cloze');
  });

  it('accepts an empty exercises array', () => {
    const data = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      exercises: [],
    };
    const result = CreateSessionResponseSchema.parse(data);
    expect(result.exercises).toHaveLength(0);
  });

  it('rejects non-uuid id', () => {
    expect(() =>
      CreateSessionResponseSchema.parse({
        id: 'not-a-uuid',
        exercises: [],
      }),
    ).toThrow();
  });
});

describe('CompleteSessionResponseSchema', () => {
  it('parses a valid complete-session response', () => {
    const data = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      exerciseCount: 5,
      correctCount: 4,
      attemptedCount: 5,
      skippedCount: 0,
      durationSeconds: 240,
    };
    const result = CompleteSessionResponseSchema.parse(data);
    expect(result).toEqual(data);
  });

  it('rejects negative correctCount', () => {
    expect(() =>
      CompleteSessionResponseSchema.parse({
        id: '123e4567-e89b-12d3-a456-426614174000',
        exerciseCount: 5,
        correctCount: -1,
        attemptedCount: 5,
        skippedCount: 0,
        durationSeconds: 240,
      }),
    ).toThrow();
  });

  it('rejects non-integer durationSeconds', () => {
    expect(() =>
      CompleteSessionResponseSchema.parse({
        id: '123e4567-e89b-12d3-a456-426614174000',
        exerciseCount: 5,
        correctCount: 4,
        attemptedCount: 5,
        skippedCount: 0,
        durationSeconds: 240.5,
      }),
    ).toThrow();
  });
});

it('parses a resume-session response', () => {
  const parsed = ResumeSessionResponseSchema.parse({
    id: '11111111-1111-1111-1111-111111111111',
    exercises: [
      { id: 'e2', type: 'cloze', language: 'EN', difficulty: 'B1', grammarPointKey: null, contentJson: {} },
    ],
    attemptedExerciseIds: ['e2'],
    completedAt: null,
  });
  expect(parsed.exercises[0].id).toBe('e2');
  expect(parsed.attemptedExerciseIds).toEqual(['e2']);
  expect(parsed.completedAt).toBeNull();
});

describe('CreateSessionRequestSchema — exerciseType', () => {
  const base = {
    language: Language.ES,
    difficulty: CefrLevel.B1,
    exerciseCount: 4,
  };

  it('accepts a request without exerciseType (omitted → undefined)', () => {
    const r = CreateSessionRequestSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.exerciseType).toBeUndefined();
  });

  it('accepts a request with a valid exerciseType', () => {
    const r = CreateSessionRequestSchema.safeParse({
      ...base,
      exerciseType: ExerciseType.DICTATION,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.exerciseType).toBe(ExerciseType.DICTATION);
  });

  it('rejects an invalid exerciseType', () => {
    const r = CreateSessionRequestSchema.safeParse({
      ...base,
      exerciseType: 'not_a_type',
    });
    expect(r.success).toBe(false);
  });
});
