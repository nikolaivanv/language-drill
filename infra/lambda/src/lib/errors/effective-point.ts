import { sql, type SQL } from 'drizzle-orm';
import { errorObservations } from '@language-drill/db';

/**
 * The grammar point an error observation is EVIDENCE ABOUT — the "effective
 * point" every per-point error surface groups on.
 *
 * `error_grammar_point_key` is the evaluator's per-error attribution and always
 * wins. When it is null the rule depends on `error_type`, because null means
 * two different things:
 *
 *  - On a **grammar** error it means "violates none of the in-scope points" —
 *    incomplete attribution, so the host point (the point being drilled) is a
 *    reasonable stand-in and is kept.
 *  - On a **vocabulary / spelling / pragmatics** error it is a deliberate
 *    signal. The evaluator prompt instructs: "omit grammarPointKey when the
 *    error ... is a vocabulary/spelling slip" (`packages/ai/src/prompts.ts`).
 *    Such an error is not about any grammar point, so there is nothing to fall
 *    back to and the observation belongs to no point.
 *
 * The old bare `COALESCE(error_grammar_point_key, host_grammar_point_key)`
 * collapsed those two cases, which filed lexical slips under whatever point
 * happened to be on screen — e.g. `el tamaño más barato → una talla más barata`
 * surfacing as the "recurring slip" for negative-imperative clitic placement,
 * and inflating that point's 30-day error count from 2 to 4.
 *
 * Four call sites are documented as byte-identical twins (`routes/progress.ts`,
 * `routes/sessions.ts`, `routes/insights.ts`, `lib/mastery/rank-context.ts`);
 * the rule therefore lives here once, in a SQL and a JS form that
 * `effective-point.test.ts` holds to the same behavior.
 *
 * NOTE (parked follow-up): ~40% of stored *grammar* errors carry a null
 * attribution, several of them plainly violating an in-scope point
 * (`divertido → divertida` under a nominalizers exercise is gender agreement).
 * That is an evaluator-prompt coverage gap, not an attribution-semantics bug,
 * and the host fallback above is what currently papers over it.
 */
export const GRAMMAR_ERROR_TYPE = 'grammar';

export function effectiveGrammarPointKey(row: {
  errorGrammarPointKey: string | null;
  hostGrammarPointKey: string | null;
  errorType: string;
}): string | null {
  if (row.errorGrammarPointKey) return row.errorGrammarPointKey;
  return row.errorType === GRAMMAR_ERROR_TYPE ? row.hostGrammarPointKey : null;
}

/**
 * SQL twin of {@link effectiveGrammarPointKey}. Safe in SELECT and GROUP BY.
 *
 * The comparison literals here and in {@link errorSampleOrderSql} are written
 * straight into the template rather than interpolated. Each query emits these
 * expressions twice — once in the SELECT list, once in GROUP BY (or once per
 * `array_agg`) — and
 * Postgres matches a GROUP BY expression to the SELECT list *structurally*,
 * treating two `Param` nodes with different paramids as unequal. Binding the
 * literal therefore makes Postgres reject the query outright:
 *   column "error_observations.error_grammar_point_key" must appear in the
 *   GROUP BY clause or be used in an aggregate function
 * (verified against Postgres 17). Both are fixed literals, never user input, so
 * inlining carries no injection risk. `sql.raw` would work too, but the
 * drizzle-orm mock in `rank-context.test.ts` does not implement it, and a
 * literal keeps the expression legible anyway. `effective-point.test.ts` pins
 * the SQL text to {@link GRAMMAR_ERROR_TYPE} so the two cannot drift.
 */
export function effectiveGrammarPointKeySql(
  t: typeof errorObservations = errorObservations,
): SQL<string | null> {
  return sql<string | null>`COALESCE(${t.errorGrammarPointKey}, CASE WHEN ${t.errorType} = 'grammar' THEN ${t.hostGrammarPointKey} END)`;
}

/**
 * ORDER BY for picking the ONE representative slip shown per point (the
 * "recurring slip" card). Total, so the pick is reproducible:
 *
 *  1. explicitly attributed before host-fallback — an attributed error is
 *     certainly about the point; a fallback one only might be;
 *  2. then most recent (the card's stated intent);
 *  3. then major before minor, and finally `id`, purely to break ties.
 *
 * Steps 3–4 are not cosmetic: every error from one submission shares
 * `occurred_at` to the millisecond, so recency alone left the winner to
 * `array_agg`'s arbitrary order. That is how a vocabulary slip beat the
 * same-instant spelling slip onto the negative-imperative card.
 */
export function errorSampleOrderSql(
  t: typeof errorObservations = errorObservations,
): SQL {
  return sql`(${t.errorGrammarPointKey} IS NOT NULL) DESC, ${t.occurredAt} DESC, (${t.severity} = 'major') DESC, ${t.id} DESC`;
}
