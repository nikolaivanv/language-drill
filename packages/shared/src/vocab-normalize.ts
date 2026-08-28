/**
 * Canonical surface-form normalization for vocab coverage matching. Shared by
 * the coverage read model (infra/lambda), the generation seed exclude and
 * seed-match reject gate (packages/db), and the scheduler's covered-target
 * count. All four MUST agree by construction, so there is exactly one copy.
 *
 * Lowercase, trim, and strip a leading article when the string is multi-token,
 * so a curated display form ("la manzana", "die Schule") matches the bare
 * headword ("manzana", "Schule") the generator emits as `expectedWord`.
 *
 * Spanish AND German citation articles are stripped. The German half was
 * missing until 2026-08-28: 451 of the 521 approved German vocab targets carry
 * an article in `display_form`, and the vocab_recall instruction asks the
 * learner to "include the correct article", so the generator legitimately
 * emits "die Schule". That normalized to "die schule", never matched the seed
 * lemma "Schule", and `vocabSeedMismatch` rejected the draft as
 * `seed-target-mismatch` — 13 times in prod, ALL German, zero in ES/TR, which
 * is exactly the signature a Spanish-only list predicts. It left
 * `de:a1:vocab_recall:de-a1-vocab-city-transport` one target short and
 * re-requesting that target nightly from 2026-08-17 on.
 *
 * Only nominative citation forms are listed. A curated `display_form` is
 * always a citation form, so the oblique articles (den/dem/des/einer/…) would
 * add no coverage and only widen the chance of eating a real first token.
 * Turkish needs no entry: it has no definite article, and its one
 * lemma/display-form divergence ("afet" / "doğal afet") is a modifier, not an
 * article — the same reason "sich bewerben" and "en directo" stay untouched.
 */
const ARTICLES = new Set([
  // Spanish
  'el',
  'la',
  'los',
  'las',
  'un',
  'una',
  'unos',
  'unas',
  // German
  'der',
  'die',
  'das',
  'ein',
  'eine',
]);

export function normalizeWord(s: string): string {
  const lowered = s.trim().toLowerCase();
  const tokens = lowered.split(/\s+/);
  if (tokens.length > 1 && ARTICLES.has(tokens[0])) return tokens.slice(1).join(' ');
  return lowered;
}
