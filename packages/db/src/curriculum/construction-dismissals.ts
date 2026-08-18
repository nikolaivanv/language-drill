/**
 * Construction-dismissals ledger — every "this construction is legitimately
 * rare in this cell" judgement, recorded so `pnpm audit:constructions` stops
 * re-reporting it on every run.
 *
 * Lives beside the curriculum because that is what it describes: a dismissal is
 * a statement about a grammar point's pedagogy, not about the audit tool.
 *
 * Deliberately NOT an extension of `COLLAPSE_DISMISSALS`, which is keyed on a
 * dominant answer SURFACE. A dismissal here says a named sub-construction is
 * legitimately under-represented (a Spanish reporting verb that takes no tense
 * shift is genuinely uncommon). Overloading `surface: null` to mean "some
 * construction" would make both ledgers harder to read.
 *
 * Starts empty: entries are added as the audit's findings are reviewed and
 * judged correct-as-is.
 */

import { ExerciseType } from '@language-drill/shared';

export type ConstructionDismissal = Readonly<{
  grammarPointKey: string;
  type: ExerciseType;
  /** The `ClaimedConstruction.id` this dismissal covers. Never null — a
   *  blanket cell dismissal would hide a second, unrelated gap. */
  constructionId: string;
  /** Why the under-representation is correct. Non-empty; this is the whole value. */
  reason: string;
  /** ISO date (YYYY-MM-DD). Shown in the report so a stale dismissal is
   *  visible rather than silently permanent. */
  dismissedOn: string;
}>;

export const CONSTRUCTION_DISMISSALS: readonly ConstructionDismissal[] = Object.freeze([]);

/** The ledger entry accounting for this exact finding, or `undefined`. Returns
 *  the ENTRY so the report can render its `reason` and `dismissedOn` — a
 *  dismissal shown only as the word "ledger" is an unauditable filtered view. */
export function findConstructionDismissal(
  grammarPointKey: string,
  type: ExerciseType,
  constructionId: string,
): ConstructionDismissal | undefined {
  return CONSTRUCTION_DISMISSALS.find(
    (d) =>
      d.grammarPointKey === grammarPointKey &&
      d.type === type &&
      d.constructionId === constructionId,
  );
}

/** Every dismissed construction id for one cell, as the audit's pure verdict
 *  step consumes it. */
export function dismissedConstructionIds(
  grammarPointKey: string,
  type: ExerciseType,
): Set<string> {
  return new Set(
    CONSTRUCTION_DISMISSALS.filter(
      (d) => d.grammarPointKey === grammarPointKey && d.type === type,
    ).map((d) => d.constructionId),
  );
}
