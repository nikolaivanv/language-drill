/**
 * Construction-coverage audit (2026-08-18 design). In-repo prompts + forced
 * tools + pure parsers, mirroring `collapse-triage.ts` and `gloss-spoilage.ts`.
 * NOT a runtime Lambda path and NOT registered in Langfuse — a dev-time aid run
 * by a human via the `audit:constructions` CLI. Do NOT add it to the PROMPTS
 * manifest in `bootstrap-prompts.ts`. Bump the version constant on prompt edits.
 *
 * Finds the defect neither the generator nor the validator can see: a point
 * whose description claims N constructions but whose approved pool realizes
 * one. `audit:collapse` cannot find it either — two of its three signals read
 * declared mechanisms that a spec-less point lacks by definition, and the other
 * two are lexical, so 45 rows of one construction over 45 different nouns look
 * diverse.
 *
 * This module holds NO db import (`ai` must not import `db` — CI TS2307). The
 * grammar point and every DB-derived value are passed in by the CLI.
 */

export const CONSTRUCTION_COVERAGE_PROMPT_VERSION = 'construction-coverage@2026-08-18';

/** A mustRepresent construction at or below this share of classified rows is a
 *  finding. At the default sample of 24 this means 0 or 1 row — the cliff is
 *  sharp by design: the defect being hunted is near-total absence, not mild
 *  skew (mild skew on a DECLARED mechanism is audit:collapse's variant-skew). */
export const FINDING_MAX_SHARE = 0.05;

/** Above this share of `none` + `unclear`, the honest reading is that the
 *  enumeration was wrong, not that the pool is collapsed. Such a cell reports
 *  as `enumeration-suspect` and produces NO finding — without this gate a bad
 *  stage-1 call manufactures a confident finding from every row it failed to
 *  understand. */
export const JUDGE_HEALTH_MAX_UNRESOLVED_SHARE = 0.33;

export type ClaimedConstruction = {
  /** kebab-case; reused as the proposed variant id in the proposal stage. */
  id: string;
  label: string;
  mustRepresent: boolean;
  rationale: string;
};

export type PointEnumeration = {
  grammarPointKey: string;
  constructions: ClaimedConstruction[];
  mechanism: 'construction-variants' | 'coverage-spec' | 'none';
};

/** One approved row as the CLI loads it. `content` is the raw `content_json`
 *  blob — deliberately untyped, since the audit reads legacy rows whose shape
 *  predates the current discriminated union. */
export type AuditRow = {
  id: string;
  content: Record<string, unknown>;
};

/** One classifier result. `constructionId: null` covers both `none` (the row
 *  realizes something not on the list) and `unclear`. */
export type RowClassification = {
  constructionId: string | null;
};

export type ConstructionCount = {
  id: string;
  label: string;
  mustRepresent: boolean;
  count: number;
  /** Of CLASSIFIED rows, not of sampled rows. */
  share: number;
};

export type CellAnalysis = {
  status: 'ok' | 'finding' | 'enumeration-suspect';
  /** Rows that resolved to a construction id. */
  classified: number;
  /** Rows that resolved to `none` or `unclear`. */
  unresolved: number;
  /** classified + unresolved — the report's denominator. */
  sampled: number;
  counts: ConstructionCount[];
  /** mustRepresent constructions at or below FINDING_MAX_SHARE, minus
   *  dismissals. Always empty unless `status === 'finding'`. */
  missing: ConstructionCount[];
};

/** Tiny inline concurrency limiter. A local copy rather than an import: the
 *  equivalent helper lives in `packages/db/scripts/p-limit.ts`, and `ai` must
 *  not depend on `db`. */
export type LimitFn = <T>(fn: () => Promise<T>) => Promise<T>;

export function pLimit(concurrency: number): LimitFn {
  if (concurrency < 1) throw new Error('pLimit: concurrency must be >= 1');
  let active = 0;
  const queue: Array<() => void> = [];

  const next = (): void => {
    if (active >= concurrency) return;
    const job = queue.shift();
    if (job) job();
  };

  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = (): void => {
        active++;
        fn()
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          });
      };
      queue.push(run);
      next();
    });
}

/** FNV-1a. Small, dependency-free, and stable across Node versions — the
 *  sample must reproduce exactly from a `--seed`. */
function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Deterministic, spread sample of a cell's rows.
 *
 * Ordering by the row's own `created_at` (or by input order, which is the
 * same thing) would be wrong: consecutive rows come from the same generation
 * batch and share a prompt version, so a head-of-list sample measures one
 * batch's habits rather than the cell's. Hashing `(seed, id)` spreads the
 * sample across batches while staying reproducible.
 */
export function sampleRowsForCell<T extends { id: string }>(
  rows: readonly T[],
  seed: string,
  cap: number,
): T[] {
  if (rows.length <= cap) return [...rows];
  return [...rows]
    .map((row) => ({ row, h: hash32(`${seed}:${row.id}`) }))
    .sort((a, b) => (a.h === b.h ? a.row.id.localeCompare(b.row.id) : a.h - b.h))
    .slice(0, cap)
    .map((entry) => entry.row);
}

export type AnalyzeCellInput = {
  constructions: readonly ClaimedConstruction[];
  classifications: readonly RowClassification[];
  dismissedConstructionIds: ReadonlySet<string>;
};

/** Pure verdict. No LLM, no I/O. */
export function analyzeCell(input: AnalyzeCellInput): CellAnalysis {
  const { constructions, classifications, dismissedConstructionIds } = input;

  const sampled = classifications.length;
  const tally = new Map<string, number>();
  let unresolved = 0;
  for (const c of classifications) {
    if (c.constructionId === null) {
      unresolved++;
      continue;
    }
    tally.set(c.constructionId, (tally.get(c.constructionId) ?? 0) + 1);
  }
  const classified = sampled - unresolved;

  const counts: ConstructionCount[] = constructions.map((c) => {
    const count = tally.get(c.id) ?? 0;
    return {
      id: c.id,
      label: c.label,
      mustRepresent: c.mustRepresent,
      count,
      // Guard the divide: a fully unresolved cell is caught by the health gate
      // below, but must not produce NaN shares in the report on the way there.
      share: classified === 0 ? 0 : count / classified,
    };
  });

  if (sampled === 0 || unresolved / sampled > JUDGE_HEALTH_MAX_UNRESOLVED_SHARE) {
    return { status: 'enumeration-suspect', classified, unresolved, sampled, counts, missing: [] };
  }

  const missing = counts.filter(
    (c) =>
      c.mustRepresent &&
      c.share <= FINDING_MAX_SHARE &&
      !dismissedConstructionIds.has(c.id),
  );

  return {
    status: missing.length > 0 ? 'finding' : 'ok',
    classified,
    unresolved,
    sampled,
    counts,
    missing,
  };
}
