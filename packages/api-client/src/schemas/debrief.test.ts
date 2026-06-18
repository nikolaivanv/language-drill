import { describe, it, expect } from 'vitest';
import { ExerciseType } from '@language-drill/shared';
import {
  DebriefItemSchema,
  DebriefItemStatusSchema,
  DebriefResponseSchema,
} from './debrief';

const dictationResult = {
  kind: 'dictation',
  score: 0.82, grammarAccuracy: 0.82, vocabularyRange: 'B1',
  taskAchievement: 0.9, feedback: 'Good ear.', errors: [], estimatedCefrEvidence: 'B1',
  rawCharAccuracy: 0.8, adjustedCharAccuracy: 0.82, wordAccuracy: 0.9, listeningCefr: 'B1',
  headline: 'Casi perfecto', summary: 'Solo un desliz.',
  diff: [{ kind: 'match', text: 'Hola' }],
  differences: [{ id: 1, kind: 'error', category: 'word boundary', severity: 'low', got: 'a', expected: 'b', note: 'n' }],
  criteria: [{ id: 'phon', label: 'Phoneme discrimination', score: 0.8, cefr: 'B1', note: 'n' }],
};

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
  submissionId: '33333333-3333-4333-8333-333333333333',
  type: 'cloze',
  grammarPointKey: 'es-b1-conditional',
  contentJson: { instructions: 'Fill in', sentence: 'Yo ___ libros' },
  status: 'correct',
  userAnswer: 'leo',
  score: 0.95,
  evaluation: validEvaluation,
};

const validSkippedItem = {
  exerciseId: '22222222-2222-4222-8222-222222222222',
  submissionId: null,
  type: 'translation',
  grammarPointKey: null,
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
    expect(result.grammarPointKey).toBe('es-b1-conditional');
  });

  it('parses submissionId (history id) on an attempted item', () => {
    const result = DebriefItemSchema.parse(validAttemptedItem);
    expect(result.submissionId).toBe('33333333-3333-4333-8333-333333333333');
  });

  it('accepts a null submissionId on skipped items', () => {
    const result = DebriefItemSchema.parse(validSkippedItem);
    expect(result.submissionId).toBeNull();
  });

  it('requires submissionId field (nullable, not optional)', () => {
    const { submissionId: _omitted, ...withoutId } = validAttemptedItem;
    expect(() => DebriefItemSchema.parse(withoutId)).toThrow();
  });

  it('rejects a non-uuid submissionId', () => {
    expect(() =>
      DebriefItemSchema.parse({ ...validAttemptedItem, submissionId: 'not-a-uuid' }),
    ).toThrow();
  });

  it('accepts a null grammarPointKey on grammar-agnostic items', () => {
    const result = DebriefItemSchema.parse(validSkippedItem);
    expect(result.grammarPointKey).toBeNull();
  });

  it('requires grammarPointKey field (nullable, not optional)', () => {
    const { grammarPointKey: _omitted, ...withoutKey } = validAttemptedItem;
    expect(() => DebriefItemSchema.parse(withoutKey)).toThrow();
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

  it('preserves dictation-specific fields in evaluation', () => {
    const item = {
      exerciseId: '11111111-1111-1111-1111-111111111111',
      submissionId: '44444444-4444-4444-8444-444444444444',
      type: ExerciseType.DICTATION, grammarPointKey: 'es-b1-dictation',
      contentJson: {}, status: 'incorrect', userAnswer: 'Hola',
      score: 0.82, evaluation: dictationResult,
    };
    const parsed = DebriefItemSchema.parse(item);
    expect(parsed.evaluation).toMatchObject({
      kind: 'dictation',
      diff: [{ kind: 'match', text: 'Hola' }],
      criteria: [{ id: 'phon' }],
    });
  });

  it('still accepts a plain EvaluationResult and null', () => {
    const evalResult = { score: 0.7, grammarAccuracy: 0.7, vocabularyRange: 'B1', taskAchievement: 0.7, feedback: 'ok', errors: [], estimatedCefrEvidence: 'B1' };
    const base = { exerciseId: '11111111-1111-1111-1111-111111111111', submissionId: '55555555-5555-4555-8555-555555555555', type: ExerciseType.CLOZE, grammarPointKey: null, contentJson: {}, status: 'correct', userAnswer: 'x', score: 0.7 };
    expect(DebriefItemSchema.parse({ ...base, evaluation: evalResult }).evaluation).toMatchObject({ score: 0.7 });
    expect(DebriefItemSchema.parse({ ...base, evaluation: null, status: 'skipped', userAnswer: null, score: null }).evaluation).toBeNull();
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

// ---------------------------------------------------------------------------
// DebriefResponseSchema — skillMovements field
// ---------------------------------------------------------------------------

const base = {
  id: '00000000-0000-0000-0000-000000000000',
  language: 'ES',
  difficulty: 'B2',
  startedAt: '2026-06-16T04:00:00.000Z',
  completedAt: '2026-06-16T04:10:00.000Z',
  durationSeconds: 600,
  exerciseCount: 3,
  correctCount: 2,
  attemptedCount: 3,
  skippedCount: 0,
  items: [],
};

describe('DebriefResponseSchema skillMovements', () => {
  it('accepts a response carrying banded skillMovements', () => {
    const parsed = DebriefResponseSchema.parse({
      ...base,
      skillMovements: [
        { grammarPointKey: 'es-b2-x', label: 'X', band: 'gain', confidence: 'high' },
      ],
    });
    expect(parsed.skillMovements).toHaveLength(1);
  });

  it('defaults skillMovements to [] when omitted (back-compat)', () => {
    expect(DebriefResponseSchema.parse(base).skillMovements).toEqual([]);
  });
});
