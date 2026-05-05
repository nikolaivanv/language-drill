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
 * Internal to `@language-drill/db` — not re-exported from the package barrel.
 *
 * @remarks
 * **Phase 6 sync requirement.** When a new `ExerciseType` member is added (e.g.
 * `listening`, `speaking`), the `<type>` alternation below MUST be updated in
 * the same PR; otherwise newly-typed cell keys will fail validation. The
 * regex deliberately enumerates the current members so a forgotten update is
 * caught at insert time rather than silently writing an unparseable cell key.
 */
const CELL_KEY_REGEX = /^(es|de|tr):(a1|a2|b1|b2):(cloze|translation|vocab_recall):[a-z0-9-]+$/;

export function assertValidCellKey(cellKey: string): void {
  if (!CELL_KEY_REGEX.test(cellKey)) {
    throw new Error(`Invalid generation_jobs cell_key: ${JSON.stringify(cellKey)}`);
  }
}
