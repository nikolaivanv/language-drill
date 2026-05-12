/**
 * Validates a `theory_generation_jobs.cell_key` against the format:
 *
 *   `<lang>:<level>:<grammar_point_key>`
 *
 * Theory cell keys carry no `<type>` segment because theory has no per-type
 * fan-out (one page per cell, not 50 drafts per type as in exercise
 * generation). The first caller is Phase 2's CLI, which builds the key via
 * `buildTheoryCellKey` before writing a row into `theory_generation_jobs`.
 *
 * Lowercase alternation matches the existing `CELL_KEY_REGEX` convention in
 * `cell-key.ts` so callers can pass upper-case enum literals (e.g.
 * `Language.ES`, `CefrLevel.B1`) and let `buildTheoryCellKey` normalize
 * before joining.
 */
export const THEORY_CELL_KEY_REGEX =
  /^(es|de|tr):(a1|a2|b1|b2):[a-z]{2}-[a-z0-9]+-[a-z0-9-]+$/;

export function assertValidTheoryCellKey(cellKey: string): void {
  if (!THEORY_CELL_KEY_REGEX.test(cellKey)) {
    throw new Error(`Invalid theory cell key: ${JSON.stringify(cellKey)}`);
  }
}

/**
 * Build the canonical `<lang>:<level>:<grammar_point_key>` cell key. Each
 * segment is lowercased before joining so callers can pass the enum-shaped
 * `Language` / `CefrLevel` literals (which are upper-case) without
 * normalizing in advance.
 *
 * Unlike `buildCellKey`, this helper calls `assertValidTheoryCellKey` on its
 * own output as a defense-in-depth check — a malformed input (e.g. an empty
 * `grammarPointKey`) would lowercase fine but still fail the regex, and the
 * build call surfaces the error at the boundary rather than letting a bad
 * key reach the audit table.
 */
export function buildTheoryCellKey(parts: {
  language: string;
  cefrLevel: string;
  grammarPointKey: string;
}): string {
  const cellKey = `${parts.language.toLowerCase()}:${parts.cefrLevel.toLowerCase()}:${parts.grammarPointKey.toLowerCase()}`;
  assertValidTheoryCellKey(cellKey);
  return cellKey;
}
