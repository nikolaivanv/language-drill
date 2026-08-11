/**
 * Pool collapse metrics (2026-08-11 design). Pure — no I/O, no env, and NO
 * import of `@language-drill/db`: the grammar point's declared config is passed
 * in by the caller (`packages/ai/scripts/audit-collapse.ts`), which is the only
 * unit allowed to touch both `db` and Anthropic.
 *
 * Signal 1 (this file, below) is deliberately SPEC-AGNOSTIC. It never reads
 * `coverageSpec`, which is exactly why it catches a satisfied spec that fails to
 * cover a point's real variation — the PR #631 class of defect, where
 * `de-b1-um-zu-damit` was 49/50 `damit` on a point whose entire content is the
 * `um…zu` / `damit` contrast, and no CoverageAxis could have expressed it.
 */

import { ExerciseType, MIN_PER_VARIANT } from '@language-drill/shared';
import type { CoverageTags, CoverageAxis, GrammarPoint } from '@language-drill/shared';

/** One approved exercise row, as the CLI loads it. `content` is the raw
 *  `content_json` blob — deliberately untyped, since the audit reads legacy rows
 *  whose shape predates the current discriminated union. */
export type AuditRow = {
  id: string;
  type: ExerciseType;
  content: Record<string, unknown>;
  coverageTags: CoverageTags | null;
};

/** How many distinct surfaces the report shows per cell. Also the number the
 *  triage prompt sees — enough to judge, small enough to stay cheap. */
export const DISTRIBUTION_LIMIT = 8;

export type SurfaceDistribution = {
  topSurface: string;
  topCount: number;
  /** Rows that yielded a usable surface. Rows without one are excluded. */
  total: number;
  share: number;
  distribution: Array<{ surface: string; count: number }>;
};

export type SurfaceFlagOptions = { minRows: number; threshold: number };

/** The `content_json` field whose value collapses, per exercise type. */
const SURFACE_FIELD: Partial<Record<`${ExerciseType}`, string>> = {
  cloze: 'correctAnswer',
  translation: 'referenceTranslation',
  // The lexical head the cell collapses onto despite satisfied person floors —
  // the failure `conjugationSeedWords` exists to fix.
  conjugation: 'lemma',
  // Free production, so there is no single correct answer: the TASK FRAMING is
  // what collapses (`de-b2-mittelfeld-word-order`, 91% "Sie hat…").
  sentence_construction: 'prompt',
};

/** Raw surface string for a row, or null when this type has no defined surface
 *  or the field is absent / not a string. */
export function surfaceOf(
  type: ExerciseType,
  content: Record<string, unknown>,
): string | null {
  const field = SURFACE_FIELD[type];
  if (field === undefined) return null;
  const value = content[field];
  return typeof value === 'string' ? value : null;
}

/**
 * Strip punctuation from each token's EDGES only. Word-internal apostrophes and
 * hyphens are preserved deliberately — `Anne'nin`, `e-posta`, and `don't` are
 * single words, and collapsing them would merge distinct TR possessive answers
 * into one bucket. Same rule the `tokenize.ts` reader uses.
 */
const EDGE_PUNCT = /^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu;

function tokens(raw: string): string[] {
  return raw
    .toLowerCase()
    .split(/\s+/u)
    .map((t) => t.replace(EDGE_PUNCT, ''))
    .filter((t) => t.length > 0);
}

/**
 * The comparable key for one surface. Per type:
 *   - cloze: the ANSWER HEAD (first token) — a cloze blank holds one word, and
 *     trailing context varies.
 *   - translation / sentence_construction: the LEADING BIGRAM — the construction
 *     frame lives at the start of the sentence (`Dicen que…`, `Sie hat…`).
 *   - conjugation: the WHOLE lemma — multiword lemmas (`sich freuen`, `dar
 *     cuenta`) are one lexical identity, so taking the head would merge every
 *     reflexive under `sich`.
 */
export function normalizeSurface(type: ExerciseType, raw: string): string | null {
  const parts = tokens(raw);
  if (parts.length === 0) return null;
  if (type === ExerciseType.CONJUGATION) return parts.join(' ');
  if (type === ExerciseType.CLOZE) return parts[0];
  return parts.slice(0, 2).join(' ');
}

/** Top-surface concentration for one cell, or null when no row yields a usable
 *  surface. Ties break alphabetically so the output is deterministic. */
export function computeSurfaceCollapse(
  type: ExerciseType,
  rows: readonly AuditRow[],
): SurfaceDistribution | null {
  const counts = new Map<string, number>();
  let total = 0;
  for (const r of rows) {
    const raw = surfaceOf(type, r.content);
    if (raw === null) continue;
    const key = normalizeSurface(type, raw);
    if (key === null) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    total += 1;
  }
  if (total === 0) return null;

  const sorted = [...counts.entries()]
    .map(([surface, count]) => ({ surface, count }))
    .sort((a, b) => (b.count - a.count) || a.surface.localeCompare(b.surface));

  return {
    topSurface: sorted[0].surface,
    topCount: sorted[0].count,
    total,
    share: sorted[0].count / total,
    distribution: sorted.slice(0, DISTRIBUTION_LIMIT),
  };
}

/** The PR #631 sweep gate: enough rows to be meaningful, concentrated enough to
 *  be suspicious. Inclusive on both bounds. */
export function isSurfaceFlagged(
  d: SurfaceDistribution | null,
  opts: SurfaceFlagOptions,
): boolean {
  if (d === null) return false;
  return d.total >= opts.minRows && d.share >= opts.threshold;
}

export type FloorShortfall = {
  axis: CoverageAxis;
  value: string;
  floor: number;
  actual: number;
};

export type SpecShortfall = {
  shortfalls: FloorShortfall[];
  approved: number;
  target: number;
  /**
   * `approved >= target`. THE load-bearing field: a cell below target self-heals
   * once the scheduler resumes (its `need = target - approved` is positive, so
   * the floors get targeted on the next batch). A cell AT target has no deficit,
   * so the scheduler never revisits it and the floors never fire, however loudly
   * they are declared. That cell needs `pnpm demote:pool` — the "classic trap"
   * in docs/curriculum-authoring.md.
   */
  atTarget: boolean;
};

/**
 * Declared `coverageSpec` floors vs. the realized `coverage_tags` distribution.
 * Deterministic, no LLM: the declared floor is ground truth, so there is nothing
 * to triage. Returns null for a point without a spec.
 *
 * Rows whose `coverage_tags` lack the axis are simply not counted toward any
 * value — untagged legacy rows are not evidence that a floor is met.
 */
export function computeSpecShortfall(
  gp: GrammarPoint,
  rows: readonly AuditRow[],
  target: number,
): SpecShortfall | null {
  const spec = gp.coverageSpec;
  if (!spec) return null;

  const shortfalls: FloorShortfall[] = [];
  for (const axis of spec.axes) {
    const counts = new Map<string, number>();
    for (const r of rows) {
      const value = r.coverageTags?.[axis.name];
      if (typeof value !== 'string') continue;
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    for (const [value, floor] of Object.entries(axis.floors)) {
      const actual = counts.get(value) ?? 0;
      if (actual < (floor as number)) {
        shortfalls.push({ axis: axis.name, value, floor: floor as number, actual });
      }
    }
  }

  return { shortfalls, approved: rows.length, target, atTarget: rows.length >= target };
}

export type VariantCoverage = {
  id: string;
  count: number;
  share: number;
  /** Fair share of the DECLARED-variant pool: `approved * share / totalShare`. */
  quota: number;
};

export type VariantSkew = {
  perVariant: VariantCoverage[];
  /** Variants holding more rows than their quota. */
  overQuota: string[];
  /** Variants below `MIN_PER_VARIANT` — too thin to appear in a learner's rotation. */
  underMin: string[];
  /**
   * Rows whose `content_json.seedWord` is null or is not a declared variant id.
   * Nothing else in the codebase measures this, and it is the hazard the #631
   * rollout documented at length: an unbackfilled legacy row occupies an approved
   * slot (counting toward `target - approved`) while contributing to NO variant's
   * quota, so the scheduler reads every variant as zero-covered on a cell that is
   * simultaneously at target.
   */
  unrecognizedSeedCount: number;
  /** Rows carrying a declared variant id. Quotas are computed against this. */
  approved: number;
};

/** Declared `constructionVariants` vs. the realized `seedWord` distribution.
 *  Deterministic. Returns null for a point without variants. */
export function computeVariantSkew(
  gp: GrammarPoint,
  rows: readonly AuditRow[],
): VariantSkew | null {
  const variants = gp.constructionVariants;
  if (!variants || variants.length === 0) return null;

  const declared = new Set(variants.map((v) => v.id));
  const counts = new Map<string, number>();
  let unrecognizedSeedCount = 0;
  for (const r of rows) {
    const seed = r.content.seedWord;
    if (typeof seed === 'string' && declared.has(seed)) {
      counts.set(seed, (counts.get(seed) ?? 0) + 1);
    } else {
      unrecognizedSeedCount += 1;
    }
  }

  // Only declared variants count toward the pool — a legacy frequency-word seed
  // is not evidence that any variant is covered. Same rule as `pickVariantSeeds`.
  const approved = variants.reduce((sum, v) => sum + (counts.get(v.id) ?? 0), 0);
  const totalShare = variants.reduce((sum, v) => sum + (v.share ?? 1), 0);

  const perVariant: VariantCoverage[] = variants.map((v) => {
    const share = v.share ?? 1;
    return {
      id: v.id,
      count: counts.get(v.id) ?? 0,
      share,
      quota: (approved * share) / totalShare,
    };
  });

  return {
    perVariant,
    overQuota: perVariant.filter((v) => v.count > v.quota).map((v) => v.id),
    underMin: perVariant.filter((v) => v.count < MIN_PER_VARIANT).map((v) => v.id),
    unrecognizedSeedCount,
    approved,
  };
}
