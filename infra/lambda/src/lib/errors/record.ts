import type { EvaluationError } from '@language-drill/shared';
import { errorObservations, errorObservationsFromEvaluation } from '@language-drill/db';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbLike = { insert: (table: any) => { values: (rows: any[]) => Promise<unknown> } };

export interface RecordArgs {
  errors: readonly EvaluationError[] | undefined;
  userId: string;
  language: string;
  exerciseId: string;
  sessionId: string | null;
  exerciseHistoryId: string;
  exerciseType: string;
  hostGrammarPointKey: string | null;
  occurredAt: Date;
}

/**
 * Best-effort: persist the evaluator's errors as observation rows. A failure
 * here must never fail a submission — the authoritative signal is the history
 * row, written before this is called.
 */
export async function recordErrorObservations(db: DbLike, args: RecordArgs): Promise<void> {
  try {
    const { errors, ...ctx } = args;
    const rows = errorObservationsFromEvaluation(errors, ctx);
    if (rows.length === 0) return;
    await db.insert(errorObservations).values(rows);
  } catch (err) {
    console.error('recordErrorObservations failed (non-fatal):', err);
  }
}
