// ---------------------------------------------------------------------------
// Vocabulary Review (Part 2) — API router
// ---------------------------------------------------------------------------
// Mounts the review surface under `/review/*`, scoped to the authenticated
// user (Clerk JWT → `c.get('userId')` via `authMiddleware`, mirroring
// `routes/read.ts` and `routes/progress.ts`). Every locally-graded item is
// free + server-graded and writes NO `usage_events` row (Req 8.3).
//
// Endpoints are added in sibling tasks:
//   GET  /review/overview                 — hub counts (Req 4.1)
//   POST /review/sessions                 — start a session, queue up-front
//   POST /review/items/:stateId/submit    — graded-item hot path (local, free)
//   GET  /review/sessions/:id/summary     — end-of-session debrief
//   GET  /review/bank                     — browse one row per lemma
//   GET  /review/words/:stateId           — word detail
//   PATCH/DELETE /review/words/:stateId    — suspend / mark-known / reset / delete
//   GET  /review/active-lemmas            — reading under-review highlight source
// ---------------------------------------------------------------------------

import { Hono } from 'hono';
import { z } from 'zod';
import { and, desc, eq, inArray, min, notInArray } from 'drizzle-orm';
import { CefrLevel, Language } from '@language-drill/shared';
import {
  userVocabulary,
  vocabularyReviewLog,
  vocabularyReviewSessions,
  vocabularyReviewState,
} from '@language-drill/db';
import { db } from '../db';
import { authMiddleware } from '../middleware/auth';
import type { Bindings, Variables } from '../middleware/auth';
import { assembleCards, buildQueue, ensureReviewState, overview } from '../lib/review/queue';
import { gradeCloze, gradeMeaning, gradeRecognition } from '../lib/review/grading';
import {
  applyReview,
  deriveLifecycleState,
  initCard,
  Rating,
  ratingFromOutcome,
  rehydrateCard,
  serializeCard,
} from '../lib/review/scheduler';
import { computeMasteryDeltas, writeReviewLog } from '../lib/review/evidence';

// EN is a source-only language, never a review target — the Lambda owns its own
// ES/DE/TR-only enum (mirrors `routes/progress.ts`) so it doesn't depend on the
// api-client package.
const LearningLanguageEnum = z.enum([Language.ES, Language.DE, Language.TR]);

const OverviewQuerySchema = z.object({
  language: LearningLanguageEnum,
});

// Mirrors the server `ReviewFilter` union (queue.ts): focused-subset selectors
// for the session queue (Req 3.6, 13.1).
const ReviewFilterSchema = z.union([
  z.literal('all'),
  z.literal('new'),
  z.literal('leech'),
  z.object({ readEntryId: z.string().min(1) }),
  z.object({ grammarPoint: z.string().min(1) }),
]);

const StartSessionSchema = z.object({
  language: LearningLanguageEnum,
  filter: ReviewFilterSchema.optional(),
});

const VocabStatusEnum = z.enum([
  'new',
  'learning',
  'mature',
  'leech',
  'suspended',
  'known',
]);

const BankQuerySchema = z.object({
  language: LearningLanguageEnum,
  status: VocabStatusEnum.optional(),
  q: z.string().optional(),
});

// Cap the word-detail review history to the most recent N rows.
const WORD_HISTORY_LIMIT = 50;

const WordActionSchema = z.object({
  action: z.enum(['suspend', 'unsuspend', 'mark_known', 'reset']),
});

// Lifecycle states that eject a card from queue builds (Req 12.5).
const EJECTED_STATES = ['suspended', 'known'] as const;

const SubmitItemSchema = z.object({
  itemType: z.enum(['cloze', 'meaning', 'recognition']),
  // Empty string is allowed (a "reveal / I don't know" submit → incorrect).
  answer: z.string(),
  // cloze: the tested occurrence's surface (the expected answer key, validated
  // server-side against the card). meaning: ignored. recognition: ignored.
  surface: z.string().min(1).optional(),
  // meaning: number of progressive hints used → taints a correct answer to
  // `partial` (Req 6.3).
  hintsUsed: z.number().int().nonnegative().optional(),
  // Optional link to the owning session for the summary aggregation.
  sessionId: z.string().uuid().optional(),
});

const review = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Per-route auth: every `/review/*` method requires a valid Clerk JWT, which
// the middleware resolves to `c.get('userId')` for the handlers (Req 14.1).
review.use('/review/*', authMiddleware);

// ---------------------------------------------------------------------------
// GET /review/overview — hub counts for the active language (Req 4.1, 4.2)
// ---------------------------------------------------------------------------
// Per-language only (Req 13.4): the queue + breakdown are built for exactly the
// requested language and never blend.
review.get('/review/overview', async (c) => {
  const parsed = OverviewQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json(
      {
        error: 'Invalid query parameters',
        code: 'VALIDATION_ERROR',
        details: parsed.error.flatten(),
      },
      400,
    );
  }

  const { language } = parsed.data;
  const userId = c.get('userId');
  const result = await overview(db, userId, language);
  return c.json(result);
});

// ---------------------------------------------------------------------------
// POST /review/sessions — start a session, queue up-front (Req 10.1, 3.1, 3.6)
// ---------------------------------------------------------------------------
review.post('/review/sessions', async (c) => {
  const parsed = StartSessionSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json(
      {
        error: 'Invalid request body',
        code: 'VALIDATION_ERROR',
        details: parsed.error.flatten(),
      },
      400,
    );
  }

  const { language, filter = 'all' } = parsed.data;
  const userId = c.get('userId');

  // Back-fill `new` scheduler rows for saved lemmas, then build this language's
  // queue (Req 3.1, 13.1). buildQueue runs first so we record the real count.
  await ensureReviewState(db, userId, language);
  const { items } = await buildQueue(db, userId, language, filter);

  // `filter` jsonb is null for the default per-language queue; otherwise the
  // focused-subset selector used (design Component 3).
  const storedFilter = filter === 'all' ? null : filter;
  const [session] = await db
    .insert(vocabularyReviewSessions)
    .values({ userId, language, filter: storedFilter, itemCount: items.length })
    .returning({ id: vocabularyReviewSessions.id });

  return c.json({ sessionId: session.id, items });
});

// ---------------------------------------------------------------------------
// POST /review/items/:stateId/submit — graded-item hot path (local, free)
// ---------------------------------------------------------------------------
// Grades locally (no LLM, Req 8.1), advances the FSRS card, persists state,
// writes an evidence log row and the "what moved" deltas — and writes NO
// `usage_events` row (Req 8.3): this path is intentionally un-metered.
review.post('/review/items/:stateId/submit', async (c) => {
  const stateId = c.req.param('stateId');
  const parsed = SubmitItemSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json(
      {
        error: 'Invalid request body',
        code: 'VALIDATION_ERROR',
        details: parsed.error.flatten(),
      },
      400,
    );
  }
  const { itemType, answer, surface, hintsUsed = 0, sessionId } = parsed.data;
  const userId = c.get('userId');

  // Ownership: load the card's state row; 404 if absent, 403 if another user's
  // (no scheduler mutation, no log row — Req 8.3 / error scenario 1).
  const [state] = await db
    .select()
    .from(vocabularyReviewState)
    .where(eq(vocabularyReviewState.id, stateId))
    .limit(1);
  if (!state) {
    return c.json({ error: 'Review card not found', code: 'CARD_NOT_FOUND' }, 404);
  }
  if (state.userId !== userId) {
    return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }

  const { language, lemma } = state;
  const [card] = await assembleCards(db, userId, language, [lemma]);

  // Local grade per item type (Req 5.2, 6.2, 7.3, 8.1, 8.2).
  let outcome;
  let correctAnswer: string;
  let grammarPoints: string[] = [];
  const cefrBand: CefrLevel | null = card?.cefr ? CefrLevel[card.cefr] : null;

  if (itemType === 'cloze') {
    if (!surface) {
      return c.json({ error: 'surface is required for cloze', code: 'VALIDATION_ERROR' }, 400);
    }
    const occ = card?.occurrences.find((o) => o.surface === surface);
    outcome = gradeCloze(answer, surface, language);
    correctAnswer = surface;
    grammarPoints = occ?.grammarPoints ?? [];
  } else if (itemType === 'meaning') {
    const acceptedForms = [
      ...new Set([lemma, ...(card?.occurrences.map((o) => o.surface) ?? [])]),
    ];
    outcome = gradeMeaning(answer, acceptedForms, language, hintsUsed);
    correctAnswer = lemma;
  } else {
    correctAnswer = card?.gloss ?? lemma;
    outcome = gradeRecognition(answer, correctAnswer);
  }

  // Advance the FSRS card through the single scheduler seam (Req 5.5, 6.5, 8.4).
  const now = new Date();
  const rating = ratingFromOutcome(outcome, { hintsUsed });
  const { next, delta } = applyReview(rehydrateCard(state.fsrsCardJson), rating, now);

  await db
    .update(vocabularyReviewState)
    .set({
      fsrsCardJson: serializeCard(next),
      stability: next.stability,
      difficulty: next.difficulty,
      reps: next.reps,
      lapses: next.lapses,
      state: deriveLifecycleState(next),
      lastReviewedAt: now,
      dueAt: next.due,
    })
    .where(eq(vocabularyReviewState.id, stateId));

  // Evidence + "what moved" deltas (Req 9.4). The single just-written log id is
  // the baseline-exclusion for the per-item delta.
  const logId = await writeReviewLog(db, {
    userId,
    language,
    reviewStateId: stateId,
    sessionId: sessionId ?? null,
    lemma,
    itemType,
    surface: surface ?? null,
    outcome,
    rating,
    cefrBand,
    grammarPoints,
    reviewedAt: now,
  });
  const masteryDeltas = await computeMasteryDeltas(db, userId, language, [logId], now);

  return c.json({ outcome, correctAnswer, schedulerDelta: delta, masteryDeltas });
});

// ---------------------------------------------------------------------------
// GET /review/sessions/:id/summary — end-of-session debrief (Req 11.1–11.3)
// ---------------------------------------------------------------------------
review.get('/review/sessions/:id/summary', async (c) => {
  const sessionId = c.req.param('id');
  const userId = c.get('userId');

  const [session] = await db
    .select()
    .from(vocabularyReviewSessions)
    .where(eq(vocabularyReviewSessions.id, sessionId))
    .limit(1);
  if (!session) {
    return c.json({ error: 'Session not found', code: 'SESSION_NOT_FOUND' }, 404);
  }
  if (session.userId !== userId) {
    return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }

  const { language } = session;
  const now = new Date();
  // Mark the session complete on first summary view (idempotent), so duration
  // is grounded in a stored end time.
  const completedAt = session.completedAt ?? now;
  if (!session.completedAt) {
    await db
      .update(vocabularyReviewSessions)
      .set({ completedAt: now })
      .where(eq(vocabularyReviewSessions.id, sessionId));
  }

  // All graded items in this session, in order.
  const rows = await db
    .select({
      id: vocabularyReviewLog.id,
      reviewStateId: vocabularyReviewLog.reviewStateId,
      lemma: vocabularyReviewLog.lemma,
      surface: vocabularyReviewLog.surface,
      itemType: vocabularyReviewLog.itemType,
      outcome: vocabularyReviewLog.outcome,
      rating: vocabularyReviewLog.rating,
    })
    .from(vocabularyReviewLog)
    .where(eq(vocabularyReviewLog.sessionId, sessionId))
    .orderBy(vocabularyReviewLog.reviewedAt);

  const correct = rows.filter((r) => r.outcome === 'correct').length;
  const partial = rows.filter((r) => r.outcome === 'partial').length;
  const missed = rows.filter((r) => r.outcome === 'incorrect').length;

  // promoted/lapsed are rating-based proxies: Again resets the interval (lapsed),
  // Good/Easy graduate it (promoted); Hard holds. Deduped by lemma.
  const promoted = [
    ...new Set(rows.filter((r) => r.rating >= Rating.Good).map((r) => r.lemma)),
  ];
  const lapsed = [
    ...new Set(rows.filter((r) => r.rating === Rating.Again).map((r) => r.lemma)),
  ];

  // New cards = cards whose first-ever review falls in this session.
  const stateIds = [...new Set(rows.map((r) => r.reviewStateId))];
  let newCards = 0;
  if (stateIds.length > 0) {
    const firstReviews = await db
      .select({
        stateId: vocabularyReviewLog.reviewStateId,
        first: min(vocabularyReviewLog.reviewedAt),
      })
      .from(vocabularyReviewLog)
      .where(
        and(
          eq(vocabularyReviewLog.userId, userId),
          inArray(vocabularyReviewLog.reviewStateId, stateIds),
        ),
      )
      .groupBy(vocabularyReviewLog.reviewStateId);
    newCards = firstReviews.filter(
      (f) => f.first !== null && f.first >= session.startedAt,
    ).length;
  }

  // Session-level "what moved": exclude all of this session's evidence for the
  // baseline (Req 11.2).
  const grammarDeltas = await computeMasteryDeltas(
    db,
    userId,
    language,
    rows.map((r) => r.id),
    now,
  );

  // "When the next batch is due" — reuse the hub's next-due preview (Req 11.3).
  const { nextDueAt } = await overview(db, userId, language);

  return c.json({
    total: rows.length,
    correct,
    partial,
    missed,
    promoted,
    lapsed,
    newCards,
    items: rows.map((r) => ({
      lemma: r.lemma,
      surface: r.surface,
      itemType: r.itemType,
      outcome: r.outcome,
    })),
    grammarDeltas,
    nextDueAt,
    durationSeconds: Math.round((completedAt.getTime() - session.startedAt.getTime()) / 1000),
  });
});

// ---------------------------------------------------------------------------
// GET /review/bank — browse, one row per lemma (Req 12.1, 12.2, 12.6)
// ---------------------------------------------------------------------------
review.get('/review/bank', async (c) => {
  const parsed = BankQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json(
      {
        error: 'Invalid query parameters',
        code: 'VALIDATION_ERROR',
        details: parsed.error.flatten(),
      },
      400,
    );
  }
  const { language, status, q } = parsed.data;
  const userId = c.get('userId');

  // Back-fill state so every saved lemma appears (idempotent), then pool.
  await ensureReviewState(db, userId, language);
  let cards = await assembleCards(db, userId, language);

  if (status) {
    cards = cards.filter((card) => card.fsrs.state === status); // incl. leech (Req 12.6)
  }
  const needle = q?.trim().toLowerCase();
  if (needle) {
    cards = cards.filter(
      (card) =>
        card.lemma.toLowerCase().includes(needle) ||
        card.gloss.toLowerCase().includes(needle),
    );
  }
  cards.sort((a, b) => a.lemma.localeCompare(b.lemma));

  const rows = cards.map((card) => ({
    stateId: card.stateId,
    lemma: card.lemma,
    gloss: card.gloss,
    pos: card.pos,
    cefr: card.cefr,
    status: card.fsrs.state,
    stability: card.fsrs.stability,
    dueAt: card.fsrs.dueAt,
  }));

  return c.json({ rows });
});

// ---------------------------------------------------------------------------
// GET /review/words/:stateId — word detail (Req 12.3)
// ---------------------------------------------------------------------------
review.get('/review/words/:stateId', async (c) => {
  const stateId = c.req.param('stateId');
  const userId = c.get('userId');

  const [state] = await db
    .select()
    .from(vocabularyReviewState)
    .where(eq(vocabularyReviewState.id, stateId))
    .limit(1);
  if (!state) {
    return c.json({ error: 'Review card not found', code: 'CARD_NOT_FOUND' }, 404);
  }
  if (state.userId !== userId) {
    return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }

  const { language, lemma } = state;
  const [card] = await assembleCards(db, userId, language, [lemma]);

  // The saved deep-card snapshot (head occurrence) re-rendered in the detail.
  const [vocab] = await db
    .select({ card: userVocabulary.card })
    .from(userVocabulary)
    .where(
      and(
        eq(userVocabulary.userId, userId),
        eq(userVocabulary.language, language),
        eq(userVocabulary.lemma, lemma),
      ),
    )
    .orderBy(userVocabulary.addedAt)
    .limit(1);

  const history = await db
    .select({
      itemType: vocabularyReviewLog.itemType,
      surface: vocabularyReviewLog.surface,
      outcome: vocabularyReviewLog.outcome,
      rating: vocabularyReviewLog.rating,
      reviewedAt: vocabularyReviewLog.reviewedAt,
    })
    .from(vocabularyReviewLog)
    .where(eq(vocabularyReviewLog.reviewStateId, stateId))
    .orderBy(desc(vocabularyReviewLog.reviewedAt))
    .limit(WORD_HISTORY_LIMIT);

  const occurrences = card?.occurrences ?? [];
  const grammarPoints = [...new Set(occurrences.flatMap((o) => o.grammarPoints))];
  // Current scheduled interval (days) for the FSRS stats block.
  const nextIntervalDays = rehydrateCard(state.fsrsCardJson).scheduled_days;

  return c.json({
    stateId: state.id,
    lemma,
    language,
    gloss: card?.gloss ?? lemma,
    pos: card?.pos ?? '',
    cefr: card?.cefr ?? null,
    freqRank: card?.freqRank ?? null,
    isPhrase: card?.isPhrase ?? false,
    deepCard: vocab?.card ?? null,
    occurrences,
    fsrs: {
      stability: state.stability,
      difficulty: state.difficulty,
      reps: state.reps,
      lapses: state.lapses,
      state: state.state,
      dueAt: state.dueAt.toISOString(),
      lastReviewedAt: state.lastReviewedAt ? state.lastReviewedAt.toISOString() : null,
      nextIntervalDays,
    },
    grammarPoints,
    history: history.map((h) => ({
      itemType: h.itemType,
      surface: h.surface,
      outcome: h.outcome,
      rating: h.rating,
      reviewedAt: h.reviewedAt.toISOString(),
    })),
  });
});

// ---------------------------------------------------------------------------
// PATCH /review/words/:stateId — suspend / unsuspend / mark-known / reset (Req 12.4, 12.5)
// ---------------------------------------------------------------------------
review.patch('/review/words/:stateId', async (c) => {
  const stateId = c.req.param('stateId');
  const userId = c.get('userId');
  const parsed = WordActionSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json(
      {
        error: 'Invalid request body',
        code: 'VALIDATION_ERROR',
        details: parsed.error.flatten(),
      },
      400,
    );
  }

  const [state] = await db
    .select()
    .from(vocabularyReviewState)
    .where(eq(vocabularyReviewState.id, stateId))
    .limit(1);
  if (!state) {
    return c.json({ error: 'Review card not found', code: 'CARD_NOT_FOUND' }, 404);
  }
  if (state.userId !== userId) {
    return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }

  const now = new Date();
  let status;
  let dueAt = state.dueAt;
  let setValues;

  switch (parsed.data.action) {
    case 'suspend':
      status = 'suspended' as const;
      setValues = { state: status };
      break;
    case 'mark_known':
      status = 'known' as const;
      setValues = { state: status };
      break;
    case 'unsuspend':
      // Re-derive the lifecycle from the preserved FSRS card (Req 12.5).
      status = deriveLifecycleState(rehydrateCard(state.fsrsCardJson));
      setValues = { state: status };
      break;
    case 'reset': {
      // Wipe SR progress back to a brand-new, due-now card.
      const card = initCard(now);
      status = deriveLifecycleState(card);
      dueAt = card.due;
      setValues = {
        fsrsCardJson: serializeCard(card),
        stability: card.stability,
        difficulty: card.difficulty,
        reps: card.reps,
        lapses: card.lapses,
        state: status,
        lastReviewedAt: null,
        dueAt: card.due,
      };
      break;
    }
  }

  await db
    .update(vocabularyReviewState)
    .set(setValues)
    .where(eq(vocabularyReviewState.id, stateId));

  return c.json({ stateId, status, dueAt: dueAt.toISOString() });
});

// ---------------------------------------------------------------------------
// DELETE /review/words/:stateId — remove the card + its saved surfaces (Req 12.4)
// ---------------------------------------------------------------------------
review.delete('/review/words/:stateId', async (c) => {
  const stateId = c.req.param('stateId');
  const userId = c.get('userId');

  const [state] = await db
    .select()
    .from(vocabularyReviewState)
    .where(eq(vocabularyReviewState.id, stateId))
    .limit(1);
  if (!state) {
    return c.json({ error: 'Review card not found', code: 'CARD_NOT_FOUND' }, 404);
  }
  if (state.userId !== userId) {
    return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }

  // Delete the state row (cascades its `vocabulary_review_log` rows) and the
  // underlying per-surface `userVocabulary` rows for this lemma.
  await db.delete(vocabularyReviewState).where(eq(vocabularyReviewState.id, stateId));
  await db
    .delete(userVocabulary)
    .where(
      and(
        eq(userVocabulary.userId, userId),
        eq(userVocabulary.language, state.language),
        eq(userVocabulary.lemma, state.lemma),
      ),
    );

  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// GET /review/active-lemmas — reading under-review highlight source (Req 13.2)
// ---------------------------------------------------------------------------
// "Active" = cards still in rotation (not suspended/known). Returns the lemmas
// (primary match for surface-keyed Reading annotations) plus the normalized
// occurrence surfaces (fallback match). Both deduped + language-scoped.
review.get('/review/active-lemmas', async (c) => {
  const parsed = OverviewQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json(
      {
        error: 'Invalid query parameters',
        code: 'VALIDATION_ERROR',
        details: parsed.error.flatten(),
      },
      400,
    );
  }
  const { language } = parsed.data;
  const userId = c.get('userId');

  const activeRows = await db
    .selectDistinct({ lemma: vocabularyReviewState.lemma })
    .from(vocabularyReviewState)
    .where(
      and(
        eq(vocabularyReviewState.userId, userId),
        eq(vocabularyReviewState.language, language),
        notInArray(vocabularyReviewState.state, [...EJECTED_STATES]),
      ),
    );
  const lemmas = activeRows.map((r) => r.lemma);

  let surfaces: string[] = [];
  if (lemmas.length > 0) {
    const words = await db
      .selectDistinct({ word: userVocabulary.word })
      .from(userVocabulary)
      .where(
        and(
          eq(userVocabulary.userId, userId),
          eq(userVocabulary.language, language),
          inArray(userVocabulary.lemma, lemmas),
        ),
      );
    surfaces = [...new Set(words.map((w) => w.word.toLowerCase()))];
  }

  return c.json({ lemmas, surfaces });
});

export default review;
