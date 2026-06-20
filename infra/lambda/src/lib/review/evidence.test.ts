import { describe, it, expect, vi } from 'vitest';
import { CefrLevel, Language } from '@language-drill/shared';
import type { ReviewOutcome } from '@language-drill/shared';
import type { Db } from '@language-drill/db';
import {
  REVIEW_VOCAB_TYPE,
  REVIEW_GRAMMAR_TYPE,
  reviewContributingRows,
  computeMasteryDeltas,
  writeReviewLog,
} from './evidence';

const { ES, DE, TR } = Language;

// ---------------------------------------------------------------------------
// Fakes — the evidence fns take `db` as a param, so we hand them a stub whose
// `.select().from().where()` chain resolves to preset rows, and whose
// `.insert().values()` records the inserted object. The real Drizzle schema
// objects are passed as args but ignored by the stub.
// ---------------------------------------------------------------------------

type LogRow = {
  id: string;
  outcome: ReviewOutcome;
  cefrBand: CefrLevel | null;
  grammarPoints: string[];
  reviewedAt: Date;
};

function selectDb(rows: LogRow[]): Db {
  const where = vi.fn(() => Promise.resolve(rows));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return { select } as unknown as Db;
}

function insertDb(): { db: Db; values: ReturnType<typeof vi.fn> } {
  const values = vi.fn(() => ({ returning: () => Promise.resolve([{ id: 'log-1' }]) }));
  const insert = vi.fn(() => ({ values }));
  return { db: { insert } as unknown as Db, values };
}

const NOW = new Date('2026-01-01T00:00:00.000Z');

function logRow(overrides: Partial<LogRow> = {}): LogRow {
  return {
    id: 'row-1',
    outcome: 'correct',
    cefrBand: CefrLevel.B1,
    grammarPoints: [],
    reviewedAt: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// reviewContributingRows — score mapping + axis routing + two-row emission
// ---------------------------------------------------------------------------

describe('reviewContributingRows', () => {
  it('maps outcome → score (correct=1, partial=0.5, incorrect=0)', async () => {
    const rows = await reviewContributingRows(
      selectDb([
        logRow({ id: 'a', outcome: 'correct' }),
        logRow({ id: 'b', outcome: 'partial' }),
        logRow({ id: 'c', outcome: 'incorrect' }),
      ]),
      'user_1',
      ES,
    );
    // No grammar points → one vocab row each.
    expect(rows.map((r) => r.score)).toEqual([1, 0.5, 0]);
    expect(rows.every((r) => r.type === REVIEW_VOCAB_TYPE)).toBe(true);
  });

  it('emits a second grammar row only when grammarPoints are present (Req 9.2)', async () => {
    const rows = await reviewContributingRows(
      selectDb([
        logRow({ id: 'a', outcome: 'correct', grammarPoints: ['ablative case'] }),
        logRow({ id: 'b', outcome: 'incorrect', grammarPoints: [] }),
      ]),
      'user_1',
      TR,
    );
    const vocab = rows.filter((r) => r.type === REVIEW_VOCAB_TYPE);
    const grammar = rows.filter((r) => r.type === REVIEW_GRAMMAR_TYPE);
    expect(vocab).toHaveLength(2); // one per log row, always
    expect(grammar).toHaveLength(1); // only the row carrying a grammar point
    expect(grammar[0].score).toBe(1);
  });

  it('falls back to CEFR B1 when cefrBand is null, else uses the band', async () => {
    const rows = await reviewContributingRows(
      selectDb([
        logRow({ id: 'a', cefrBand: null }),
        logRow({ id: 'b', cefrBand: CefrLevel.A2 }),
      ]),
      'user_1',
      DE,
    );
    expect(rows[0].difficulty).toBe(CefrLevel.B1);
    expect(rows[1].difficulty).toBe(CefrLevel.A2);
  });

  it('carries reviewedAt through to evaluatedAt', async () => {
    const when = new Date('2025-12-15T08:00:00.000Z');
    const rows = await reviewContributingRows(
      selectDb([logRow({ reviewedAt: when })]),
      'user_1',
      ES,
    );
    expect(rows[0].evaluatedAt).toBe(when);
  });
});

// ---------------------------------------------------------------------------
// computeMasteryDeltas — bounded [0,1] + correct direction
// ---------------------------------------------------------------------------

describe('computeMasteryDeltas', () => {
  it('returns no deltas when the given rows carry no grammar points', async () => {
    const deltas = await computeMasteryDeltas(
      selectDb([logRow({ id: 'a', grammarPoints: [] })]),
      'user_1',
      ES,
      ['a'],
      NOW,
    );
    expect(deltas).toEqual([]);
  });

  it('shows movement from a no-evidence baseline (from=0) on a first review', async () => {
    const deltas = await computeMasteryDeltas(
      selectDb([logRow({ id: 'a', outcome: 'correct', grammarPoints: ['dative'] })]),
      'user_1',
      DE,
      ['a'],
      NOW,
    );
    expect(deltas).toHaveLength(1);
    expect(deltas[0].grammarPoint).toBe('dative');
    expect(deltas[0].from).toBe(0);
    expect(deltas[0].to).toBeGreaterThan(0);
    expect(deltas[0].to).toBeLessThanOrEqual(1);
  });

  it('raises mastery when a correct review is added (to > from)', async () => {
    const baseline = logRow({
      id: 'old',
      outcome: 'incorrect',
      grammarPoints: ['dative'],
      reviewedAt: new Date('2025-12-20T00:00:00.000Z'),
    });
    const fresh = logRow({ id: 'new', outcome: 'correct', grammarPoints: ['dative'] });
    const deltas = await computeMasteryDeltas(
      selectDb([baseline, fresh]),
      'user_1',
      DE,
      ['new'],
      NOW,
    );
    expect(deltas[0].to).toBeGreaterThan(deltas[0].from);
    expect(deltas[0].from).toBeGreaterThanOrEqual(0);
    expect(deltas[0].to).toBeLessThanOrEqual(1);
  });

  it('lowers mastery when an incorrect review is added (to < from)', async () => {
    const baseline = logRow({
      id: 'old',
      outcome: 'correct',
      grammarPoints: ['dative'],
      reviewedAt: new Date('2025-12-20T00:00:00.000Z'),
    });
    const fresh = logRow({ id: 'new', outcome: 'incorrect', grammarPoints: ['dative'] });
    const deltas = await computeMasteryDeltas(
      selectDb([baseline, fresh]),
      'user_1',
      DE,
      ['new'],
      NOW,
    );
    expect(deltas[0].to).toBeLessThan(deltas[0].from);
  });

  it('returns deltas in stable alphabetical order across multiple labels', async () => {
    const deltas = await computeMasteryDeltas(
      selectDb([logRow({ id: 'a', grammarPoints: ['zeta', 'alpha', 'mu'] })]),
      'user_1',
      ES,
      ['a'],
      NOW,
    );
    expect(deltas.map((d) => d.grammarPoint)).toEqual(['alpha', 'mu', 'zeta']);
  });

  it('excludes no-op deltas (from === to) while keeping real upward and downward moves', async () => {
    // 'moved-up': only the fresh correct row is in excludeLogIds → from=0, to>0
    // 'moved-down': existing correct baseline + fresh incorrect → to < from
    // 'unchanged': has prior evidence + fresh identical outcome so from === to
    //   (simulate by giving it prior history that is identical to what it would
    //   be with the new row: we make both rows correct so adding a second identical
    //   correct row shifts mastery by an infinitesimal amount; instead use a
    //   pair of rows that produce *exactly* the same aggregated mastery by having
    //   the excluded row be a duplicate of an existing baseline row — i.e. same
    //   id in both the row list and the exclude set, ensuring rowsForLabel minus
    //   excludeSet is empty for "unchanged-point" and the new row score exactly
    //   matches the singleton result.
    //   Simplest approach: give 'unchanged-point' only the excluded row and make
    //   the outcome produce from=0 (no prior) and to=0 (zero score → mastery=0)).
    const movedUpRow = logRow({
      id: 'up',
      outcome: 'correct',
      grammarPoints: ['moved-up'],
    });
    const movedDownBaseline = logRow({
      id: 'down-base',
      outcome: 'correct',
      grammarPoints: ['moved-down'],
      reviewedAt: new Date('2025-12-20T00:00:00.000Z'),
    });
    const movedDownFresh = logRow({
      id: 'down-fresh',
      outcome: 'incorrect',
      grammarPoints: ['moved-down'],
    });
    // 'unchanged-point': only the excluded row, with incorrect outcome
    // → from = aggregateAxisMastery([]) = 0, to = aggregateAxisMastery([incorrect]) = 0
    // so from === to === 0 → this delta should be dropped.
    const unchangedRow = logRow({
      id: 'unchanged',
      outcome: 'incorrect',
      grammarPoints: ['unchanged-point'],
    });

    const deltas = await computeMasteryDeltas(
      selectDb([movedUpRow, movedDownBaseline, movedDownFresh, unchangedRow]),
      'user_1',
      ES,
      ['up', 'down-fresh', 'unchanged'],
      NOW,
    );

    expect(deltas.map((d) => d.grammarPoint)).not.toContain('unchanged-point');
    expect(deltas.find((d) => d.grammarPoint === 'moved-up')).toBeTruthy();
    expect(deltas.find((d) => d.grammarPoint === 'moved-down')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// writeReviewLog — column mapping + defaults
// ---------------------------------------------------------------------------

describe('writeReviewLog', () => {
  it('inserts a row, defaulting optional columns', async () => {
    const { db, values } = insertDb();
    const id = await writeReviewLog(db, {
      userId: 'user_1',
      language: ES,
      reviewStateId: 'state-1',
      lemma: 'gato',
      itemType: 'cloze',
      outcome: 'correct',
      rating: 3,
    });
    expect(id).toBe('log-1'); // returns the inserted row id
    expect(values).toHaveBeenCalledTimes(1);
    const inserted = values.mock.calls[0][0];
    expect(inserted).toMatchObject({
      userId: 'user_1',
      language: ES,
      reviewStateId: 'state-1',
      lemma: 'gato',
      itemType: 'cloze',
      outcome: 'correct',
      rating: 3,
      sessionId: null,
      surface: null,
      cefrBand: null,
      grammarPoints: [],
    });
    // reviewedAt omitted → relies on the column default, not sent explicitly.
    expect(inserted).not.toHaveProperty('reviewedAt');
  });

  it('forwards provided optional columns verbatim', async () => {
    const { db, values } = insertDb();
    const when = new Date('2026-01-02T00:00:00.000Z');
    await writeReviewLog(db, {
      userId: 'user_1',
      language: TR,
      reviewStateId: 'state-2',
      sessionId: 'sess-1',
      lemma: 'ev',
      itemType: 'meaning',
      surface: 'evler',
      outcome: 'partial',
      rating: 2,
      cefrBand: CefrLevel.A2,
      grammarPoints: ['plural'],
      reviewedAt: when,
    });
    expect(values.mock.calls[0][0]).toMatchObject({
      sessionId: 'sess-1',
      surface: 'evler',
      cefrBand: CefrLevel.A2,
      grammarPoints: ['plural'],
      reviewedAt: when,
    });
  });
});
