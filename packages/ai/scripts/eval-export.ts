/**
 * packages/ai — eval-export CLI (Phase 2 Tasks 22 + 23).
 *
 * Samples evaluation traces from Langfuse into a candidate dataset for the
 * eval runner.
 *
 *   - Task 22 — fetch + uniform-sample primitives, no writes.
 *   - Task 23 — get-or-create Langfuse dataset, dedupe sampled traces by
 *     `submissionId`, look up the user answer + exercise content from
 *     Neon, write `createDatasetItem` per remaining trace.
 *
 * Invocation (task 26 wires the `pnpm` shortcut):
 *   tsx scripts/eval-export.ts \
 *     --from 2026-05-10 --to 2026-05-16 \
 *     --sample 20 --dataset eval-smoke \
 *     [--language es] [--cefr B1] [--seed 42]
 *
 * Tag schema (set by Phase-1's `buildTraceMetadata`, dimension:value
 * convention): `feature:evaluate`, `language:<code>`, `cefrLevel:<level>`.
 * Langfuse `api.traceList({tags})` AND-matches the array, so optional
 * --language / --cefr narrow the population without code branches.
 *
 * Sampling: uniform-random over the fetched population. `--seed` makes a
 * re-run reproduce the same item selection (important when the operator
 * wants to re-run the eval after tweaking the candidate prompt against
 * the SAME dataset slice). Without --seed, `Math.random` is used.
 *
 * Dedupe: pulled by `submissionId` (the `userExerciseHistory.id` Phase 1
 * stamps onto every evaluate trace). Re-running `eval:export` with
 * overlapping date ranges is a no-op for the overlap — items already in
 * the dataset are skipped, not re-created.
 */

import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

import type { Langfuse } from "langfuse";

import {
  type Db,
  createDb,
  eq,
  exercises,
  requireEnv,
  userExerciseHistory,
} from "@language-drill/db";

import { getLangfuse } from "../src/index.js";

// ---------------------------------------------------------------------------
// Tag construction — Phase-1's v2 (dimension:value) schema
// ---------------------------------------------------------------------------

/**
 * Build the tag filter for `api.traceList`. The exporter always pins
 * `feature:evaluate` so only the eval surface is sampled. `--language`
 * and `--cefr` are optional narrowing dimensions; absent → no extra
 * filter (the full evaluate population is the candidate pool).
 *
 * Tag values are normalised the same way Phase-1's `buildTraceMetadata`
 * emits them: language codes uppercased (`ES`, `DE`, `TR`); CEFR levels
 * uppercased (`A1`..`C2`). Mismatches between caller casing and trace
 * casing would silently return zero traces.
 */
export function buildTagFilter(opts: {
  language?: string;
  cefr?: string;
}): string[] {
  const tags: string[] = ["feature:evaluate"];
  if (opts.language !== undefined && opts.language !== "") {
    tags.push(`language:${opts.language.toUpperCase()}`);
  }
  if (opts.cefr !== undefined && opts.cefr !== "") {
    tags.push(`cefrLevel:${opts.cefr.toUpperCase()}`);
  }
  return tags;
}

// ---------------------------------------------------------------------------
// PRNG + uniform sample — no new deps
// ---------------------------------------------------------------------------

/**
 * Mulberry32 — small fast 32-bit PRNG. Seeded from `--seed` so a re-run
 * with the same seed reproduces the same item ordering. Output is in
 * [0, 1) like `Math.random`.
 *
 * Public-domain algorithm (Tommy Ettinger). Not cryptographically secure
 * — uniform sampling for eval doesn't need security, only repeatability.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Partial Fisher-Yates: yields a uniform random subset of size
 * `min(n, items.length)` without mutating the input. Returns a fresh
 * array.
 *
 * The partial-shuffle variant runs in O(n) regardless of the input
 * size — cheaper than `arr.sort(() => rng() - 0.5)`, which both has
 * O(n log n) cost AND is provably non-uniform.
 */
export function uniformSample<T>(
  items: readonly T[],
  n: number,
  rng: () => number = Math.random,
): T[] {
  const arr = items.slice();
  const k = Math.min(Math.max(n, 0), arr.length);
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(rng() * (arr.length - i));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr.slice(0, k);
}

// ---------------------------------------------------------------------------
// Trace fetch — paginated traceList
// ---------------------------------------------------------------------------

/**
 * Narrow port for the SDK methods this script consumes. Lets tests inject
 * a stub without spinning up the full Langfuse client.
 */
export type LangfuseTraceApi = {
  api: Pick<Langfuse["api"], "traceList" | "datasetItemsList">;
};

/**
 * One fetched trace row from `api.traceList`. We rely only on `id` +
 * `metadata` + `timestamp` downstream; the rest is passed through as-is
 * to task 23's dataset-item builder.
 */
export type FetchedTrace = {
  id: string;
  timestamp?: string;
  metadata?: Record<string, unknown> | null;
} & Record<string, unknown>;

// Langfuse Cloud caps `/api/public/traces?limit` server-side. Empirically
// `limit=1000` returns HTTP 400 ("Bad Request") even though the SDK type
// accepts it; the SDK's own `traceList` docstring hedges: "If you encounter
// api issues due to too large page sizes, try to reduce the limit."
// 100 matches the bootstrap-prompts list call and is well within accepted
// bounds. The paginator below already loops, so the only cost of a smaller
// page is one extra HTTP request per ~100 traces fetched.
export const TRACE_LIST_PAGE_SIZE = 100;

/**
 * Walks `langfuse.api.traceList` from page 1 forward until the API stops
 * returning full pages. Returns the concatenated trace list — order is
 * whatever the API gave us (typically newest first), which is fine: the
 * sampler reorders.
 *
 * `meta.totalPages` is the documented truth but a short last page is the
 * tighter guarantee (and works if the API ever stops surfacing totals).
 */
export async function fetchAllEvaluateTraces(opts: {
  langfuse: LangfuseTraceApi;
  tags: string[];
  fromTimestamp: string;
  toTimestamp: string;
}): Promise<FetchedTrace[]> {
  const all: FetchedTrace[] = [];
  let page = 1;
  // Hard upper bound on pages so a misbehaving API can't loop us forever
  // — 1_000_000 traces (1000 × 1000 pages) is way past anything the eval
  // workflow would ever need.
  const MAX_PAGES = 1000;
  while (page <= MAX_PAGES) {
    const response = await opts.langfuse.api.traceList({
      tags: opts.tags,
      fromTimestamp: opts.fromTimestamp,
      toTimestamp: opts.toTimestamp,
      page,
      limit: TRACE_LIST_PAGE_SIZE,
    });
    const data = (response.data ?? []) as FetchedTrace[];
    all.push(...data);
    if (data.length < TRACE_LIST_PAGE_SIZE) break;
    page++;
  }
  return all;
}

// ---------------------------------------------------------------------------
// Dataset write path — get-or-create + dedupe + per-trace write
// ---------------------------------------------------------------------------

/**
 * Wider port covering the dataset surface task 23 consumes. Composed with
 * `LangfuseTraceApi` so a single test stub covers both fetch and write.
 */
export type LangfuseDatasetApi = LangfuseTraceApi & {
  createDataset: (
    input: string | { name: string; description?: string; metadata?: unknown },
  ) => Promise<unknown>;
  createDatasetItem: (body: {
    datasetName: string;
    input?: unknown;
    expectedOutput?: unknown;
    metadata?: unknown;
  }) => Promise<unknown>;
};

/**
 * Narrow port for the Neon lookup. Lets tests inject a stub map without
 * spinning up Drizzle or the WebSocket pool. The real-world implementation
 * (factory below) does the SELECT-JOIN against `userExerciseHistory` +
 * `exercises`.
 */
export type DbExerciseLookup = {
  lookupExerciseSubmission: (submissionId: string) => Promise<{
    userAnswer: string;
    exerciseContent: unknown;
    language: string;
    cefrLevel: string;
    exerciseType: string;
  } | null>;
};

/**
 * Real-world `DbExerciseLookup` backed by Drizzle. Single read-only
 * SELECT-JOIN per submission — `userExerciseHistory.responseJson` is the
 * shape `{ userAnswer, evaluation }` stamped by the submit route
 * (`infra/lambda/src/routes/exercises.ts:238`).
 *
 * `db.query.*` relational helpers aren't initialised on the workspace
 * `createDb()` instance, so this uses the plain query-builder path.
 */
export function createDbExerciseLookup(db: Db): DbExerciseLookup {
  return {
    async lookupExerciseSubmission(submissionId) {
      const rows = await db
        .select({
          responseJson: userExerciseHistory.responseJson,
          exerciseContent: exercises.contentJson,
          language: exercises.language,
          difficulty: exercises.difficulty,
          exerciseType: exercises.type,
        })
        .from(userExerciseHistory)
        .leftJoin(exercises, eq(userExerciseHistory.exerciseId, exercises.id))
        .where(eq(userExerciseHistory.id, submissionId))
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      // The submission row exists but its joined exercise may not (FK is
      // `set null` semantics) — guard so missing exercise data is a "skip"
      // not a crash.
      if (
        row.exerciseContent === null ||
        row.language === null ||
        row.difficulty === null ||
        row.exerciseType === null
      ) {
        return null;
      }
      // Extract `userAnswer` from the JSONB shape; defensively bail when
      // the field isn't a string (older rows from before the route stamped
      // it, or a writer bug).
      const userAnswer =
        row.responseJson !== null &&
        typeof row.responseJson === "object" &&
        "userAnswer" in row.responseJson &&
        typeof (row.responseJson as { userAnswer: unknown }).userAnswer ===
          "string"
          ? (row.responseJson as { userAnswer: string }).userAnswer
          : null;
      if (userAnswer === null) return null;
      return {
        userAnswer,
        exerciseContent: row.exerciseContent,
        language: row.language,
        cefrLevel: row.difficulty,
        exerciseType: row.exerciseType,
      };
    },
  };
}

/**
 * The trace metadata fields the dataset-writer pulls. Phase-1's
 * `buildTraceMetadata` is the canonical writer; absent fields surface
 * as `undefined` so the dataset-writer can skip-and-log rather than
 * crash on legacy traces.
 */
export type TraceMetadataPick = {
  submissionId?: string;
  language?: string;
  cefrLevel?: string;
  exerciseType?: string;
  localPromptVersion?: string;
};

export function extractTraceMetadata(trace: FetchedTrace): TraceMetadataPick {
  const md = trace.metadata;
  if (md === null || md === undefined || typeof md !== "object") return {};
  const r = md as Record<string, unknown>;
  return {
    submissionId:
      typeof r.submissionId === "string" ? r.submissionId : undefined,
    language: typeof r.language === "string" ? r.language : undefined,
    cefrLevel: typeof r.cefrLevel === "string" ? r.cefrLevel : undefined,
    exerciseType:
      typeof r.exerciseType === "string" ? r.exerciseType : undefined,
    localPromptVersion:
      typeof r.localPromptVersion === "string"
        ? r.localPromptVersion
        : undefined,
  };
}

/**
 * Cap on items-pagination loops. Same shape as `TRACE_LIST_PAGE_SIZE`: 100
 * per page (Langfuse Cloud's accepted bound) × a 50-page hard cap = 5000
 * items before we bail, far past any realistic eval dataset.
 */
export const DATASET_ITEMS_PAGE_SIZE = 100;
const DATASET_ITEMS_PAGE_CAP = 50;

/**
 * Get-or-create the named Langfuse dataset, returning every existing item
 * (or an empty list when freshly created).
 *
 * We deliberately do NOT use the SDK's `getDataset` helper to "check
 * existence" first. That method is buggy on missing datasets in
 * `langfuse-core@3.38.20`: when the dataset doesn't exist, the SDK logs
 * the 404 to stderr and then crashes downstream with
 * `TypeError: itemsResponse.data is not iterable` because it tries to
 * iterate `_getDatasetItems(...).data` on a path that already 404'd. See
 * `langfuse-core/lib/index.cjs.js:1910-1925`.
 *
 * Instead:
 *   1. `createDataset({name})` unconditionally. The SDK docs the endpoint
 *      as "Upserts the dataset if it already exists" — idempotent, safe
 *      to re-run.
 *   2. Paginate `api.datasetItemsList({datasetName, …})` directly, which
 *      throws cleanly on real errors.
 *
 * `createDataset` failures propagate (Scenario d — CLI exits non-zero).
 * Item-fetch failures also propagate; we'd rather fail loudly than write
 * to a dataset we can't dedupe against.
 */
export async function getOrCreateDataset(
  langfuse: LangfuseDatasetApi,
  name: string,
): Promise<{ existingItems: ReadonlyArray<{ metadata?: unknown }> }> {
  await langfuse.createDataset({ name });

  const items: Array<{ metadata?: unknown }> = [];
  let page = 1;
  for (let i = 0; i < DATASET_ITEMS_PAGE_CAP; i++) {
    const resp = await langfuse.api.datasetItemsList({
      datasetName: name,
      limit: DATASET_ITEMS_PAGE_SIZE,
      page,
    });
    items.push(...resp.data);
    if (page >= resp.meta.totalPages) break;
    page++;
  }

  return { existingItems: items };
}

/**
 * Build a `Set<submissionId>` from Langfuse dataset items so the writer
 * can skip rows that are already in the dataset. Items without a string
 * `metadata.submissionId` are silently ignored — they predate Phase-2's
 * eval-export schema and aren't actionable for dedupe.
 */
export function buildExistingSubmissionIdSet(
  items: ReadonlyArray<{ metadata?: unknown }>,
): Set<string> {
  const set = new Set<string>();
  for (const item of items) {
    const md = item.metadata;
    if (md === null || md === undefined || typeof md !== "object") continue;
    const id = (md as { submissionId?: unknown }).submissionId;
    if (typeof id === "string" && id.length > 0) set.add(id);
  }
  return set;
}

export type EvalExportWriteResult = {
  /** Items successfully written to the Langfuse dataset. */
  created: string[];
  /** SubmissionIds skipped because they were already in the dataset. */
  skippedDedupe: string[];
  /** SubmissionIds skipped because the Neon lookup turned up no rows. */
  missingInDb: string[];
  /** Sampled traces whose metadata lacked a usable `submissionId`. */
  missingMetadata: string[];
  /** Per-trace write failures (createDatasetItem threw). */
  errors: Array<{ submissionId: string; error: unknown }>;
};

/**
 * Walk the sampled trace list, dedupe, look up the source exercise/answer
 * from Neon, and write a Langfuse dataset item per remaining trace.
 *
 * Per-trace failures are caught and recorded so a single bad row doesn't
 * abort the batch. Dataset-creation failures (caller path) are NOT
 * caught — they bubble up so the CLI exits non-zero.
 */
export async function writeSampledTracesToDataset(opts: {
  langfuse: LangfuseDatasetApi;
  db: DbExerciseLookup;
  datasetName: string;
  sampled: ReadonlyArray<FetchedTrace>;
  existingSubmissionIds: ReadonlySet<string>;
  now?: () => Date;
  log?: (...args: unknown[]) => void;
}): Promise<EvalExportWriteResult> {
  const {
    langfuse,
    db,
    datasetName,
    sampled,
    existingSubmissionIds,
    now = () => new Date(),
    log = (...args: unknown[]) => console.log(...args),
  } = opts;

  const created: string[] = [];
  const skippedDedupe: string[] = [];
  const missingInDb: string[] = [];
  const missingMetadata: string[] = [];
  const errors: Array<{ submissionId: string; error: unknown }> = [];

  for (const trace of sampled) {
    const meta = extractTraceMetadata(trace);
    if (
      meta.submissionId === undefined ||
      meta.language === undefined ||
      meta.cefrLevel === undefined ||
      meta.exerciseType === undefined
    ) {
      log(
        `[eval-export] trace ${trace.id} missing required metadata (submissionId/language/cefrLevel/exerciseType); skipping`,
      );
      missingMetadata.push(trace.id);
      continue;
    }
    const submissionId = meta.submissionId;

    if (existingSubmissionIds.has(submissionId)) {
      skippedDedupe.push(submissionId);
      continue;
    }

    let lookup: Awaited<
      ReturnType<DbExerciseLookup["lookupExerciseSubmission"]>
    >;
    try {
      lookup = await db.lookupExerciseSubmission(submissionId);
    } catch (err) {
      // DB read failure is per-row, not fatal: an intermittent Neon hiccup
      // shouldn't lose a 1000-trace export.
      log(
        `[eval-export] DB lookup failed for submission=${submissionId}; skipping`,
        err,
      );
      errors.push({ submissionId, error: err });
      continue;
    }
    if (lookup === null) {
      log(
        `[eval-export] no exercise row in Neon for submission=${submissionId}; skipping`,
      );
      missingInDb.push(submissionId);
      continue;
    }

    const datasetItemBody = {
      datasetName,
      input: {
        exercise: lookup.exerciseContent,
        userAnswer: lookup.userAnswer,
        language: lookup.language,
        difficulty: lookup.cefrLevel,
      },
      expectedOutput: trace.output,
      metadata: {
        submissionId,
        language: meta.language,
        cefrLevel: meta.cefrLevel,
        exerciseType: meta.exerciseType,
        localPromptVersion: meta.localPromptVersion,
        sourceTraceId: trace.id,
        exportedAt: now().toISOString(),
      },
    };

    try {
      await langfuse.createDatasetItem(datasetItemBody);
      created.push(submissionId);
    } catch (err) {
      log(
        `[eval-export] createDatasetItem failed for submission=${submissionId}; continuing`,
        err,
      );
      errors.push({ submissionId, error: err });
    }
  }

  return { created, skippedDedupe, missingInDb, missingMetadata, errors };
}

// ---------------------------------------------------------------------------
// runEvalExport — the testable orchestrator
// ---------------------------------------------------------------------------

export type EvalExportArgs = {
  from: string;
  to: string;
  sample: number;
  dataset: string;
  language?: string;
  cefr?: string;
  seed?: number;
};

export type EvalExportSamplingResult = {
  /** Total traces returned by `traceList` for the filter. */
  fetchedCount: number;
  /** Sampled subset (size = min(sample, fetched)). */
  sampled: FetchedTrace[];
  /** Tag filter actually sent to the API — surfaced for log/test visibility. */
  tags: string[];
};

/**
 * Fetch evaluate traces in the requested window + filter, then return a
 * uniform-random sample of size `--sample`. Task 22's foundational step;
 * `runEvalExport` (below) layers dataset-item creation on top.
 */
export async function runEvalExportSampling(
  langfuse: LangfuseTraceApi,
  args: EvalExportArgs,
  log: (...args: unknown[]) => void = (...args) => console.log(...args),
): Promise<EvalExportSamplingResult> {
  const tags = buildTagFilter({ language: args.language, cefr: args.cefr });

  const fetched = await fetchAllEvaluateTraces({
    langfuse,
    tags,
    fromTimestamp: args.from,
    toTimestamp: args.to,
  });

  const rng =
    args.seed !== undefined && Number.isFinite(args.seed)
      ? mulberry32(Math.trunc(args.seed))
      : Math.random;

  const sampled = uniformSample(fetched, args.sample, rng);

  log(
    `[eval-export] fetched=${fetched.length} sampled=${sampled.length} tags=${tags.join(",")}`,
  );

  return { fetchedCount: fetched.length, sampled, tags };
}

/**
 * End-to-end Task-23 orchestrator: sample traces → get-or-create dataset
 * → dedupe → look up per-trace Neon rows → write dataset items. Returns
 * the union of the sampling + write results so the CLI (and tests) can
 * print a single summary AND decide exit code in one place.
 *
 * Dataset-creation failure propagates (the CLI maps a throw here to
 * `exit 1`). Per-trace failures are recorded in the result.
 */
export async function runEvalExport(opts: {
  langfuse: LangfuseDatasetApi;
  db: DbExerciseLookup;
  args: EvalExportArgs;
  now?: () => Date;
  log?: (...args: unknown[]) => void;
}): Promise<EvalExportSamplingResult & EvalExportWriteResult> {
  const {
    langfuse,
    db,
    args,
    now,
    log = (...args: unknown[]) => console.log(...args),
  } = opts;

  const sampling = await runEvalExportSampling(langfuse, args, log);

  const { existingItems } = await getOrCreateDataset(langfuse, args.dataset);
  const existingSubmissionIds = buildExistingSubmissionIdSet(existingItems);

  const write = await writeSampledTracesToDataset({
    langfuse,
    db,
    datasetName: args.dataset,
    sampled: sampling.sampled,
    existingSubmissionIds,
    now,
    log,
  });

  log(
    `[eval-export] dataset=${args.dataset} created=${write.created.length} dedupe=${write.skippedDedupe.length} missingInDb=${write.missingInDb.length} missingMetadata=${write.missingMetadata.length} errors=${write.errors.length}`,
  );

  return { ...sampling, ...write };
}

// ---------------------------------------------------------------------------
// Date normalization — Langfuse's traceList expects ISO-8601 date-time
// ---------------------------------------------------------------------------

/**
 * Langfuse's `/api/public/traces` rejects bare `YYYY-MM-DD` strings with a
 * 400 because the OpenAPI schema marks `fromTimestamp` / `toTimestamp` as
 * `format: date-time` — so they must include a time + timezone component.
 *
 * Operators reasonably write `--from 2026-05-17 --to 2026-05-20` though.
 * Resolution: at the CLI boundary, if the value is a bare date, pad it
 * to UTC start-of-day (`--from`) or UTC end-of-day (`--to`). Full ISO
 * datetimes pass through verbatim. Anything `new Date()` can't parse
 * throws a clear error before we hit the network.
 *
 * Semantics: `--from <date>` and `--to <date>` together include all
 * traces with timestamps from the start of the `from` day through the
 * end of the `to` day inclusive (≈ what an operator naturally expects).
 */
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeFromTimestamp(value: string): string {
  if (DATE_ONLY_RE.test(value)) return `${value}T00:00:00.000Z`;
  return validateIsoDatetime(value, "--from");
}

export function normalizeToTimestamp(value: string): string {
  if (DATE_ONLY_RE.test(value)) return `${value}T23:59:59.999Z`;
  return validateIsoDatetime(value, "--to");
}

function validateIsoDatetime(value: string, flag: string): string {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    throw new Error(
      `[eval-export] ${flag} must be YYYY-MM-DD or ISO-8601 datetime, got ${JSON.stringify(value)}`,
    );
  }
  // Re-emit via toISOString so the API receives a canonical UTC form
  // regardless of which timezone the operator typed.
  return new Date(ms).toISOString();
}

// ---------------------------------------------------------------------------
// argv parsing
// ---------------------------------------------------------------------------

export function parseEvalExportArgs(argv: string[] = process.argv.slice(2)): EvalExportArgs {
  const parsed = parseArgs({
    args: argv,
    options: {
      from: { type: "string" },
      to: { type: "string" },
      sample: { type: "string" },
      dataset: { type: "string" },
      language: { type: "string" },
      cefr: { type: "string" },
      seed: { type: "string" },
      help: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  if (parsed.values.help) {
    printUsage();
    process.exit(0);
  }

  const missing: string[] = [];
  for (const key of ["from", "to", "sample", "dataset"] as const) {
    if (parsed.values[key] === undefined || parsed.values[key] === "") {
      missing.push(`--${key}`);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `[eval-export] missing required argument(s): ${missing.join(", ")}`,
    );
  }

  const sample = Number(parsed.values.sample);
  if (!Number.isFinite(sample) || sample <= 0 || !Number.isInteger(sample)) {
    throw new Error(
      `[eval-export] --sample must be a positive integer, got ${parsed.values.sample}`,
    );
  }

  let seed: number | undefined;
  if (parsed.values.seed !== undefined && parsed.values.seed !== "") {
    const parsedSeed = Number(parsed.values.seed);
    if (!Number.isFinite(parsedSeed) || !Number.isInteger(parsedSeed)) {
      throw new Error(
        `[eval-export] --seed must be an integer, got ${parsed.values.seed}`,
      );
    }
    seed = parsedSeed;
  }

  return {
    from: normalizeFromTimestamp(parsed.values.from!),
    to: normalizeToTimestamp(parsed.values.to!),
    sample,
    dataset: parsed.values.dataset!,
    language: parsed.values.language,
    cefr: parsed.values.cefr,
    seed,
  };
}

function printUsage(): void {
  console.log(
    [
      "Usage: pnpm eval:export --from <date> --to <date> --sample <n> --dataset <name>",
      "                       [--language <code>] [--cefr <level>] [--seed <int>]",
      "",
      "Samples Phase-1 evaluation traces from Langfuse into a candidate eval dataset.",
      "",
      "  --from <date>       Lower bound on trace.timestamp. Accepts YYYY-MM-DD",
      "                      (interpreted as UTC start-of-day) or full ISO-8601.",
      "  --to <date>         Upper bound on trace.timestamp. Accepts YYYY-MM-DD",
      "                      (interpreted as UTC end-of-day, inclusive of that day)",
      "                      or full ISO-8601.",
      "  --sample <n>        Desired sampled-item count (capped at population size).",
      "  --dataset <name>    Langfuse dataset to write into.",
      "  --language <code>   Optional language filter — ES, DE, TR.",
      "  --cefr <level>      Optional CEFR filter — A1, A2, B1, B2, C1, C2.",
      "  --seed <int>        Optional PRNG seed for reproducible sampling.",
      "  --help              Show this message.",
    ].join("\n"),
  );
}

// ---------------------------------------------------------------------------
// CLI entry — only runs when invoked directly via `tsx scripts/eval-export.ts`
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseEvalExportArgs();

  const lf = getLangfuse();
  if (!lf) {
    console.error(
      "[eval-export] Langfuse client unavailable — set LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY in your env",
    );
    process.exit(1);
  }

  // The Drizzle WebSocket pool is only created here (on the CLI path).
  // Tests inject a `DbExerciseLookup` stub via `runEvalExport(opts)` directly.
  const db = createDb(requireEnv("DATABASE_URL"));
  const result = await runEvalExport({
    langfuse: lf,
    db: createDbExerciseLookup(db),
    args,
  });

  if (result.errors.length > 0) {
    process.exit(1);
  }
}

/**
 * The Langfuse SDK throws a `Response` object on non-2xx replies. `Response`'s
 * default toString prints `[object Response]` and Node's util.inspect shows
 * the public getters (status, headers, etc.) but NOT the body — which is
 * where the actual error message lives. Read it once before exiting so the
 * operator sees something they can act on.
 */
async function formatError(err: unknown): Promise<string> {
  if (err instanceof Response) {
    let body: string;
    try {
      body = await err.text();
    } catch {
      body = "<unable to read response body>";
    }
    return `HTTP ${err.status} ${err.statusText} from ${err.url}\n  body: ${body}`;
  }
  return err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
}

const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch(async (err) => {
    console.error("[eval-export] unhandled failure:", await formatError(err));
    process.exit(1);
  });
}
