import { describe, it, expect } from 'vitest';
import { ActivitySessionListItemSchema, ActivitySessionDetailSchema } from './admin-activity';

describe('ActivitySessionListItemSchema', () => {
  it('parses a feed row', () => {
    const parsed = ActivitySessionListItemSchema.parse({
      sessionId: 's1', userId: 'u1', language: 'TR', difficulty: 'A2',
      exerciseCount: 8, correctCount: 2, completedAt: null, startedAt: '2026-06-22T09:00:00Z',
      signals: ['abandoned'], primarySignal: 'abandoned',
    });
    expect(parsed.primarySignal).toBe('abandoned');
  });
});

describe('ActivitySessionDetailSchema', () => {
  it('parses a detail payload with raw response passthrough', () => {
    const parsed = ActivitySessionDetailSchema.parse({
      session: { sessionId: 's1', userId: 'u1', language: 'TR', difficulty: 'A2',
        exerciseCount: 1, correctCount: 0, startedAt: '2026-06-22T09:00:00Z', completedAt: null },
      exercises: [{ exerciseId: 'e1', order: 0, type: 'cloze', content: { p: 1 }, score: 0.2,
        response: { anything: true }, evaluatedAt: '2026-06-22T09:05:00Z',
        errors: [{ errorType: 'grammar', severity: 'major', wrongText: 'x', correction: 'X', errorGrammarPointKey: null }],
        flag: null }],
    });
    expect(parsed.exercises[0].response).toEqual({ anything: true });
  });
});
