import { describe, it, expect } from 'vitest';
import {
  DebriefItemSchema,
  DebriefItemStatusSchema,
  DebriefResponseSchema,
} from './debrief';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const validEvaluation = {
  score: 0.85,
  grammarAccuracy: 0.9,
  vocabularyRange: 'B1',
  taskAchievement: 0.8,
  feedback: 'Solid attempt — minor verb form slip.',
  errors: [],
  estimatedCefrEvidence: 'B1',
};

const validAttemptedItem = {
  exerciseId: '11111111-1111-4111-8111-111111111111',
  type: 'cloze',
  contentJson: { instructions: 'Fill in', sentence: 'Yo ___ libros' },
  status: 'correct',
  userAnswer: 'leo',
  score: 0.95,
  evaluation: validEvaluation,
};

const validSkippedItem = {
  exerciseId: '22222222-2222-4222-8222-222222222222',
  type: 'translation',
  contentJson: {
    instructions: 'Translate',
    sourceText: 'I am hungry',
    referenceTranslation: 'tengo hambre',
  },
  status: 'skipped',
  userAnswer: null,
  score: null,
  evaluation: null,
};

const validResponse = {
  id: '00000000-0000-4000-8000-000000000000',
  language: 'ES',
  difficulty: 'B1',
  startedAt: '2026-05-04T10:00:00.000Z',
  completedAt: '2026-05-04T10:04:38.000Z',
  durationSeconds: 278,
  exerciseCount: 5,
  correctCount: 3,
  attemptedCount: 4,
  skippedCount: 1,
  items: [validAttemptedItem, validSkippedItem],
};

// ---------------------------------------------------------------------------
// DebriefItemStatusSchema
// ---------------------------------------------------------------------------

describe('DebriefItemStatusSchema', () => {
  it('accepts the three valid statuses', () => {
    expect(DebriefItemStatusSchema.parse('correct')).toBe('correct');
    expect(DebriefItemStatusSchema.parse('incorrect')).toBe('incorrect');
    expect(DebriefItemStatusSchema.parse('skipped')).toBe('skipped');
  });

  it('rejects unknown statuses', () => {
    expect(() => DebriefItemStatusSchema.parse('foo')).toThrow();
    expect(() => DebriefItemStatusSchema.parse('SKIPPED')).toThrow();
    expect(() => DebriefItemStatusSchema.parse('')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// DebriefItemSchema
// ---------------------------------------------------------------------------

describe('DebriefItemSchema', () => {
  it('parses a valid attempted (correct) item', () => {
    const result = DebriefItemSchema.parse(validAttemptedItem);
    expect(result.status).toBe('correct');
    expect(result.userAnswer).toBe('leo');
    expect(result.score).toBe(0.95);
    expect(result.evaluation).not.toBeNull();
  });

  it('parses a valid skipped item with null fields (Req 2.3)', () => {
    const result = DebriefItemSchema.parse(validSkippedItem);
    expect(result.status).toBe('skipped');
    expect(result.userAnswer).toBeNull();
    expect(result.score).toBeNull();
    expect(result.evaluation).toBeNull();
  });

  it('parses a valid incorrect item with score < CORRECT_THRESHOLD', () => {
    const item = {
      ...validAttemptedItem,
      status: 'incorrect',
      score: 0.4,
    };
    expect(() => DebriefItemSchema.parse(item)).not.toThrow();
  });

  it('rejects status: "foo"', () => {
    expect(() =>
      DebriefItemSchema.parse({ ...validAttemptedItem, status: 'foo' }),
    ).toThrow();
  });

  it('rejects userAnswer: undefined (only string or null is valid)', () => {
    expect(() =>
      DebriefItemSchema.parse({ ...validAttemptedItem, userAnswer: undefined }),
    ).toThrow();
  });

  it('rejects score < 0', () => {
    expect(() =>
      DebriefItemSchema.parse({ ...validAttemptedItem, score: -0.1 }),
    ).toThrow();
  });

  it('rejects score > 1', () => {
    expect(() =>
      DebriefItemSchema.parse({ ...validAttemptedItem, score: 1.1 }),
    ).toThrow();
  });

  it('rejects non-uuid exerciseId', () => {
    expect(() =>
      DebriefItemSchema.parse({ ...validAttemptedItem, exerciseId: 'not-a-uuid' }),
    ).toThrow();
  });

  it('rejects unknown ExerciseType', () => {
    expect(() =>
      DebriefItemSchema.parse({ ...validAttemptedItem, type: 'unknown_type' }),
    ).toThrow();
  });

  it('accepts contentJson of any shape (z.unknown())', () => {
    // The schema deliberately treats contentJson as opaque — narrowing happens
    // in the consumer via type guards. Schema-level validation just passes.
    expect(() =>
      DebriefItemSchema.parse({
        ...validAttemptedItem,
        contentJson: { foo: 'bar' },
      }),
    ).not.toThrow();
    expect(() =>
      DebriefItemSchema.parse({ ...validAttemptedItem, contentJson: null }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// DebriefResponseSchema
// ---------------------------------------------------------------------------

describe('DebriefResponseSchema', () => {
  it('parses a valid response with mixed item statuses', () => {
    const result = DebriefResponseSchema.parse(validResponse);
    expect(result.id).toBe(validResponse.id);
    expect(result.language).toBe('ES');
    expect(result.difficulty).toBe('B1');
    expect(result.items).toHaveLength(2);
    expect(result.items[0].status).toBe('correct');
    expect(result.items[1].status).toBe('skipped');
  });

  it('parses a response with an empty items array (defensive)', () => {
    const data = { ...validResponse, items: [] };
    const result = DebriefResponseSchema.parse(data);
    expect(result.items).toHaveLength(0);
  });

  it('rejects negative exerciseCount', () => {
    expect(() =>
      DebriefResponseSchema.parse({ ...validResponse, exerciseCount: -1 }),
    ).toThrow();
  });

  it('rejects negative correctCount', () => {
    expect(() =>
      DebriefResponseSchema.parse({ ...validResponse, correctCount: -1 }),
    ).toThrow();
  });

  it('rejects negative attemptedCount', () => {
    expect(() =>
      DebriefResponseSchema.parse({ ...validResponse, attemptedCount: -1 }),
    ).toThrow();
  });

  it('rejects negative skippedCount', () => {
    expect(() =>
      DebriefResponseSchema.parse({ ...validResponse, skippedCount: -1 }),
    ).toThrow();
  });

  it('rejects negative durationSeconds', () => {
    expect(() =>
      DebriefResponseSchema.parse({ ...validResponse, durationSeconds: -1 }),
    ).toThrow();
  });

  it('rejects non-integer durationSeconds', () => {
    expect(() =>
      DebriefResponseSchema.parse({ ...validResponse, durationSeconds: 1.5 }),
    ).toThrow();
  });

  it('rejects non-uuid id', () => {
    expect(() =>
      DebriefResponseSchema.parse({ ...validResponse, id: 'not-a-uuid' }),
    ).toThrow();
  });

  it('rejects non-ISO startedAt', () => {
    expect(() =>
      DebriefResponseSchema.parse({ ...validResponse, startedAt: 'yesterday' }),
    ).toThrow();
  });

  it('rejects unknown Language', () => {
    expect(() =>
      DebriefResponseSchema.parse({ ...validResponse, language: 'FR' }),
    ).toThrow();
  });

  it('rejects unknown CefrLevel', () => {
    expect(() =>
      DebriefResponseSchema.parse({ ...validResponse, difficulty: 'D1' }),
    ).toThrow();
  });

  it('rejects malformed item in items array', () => {
    expect(() =>
      DebriefResponseSchema.parse({
        ...validResponse,
        items: [{ ...validAttemptedItem, status: 'foo' }],
      }),
    ).toThrow();
  });
});
