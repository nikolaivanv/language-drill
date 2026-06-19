import { describe, expect, it, vi } from 'vitest';
import type { EvaluationError, FreeWritingError } from '@language-drill/shared';
import { recordErrorObservations, freeWritingErrorsToEvaluationErrors } from './record';

const baseArgs = {
  userId: 'u1',
  language: 'TR',
  exerciseId: 'ex1',
  sessionId: 's1',
  exerciseHistoryId: 'h1',
  exerciseType: 'translation',
  hostGrammarPointKey: 'tr-a1-locative',
  occurredAt: new Date('2026-06-19T00:00:00Z'),
};

const err: EvaluationError = {
  type: 'grammar',
  severity: 'major',
  text: 'pazarda',
  correction: 'pazara',
  explanation: 'x',
};

function fakeDb() {
  const values = vi.fn().mockResolvedValue(undefined);
  return { db: { insert: vi.fn(() => ({ values })) }, values };
}

describe('freeWritingErrorsToEvaluationErrors', () => {
  it('returns [] for undefined', () => {
    expect(freeWritingErrorsToEvaluationErrors(undefined)).toEqual([]);
  });

  it('returns [] for empty array', () => {
    expect(freeWritingErrorsToEvaluationErrors([])).toEqual([]);
  });

  it('maps fields correctly including severity and note fallback', () => {
    const fwErrors: FreeWritingError[] = [
      {
        n: 1,
        severity: 'high',
        type: 'grammar',
        original: 'los niños va',
        correction: 'los niños van',
        where: '§1',
        note: 'Subject-verb agreement error',
      },
      {
        n: 2,
        severity: 'med',
        type: 'vocabulary',
        original: 'muy bonita',
        correction: 'muy hermosa',
        // note intentionally omitted to test fallback
      } as FreeWritingError,
      {
        n: 3,
        severity: 'low',
        type: 'spelling',
        original: 'accion',
        correction: 'acción',
        note: 'Missing accent mark',
      },
    ];

    const result = freeWritingErrorsToEvaluationErrors(fwErrors);

    expect(result).toHaveLength(3);

    expect(result[0]).toEqual<EvaluationError>({
      type: 'grammar',
      severity: 'major',
      text: 'los niños va',
      correction: 'los niños van',
      explanation: 'Subject-verb agreement error',
    });

    expect(result[1]).toEqual<EvaluationError>({
      type: 'vocabulary',
      severity: 'minor',
      text: 'muy bonita',
      correction: 'muy hermosa',
      explanation: '',
    });

    expect(result[2]).toEqual<EvaluationError>({
      type: 'spelling',
      severity: 'minor',
      text: 'accion',
      correction: 'acción',
      explanation: 'Missing accent mark',
    });
  });
});

describe('recordErrorObservations', () => {
  it('inserts one row per error', async () => {
    const { db, values } = fakeDb();
    await recordErrorObservations(db, { ...baseArgs, errors: [err, err] });
    expect(values).toHaveBeenCalledTimes(1);
    expect((values.mock.calls[0][0] as unknown[]).length).toBe(2);
  });

  it('does not touch the db when there are no errors', async () => {
    const { db, values } = fakeDb();
    await recordErrorObservations(db, { ...baseArgs, errors: [] });
    expect(db.insert).not.toHaveBeenCalled();
    expect(values).not.toHaveBeenCalled();
  });

  it('swallows insert failures (never throws)', async () => {
    const values = vi.fn().mockRejectedValue(new Error('db down'));
    const db = { insert: vi.fn(() => ({ values })) };
    await expect(
      recordErrorObservations(db, { ...baseArgs, errors: [err] }),
    ).resolves.toBeUndefined();
  });
});
