/**
 * SQS message contract between the producers (CLI `--queue`, scheduler Lambda,
 * future admin route) and the generation Lambda (consumer). One message =
 * one cell-job. The Lambda's handler parses the body via
 * `parseGenerationJobMessage` (throws with named-field errors on shape
 * violations) and dispatches to `runOneCell` from `@language-drill/db`.
 *
 * Also exports `checkAuditRowState`, the SQS at-least-once-delivery
 * idempotency primitive: before re-running the cell pipeline on a redelivered
 * message, the Lambda inspects the prior audit row to decide skip/defer/run.
 */

import type { CurriculumCefrLevel, Db } from '@language-drill/db';
import { generationJobs } from '@language-drill/db';
import {
  COVERAGE_AXIS_VALUES,
  ExerciseType,
  Language,
  type CoverageAxis,
  type CoverageTarget,
  type LearningLanguage,
} from '@language-drill/shared';
import { eq } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The `trigger` discriminator matches the `generation_jobs.trigger` column's
 * TS-enforced union (Phase 1 schema). The Lambda re-checks `trigger='cli'` is
 * forbidden in production (Req 2.6) as a defense-in-depth backstop on top of
 * the CLI's prod-queue substring guard.
 */
export type GenerationJobTrigger = 'cli' | 'scheduled' | 'admin';

export type GenerationJobMessage = {
  /** UUID. Used as both `generation_jobs.id` and the audit-row idempotency key. */
  jobId: string;
  trigger: GenerationJobTrigger;
  spec: {
    language: LearningLanguage;
    /**
     * Currently `'A1' | 'A2' | 'B1' | 'B2'` per `CurriculumCefrLevel`. The
     * runtime parser additionally accepts `'C1' | 'C2'` so a Phase 6 producer
     * that widens the curriculum can post messages an unchanged Lambda still
     * parses; round-1 narrowing happens in the handler (Req 2.7).
     */
    cefrLevel: CurriculumCefrLevel;
    exerciseType: ExerciseType;
    /** Curriculum entry key — resolved server-side via `getGrammarPoint`. */
    grammarPointKey: string;
    /** Forward-compat metadata; null in Phase 4. */
    topicDomain: string | null;
    /** [1, 200], same range as the CLI's `--count`. */
    count: number;
    batchSeed: string;
    /**
     * Phase 2 coverage controller: explicit per-draft axis targets. When
     * present, MUST be an array of length === `count`; each element a sparse
     * `{ axis: value }` map over known coverage axes/values. Absent on CLI/admin
     * and non-spec scheduled cells.
     */
    coverageTargets?: CoverageTarget[];
  };
  /** Cell-level cost cap in USD. (0, 100). */
  maxCostUsd: number;
};

/** SQS at-least-once redelivery → audit-row state machine for the handler. */
export type AuditRowState =
  | { status: 'absent' }
  | { status: 'in-progress' }
  | { status: 'completed'; jobStatus: 'succeeded' | 'failed' };

// ---------------------------------------------------------------------------
// Allowed-value sets (runtime checks)
// ---------------------------------------------------------------------------

const VALID_TRIGGERS: ReadonlySet<string> = new Set([
  'cli',
  'scheduled',
  'admin',
]);

/**
 * Phase 4 + Phase 6-friendly. The handler's round-1 guard (Req 2.7) narrows
 * to `ROUND_1_CEFR_LEVELS = ['A1','A2','B1','B2']`; this parser accepts the
 * full literal set so a forward-compat C1/C2 message round-trips cleanly.
 */
const VALID_CEFR_LEVELS: ReadonlySet<string> = new Set([
  'A1',
  'A2',
  'B1',
  'B2',
  'C1',
  'C2',
]);

const VALID_LANGUAGES: ReadonlySet<string> = new Set([
  Language.ES,
  Language.DE,
  Language.TR,
]);

const VALID_EXERCISE_TYPES: ReadonlySet<string> = new Set([
  ExerciseType.CLOZE,
  ExerciseType.TRANSLATION,
  ExerciseType.VOCAB_RECALL,
  ExerciseType.SENTENCE_CONSTRUCTION,
  ExerciseType.DICTATION,
  ExerciseType.FREE_WRITING,
  ExerciseType.CONJUGATION,
]);

const COUNT_MIN = 1;
const COUNT_MAX = 200;
const BATCH_SEED_MAX_LENGTH = 100;
const MAX_COST_USD_EXCLUSIVE_MAX = 100;

// ---------------------------------------------------------------------------
// parseGenerationJobMessage
// ---------------------------------------------------------------------------

/**
 * Parse a JSON-decoded SQS message body into a typed `GenerationJobMessage`.
 * Throws an `Error` whose message names the offending field on every shape
 * violation. Mirror of `parseValidationResult` (`packages/ai/src/validate.ts`).
 *
 * The caller is expected to pass `JSON.parse(record.body)` — this function
 * accepts a parsed value, not a raw string.
 */
export function parseGenerationJobMessage(
  input: unknown,
): GenerationJobMessage {
  if (!isPlainObject(input)) {
    throw new Error(
      `GenerationJobMessage: expected object, got ${describe(input)}`,
    );
  }

  const jobId = requireNonEmptyString(input, 'jobId');
  const trigger = requireUnion(input, 'trigger', VALID_TRIGGERS);

  const specValue = (input as Record<string, unknown>)['spec'];
  if (!isPlainObject(specValue)) {
    throw new Error(`spec: expected object, got ${describe(specValue)}`);
  }

  const language = requireUnion(specValue, 'spec.language', VALID_LANGUAGES);
  const cefrLevel = requireUnion(specValue, 'spec.cefrLevel', VALID_CEFR_LEVELS);
  const exerciseType = requireUnion(
    specValue,
    'spec.exerciseType',
    VALID_EXERCISE_TYPES,
  );
  const grammarPointKey = requireNonEmptyString(specValue, 'spec.grammarPointKey');
  const topicDomain = requireNullableString(specValue, 'spec.topicDomain');
  const count = requireIntegerInRange(
    specValue,
    'spec.count',
    COUNT_MIN,
    COUNT_MAX,
  );
  const batchSeed = requireBatchSeed(specValue, 'spec.batchSeed');
  const coverageTargets = optionalCoverageTargets(specValue, count);

  const maxCostUsd = requireMaxCostUsd(input, 'maxCostUsd');

  return {
    jobId,
    trigger: trigger as GenerationJobTrigger,
    spec: {
      language: language as LearningLanguage,
      // Forward-compat cast: `cefrLevel` may be 'C1'/'C2' at runtime; the type
      // narrows it to round-1, and the handler's guard catches out-of-scope.
      cefrLevel: cefrLevel as CurriculumCefrLevel,
      exerciseType: exerciseType as ExerciseType,
      grammarPointKey,
      topicDomain,
      count,
      batchSeed,
      ...(coverageTargets !== undefined ? { coverageTargets } : {}),
    },
    maxCostUsd,
  };
}

// ---------------------------------------------------------------------------
// checkAuditRowState
// ---------------------------------------------------------------------------

/**
 * Inspect the `generation_jobs` row for `jobId` and classify it for the
 * Lambda's per-record dispatch (Req 2.9):
 *
 *   - `'absent'` → first delivery; the handler proceeds to call `runOneCell`,
 *     which writes the audit row at the start of the cell.
 *   - `'completed'` → the prior delivery already finished; the handler logs
 *     and skips silently (success — implicit acknowledgment).
 *   - `'in-progress'` → a sibling Lambda is still working OR a prior delivery
 *     crashed mid-cell; the handler defers (adds the messageId to
 *     `batchItemFailures` so SQS redelivers after the visibility timeout).
 *
 * The Phase 1 schema's `status` column accepts `'queued' | 'running' |
 * 'succeeded' | 'failed'`. Phase 3's `runOneCell` opens the row directly with
 * `'running'` (no `'queued'` state), but for forward-compat the helper treats
 * `'queued'` like `'running'` — both defer.
 */
export async function checkAuditRowState(
  db: Db,
  jobId: string,
): Promise<AuditRowState> {
  const rows = await db
    .select({ status: generationJobs.status })
    .from(generationJobs)
    .where(eq(generationJobs.id, jobId))
    .limit(1);

  if (rows.length === 0) return { status: 'absent' };

  const status = rows[0].status;
  if (status === 'succeeded' || status === 'failed') {
    return { status: 'completed', jobStatus: status };
  }
  // 'running' OR 'queued' (forward-compat) OR any other non-terminal value.
  return { status: 'in-progress' };
}

// ---------------------------------------------------------------------------
// Internal field validators
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function requireNonEmptyString(
  obj: Record<string, unknown>,
  field: string,
): string {
  const segments = field.split('.');
  const last = segments[segments.length - 1];
  const value = obj[last];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(
      `${field}: expected non-empty string, got ${JSON.stringify(value)}`,
    );
  }
  return value;
}

function requireNullableString(
  obj: Record<string, unknown>,
  field: string,
): string | null {
  const segments = field.split('.');
  const last = segments[segments.length - 1];
  const value = obj[last];
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new Error(
      `${field}: expected string or null, got ${JSON.stringify(value)}`,
    );
  }
  return value;
}

function requireUnion(
  obj: Record<string, unknown>,
  field: string,
  allowed: ReadonlySet<string>,
): string {
  const segments = field.split('.');
  const last = segments[segments.length - 1];
  const value = obj[last];
  if (typeof value !== 'string' || !allowed.has(value)) {
    throw new Error(
      `${field}: expected one of ${JSON.stringify(Array.from(allowed))}, got ${JSON.stringify(value)}`,
    );
  }
  return value;
}

function requireIntegerInRange(
  obj: Record<string, unknown>,
  field: string,
  min: number,
  max: number,
): number {
  const segments = field.split('.');
  const last = segments[segments.length - 1];
  const value = obj[last];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(
      `${field}: expected integer, got ${JSON.stringify(value)}`,
    );
  }
  if (value < min || value > max) {
    throw new Error(
      `${field}: expected integer in [${min}, ${max}], got ${value}`,
    );
  }
  return value;
}

function requireBatchSeed(
  obj: Record<string, unknown>,
  field: string,
): string {
  const value = requireNonEmptyString(obj, field);
  if (value.length > BATCH_SEED_MAX_LENGTH) {
    throw new Error(
      `${field}: expected length ≤ ${BATCH_SEED_MAX_LENGTH}, got length ${value.length}`,
    );
  }
  return value;
}

const VALID_AXES = new Set(Object.keys(COVERAGE_AXIS_VALUES));

function optionalCoverageTargets(
  spec: Record<string, unknown>,
  count: number,
): CoverageTarget[] | undefined {
  const value = spec["coverageTargets"];
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new Error(
      `spec.coverageTargets: expected array or undefined, got ${describe(value)}`,
    );
  }
  if (value.length !== count) {
    throw new Error(
      `spec.coverageTargets: expected length === spec.count (${count}), got ${value.length}`,
    );
  }
  const out: CoverageTarget[] = [];
  for (const entry of value) {
    if (!isPlainObject(entry)) {
      throw new Error(
        `spec.coverageTargets: each element must be an object, got ${describe(entry)}`,
      );
    }
    const target: CoverageTarget = {};
    for (const [axis, v] of Object.entries(entry)) {
      if (!VALID_AXES.has(axis)) {
        throw new Error(`spec.coverageTargets: unknown axis '${axis}'`);
      }
      const legal = COVERAGE_AXIS_VALUES[axis as CoverageAxis];
      if (typeof v !== "string" || !legal.includes(v)) {
        throw new Error(
          `spec.coverageTargets: illegal value ${JSON.stringify(v)} for axis '${axis}'`,
        );
      }
      target[axis as CoverageAxis] = v;
    }
    out.push(target);
  }
  return out;
}

function requireMaxCostUsd(
  obj: Record<string, unknown>,
  field: string,
): number {
  const segments = field.split('.');
  const last = segments[segments.length - 1];
  const value = obj[last];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(
      `${field}: expected finite number, got ${JSON.stringify(value)}`,
    );
  }
  if (value <= 0 || value >= MAX_COST_USD_EXCLUSIVE_MAX) {
    throw new Error(
      `${field}: expected number in (0, ${MAX_COST_USD_EXCLUSIVE_MAX}), got ${value}`,
    );
  }
  return value;
}
