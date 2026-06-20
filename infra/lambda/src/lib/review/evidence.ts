// ---------------------------------------------------------------------------
// Vocabulary Review — evidence & mastery movement
// ---------------------------------------------------------------------------
// Persists each graded review item to `vocabulary_review_log` and maps those
// rows into the progress radar's `ContributingRow` shape so reviews advance the
// radar (Req 9.1–9.3, 9.6). `computeMasteryDeltas` (the "what moved" before→after)
// is added in a sibling task.
//
// Bucketing note (Req 9.3): `aggregateRadar` routes each ContributingRow into
// exactly one axis. A graded review therefore emits TWO rows when it carries
// grammar points — one `vocab_review_vocab` (→ vocabulary axis) and one
// `vocab_review_grammar` (→ grammar axis); reviews without grammar points emit
// only the vocabulary row. These sentinels are mapped in `axisForExerciseType`
// (see the progress-aggregation extension); without that mapping they fall
// through its `default → null` branch and are silently dropped.
// ---------------------------------------------------------------------------

import { and, eq, gte } from 'drizzle-orm';
import { CefrLevel } from '@language-drill/shared';
import type {
  CefrLevel as CefrLevelType,
  LearningLanguage,
  MasteryDelta,
  ReviewItemType,
  ReviewOutcome,
} from '@language-drill/shared';
import { vocabularyReviewLog, type Db } from '@language-drill/db';
import { aggregateAxisMastery, type ContributingRow } from '../progress-aggregation';

const MS_PER_DAY = 86_400_000;

// Radar window the exercise-history rows already use — kept identical so the
// UNIONed review rows are filtered consistently (design Component 5).
const DEFAULT_WINDOW_DAYS = 90;

// CEFR fallback when a review row carries no band (e.g. older saved words).
const DEFAULT_CEFR_BAND = CefrLevel.B1;

// `ContributingRow.type` sentinels for review evidence. MUST stay in sync with
// the `axisForExerciseType` cases added in the progress-aggregation extension.
export const REVIEW_VOCAB_TYPE = 'vocab_review_vocab';
export const REVIEW_GRAMMAR_TYPE = 'vocab_review_grammar';

const SCORE_BY_OUTCOME: Record<ReviewOutcome, number> = {
  correct: 1,
  partial: 0.5,
  incorrect: 0,
};

// ---------------------------------------------------------------------------
// writeReviewLog
// ---------------------------------------------------------------------------

/** Columns the caller supplies for one evidence row (`reviewedAt` defaults). */
export interface ReviewLogRow {
  userId: string;
  language: LearningLanguage;
  reviewStateId: string;
  sessionId?: string | null;
  lemma: string;
  itemType: ReviewItemType;
  surface?: string | null;
  outcome: ReviewOutcome;
  rating: number;
  cefrBand?: CefrLevelType | null;
  grammarPoints?: string[];
  reviewedAt?: Date;
}

/**
 * Insert one `vocabulary_review_log` row and return its id (Req 9.1, 9.6). The
 * id lets the caller pass it as `excludeLogIds` to `computeMasteryDeltas` for
 * the per-item "what moved" baseline (Req 9.4).
 */
export async function writeReviewLog(db: Db, row: ReviewLogRow): Promise<string> {
  const [inserted] = await db
    .insert(vocabularyReviewLog)
    .values({
      userId: row.userId,
      language: row.language,
      reviewStateId: row.reviewStateId,
      sessionId: row.sessionId ?? null,
      lemma: row.lemma,
      itemType: row.itemType,
      surface: row.surface ?? null,
      outcome: row.outcome,
      rating: row.rating,
      cefrBand: row.cefrBand ?? null,
      grammarPoints: row.grammarPoints ?? [],
      ...(row.reviewedAt ? { reviewedAt: row.reviewedAt } : {}),
    })
    .returning({ id: vocabularyReviewLog.id });
  return inserted.id;
}

// ---------------------------------------------------------------------------
// reviewContributingRows
// ---------------------------------------------------------------------------

/**
 * Map a user's review-log rows (within the radar's rolling window) into
 * `ContributingRow`s for the radar (Req 9.1–9.3). `score` from outcome
 * (`correct=1, partial=0.5, incorrect=0`), `difficulty` from `cefrBand`
 * (fallback B1), `evaluatedAt = reviewedAt`. Emits a `vocab_review_vocab` row
 * always and an additional `vocab_review_grammar` row when the item carried
 * grammar points.
 */
export async function reviewContributingRows(
  db: Db,
  userId: string,
  language: LearningLanguage,
  sinceDays: number = DEFAULT_WINDOW_DAYS,
): Promise<ContributingRow[]> {
  const windowStart = new Date(Date.now() - sinceDays * MS_PER_DAY);

  const rows = await db
    .select({
      outcome: vocabularyReviewLog.outcome,
      cefrBand: vocabularyReviewLog.cefrBand,
      grammarPoints: vocabularyReviewLog.grammarPoints,
      reviewedAt: vocabularyReviewLog.reviewedAt,
    })
    .from(vocabularyReviewLog)
    .where(
      and(
        eq(vocabularyReviewLog.userId, userId),
        eq(vocabularyReviewLog.language, language),
        gte(vocabularyReviewLog.reviewedAt, windowStart),
      ),
    );

  const out: ContributingRow[] = [];
  for (const r of rows) {
    const score = SCORE_BY_OUTCOME[r.outcome];
    const difficulty = r.cefrBand ?? DEFAULT_CEFR_BAND;
    out.push({
      score,
      difficulty,
      type: REVIEW_VOCAB_TYPE,
      evaluatedAt: r.reviewedAt,
    });
    if (r.grammarPoints.length > 0) {
      out.push({
        score,
        difficulty,
        type: REVIEW_GRAMMAR_TYPE,
        evaluatedAt: r.reviewedAt,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// computeMasteryDeltas
// ---------------------------------------------------------------------------

/** Map one raw log row to the `ContributingRow` shape the mastery formula uses. */
function masteryRow(r: {
  outcome: ReviewOutcome;
  cefrBand: CefrLevelType | null;
  reviewedAt: Date;
}): ContributingRow {
  return {
    score: SCORE_BY_OUTCOME[r.outcome],
    difficulty: r.cefrBand ?? DEFAULT_CEFR_BAND,
    type: REVIEW_GRAMMAR_TYPE,
    evaluatedAt: r.reviewedAt,
  };
}

/**
 * "What moved" before→after for the grammar labels carried by a set of
 * just-written evidence rows (Req 9.4, 11.2). For each label on the given
 * (excluded) rows, computes the radar's own recency-weighted `currentMastery`
 * over that label's review-log rows in the rolling window twice:
 *   `to`   = over all of the label's rows (the given ids are already persisted)
 *   `from` = over the same rows minus `excludeLogIds` (the pre-this baseline)
 *
 * `excludeLogIds` is the seam between the two callers: per-item feedback passes
 * the single just-written row id; the session summary passes all of the
 * session's row ids. A first-ever review of a label therefore shows movement
 * from its no-evidence (`from = 0`) baseline, by design. `now` is injected for
 * deterministic recency weighting + window cutoff.
 */
export async function computeMasteryDeltas(
  db: Db,
  userId: string,
  language: LearningLanguage,
  excludeLogIds: readonly string[],
  now: Date,
): Promise<MasteryDelta[]> {
  const windowStart = new Date(now.getTime() - DEFAULT_WINDOW_DAYS * MS_PER_DAY);

  const rows = await db
    .select({
      id: vocabularyReviewLog.id,
      outcome: vocabularyReviewLog.outcome,
      cefrBand: vocabularyReviewLog.cefrBand,
      grammarPoints: vocabularyReviewLog.grammarPoints,
      reviewedAt: vocabularyReviewLog.reviewedAt,
    })
    .from(vocabularyReviewLog)
    .where(
      and(
        eq(vocabularyReviewLog.userId, userId),
        eq(vocabularyReviewLog.language, language),
        gte(vocabularyReviewLog.reviewedAt, windowStart),
      ),
    );

  const excludeSet = new Set(excludeLogIds);

  // Affected labels = the grammar points carried by the given (excluded) rows.
  const affectedLabels = new Set<string>();
  for (const r of rows) {
    if (excludeSet.has(r.id)) {
      for (const label of r.grammarPoints) affectedLabels.add(label);
    }
  }

  // Stable (alphabetical) order so the "what moved" line is deterministic.
  // Drop no-op entries (from === to) — they render as a useless "0% → 0%" row.
  return [...affectedLabels]
    .sort()
    .map((label) => {
      const rowsForLabel = rows.filter((r) => r.grammarPoints.includes(label));
      const to = aggregateAxisMastery(rowsForLabel.map(masteryRow), now);
      const from = aggregateAxisMastery(
        rowsForLabel.filter((r) => !excludeSet.has(r.id)).map(masteryRow),
        now,
      );
      return { grammarPoint: label, from, to };
    })
    .filter((d) => d.from !== d.to);
}
