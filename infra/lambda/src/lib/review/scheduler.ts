// ---------------------------------------------------------------------------
// Vocabulary Review — FSRS scheduler wrapper
// ---------------------------------------------------------------------------
// The single seam every review rating flows through (Req 1.6). Wraps `ts-fsrs`
// behind the project's own helpers so the scheduler/algorithm is swappable and
// the rest of the feature never imports `ts-fsrs` directly.
//
// `ts-fsrs` Card carries `Date` fields (`due`, `last_review`). We persist the
// Card as JSON in `vocabulary_review_state.fsrs_card_json` (dates become ISO
// strings) and rehydrate on read. The denormalized `stability`/`difficulty`/
// `reps`/`lapses`/`state`/`dueAt` columns are derived from the Card for indexed
// queries — see queue.ts / the router.
// ---------------------------------------------------------------------------

import {
  type Card,
  type Grade,
  createEmptyCard,
  fsrs,
  type FSRS,
  generatorParameters,
  Rating,
  State,
} from 'ts-fsrs';
import type { ReviewOutcome, SchedulerDelta, VocabReviewStatus } from '@language-drill/shared';

// ---------------------------------------------------------------------------
// Tunables — kept in one place so the algorithm parameters are swappable
// without touching call sites (Req 1.7).
// ---------------------------------------------------------------------------

// `enable_fuzz: false` keeps scheduling deterministic — required for the unit
// tests and for reproducible interval growth.
export const FSRS_PARAMS = generatorParameters({
  request_retention: 0.9,
  maximum_interval: 365,
  enable_fuzz: false,
});

// A card that has lapsed this many times is a leech (Req 1.5). Surfaced in the
// bank; the rescue intervention itself is Phase 2.
export const LEECH_LAPSE_THRESHOLD = 3;

// Stability (in days) at or above which a card is considered "mature" and
// production item types are preferred over recognition (Req 7.2).
export const MATURE_STABILITY_DAYS = 7;

// The four real grades (Manual is excluded). Re-exported so callers map onto
// these without importing `ts-fsrs`.
export type FsrsRating = Grade;
export { Rating };
export type { Card as FsrsCard };

// Module-scope singleton scheduler.
const scheduler: FSRS = fsrs(FSRS_PARAMS);

// ---------------------------------------------------------------------------
// (De)serialization between the persisted JSON and a live `ts-fsrs` Card.
// ---------------------------------------------------------------------------

/** Build a plain JSON object for storage in `fsrs_card_json` (dates → ISO). */
export function serializeCard(card: Card): Record<string, unknown> {
  return {
    ...card,
    due: card.due.toISOString(),
    last_review: card.last_review ? card.last_review.toISOString() : null,
  };
}

/** Rehydrate a stored card JSON back into a live `ts-fsrs` Card (ISO → Date). */
export function rehydrateCard(json: Record<string, unknown>): Card {
  const raw = json as Record<string, unknown> & {
    due: string | Date;
    last_review?: string | Date | null;
  };
  return {
    ...(json as unknown as Card),
    due: new Date(raw.due),
    last_review: raw.last_review ? new Date(raw.last_review) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Lifecycle state — maps a `ts-fsrs` Card onto the product's lifecycle status.
// `suspended`/`known` are user actions stored separately and are never derived
// here.
// ---------------------------------------------------------------------------

export function deriveLifecycleState(card: Card): VocabReviewStatus {
  if (card.state === State.New) return 'new';
  if (card.lapses >= LEECH_LAPSE_THRESHOLD) return 'leech';
  if (card.state === State.Review && card.stability >= MATURE_STABILITY_DAYS) {
    return 'mature';
  }
  return 'learning';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** A brand-new, unreviewed card due immediately. */
export function initCard(now: Date): Card {
  return createEmptyCard(now);
}

/**
 * Map a locally-graded outcome onto an FSRS rating. This is the ONLY place an
 * outcome becomes a rating (Req 1.4, 6.3, 8.4):
 *   - incorrect → Again
 *   - partial   → Hard   (near-miss: accent-only mismatch or hint-assisted)
 *   - correct   → Good, but capped at Hard when any hint was used (Req 6.3:
 *                 0 hints → clean Good; 1+ hints taint the rating).
 *
 * `Easy` is reserved for the Phase 2 Claude-graded path, where a separate
 * `ratingFromEvalScore(score)` will sit beside this function and feed the same
 * `applyReview` — so adding production grading never touches the scheduler.
 */
export function ratingFromOutcome(
  outcome: ReviewOutcome,
  opts?: { hintsUsed?: number },
): FsrsRating {
  const hintsUsed = opts?.hintsUsed ?? 0;
  switch (outcome) {
    case 'incorrect':
      return Rating.Again;
    case 'partial':
      return Rating.Hard;
    case 'correct':
      return hintsUsed > 0 ? Rating.Hard : Rating.Good;
  }
}

/**
 * Apply one rating to a card and return the next state plus a before→after
 * delta for the feedback UI. This is the ONLY place the scheduler advances a
 * card; both local-graded items (today) and a future Claude-graded source
 * (Phase 2) call through here.
 */
export function applyReview(
  card: Card,
  rating: FsrsRating,
  now: Date,
): { next: Card; delta: SchedulerDelta } {
  const { card: next } = scheduler.next(card, now, rating);
  const delta: SchedulerDelta = {
    intervalFrom: card.scheduled_days,
    intervalTo: next.scheduled_days,
    stabilityFrom: card.stability,
    stabilityTo: next.stability,
    stateFrom: deriveLifecycleState(card),
    stateTo: deriveLifecycleState(next),
  };
  return { next, delta };
}
