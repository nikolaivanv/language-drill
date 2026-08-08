// Which learner attempts count as evidence toward mastery and progress scores.
//
// An attempt is scored against the exercise as it was at the time. When an
// exercise is later demoted the attempt survives — demotion never DELETEs,
// because user_exercise_history references exercises.id without cascade. That
// is correct for pool hygiene (a duplicate was still answerable, the learner
// still did the work) and wrong for defects (a mis-keyed answer or ambiguous
// blank marked the learner down for the item's fault, not theirs).
//
// `exercises.demotion_reason` records which case a demotion was, and this
// module is the single place that decides what follows from it.
import { sql, type SQL } from 'drizzle-orm';

import { exercises } from '../schema/exercises';

export type DemotionReason =
  | 'quality' // validator / revalidator / admin judged the item defective
  | 'learner-flag' // learner flagged it, admin upheld
  | 'duplicate' // dedup sweep
  | 'pool-hygiene'; // diversity, regeneration, other pool management

export const DEMOTION_REASONS = [
  'quality',
  'learner-flag',
  'duplicate',
  'pool-hygiene',
] as const satisfies readonly DemotionReason[];

/**
 * Demotion reasons whose attempts must not count toward learner scoring.
 * Everything else counts, including NULL and any future unrecognised value —
 * the cost of keeping a bad row is a slightly unfair score, the cost of
 * dropping a good one is destroying real evidence.
 */
export const NON_EVIDENCE_DEMOTION_REASONS = ['quality', 'learner-flag'] as const;

/**
 * Drizzle predicate constraining a query to exercises whose attempts count as
 * learner evidence. Pass the `exercises` table reference; composes under
 * `and(...)` alongside the user/language/window predicates.
 *
 * `coalesce` rather than `notInArray`: SQL `NOT IN` evaluates to NULL — not
 * true — when the column is NULL, which would silently drop every row that was
 * never demoted (i.e. almost all of them).
 *
 * The reason list is interpolated per-value (`${r}`) rather than spliced into
 * the template as literal text, so each reason is a bound parameter, not raw
 * SQL — consistent with how every other value-bearing predicate in this
 * codebase is built, and avoids ever string-building SQL text from data.
 */
export function scoringEvidenceFilter(table: typeof exercises): SQL {
  return sql`coalesce(${table.demotionReason}, '') not in (${sql.join(
    NON_EVIDENCE_DEMOTION_REASONS.map((reason) => sql`${reason}`),
    sql`, `,
  )})`;
}
