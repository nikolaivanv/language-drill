/**
 * Validates a `generation_jobs.cell_key` against the round-1 format:
 *
 *   `<lang>:<level>:<type>:<grammar_point_key>`
 *
 * where `<type>` is a current member of the `ExerciseType` enum
 * (`packages/shared/src/index.ts`). The check is performed in code rather than
 * via a database CHECK constraint, matching the project-wide convention
 * (see `tech.md` §"Database").
 *
 * `assertValidCellKey` is internal to `@language-drill/db` (not promoted
 * through the package barrel). `buildCellKey` and `buildCellKeyFromRow` are
 * Phase 4 additions that ARE promoted, since the Lambda + scheduler need them.
 *
 * @remarks
 * **Phase 6 sync requirement.** When a new `ExerciseType` member is added (e.g.
 * `listening`, `speaking`), the `<type>` alternation below MUST be updated in
 * the same PR; otherwise newly-typed cell keys will fail validation. The
 * regex deliberately enumerates the current members so a forgotten update is
 * caught at insert time rather than silently writing an unparseable cell key.
 */
const CELL_KEY_REGEX = /^(es|de|tr):(a1|a2|b1|b2):(cloze|translation|vocab_recall|sentence_construction):[a-z0-9-]+$/;

export function assertValidCellKey(cellKey: string): void {
  if (!CELL_KEY_REGEX.test(cellKey)) {
    throw new Error(`Invalid generation_jobs cell_key: ${JSON.stringify(cellKey)}`);
  }
}

/**
 * Build the canonical `<lang>:<level>:<type>:<grammar_point_key>` cell key.
 * Inputs are lowercased before joining so callers can pass the enum-shaped
 * `ExerciseType` / `Language` / `CefrLevel` literals (which are upper-case)
 * without normalizing them in advance.
 *
 * The output is NOT validated against `CELL_KEY_REGEX` — callers that want the
 * extra defense-in-depth should call `assertValidCellKey(buildCellKey(...))`.
 * This keeps the helper itself pure and allocation-light for hot paths
 * (the scheduler iterates 700+ cells per invocation).
 */
export function buildCellKey(parts: {
  language: string;
  cefrLevel: string;
  exerciseType: string;
  grammarPointKey: string;
}): string {
  return `${parts.language.toLowerCase()}:${parts.cefrLevel.toLowerCase()}:${parts.exerciseType.toLowerCase()}:${parts.grammarPointKey}`;
}

/**
 * Build a cell key from a Drizzle SELECT row whose columns are nullable
 * (`exercises.language`, `exercises.difficulty`, `exercises.type`, and
 * `exercises.grammarPointKey` are all `text(...)` without `.notNull()`).
 *
 * Null columns are coerced to `'?'` — that sentinel intentionally fails
 * `CELL_KEY_REGEX`, so a downstream `assertValidCellKey` on the result acts as
 * a load-bearing detector for malformed rows. Phase 4's scheduler uses this to
 * skip rows with NULL discriminators in its in-memory diff.
 */
export function buildCellKeyFromRow(row: {
  language: string | null;
  difficulty: string | null;
  type: string | null;
  grammarPointKey: string | null;
}): string {
  return buildCellKey({
    language: row.language ?? '?',
    cefrLevel: row.difficulty ?? '?',
    exerciseType: row.type ?? '?',
    grammarPointKey: row.grammarPointKey ?? '?',
  });
}
