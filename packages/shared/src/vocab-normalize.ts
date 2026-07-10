/**
 * Canonical surface-form normalization for vocab coverage matching. Shared by
 * the coverage read model (infra/lambda), the generation seed exclude and
 * seed-match reject gate (packages/db), and the scheduler's covered-target
 * count. All four MUST agree by construction, so there is exactly one copy.
 *
 * Lowercase, trim, collapse whitespace, and strip a leading Spanish article
 * when the string is multi-token (so "la manzana" matches the bare headword
 * "manzana" the generator emits as expectedWord).
 */
const ARTICLES = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas']);

export function normalizeWord(s: string): string {
  const lowered = s.trim().toLowerCase();
  const tokens = lowered.split(/\s+/);
  if (tokens.length > 1 && ARTICLES.has(tokens[0])) return tokens.slice(1).join(' ');
  return lowered;
}
