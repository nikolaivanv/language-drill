import { describe, expect, it, vi } from 'vitest';
import type { EvaluationError } from '@language-drill/shared';
import { recordErrorObservations } from './record';

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
