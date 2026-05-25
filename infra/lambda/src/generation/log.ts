/**
 * Tiny logging helpers for the generation Lambda handler. The handler emits
 * structured-JSON log lines via `console.log(JSON.stringify({...}))`; these
 * helpers keep the call sites short:
 *   - `errMessage` extracts a string from an `unknown` thrown value.
 *   - `summarizeResult` projects the count fields of a `CellResult` into the
 *     shape the handler logs on completion.
 */

import type { CellResult } from '@language-drill/db';

export function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function summarizeResult(r: CellResult): {
  inserted: number;
  approved: number;
  flagged: number;
  rejected: number;
  dedupGivenUp: number;
  malformedDrafts: number;
  parserFailedOrdinals: number;
  validatorParseFailedOrdinals: number;
  earlyBailed: boolean;
  rejectionReasons: Record<string, number>;
  durationMs: number;
} {
  return {
    inserted: r.insertedCount,
    // Phase 3 invariant: inserted = auto-approved ∪ flagged.
    approved: r.insertedCount - r.flaggedCount,
    flagged: r.flaggedCount,
    rejected: r.rejectedCount,
    dedupGivenUp: r.dedupGivenUpCount,
    malformedDrafts: r.malformedDraftCount,
    // R4.3 — distinguishes a within-run dedup early-bail from a normal
    // completion on the CloudWatch line (the cell still closed `succeeded`).
    earlyBailed: r.earlyBailed,
    // R5.4 — ordinals where every retry slot produced a parser failure.
    // Already a subset of `rejected`; surfaced separately so CloudWatch
    // can alert on a stuck failure mode (`> 0.2 ratio` over multiple jobs).
    parserFailedOrdinals: r.parserFailedCount,
    // R8.3 — ordinals whose validator returned a malformed first-validation
    // response (isolated to the ordinal, never failing the whole cell). Also a
    // subset of `rejected`; surfaced separately so CloudWatch can alert on a
    // validator emitting unparseable tool calls.
    validatorParseFailedOrdinals: r.validatorParseFailedCount,
    // Frequency map of validator rejection reasons across discarded ordinals,
    // so CloudWatch carries the same distribution persisted to
    // `generation_jobs.rejection_reason_counts`. Empty `{}` when nothing was
    // rejected.
    rejectionReasons: r.rejectionReasonCounts,
    durationMs: r.durationMs,
  };
}
