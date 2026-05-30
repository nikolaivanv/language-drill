// ---------------------------------------------------------------------------
// Vocabulary Review — item-type & occurrence selection (pure policy)
// ---------------------------------------------------------------------------
// Decides, for a single review card, (a) which saved occurrence to test and
// (b) which of the three Phase-1 item types to present. Pure + dependency-free
// (only shared types) so the queue builder and tests can drive it directly.
//
// Maturity → type policy (Req 2.4, 7.1, 7.2, 7.4):
//   • mature  (stability ≥ 7d) → meaning→production (prefer production)
//   • learning/leech           → cloze-in-context if a usable sentence exists,
//                                else meaning→production
//   • new                      → low-stakes warm-up: recognition, alternating
//                                with cloze across the session for variation
//
// Phrase/idiom cards exclude morphology-dependent cloze (Req 2.6): their
// reduced set is recognition + meaning. When no occurrence carries a usable
// sentence, context-dependent cloze is impossible and selection falls back to a
// context-independent type (Req 2.3 fallback).
// ---------------------------------------------------------------------------

import type { Occurrence, ReviewCard, ReviewItemType } from '@language-drill/shared';
import { MATURE_STABILITY_DAYS } from './scheduler';

/**
 * An occurrence is usable for a context-dependent item (cloze) only when its
 * saved sentence actually contains the surface form, so a blank can be cut.
 */
function hasUsableSentence(occ: Occurrence): boolean {
  const surface = occ.surface.trim();
  const sentence = occ.sentence.trim();
  if (surface.length === 0 || sentence.length === 0) return false;
  return sentence.toLowerCase().includes(surface.toLowerCase());
}

/**
 * Pick one occurrence to test this session. Seeded selection across the
 * occurrences that carry a usable sentence so a different surface form may be
 * tested across sessions (Req 2.3). Returns `null` when no occurrence has a
 * usable sentence — the caller then falls back to a context-independent item
 * type (Req 2.4).
 */
export function pickOccurrence(card: ReviewCard, seed = 0): Occurrence | null {
  const usable = card.occurrences.filter(hasUsableSentence);
  if (usable.length === 0) return null;
  return usable[seed % usable.length];
}

/**
 * Map a card's FSRS maturity (+ phrase flag + occurrence availability) to one
 * of the three Phase-1 item types. `seed` (supplied per-card by the queue
 * builder) varies new-card warm-ups across the session (Req 7.4).
 */
export function pickItemType(card: ReviewCard, seed = 0): ReviewItemType {
  const { stability, state } = card.fsrs;
  const clozeAllowed = !card.isPhrase && pickOccurrence(card, seed) !== null;

  // Mature → prefer a production item type over recognition (Req 7.2).
  if (stability >= MATURE_STABILITY_DAYS) return 'meaning';

  // Brand-new → low-stakes warm-up, alternated with cloze for variation
  // (Req 7.1, 7.4). Phrase / no usable sentence → recognition only.
  if (state === 'new') {
    if (clozeAllowed) return seed % 2 === 0 ? 'recognition' : 'cloze';
    return 'recognition';
  }

  // Learning / leech (below maturity) → cloze-in-context when possible, else
  // the context-independent production type (Req 2.4).
  return clozeAllowed ? 'cloze' : 'meaning';
}
