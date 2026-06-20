import type { EvaluationError } from '@language-drill/shared';

export interface ErrorObservationContext {
  userId: string;
  language: string;
  exerciseId: string;
  sessionId: string | null;
  exerciseHistoryId: string;
  exerciseType: string;
  hostGrammarPointKey: string | null;
  occurredAt: Date;
}

/** Exactly the `NewErrorObservation` insert shape minus the defaulted `id`. */
export interface ErrorObservationRow {
  userId: string;
  language: string;
  exerciseId: string;
  sessionId: string | null;
  exerciseHistoryId: string;
  exerciseType: string;
  hostGrammarPointKey: string | null;
  errorGrammarPointKey: string | null;
  errorType: string;
  severity: string;
  wrongText: string;
  correction: string;
  occurredAt: Date;
}

/**
 * Pure: turn an evaluation's errors[] into insert rows. `errorGrammarPointKey`
 * is always null here — per-error attribution arrives in Phase 3 via the
 * evaluation prompt schema. Returns [] for missing/empty input.
 */
export function errorObservationsFromEvaluation(
  errors: readonly EvaluationError[] | undefined,
  ctx: ErrorObservationContext,
): ErrorObservationRow[] {
  if (!errors || errors.length === 0) return [];
  return errors.map((e) => ({
    userId: ctx.userId,
    language: ctx.language,
    exerciseId: ctx.exerciseId,
    sessionId: ctx.sessionId,
    exerciseHistoryId: ctx.exerciseHistoryId,
    exerciseType: ctx.exerciseType,
    hostGrammarPointKey: ctx.hostGrammarPointKey,
    errorGrammarPointKey: e.grammarPointKey ?? null,
    errorType: e.type,
    severity: e.severity,
    wrongText: e.text,
    correction: e.correction,
    occurredAt: ctx.occurredAt,
  }));
}

export interface BackfillHistoryRow {
  userId: string;
  language: string;
  exerciseId: string;
  sessionId: string | null;
  historyId: string;
  exerciseType: string;
  hostGrammarPointKey: string | null;
  evaluatedAt: Date;
  responseJson: unknown;
}

/** Defensive read of `response_json.evaluation.errors` (shape is untyped JSONB). */
function extractErrors(responseJson: unknown): EvaluationError[] | undefined {
  if (!responseJson || typeof responseJson !== 'object') return undefined;
  const evaluation = (responseJson as Record<string, unknown>).evaluation;
  if (!evaluation || typeof evaluation !== 'object') return undefined;
  const errors = (evaluation as Record<string, unknown>).errors;
  return Array.isArray(errors) ? (errors as EvaluationError[]) : undefined;
}

/**
 * Pure: build observation rows for one history row during backfill, skipping
 * rows whose history id is already present (idempotent re-runs).
 */
export function backfillRowsFor(
  row: BackfillHistoryRow,
  alreadyObserved: ReadonlySet<string>,
): ErrorObservationRow[] {
  if (alreadyObserved.has(row.historyId)) return [];
  return errorObservationsFromEvaluation(extractErrors(row.responseJson), {
    userId: row.userId,
    language: row.language,
    exerciseId: row.exerciseId,
    sessionId: row.sessionId,
    exerciseHistoryId: row.historyId,
    exerciseType: row.exerciseType,
    hostGrammarPointKey: row.hostGrammarPointKey,
    occurredAt: row.evaluatedAt,
  });
}
