// Distinct-by-content composition for GET /exercises/set. Pure + unit-tested.
//
// The conjugation pool holds exact-duplicate content rows (same lemma + target
// form + pronoun stored under several UUIDs), so a single-row random draw can
// serve the same exercise repeatedly within a sitting. The set endpoint pulls a
// freshness-ordered window and de-dupes by content signature so a session never
// repeats the same prompt.

export const CONJUGATION_SET_DEFAULT = 10;
export const CONJUGATION_SET_MAX = 20;
// Over-fetch window: the conjugation pools are small (≤~220 rows/level) and
// duplicate-heavy, so pull a generous slice and let de-dup pick distinct items.
export const CONJUGATION_SET_FETCH_CAP = 300;

/**
 * Salient signature for a conjugation exercise: what the learner is asked to
 * produce — `"<lemma>|<targetForm>|<pronoun>"`. Deliberately ignores
 * breakdown/example fields so two rows that pose the same prompt (but differ in
 * incidental content) collapse to one. Missing fields become empty segments.
 */
export function conjugationSignature(contentJson: unknown): string {
  const c = (contentJson ?? {}) as {
    lemma?: unknown;
    targetForm?: unknown;
    subject?: { pronoun?: unknown } | null;
  };
  const lemma = typeof c.lemma === 'string' ? c.lemma : '';
  const target = typeof c.targetForm === 'string' ? c.targetForm : '';
  const pronoun =
    c.subject && typeof c.subject.pronoun === 'string' ? c.subject.pronoun : '';
  return `${lemma}|${target}|${pronoun}`;
}

/**
 * Keep the first occurrence per signature, preserving input order, and slice to
 * `count`. The caller supplies items already ordered freshest-first (the SQL
 * `freshFirstOrderBy` window), so the kept item per signature is the freshest.
 */
export function dedupeBySignature<T>(
  items: readonly T[],
  count: number,
  signatureOf: (item: T) => string,
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (out.length >= count) break;
    const sig = signatureOf(item);
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(item);
  }
  return out;
}
