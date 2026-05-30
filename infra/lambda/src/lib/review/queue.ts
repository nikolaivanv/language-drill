// ---------------------------------------------------------------------------
// Vocabulary Review — queue builder & card assembly
// ---------------------------------------------------------------------------
// Turns the existing per-surface `user_vocabulary` rows into lemma-keyed
// `ReviewCard`s (pooled occurrences + joined FSRS state), non-destructively:
// this feature never writes to `user_vocabulary` and never changes its
// surface-form unique key (Req 2.1, 2.5).
//
// `ensureReviewState` lazily back-fills a `new` scheduler row for any saved
// lemma that lacks one, decoupling Part 2 from Part 1's save path. `buildQueue`
// and `overview` (which order + filter these cards into a session) are added in
// sibling tasks.
// ---------------------------------------------------------------------------

import { and, eq, gt, inArray, min, notInArray } from 'drizzle-orm';
import {
  userVocabulary,
  vocabularyReviewLog,
  vocabularyReviewState,
  type Db,
} from '@language-drill/db';
import type {
  DeepCard,
  LearningLanguage,
  Morphology,
  Occurrence,
  QueueBreakdown,
  ReviewCard,
  ReviewItemType,
} from '@language-drill/shared';
import { deriveLifecycleState, initCard, serializeCard } from './scheduler';
import { pickItemType, pickOccurrence } from './item-select';
import { startOfUtcDay } from '../today-plan';

// ---------------------------------------------------------------------------
// ensureReviewState
// ---------------------------------------------------------------------------

/**
 * Idempotently create a `new` `vocabulary_review_state` row for every saved
 * lemma in this (user, language) that lacks one (Req 2.1). Safe to call before
 * each queue build: existing rows are left untouched, and the unique
 * `(userId, language, lemma)` key + `onConflictDoNothing` guard against races.
 */
export async function ensureReviewState(
  db: Db,
  userId: string,
  language: LearningLanguage,
): Promise<void> {
  const [savedLemmas, statedLemmas] = await Promise.all([
    db
      .selectDistinct({ lemma: userVocabulary.lemma })
      .from(userVocabulary)
      .where(and(eq(userVocabulary.userId, userId), eq(userVocabulary.language, language))),
    db
      .select({ lemma: vocabularyReviewState.lemma })
      .from(vocabularyReviewState)
      .where(
        and(
          eq(vocabularyReviewState.userId, userId),
          eq(vocabularyReviewState.language, language),
        ),
      ),
  ]);

  const existing = new Set(statedLemmas.map((r) => r.lemma));
  const missing = savedLemmas.map((r) => r.lemma).filter((lemma) => !existing.has(lemma));
  if (missing.length === 0) return;

  const now = new Date();
  const rows = missing.map((lemma) => {
    const card = initCard(now);
    return {
      userId,
      language,
      lemma,
      fsrsCardJson: serializeCard(card),
      stability: card.stability,
      difficulty: card.difficulty,
      reps: card.reps,
      lapses: card.lapses,
      state: deriveLifecycleState(card),
      lastReviewedAt: card.last_review ?? null,
      dueAt: card.due,
    };
  });

  await db.insert(vocabularyReviewState).values(rows).onConflictDoNothing();
}

// ---------------------------------------------------------------------------
// assembleCards
// ---------------------------------------------------------------------------

type VocabRow = typeof userVocabulary.$inferSelect;
type StateRow = typeof vocabularyReviewState.$inferSelect;

/** Best-available contextual sense for an occurrence, from the saved card. */
function occurrenceSense(card: DeepCard | null, fallback: string): string {
  if (card?.type === 'word') return card.contextualSense || fallback;
  if (card?.type === 'phrase') return card.idiomaticMeaning || fallback;
  return fallback;
}

/**
 * Free-text grammar-point labels carried by an occurrence (Req 2.2), derived
 * from a word card's morphology segment functions (e.g. "ablative case").
 * Normalized (trimmed, lowercased) and de-duplicated; display + evidence only
 * in Phase 1. Phrase cards carry none.
 */
function occurrenceGrammarPoints(card: DeepCard | null): string[] {
  if (card?.type !== 'word' || !card.morphology) return [];
  const seen = new Set<string>();
  for (const seg of card.morphology.segments) {
    const label = seg.function.trim().toLowerCase();
    if (label.length > 0) seen.add(label);
  }
  return [...seen];
}

/** Map one `user_vocabulary` row to an Occurrence, or null when unusable. */
function toOccurrence(row: VocabRow): Occurrence | null {
  const surface = row.word.trim();
  const sentence = row.exampleSentence.trim();
  // Drop occurrences with no usable sentence (Req 2.4 fallback path); a card
  // with zero occurrences is still valid (item-select picks a context-free type).
  if (surface.length === 0 || sentence.length === 0) return null;

  const card: DeepCard | null = row.card ?? null;
  const morphology: Morphology | undefined =
    card?.type === 'word' ? card.morphology : undefined;

  return {
    surface: row.word,
    sentence: row.exampleSentence,
    contextualSense: occurrenceSense(card, row.gloss || row.lemma),
    whyThisForm: morphology?.whyThisForm,
    morphology,
    grammarPoints: occurrenceGrammarPoints(card),
  };
}

/**
 * Group a (user, language)'s `user_vocabulary` rows by lemma into `ReviewCard`s
 * with pooled occurrences, joined to their `vocabulary_review_state` (Req 2.1,
 * 2.2, 2.5). Lemmas lacking a state row are skipped — call `ensureReviewState`
 * first. Optional `lemmas` narrows the assembly (used by the word-detail and
 * queue paths).
 */
export async function assembleCards(
  db: Db,
  userId: string,
  language: LearningLanguage,
  lemmas?: readonly string[],
): Promise<ReviewCard[]> {
  // An explicit empty lemma filter means "nothing requested".
  if (lemmas && lemmas.length === 0) return [];

  const vocabWhere = and(
    eq(userVocabulary.userId, userId),
    eq(userVocabulary.language, language),
    ...(lemmas ? [inArray(userVocabulary.lemma, [...lemmas])] : []),
  );
  const stateWhere = and(
    eq(vocabularyReviewState.userId, userId),
    eq(vocabularyReviewState.language, language),
    ...(lemmas ? [inArray(vocabularyReviewState.lemma, [...lemmas])] : []),
  );

  const [vocabRows, stateRows] = await Promise.all([
    db
      .select()
      .from(userVocabulary)
      .where(vocabWhere)
      .orderBy(userVocabulary.lemma, userVocabulary.addedAt),
    db.select().from(vocabularyReviewState).where(stateWhere),
  ]);

  const stateByLemma = new Map<string, StateRow>();
  for (const s of stateRows) stateByLemma.set(s.lemma, s);

  // Group vocab rows by lemma, preserving the query's (lemma, addedAt) order.
  const rowsByLemma = new Map<string, VocabRow[]>();
  for (const row of vocabRows) {
    const group = rowsByLemma.get(row.lemma);
    if (group) group.push(row);
    else rowsByLemma.set(row.lemma, [row]);
  }

  const cards: ReviewCard[] = [];
  for (const [lemma, rows] of rowsByLemma) {
    const state = stateByLemma.get(lemma);
    if (!state) continue; // no scheduler row yet → not reviewable this pass

    const head = rows[0];
    const occurrences = rows
      .map(toOccurrence)
      .filter((o): o is Occurrence => o !== null);

    cards.push({
      stateId: state.id,
      lemma,
      language,
      gloss: head.gloss,
      pos: head.pos,
      cefr: head.cefrBand ?? null,
      freqRank: head.frequencyRank ?? null,
      isPhrase: rows.some((r) => r.card?.type === 'phrase'),
      occurrences,
      fsrs: {
        stability: state.stability,
        difficulty: state.difficulty,
        reps: state.reps,
        lapses: state.lapses,
        state: state.state,
        dueAt: state.dueAt.toISOString(),
        lastReviewedAt: state.lastReviewedAt ? state.lastReviewedAt.toISOString() : null,
      },
    });
  }

  return cards;
}

// ---------------------------------------------------------------------------
// buildQueue
// ---------------------------------------------------------------------------

/** Default per-language daily intake of brand-new cards (Req 3.2). */
export const NEW_INTAKE_CAP = 5;
/** Default session-size ceiling; most-overdue cards win when exceeded (Req 3.4). */
export const SESSION_CEILING = 20;

/**
 * Session-build filter (Req 3.6). `all` = due reviews + capped new intake;
 * `new`/`leech` are focused subsets; `{ readEntryId }` reviews a passage's saved
 * words (Req 13.1); `{ grammarPoint }` targets a normalized grammar-point label.
 */
export type ReviewFilter =
  | 'all'
  | 'new'
  | 'leech'
  | { readEntryId: string }
  | { grammarPoint: string };

/**
 * One queued review item: the card identity + the policy-selected item type and
 * (for context-dependent cloze) the occurrence to test. Display fields are
 * carried so the panes render without a second fetch; the answer is graded
 * server-side from `stateId`. The api-client wire schema mirrors this shape.
 */
export interface ReviewItem {
  stateId: string;
  lemma: string;
  // Reuse ReviewCard's field types (Zod string-literal enums) so projection is
  // assignment-compatible without a cast.
  language: ReviewCard['language'];
  itemType: ReviewItemType;
  gloss: string;
  pos: string;
  cefr: ReviewCard['cefr'];
  freqRank: number | null;
  occurrence: Occurrence | null;
}

/** Count how many brand-new cards may still be introduced today (Req 3.2). */
async function newIntakeRemaining(
  db: Db,
  userId: string,
  language: LearningLanguage,
  now: Date,
): Promise<number> {
  const startOfToday = startOfUtcDay(now);
  // Earliest review per card; a card whose first-ever review is today was
  // "introduced" today and counts against the daily cap.
  const firstReviews = await db
    .select({
      stateId: vocabularyReviewLog.reviewStateId,
      first: min(vocabularyReviewLog.reviewedAt),
    })
    .from(vocabularyReviewLog)
    .where(
      and(eq(vocabularyReviewLog.userId, userId), eq(vocabularyReviewLog.language, language)),
    )
    .groupBy(vocabularyReviewLog.reviewStateId);

  const introducedToday = firstReviews.filter(
    (r) => r.first !== null && r.first >= startOfToday,
  ).length;
  return Math.max(0, NEW_INTAKE_CAP - introducedToday);
}

/** Lemmas saved from a specific reading passage (the `{ readEntryId }` filter). */
async function lemmasForReadEntry(
  db: Db,
  userId: string,
  language: LearningLanguage,
  readEntryId: string,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ lemma: userVocabulary.lemma })
    .from(userVocabulary)
    .where(
      and(
        eq(userVocabulary.userId, userId),
        eq(userVocabulary.language, language),
        eq(userVocabulary.sourceReadEntryId, readEntryId),
      ),
    );
  return rows.map((r) => r.lemma);
}

/** Project a selected card into a queue item, varying type/occurrence by seed. */
function toReviewItem(card: ReviewCard, seed: number): ReviewItem {
  const itemType = pickItemType(card, seed);
  // Only the context-dependent cloze carries an occurrence; meaning/recognition
  // are context-free (and meaning must not leak the word inside an example).
  const occurrence = itemType === 'cloze' ? pickOccurrence(card, seed) : null;
  return {
    stateId: card.stateId,
    lemma: card.lemma,
    language: card.language,
    itemType,
    gloss: card.gloss,
    pos: card.pos,
    cefr: card.cefr,
    freqRank: card.freqRank,
    occurrence,
  };
}

/**
 * Build a single language's ordered review queue (Req 3.1–3.6, 13.1). Selects
 * due reviews + a capped intake of new cards (excluding `suspended`/`known`),
 * narrowed by `filter`, ordered most-overdue first, and capped to the session
 * ceiling. Returns the queued items plus a breakdown for the hub/summary.
 */
export async function buildQueue(
  db: Db,
  userId: string,
  language: LearningLanguage,
  filter: ReviewFilter = 'all',
): Promise<{ items: ReviewItem[]; breakdown: QueueBreakdown }> {
  const now = new Date();

  // Resolve the candidate lemma set (a passage filter narrows it up-front).
  let candidateLemmas: string[] | undefined;
  if (typeof filter === 'object' && 'readEntryId' in filter) {
    candidateLemmas = await lemmasForReadEntry(db, userId, language, filter.readEntryId);
    if (candidateLemmas.length === 0) {
      return { items: [], breakdown: emptyBreakdown() };
    }
  }

  let cards = await assembleCards(db, userId, language, candidateLemmas);

  // Never review ejected cards (Req 3.3).
  cards = cards.filter((c) => c.fsrs.state !== 'suspended' && c.fsrs.state !== 'known');

  // Grammar-point filter narrows to cards carrying that normalized label.
  if (typeof filter === 'object' && 'grammarPoint' in filter) {
    const gp = filter.grammarPoint.trim().toLowerCase();
    cards = cards.filter((c) =>
      c.occurrences.some((o) => o.grammarPoints.includes(gp)),
    );
  }

  const nowMs = now.getTime();
  const isDue = (c: ReviewCard) => new Date(c.fsrs.dueAt).getTime() <= nowMs;

  const newCards = cards.filter((c) => c.fsrs.state === 'new');
  const dueReviewCards = cards.filter((c) => c.fsrs.state !== 'new' && isDue(c));
  const leechCards = cards.filter((c) => c.fsrs.state === 'leech');

  const remainingNew = await newIntakeRemaining(db, userId, language, now);
  const cappedNew = newCards.slice(0, remainingNew);

  // Apply the focused-subset selection.
  let selected: ReviewCard[];
  if (filter === 'new') {
    selected = cappedNew;
  } else if (filter === 'leech') {
    selected = leechCards;
  } else {
    selected = [...dueReviewCards, ...cappedNew];
  }

  // Most-overdue first; cap to the session ceiling (Req 3.4).
  selected.sort((a, b) => new Date(a.fsrs.dueAt).getTime() - new Date(b.fsrs.dueAt).getTime());
  const capped = selected.slice(0, SESSION_CEILING);

  const items = capped.map((card, i) => toReviewItem(card, i));

  const mix = { cloze: 0, meaning: 0, recognition: 0 };
  for (const item of items) mix[item.itemType] += 1;

  return {
    items,
    breakdown: {
      due: dueReviewCards.length,
      new: cappedNew.length,
      leech: leechCards.length,
      total: items.length,
      mix,
    },
  };
}

function emptyBreakdown(): QueueBreakdown {
  return { due: 0, new: 0, leech: 0, total: 0, mix: { cloze: 0, meaning: 0, recognition: 0 } };
}

// ---------------------------------------------------------------------------
// overview
// ---------------------------------------------------------------------------

/** Per-item time estimate (minutes) — review items are quicker than full drills. */
const REVIEW_MINUTES_BY_TYPE: Record<ReviewItemType, number> = {
  recognition: 0.25,
  cloze: 0.5,
  meaning: 0.5,
};

/** Hub payload: the projected session breakdown + length + next-due preview. */
export interface HubOverview {
  breakdown: QueueBreakdown;
  estimatedMinutes: number;
  nextDueAt: string | null;
}

function estimateMinutes(items: readonly ReviewItem[]): number {
  if (items.length === 0) return 0;
  const total = items.reduce((sum, it) => sum + REVIEW_MINUTES_BY_TYPE[it.itemType], 0);
  return Math.max(1, Math.round(total));
}

/** Soonest not-yet-due card for this language (next-due preview, Req 3.5/4.3). */
async function nextDueAt(
  db: Db,
  userId: string,
  language: LearningLanguage,
  now: Date,
): Promise<string | null> {
  const [row] = await db
    .select({ next: min(vocabularyReviewState.dueAt) })
    .from(vocabularyReviewState)
    .where(
      and(
        eq(vocabularyReviewState.userId, userId),
        eq(vocabularyReviewState.language, language),
        notInArray(vocabularyReviewState.state, ['suspended', 'known']),
        gt(vocabularyReviewState.dueAt, now),
      ),
    );
  return row?.next ? row.next.toISOString() : null;
}

/**
 * Hub data for one language (Req 4.1, 4.3): the projected queue breakdown +
 * item-type mix + estimated length, plus the next-due timestamp for the
 * "all caught up" empty state (Req 3.5). Builds the same queue `buildQueue`
 * would but creates no session.
 */
export async function overview(
  db: Db,
  userId: string,
  language: LearningLanguage,
): Promise<HubOverview> {
  const { items, breakdown } = await buildQueue(db, userId, language, 'all');
  return {
    breakdown,
    estimatedMinutes: estimateMinutes(items),
    nextDueAt: await nextDueAt(db, userId, language, new Date()),
  };
}
