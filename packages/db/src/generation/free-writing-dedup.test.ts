import type Anthropic from '@anthropic-ai/sdk';
import { CefrLevel, ExerciseType, Language } from '@language-drill/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@language-drill/ai', async () => {
  const actual = await vi.importActual<typeof import('@language-drill/ai')>('@language-drill/ai');
  return { ...actual, judgeFreeWritingDuplicate: vi.fn() };
});

import { judgeFreeWritingDuplicate } from '@language-drill/ai';
import type { Db } from '../client';
import type { Cell } from './cells';
import { checkFreeWritingDuplicate, fetchFreeWritingPromptSummaries } from './free-writing-dedup';

const mockJudge = vi.mocked(judgeFreeWritingDuplicate);
const client = {} as unknown as Anthropic;

const cell: Cell = {
  language: Language.ES,
  cefrLevel: CefrLevel.B2,
  exerciseType: ExerciseType.FREE_WRITING,
  grammarPoint: { key: 'es-b2-fw-test' } as unknown as Cell['grammarPoint'],
  cellKey: 'es:b2:free_writing:es-b2-fw-test',
};

const fw = (title: string, task: string) => ({
  type: ExerciseType.FREE_WRITING,
  title,
  task,
  requiredElements: [{ id: 'a', label: 'Opina' }],
});

/** Select chain `.from().where().orderBy().limit()` resolving to `rows`; counts calls. */
function makeDb(rows: Array<{ contentJson: unknown }>, calls = { n: 0 }): Db {
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => {
      calls.n++;
      return Promise.resolve(rows);
    },
  };
  return { select: () => chain } as unknown as Db;
}

const USAGE = { inputTokens: 50, outputTokens: 5, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };

beforeEach(() => mockJudge.mockReset());

describe('fetchFreeWritingPromptSummaries', () => {
  it('summarizes rows and skips malformed ones', async () => {
    const out = await fetchFreeWritingPromptSummaries(
      makeDb([{ contentJson: fw('A', 'Task A.') }, { contentJson: { type: 'free_writing', title: 'no task' } }, { contentJson: null }]),
      cell,
    );
    expect(out).toEqual([{ title: 'A', task: 'Task A.', requiredElements: ['Opina'] }]);
  });
});

describe('checkFreeWritingDuplicate', () => {
  it('returns distinct when the judge finds no duplicate', async () => {
    mockJudge.mockResolvedValue({ result: { duplicateOf: null, reason: 'new essay' }, tokenUsage: USAGE });
    const out = await checkFreeWritingDuplicate(makeDb([{ contentJson: fw('A', 'Task A.') }]), client, cell, fw('B', 'Task B.'));
    expect(out).toEqual({ status: 'distinct', detail: 'new essay', usage: USAGE });
    expect(mockJudge.mock.calls[0][1].cefrLevel).toBe('B2');
  });

  it('returns duplicate naming the matched title', async () => {
    mockJudge.mockResolvedValue({ result: { duplicateOf: 0, reason: 'same essay' }, tokenUsage: USAGE });
    const out = await checkFreeWritingDuplicate(makeDb([{ contentJson: fw('A', 'Task A.') }]), client, cell, fw('B', 'Task A again.'));
    expect(out.status).toBe('duplicate');
    expect(out.detail).toContain('"A"');
    expect(out.usage).toEqual(USAGE);
  });

  it('re-reads the pool on every call (sees same-batch inserts)', async () => {
    mockJudge.mockResolvedValue({ result: { duplicateOf: null, reason: '' }, tokenUsage: USAGE });
    const calls = { n: 0 };
    const db = makeDb([{ contentJson: fw('A', 'Task A.') }], calls);
    await checkFreeWritingDuplicate(db, client, cell, fw('B', 'b'));
    await checkFreeWritingDuplicate(db, client, cell, fw('C', 'c'));
    expect(calls.n).toBe(2);
  });

  it('is unavailable on an out-of-range verdict index', async () => {
    // An out-of-range verdict index throws inside the check (the real judge throws on it
    // too; a throwing mock is reported as a test error by vitest 4 even when caught).
    mockJudge.mockResolvedValue({ result: { duplicateOf: 7, reason: 'bad index' }, tokenUsage: USAGE });
    const out = await checkFreeWritingDuplicate(makeDb([{ contentJson: fw('A', 'Task A.') }]), client, cell, fw('B', 'b'));
    expect(out.status).toBe('unavailable');
    expect(typeof out.detail).toBe('string');
    expect(out.detail.length).toBeGreaterThan(0);
  });

  it('is unavailable when the pool read throws, without calling the judge', async () => {
    const db = {
      select: () => {
        throw new Error('db down');
      },
    } as unknown as Db;
    const out = await checkFreeWritingDuplicate(db, client, cell, fw('B', 'b'));
    expect(out.status).toBe('unavailable');
    expect(mockJudge).not.toHaveBeenCalled();
  });

  it('is unavailable for a candidate with no title/task, without calling the judge', async () => {
    const out = await checkFreeWritingDuplicate(makeDb([]), client, cell, { type: 'free_writing', title: 'x' });
    expect(out.status).toBe('unavailable');
    expect(mockJudge).not.toHaveBeenCalled();
  });
});
