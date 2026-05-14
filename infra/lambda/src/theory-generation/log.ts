/**
 * Tiny logging helpers for the theory generation Lambda handler. The handler
 * emits structured-JSON log lines via `console.log(JSON.stringify({...}))`;
 * these helpers keep the call sites short:
 *   - `errMessage` extracts a string from an `unknown` thrown value.
 *   - `summarizeTheoryResult` projects the count fields of a
 *     `TheoryCellResult` into the shape the handler logs on completion.
 *
 * Diverges from the exercise-side `summarizeResult` (`infra/lambda/src/
 * generation/log.ts`): the exercise side mints up to N drafts per cell so it
 * reports `approved = inserted - flagged`; theory is 0-or-1 (one page per
 * cell), and `TheoryCellResult` doesn't surface flagged/rejected counts on
 * the return value — the audit row (`theory_generation_jobs.{approved,
 * flagged, rejected}` booleans) carries that verdict. The summarizer
 * therefore projects only `inserted` / `skipped` / `durationMs`; the handler
 * logs `status` and `errorMessage` separately on the terminal-failure branch.
 */

import type { TheoryCellResult } from '@language-drill/db';

export function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function summarizeTheoryResult(r: TheoryCellResult): {
  inserted: number;
  skipped: number;
  durationMs: number;
} {
  return {
    // 0 or 1 — see `TheoryCellResult` JSDoc.
    inserted: r.insertedCount,
    // 1 when the partial unique index rejected the INSERT (cell already filled).
    skipped: r.skippedCount,
    durationMs: r.durationMs,
  };
}
