import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import {
  Rating,
  applyReview,
  deriveLifecycleState,
  initCard,
  serializeCard,
} from '../lib/review/scheduler';

// ---------------------------------------------------------------------------
// Stateful in-memory db fake
// ---------------------------------------------------------------------------
// The review router exercises many chains across four tables. Rather than
// sequence per-call mocks, we keep small in-memory stores and route each query
// by a `__table` discriminator on the mocked schema objects + the projection
// shape. WHERE/ORDER BY/LIMIT args are ignored (the happy path operates on a
// single card + single session, so set-scoping is unambiguous); the real
// scheduler / grading / evidence / queue logic runs unmocked. This is a
// route-level integration test of behaviour, not of SQL filter correctness.
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
const H = vi.hoisted(() => {
  const S = {
    stateRows: [] as any[],
    vocabRows: [] as any[],
    logRows: [] as any[],
    sessionRows: [] as any[],
    inserts: [] as string[],
  };
  let idc = 0;
  // UUID-shaped so `z.string().uuid()` body validators accept generated ids.
  const genId = () => `00000000-0000-4000-8000-${String((idc += 1)).padStart(12, '0')}`;

  const resolve = (ctx: any): any[] => {
    const t = ctx.table.__table;
    const proj = ctx.proj;
    if (t === 'uv') {
      if (ctx.distinct) {
        return [...new Set(S.vocabRows.map((r) => r.lemma))].map((lemma) => ({ lemma }));
      }
      return S.vocabRows;
    }
    if (t === 'state') {
      if (proj && 'next' in proj) {
        const now = Date.now();
        const due = S.stateRows
          .filter(
            (r) => r.state !== 'suspended' && r.state !== 'known' && r.dueAt.getTime() > now,
          )
          .map((r) => r.dueAt.getTime());
        return [{ next: due.length ? new Date(Math.min(...due)) : null }];
      }
      if (proj && 'lemma' in proj) {
        return [...new Set(S.stateRows.map((r) => r.lemma))].map((lemma) => ({ lemma }));
      }
      return S.stateRows;
    }
    if (t === 'log') {
      if (proj && 'first' in proj) {
        const groups = new Map<string, Date>();
        for (const r of S.logRows) {
          const cur = groups.get(r.reviewStateId);
          if (!cur || r.reviewedAt < cur) groups.set(r.reviewStateId, r.reviewedAt);
        }
        return [...groups].map(([stateId, first]) => ({ stateId, first }));
      }
      return S.logRows;
    }
    if (t === 'sessions') return S.sessionRows;
    return [];
  };

  const makeResult = (rows: any[]): any => {
    const p: any = Promise.resolve(rows);
    p.orderBy = () => Promise.resolve(rows);
    p.groupBy = () => Promise.resolve(rows);
    p.limit = () => Promise.resolve(rows);
    return p;
  };

  const chain = (ctx: any): any => ({
    from(table: any) {
      ctx.table = table;
      return this;
    },
    where() {
      return makeResult(resolve(ctx));
    },
  });

  const db = {
    select: (proj?: any) => chain({ proj, distinct: false }),
    selectDistinct: (proj?: any) => chain({ proj, distinct: true }),
    insert: (table: any) => ({
      values(rows: any) {
        S.inserts.push(table.__table);
        const arr = Array.isArray(rows) ? rows : [rows];
        const assigned = arr.map((r) => {
          const id = r.id ?? genId();
          const row = { ...r, id };
          if (table.__table === 'state') S.stateRows.push(row);
          else if (table.__table === 'log') S.logRows.push(row);
          else if (table.__table === 'sessions') {
            S.sessionRows.push({ completedAt: null, startedAt: new Date(), ...row });
          }
          return { id };
        });
        return {
          onConflictDoNothing: () => Promise.resolve(),
          returning: () => Promise.resolve(assigned),
        };
      },
    }),
    update: (table: any) => ({
      set: (vals: any) => ({
        where: () => {
          if (table.__table === 'state' && S.stateRows[0]) Object.assign(S.stateRows[0], vals);
          if (table.__table === 'sessions' && S.sessionRows[0]) {
            Object.assign(S.sessionRows[0], vals);
          }
          return Promise.resolve();
        },
      }),
    }),
    delete: () => ({ where: () => Promise.resolve() }),
  };

  return { S, db };
});
/* eslint-enable @typescript-eslint/no-explicit-any */

vi.mock('../db', () => ({ db: H.db }));

vi.mock('@language-drill/db', () => ({
  userVocabulary: {
    __table: 'uv',
    userId: 'user_id',
    language: 'language',
    lemma: 'lemma',
    word: 'word',
    exampleSentence: 'example_sentence',
    gloss: 'gloss',
    pos: 'pos',
    cefrBand: 'cefr_band',
    frequencyRank: 'frequency_rank',
    card: 'card',
    addedAt: 'added_at',
    sourceReadEntryId: 'source_read_entry_id',
  },
  vocabularyReviewState: {
    __table: 'state',
    id: 'id',
    userId: 'user_id',
    language: 'language',
    lemma: 'lemma',
    fsrsCardJson: 'fsrs_card_json',
    stability: 'stability',
    difficulty: 'difficulty',
    reps: 'reps',
    lapses: 'lapses',
    state: 'state',
    lastReviewedAt: 'last_reviewed_at',
    dueAt: 'due_at',
  },
  vocabularyReviewLog: {
    __table: 'log',
    id: 'id',
    userId: 'user_id',
    language: 'language',
    reviewStateId: 'review_state_id',
    sessionId: 'session_id',
    lemma: 'lemma',
    itemType: 'item_type',
    surface: 'surface',
    outcome: 'outcome',
    rating: 'rating',
    cefrBand: 'cefr_band',
    grammarPoints: 'grammar_points',
    reviewedAt: 'reviewed_at',
  },
  vocabularyReviewSessions: {
    __table: 'sessions',
    id: 'id',
    userId: 'user_id',
    language: 'language',
    filter: 'filter',
    itemCount: 'item_count',
    startedAt: 'started_at',
    completedAt: 'completed_at',
  },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyJson = Record<string, any>;

const authEnv = {
  event: { requestContext: { authorizer: { jwt: { claims: { sub: 'user_1' } } } } },
};

const DEEP_CARD = {
  type: 'word',
  surface: 'gato',
  lemma: 'gato',
  pos: 'noun',
  contextualSense: 'cat (the animal)',
  definition: 'a small domesticated feline',
  definitionLabel: 'noun',
  cefr: 'B1',
  freq: 1000,
  morphology: {
    root: 'gat',
    rootGloss: 'cat',
    segments: [{ morph: 'gato', function: 'subject' }],
    whyThisForm: 'nominative singular',
  },
};

function seedCard() {
  const D = new Date('2020-01-01T00:00:00.000Z');
  // A card reviewed once (Good) so it sits in `learning` and is due in the past.
  const { next } = applyReview(initCard(D), Rating.Good, D);
  H.S.vocabRows.push({
    id: 'uv-1',
    userId: 'user_1',
    language: 'ES',
    word: 'gato',
    lemma: 'gato',
    source: 'reading',
    pos: 'noun',
    gloss: 'cat',
    exampleSentence: 'El gato duerme en el sofá.',
    frequencyRank: 1000,
    cefrBand: 'B1',
    card: DEEP_CARD,
    addedAt: D,
  });
  H.S.stateRows.push({
    id: 'state-gato',
    userId: 'user_1',
    language: 'ES',
    lemma: 'gato',
    fsrsCardJson: serializeCard(next),
    stability: next.stability,
    difficulty: next.difficulty,
    reps: next.reps,
    lapses: next.lapses,
    state: deriveLifecycleState(next),
    lastReviewedAt: D,
    dueAt: next.due,
  });
}

function post(app: Hono, path: string, body: unknown) {
  return app.request(
    path,
    { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } },
    authEnv,
  );
}

describe('review router — happy path', () => {
  let app: Hono;

  beforeEach(async () => {
    vi.clearAllMocks();
    H.S.stateRows.length = 0;
    H.S.vocabRows.length = 0;
    H.S.logRows.length = 0;
    H.S.sessionRows.length = 0;
    H.S.inserts.length = 0;
    const mod = await import('./review');
    app = new Hono();
    app.route('/', mod.default);
  });

  it('POST /sessions → submit each item type → summary, with persistence + deltas and no usage_events', async () => {
    seedCard();

    // --- start session ---------------------------------------------------
    const sessionRes = await post(app, '/review/sessions', { language: 'ES' });
    expect(sessionRes.status).toBe(200);
    const sessionBody = (await sessionRes.json()) as AnyJson;
    expect(typeof sessionBody.sessionId).toBe('string');
    expect(sessionBody.items).toHaveLength(1);
    const sessionId = sessionBody.sessionId;

    // --- submit cloze (carries the grammar point) ------------------------
    const clozeRes = await post(app, '/review/items/state-gato/submit', {
      itemType: 'cloze',
      answer: 'gato',
      surface: 'gato',
      sessionId,
    });
    expect(clozeRes.status).toBe(200);
    const cloze = (await clozeRes.json()) as AnyJson;
    expect(cloze.outcome).toBe('correct');
    expect(cloze.correctAnswer).toBe('gato');
    expect(cloze.schedulerDelta.stateFrom).toBeDefined();
    // "what moved": the cloze occurrence's grammar point advances from 0.
    expect(cloze.masteryDeltas).toHaveLength(1);
    expect(cloze.masteryDeltas[0].grammarPoint).toBe('subject');
    expect(cloze.masteryDeltas[0].to).toBeGreaterThan(cloze.masteryDeltas[0].from);

    // --- submit meaning + recognition ------------------------------------
    const meaningRes = await post(app, '/review/items/state-gato/submit', {
      itemType: 'meaning',
      answer: 'gato',
      sessionId,
    });
    expect(meaningRes.status).toBe(200);
    expect(((await meaningRes.json()) as AnyJson).outcome).toBe('correct');

    const recogRes = await post(app, '/review/items/state-gato/submit', {
      itemType: 'recognition',
      answer: 'cat',
      sessionId,
    });
    expect(recogRes.status).toBe(200);
    expect(((await recogRes.json()) as AnyJson).outcome).toBe('correct');

    // --- persistence: state advanced, three log rows written -------------
    expect(H.S.logRows).toHaveLength(3);
    expect(H.S.stateRows[0].reps).toBe(4); // 1 seeded + 3 reviews
    expect(H.S.stateRows[0].lastReviewedAt).toBeInstanceOf(Date);

    // --- no usage_events written on the local-graded path (Req 8.3) ------
    expect(H.S.inserts.every((t) => ['sessions', 'log', 'state'].includes(t))).toBe(true);
    expect(H.S.inserts.filter((t) => t === 'log')).toHaveLength(3);

    // --- summary ---------------------------------------------------------
    const summaryRes = await app.request(
      `/review/sessions/${sessionId}/summary`,
      undefined,
      authEnv,
    );
    expect(summaryRes.status).toBe(200);
    const summary = (await summaryRes.json()) as AnyJson;
    expect(summary.total).toBe(3);
    expect(summary.correct).toBe(3);
    expect(summary.partial).toBe(0);
    expect(summary.missed).toBe(0);
    expect(summary.items).toHaveLength(3);
    expect(summary.promoted).toContain('gato'); // Good rating → promoted
    expect(summary.grammarDeltas).toHaveLength(1);
    expect(summary.grammarDeltas[0].grammarPoint).toBe('subject');
    expect(typeof summary.nextDueAt).toBe('string'); // advanced into the future
    expect(summary.durationSeconds).toBeGreaterThanOrEqual(0);
  });

  it('returns 403 when submitting against another user’s card', async () => {
    seedCard();
    H.S.stateRows[0].userId = 'other_user';

    const res = await post(app, '/review/items/state-gato/submit', {
      itemType: 'meaning',
      answer: 'gato',
    });
    expect(res.status).toBe(403);
    expect(H.S.logRows).toHaveLength(0); // no evidence written
  });

  it('returns 404 for an unknown card', async () => {
    // No seed → state select resolves empty.
    const res = await post(app, '/review/items/missing/submit', {
      itemType: 'meaning',
      answer: 'gato',
    });
    expect(res.status).toBe(404);
  });
});
