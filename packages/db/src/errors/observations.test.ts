import { describe, expect, it } from 'vitest';
import type { EvaluationError } from '@language-drill/shared';
import {
  backfillRowsFor,
  errorObservationsFromEvaluation,
  type ErrorObservationContext,
} from './observations';

const ctx: ErrorObservationContext = {
  userId: 'u1',
  language: 'TR',
  exerciseId: 'ex1',
  sessionId: 's1',
  exerciseHistoryId: 'h1',
  exerciseType: 'translation',
  hostGrammarPointKey: 'tr-a1-locative',
  occurredAt: new Date('2026-06-19T00:00:00Z'),
};

const err = (over: Partial<EvaluationError> = {}): EvaluationError => ({
  type: 'grammar',
  severity: 'major',
  text: 'pazarda',
  correction: 'pazara',
  explanation: 'dative marks destination',
  ...over,
});

describe('errorObservationsFromEvaluation', () => {
  it('returns [] for undefined or empty errors', () => {
    expect(errorObservationsFromEvaluation(undefined, ctx)).toEqual([]);
    expect(errorObservationsFromEvaluation([], ctx)).toEqual([]);
  });

  it('maps each error to a row carrying context + null error point', () => {
    const rows = errorObservationsFromEvaluation([err(), err({ type: 'spelling', severity: 'minor' })], ctx);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      userId: 'u1',
      language: 'TR',
      exerciseId: 'ex1',
      sessionId: 's1',
      exerciseHistoryId: 'h1',
      exerciseType: 'translation',
      hostGrammarPointKey: 'tr-a1-locative',
      errorGrammarPointKey: null,
      errorType: 'grammar',
      severity: 'major',
      wrongText: 'pazarda',
      correction: 'pazara',
      occurredAt: ctx.occurredAt,
    });
    expect(rows[1].errorType).toBe('spelling');
    expect(rows[1].severity).toBe('minor');
  });
});

describe('backfillRowsFor', () => {
  const histRow = {
    userId: 'u1',
    language: 'TR',
    exerciseId: 'ex1',
    sessionId: 's1',
    historyId: 'h1',
    exerciseType: 'translation',
    hostGrammarPointKey: 'tr-a1-locative',
    evaluatedAt: new Date('2026-06-19T00:00:00Z'),
    responseJson: { userAnswer: 'x', evaluation: { errors: [err()] } },
  };

  it('extracts rows from response_json.evaluation.errors', () => {
    const rows = backfillRowsFor(histRow, new Set());
    expect(rows).toHaveLength(1);
    expect(rows[0].exerciseHistoryId).toBe('h1');
    expect(rows[0].wrongText).toBe('pazarda');
  });

  it('skips history rows already observed (idempotency)', () => {
    expect(backfillRowsFor(histRow, new Set(['h1']))).toEqual([]);
  });

  it('returns [] when response_json has no errors array', () => {
    expect(backfillRowsFor({ ...histRow, responseJson: { userAnswer: 'x' } }, new Set())).toEqual([]);
    expect(backfillRowsFor({ ...histRow, responseJson: null }, new Set())).toEqual([]);
    expect(backfillRowsFor({ ...histRow, responseJson: { evaluation: { errors: 'oops' } } }, new Set())).toEqual([]);
  });
});
