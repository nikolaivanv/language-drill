import { describe, it, expect } from 'vitest';
import { ActivitySessionListItemSchema, ActivitySessionDetailSchema, ActivityFailureItemSchema, ActivityRosterItemSchema } from './admin-activity';

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

describe('ActivityFailureItemSchema', () => {
  it('parses a failure row', () => {
    const parsed = ActivityFailureItemSchema.parse({
      exerciseId: 'e1', language: 'TR', difficulty: 'A2', type: 'cloze', grammarPointKey: 'tr-a2-x',
      attempts: 10, distinctUsers: 6, failRate: 0.7, avgScore: 0.31, qualityScore: 0.8, openFlags: 1,
    });
    expect(parsed.failRate).toBeCloseTo(0.7);
  });
});

describe('ActivityRosterItemSchema', () => {
  it('parses a roster row', () => {
    const parsed = ActivityRosterItemSchema.parse({
      userId: 'u1', lastActiveAt: '2026-06-22T10:00:00Z', sessions7d: 3, sessions30d: 9,
      drills7d: 20, drills30d: 75, languages: ['TR'], avgScore30d: 0.62, aiEvents7d: 21,
    });
    expect(parsed.drills30d).toBe(75);
  });
});
