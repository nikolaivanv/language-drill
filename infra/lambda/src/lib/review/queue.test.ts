import { describe, it, expect, vi } from 'vitest';
import { CefrLevel, Language } from '@language-drill/shared';
import type { DeepCard, VocabReviewStatus } from '@language-drill/shared';
import { userVocabulary, vocabularyReviewLog, vocabularyReviewState } from '@language-drill/db';
import type { Db } from '@language-drill/db';
import {
  assembleCards,
  buildQueue,
  ensureReviewState,
  overview,
  NEW_INTAKE_CAP,
  SESSION_CEILING,
} from './queue';

const { ES } = Language;

// ---------------------------------------------------------------------------
// Fake db
// ---------------------------------------------------------------------------
// The queue fns issue several distinct chains; the fake routes each by the
// real Drizzle table object passed to `.from(...)` plus the projection shape.
// WHERE/ORDER BY/GROUP BY args are ignored (SQL-level filtering is an
// integration concern — see the router test), so each test supplies the rows a
// query would already have been scoped to.
// ---------------------------------------------------------------------------

type VRow = {
  lemma: string;
  word: string;
  exampleSentence: string;
  gloss: string;
  pos: string;
  cefrBand: CefrLevel | null;
  frequencyRank: number | null;
  card: DeepCard | null;
};

type SRow = {
  id: string;
  lemma: string;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  state: VocabReviewStatus;
  dueAt: Date;
  lastReviewedAt: Date | null;
};

interface Data {
  vocabLemmaRows?: { lemma: string }[];
  vocabRows?: VRow[];
  stateLemmaRows?: { lemma: string }[];
  stateRows?: SRow[];
  logFirstReviews?: { stateId: string; first: Date | null }[];
  nextDueRows?: { next: Date | null }[];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function resolve(data: Data, ctx: any): unknown[] {
  const { table, proj, distinct } = ctx;
  if (table === userVocabulary) {
    return distinct ? (data.vocabLemmaRows ?? []) : (data.vocabRows ?? []);
  }
  if (table === vocabularyReviewState) {
    if (proj && 'next' in proj) return data.nextDueRows ?? [];
    if (proj && 'lemma' in proj) return data.stateLemmaRows ?? [];
    return data.stateRows ?? [];
  }
  if (table === vocabularyReviewLog) return data.logFirstReviews ?? [];
  return [];
}

function makeDb(data: Data, onInsert?: (rows: any) => void): Db {
  let ctx: any = {};
  const builder: any = {
    from(table: unknown) {
      ctx.table = table;
      return builder;
    },
    where() {
      const rows = resolve(data, ctx);
      const p: any = Promise.resolve(rows);
      p.orderBy = () => Promise.resolve(rows);
      p.groupBy = () => Promise.resolve(rows);
      return p;
    },
  };
  const db: any = {
    select(proj: unknown) {
      ctx = { proj, distinct: false };
      return builder;
    },
    selectDistinct(proj: unknown) {
      ctx = { proj, distinct: true };
      return builder;
    },
    insert() {
      return {
        values(rows: any) {
          onInsert?.(rows);
          return { onConflictDoNothing: () => Promise.resolve() };
        },
      };
    },
  };
  return db as unknown as Db;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Row factories
// ---------------------------------------------------------------------------

const PAST = (i = 0) => new Date(2020, 0, 1 + i);
const FUTURE = new Date(2999, 0, 1);

function vrow(lemma: string, overrides: Partial<VRow> = {}): VRow {
  return {
    lemma,
    word: lemma,
    exampleSentence: `${lemma} en una oración.`,
    gloss: `${lemma}-gloss`,
    pos: 'noun',
    cefrBand: CefrLevel.B1,
    frequencyRank: 1000,
    card: null,
    ...overrides,
  };
}

function srow(lemma: string, overrides: Partial<SRow> = {}): SRow {
  return {
    id: `state-${lemma}`,
    lemma,
    stability: 1,
    difficulty: 5,
    reps: 1,
    lapses: 0,
    state: 'learning',
    dueAt: PAST(),
    lastReviewedAt: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// ensureReviewState
// ---------------------------------------------------------------------------

describe('ensureReviewState', () => {
  it('creates new state rows only for lemmas lacking one', async () => {
    const inserted: { lemma: string; state: string }[] = [];
    const db = makeDb(
      {
        vocabLemmaRows: [{ lemma: 'a' }, { lemma: 'b' }, { lemma: 'c' }],
        stateLemmaRows: [{ lemma: 'a' }],
      },
      (rows) => inserted.push(...rows),
    );

    await ensureReviewState(db, 'user_1', ES);

    expect(inserted.map((r) => r.lemma).sort()).toEqual(['b', 'c']);
    expect(inserted.every((r) => r.state === 'new')).toBe(true);
  });

  it('is idempotent — inserts nothing when every lemma already has state', async () => {
    const onInsert = vi.fn();
    const db = makeDb(
      { vocabLemmaRows: [{ lemma: 'a' }], stateLemmaRows: [{ lemma: 'a' }] },
      onInsert,
    );

    await ensureReviewState(db, 'user_1', ES);

    expect(onInsert).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// assembleCards
// ---------------------------------------------------------------------------

describe('assembleCards', () => {
  it('returns [] for an explicit empty lemma filter (no query)', async () => {
    const db = makeDb({});
    expect(await assembleCards(db, 'user_1', ES, [])).toEqual([]);
  });

  it('builds one card per lemma joined to its state, skipping stateless lemmas', async () => {
    const db = makeDb({
      vocabRows: [vrow('a'), vrow('b')],
      stateRows: [srow('a')], // 'b' has no state row
    });
    const cards = await assembleCards(db, 'user_1', ES);
    expect(cards.map((c) => c.lemma)).toEqual(['a']);
    expect(cards[0].occurrences).toHaveLength(1);
    expect(cards[0].language).toBe('ES');
  });
});

// ---------------------------------------------------------------------------
// buildQueue
// ---------------------------------------------------------------------------

describe('buildQueue — new-intake cap (Req 3.2)', () => {
  const newCards = Array.from({ length: 8 }, (_, i) => `n${i}`);

  it('caps new intake to the daily limit, counting introductions from the log', async () => {
    const db = makeDb({
      vocabRows: newCards.map((l) => vrow(l)),
      stateRows: newCards.map((l) => srow(l, { state: 'new', reps: 0, dueAt: PAST() })),
      // Three cards already introduced today → only 2 of the 5/day remain.
      logFirstReviews: [
        { stateId: 'state-x', first: new Date() },
        { stateId: 'state-y', first: new Date() },
        { stateId: 'state-z', first: new Date() },
      ],
    });

    const { items, breakdown } = await buildQueue(db, 'user_1', ES, 'all');
    expect(breakdown.new).toBe(2);
    expect(items).toHaveLength(2);
    expect(breakdown.due).toBe(0);
  });

  it('allows the full daily cap when the log is empty', async () => {
    const db = makeDb({
      vocabRows: newCards.map((l) => vrow(l)),
      stateRows: newCards.map((l) => srow(l, { state: 'new', reps: 0, dueAt: PAST() })),
      logFirstReviews: [],
    });
    const { breakdown } = await buildQueue(db, 'user_1', ES, 'all');
    expect(breakdown.new).toBe(NEW_INTAKE_CAP);
  });
});

describe('buildQueue — ceiling + ordering (Req 3.4, 3.6)', () => {
  it('caps to the session ceiling, most-overdue first', async () => {
    const lemmas = Array.from({ length: 25 }, (_, i) => `L${i}`);
    const db = makeDb({
      vocabRows: lemmas.map((l) => vrow(l)),
      // L0 is the most overdue (oldest dueAt), L24 the least.
      stateRows: lemmas.map((l, i) => srow(l, { dueAt: PAST(i) })),
      logFirstReviews: [],
    });

    const { items, breakdown } = await buildQueue(db, 'user_1', ES, 'all');
    expect(items).toHaveLength(SESSION_CEILING);
    expect(breakdown.due).toBe(25);
    expect(breakdown.total).toBe(SESSION_CEILING);
    expect(items[0].lemma).toBe('L0'); // most overdue first
    // The five least-overdue cards are dropped by the ceiling.
    const queued = new Set(items.map((it) => it.lemma));
    for (const l of ['L20', 'L21', 'L22', 'L23', 'L24']) {
      expect(queued.has(l)).toBe(false);
    }
  });
});

describe('buildQueue — filters (Req 3.6)', () => {
  function mixedData(): Data {
    return {
      vocabRows: [vrow('new1'), vrow('due1'), vrow('due2'), vrow('leech1'), vrow('susp1')],
      stateRows: [
        srow('new1', { state: 'new', reps: 0 }),
        srow('due1'),
        srow('due2'),
        srow('leech1', { state: 'leech', lapses: 3 }),
        srow('susp1', { state: 'suspended' }),
      ],
      logFirstReviews: [],
    };
  }

  it('new filter returns only capped new cards', async () => {
    const { items, breakdown } = await buildQueue(makeDb(mixedData()), 'user_1', ES, 'new');
    expect(items.map((i) => i.lemma)).toEqual(['new1']);
    expect(breakdown.new).toBe(1);
  });

  it('leech filter returns only leech cards (excludes suspended)', async () => {
    const { items } = await buildQueue(makeDb(mixedData()), 'user_1', ES, 'leech');
    expect(items.map((i) => i.lemma)).toEqual(['leech1']);
  });

  it('excludes suspended/known from the default queue (Req 3.3)', async () => {
    const { items } = await buildQueue(makeDb(mixedData()), 'user_1', ES, 'all');
    const lemmas = items.map((i) => i.lemma);
    expect(lemmas).not.toContain('susp1');
    expect(lemmas).toContain('due1');
  });

  it('readEntryId filter returns an empty queue when the passage has no saved words', async () => {
    const db = makeDb({ vocabLemmaRows: [] });
    const { items, breakdown } = await buildQueue(db, 'user_1', ES, { readEntryId: 'r1' });
    expect(items).toEqual([]);
    expect(breakdown.total).toBe(0);
  });

  it('readEntryId filter builds from the passage lemmas when present', async () => {
    const db = makeDb({
      vocabLemmaRows: [{ lemma: 'a' }],
      vocabRows: [vrow('a')],
      stateRows: [srow('a')],
      logFirstReviews: [],
    });
    const { items } = await buildQueue(db, 'user_1', ES, { readEntryId: 'r1' });
    expect(items.map((i) => i.lemma)).toEqual(['a']);
  });
});

describe('buildQueue — per-language threading (Req 3.1)', () => {
  it('stamps the requested language onto queued items', async () => {
    const db = makeDb({
      vocabRows: [vrow('a')],
      stateRows: [srow('a')],
      logFirstReviews: [],
    });
    const { items } = await buildQueue(db, 'user_1', ES, 'all');
    expect(items[0].language).toBe('ES');
  });
});

// ---------------------------------------------------------------------------
// overview — empty-queue next-due (Req 3.5)
// ---------------------------------------------------------------------------

describe('overview', () => {
  it('reports an empty breakdown and the next-due timestamp when nothing is due', async () => {
    const db = makeDb({
      vocabRows: [vrow('a')],
      stateRows: [srow('a', { dueAt: FUTURE })], // not due
      logFirstReviews: [],
      nextDueRows: [{ next: FUTURE }],
    });
    const result = await overview(db, 'user_1', ES);
    expect(result.breakdown.total).toBe(0);
    expect(result.estimatedMinutes).toBe(0);
    expect(result.nextDueAt).toBe(FUTURE.toISOString());
  });

  it('estimates a non-zero session length when items are queued', async () => {
    const db = makeDb({
      vocabRows: [vrow('a'), vrow('b')],
      stateRows: [srow('a'), srow('b')],
      logFirstReviews: [],
      nextDueRows: [{ next: null }],
    });
    const result = await overview(db, 'user_1', ES);
    expect(result.breakdown.total).toBe(2);
    expect(result.estimatedMinutes).toBeGreaterThanOrEqual(1);
    expect(result.nextDueAt).toBeNull();
  });
});
