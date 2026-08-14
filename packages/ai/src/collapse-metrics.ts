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
  // The FIRST model answer, not the prompt. Signal 1 measures the answer side
  // on every other type, and until 2026-08-14 SC was the exception: it read
  // `prompt`, on the reasoning that free production has no single correct
  // answer. The consequence was that nothing measured what an SC cell actually
  // produces — a cell whose every model answer used one construction was
  // invisible. #648's rotation removed the original objection by binding every
  // model answer to one construction, so there is now a single scorable target.
  // Prompt-side (scene) collapse did not go unmeasured: it moved to signal 3,
  // which is where the scene is read for every other type.
  sentence_construction: 'modelAnswers',
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
  // `modelAnswers` is an array of alternatives (3 in practice). The FIRST is
  // the canonical one; pooling all three would triple-count each row and blur
  // the very concentration being measured.
  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === 'string' ? first : null;
  }
  return typeof value === 'string' ? value : null;
}

/**
 * Strip punctuation from each token's EDGES only. Word-internal apostrophes and
 * hyphens are preserved deliberately — `Anne'nin`, `e-posta`, and `don't` are
 * single words, and collapsing them would merge distinct TR possessive answers
 * into one bucket. Same INTENT as the `tokenize.ts` reader, but an independent
 * implementation — this one additionally strips `\p{S}` from the edges.
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
  /** ALL rows in the cell, tagged or not — this is the cell's approved count, the
   *  same number `atTarget` compares against `target`. Deliberately a different
   *  denominator from `VariantSkew.declaredRows`, which counts declared-variant
   *  rows only; the two are serialized side by side in the per-cell JSON. */
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
  /** Fair share of the DECLARED-variant pool: `declaredRows * share / totalShare`. */
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
  /**
   * Rows carrying a declared variant id. Quotas are computed against this.
   * NOT the cell's approved count — `SpecShortfall.approved` is that, and the
   * two sit side by side in the same per-cell JSON, so this one is named for
   * its narrower denominator.
   */
  declaredRows: number;
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
  const declaredRows = variants.reduce((sum, v) => sum + (counts.get(v.id) ?? 0), 0);
  const totalShare = variants.reduce((sum, v) => sum + (v.share ?? 1), 0);

  const perVariant: VariantCoverage[] = variants.map((v) => {
    const share = v.share ?? 1;
    return {
      id: v.id,
      count: counts.get(v.id) ?? 0,
      share,
      quota: (declaredRows * share) / totalShare,
    };
  });

  return {
    perVariant,
    overQuota: perVariant.filter((v) => v.count > v.quota).map((v) => v.id),
    underMin: perVariant.filter((v) => v.count < MIN_PER_VARIANT).map((v) => v.id),
    unrecognizedSeedCount,
    declaredRows,
  };
}

/**
 * Function words dropped before counting content lemmas. Deliberately a single
 * pooled multi-language set rather than per-language lists: a stopword from the
 * wrong language cannot cause a false NEGATIVE here (it only removes a candidate
 * that was never going to be the interesting content lemma), and one list is far
 * cheaper to maintain than four. English is included because translation stems
 * are the L1 source text.
 */
export const STOPWORDS: ReadonlySet<string> = new Set([
  // EN
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'for', 'with',
  'is', 'are', 'was', 'were', 'be', 'been', 'it', 'its', 'this', 'that', 'these',
  'those', 'i', 'you', 'he', 'she', 'we', 'they', 'my', 'your', 'his', 'her', 'our',
  'their', 'not', 'do', 'does', 'did', 'have', 'has', 'had', 'will', 'would', 'can',
  // ES
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'y', 'o', 'pero', 'de',
  'del', 'a', 'al', 'en', 'con', 'por', 'para', 'que', 'se', 'no', 'es', 'son',
  'era', 'ser', 'estar', 'esta', 'este', 'mi', 'tu', 'su', 'lo', 'le', 'me', 'te',
  // DE
  'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem', 'eines',
  'und', 'oder', 'aber', 'von', 'zu', 'im', 'in', 'auf', 'mit', 'für', 'ist', 'sind',
  'war', 'waren', 'sein', 'nicht', 'ich', 'du', 'er', 'sie', 'es', 'wir', 'ihr',
  // TR
  've', 'ile', 'bir', 'bu', 'şu', 'o', 'da', 'de', 'ki', 'için', 'ama', 'ya', 'çok',
  'ben', 'sen', 'biz', 'siz', 'onlar', 'var', 'yok', 'değil',
]);

/**
 * Default flag threshold for stem monotony. Calibration-phase (see the
 * 2026-08-11 design doc): the first prod sweep flagged 279 cells at 0.5 vs.
 * 109 at 0.85, but raising the threshold alone can't fix the signal —
 * spot-checks showed most flags are a point's own target lexeme (`dass`,
 * `nachdem`, `if`, `gestern`) appearing in every stem at share ≈ 1.0,
 * surviving even a 0.95 cutoff. A point that drills `dass` correctly has
 * `dass` in every stem; that's the content working as designed, not topic
 * monotony. The durable fix is excluding each point's own target lexeme (or
 * folding connector words into `STOPWORDS`) — a v2 change, out of scope here.
 * 0.85 keeps the signal rather than dropping it: spot-checks also turned up
 * genuine topic repetition, one of which independently corroborated a real
 * variant-skew defect. Tune via `--monotony-threshold`.
 */
export const MONOTONY_THRESHOLD_DEFAULT = 0.85;

/** The `content_json` field carrying the exercise's scene text, per type. */
const STEM_FIELD: Partial<Record<`${ExerciseType}`, string>> = {
  cloze: 'sentence',
  // The L1 SOURCE, not the reference translation: the scene is authored in the
  // source, and the reference is already signal 1's surface.
  translation: 'sourceText',
  sentence_construction: 'prompt',
  // conjugation is deliberately absent — its lexical head IS the lemma, which
  // signal 1 already measures. Counting it twice would double-report one defect.
};

export function stemOf(type: ExerciseType, content: Record<string, unknown>): string | null {
  const field = STEM_FIELD[type];
  if (field === undefined) return null;
  const value = content[field];
  return typeof value === 'string' ? value : null;
}

/**
 * Per-row vocabulary that is TASK FRAMING rather than scene, and so must not
 * count toward monotony.
 *
 * Only `sentence_construction` has any: its `prompt` interleaves the scene with
 * the task specification ("Use all four words below in one sentence…"), and the
 * specification's words recur in essentially every row by construction. Measured
 * on prod 2026-08-14, that made the signal useless — **26 of 33 SC cells
 * flagged**, with top lemmas `one` (5 cells), `sentence` (3), `use` (2),
 * `passive` (2), `causative` (2). Exactly one of the 33 (`friend`) was real
 * scene repetition.
 *
 * The row's own `instructions` field is pure boilerplate — the same task
 * specification, minus the scene — so subtracting its vocabulary strips the
 * noise without a hand-maintained stoplist that would drift as prompts evolve.
 * It also removes the point's own target term (`passive`, `causative`), which is
 * the #634 calibration weakness ("stem monotony mostly measures each point's OWN
 * target lexeme") solved for this type as a side effect.
 *
 * Scene words survive because they do not appear in the instructions:
 * `de-a1-questions`' "your friend" frame is still detected.
 */
export function stemNoiseOf(
  type: ExerciseType,
  content: Record<string, unknown>,
): ReadonlySet<string> {
  if (type !== ExerciseType.SENTENCE_CONSTRUCTION) return EMPTY_NOISE;
  const instructions = content['instructions'];
  if (typeof instructions !== 'string') return EMPTY_NOISE;
  return new Set(tokens(instructions));
}

const EMPTY_NOISE: ReadonlySet<string> = new Set<string>();

export type StemMonotony = {
  topLemma: string;
  /** Stems CONTAINING the lemma — counted once per stem, not per occurrence. */
  count: number;
  total: number;
  share: number;
};

/**
 * Share of a cell's stems containing the single most common content lemma. The
 * cheap end of the metric family: no embeddings, no clustering. If it proves too
 * blunt, clustering is a v2 and must not block signals 1 and 2.
 */
export function computeStemMonotony(
  type: ExerciseType,
  rows: readonly AuditRow[],
): StemMonotony | null {
  const docFrequency = new Map<string, number>();
  let total = 0;
  for (const r of rows) {
    const stem = stemOf(type, r.content);
    if (stem === null) continue;
    total += 1;
    const noise = stemNoiseOf(type, r.content);
    const content = new Set(
      // Drop stopwords, pure digits, and this row's task-framing vocabulary. The
      // cloze blank marker needs no clause of its own: `_` is U+005F, category
      // `Pc` ⊂ `\p{P}`, so `EDGE_PUNCT` already strips `___` down to the empty
      // string and `tokens` drops it.
      tokens(stem).filter(
        (t) => !STOPWORDS.has(t) && !/^\d+$/u.test(t) && !noise.has(t),
      ),
    );
    for (const lemma of content) {
      docFrequency.set(lemma, (docFrequency.get(lemma) ?? 0) + 1);
    }
  }
  if (total === 0 || docFrequency.size === 0) return null;

  const sorted = [...docFrequency.entries()].sort(
    (a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]),
  );
  return { topLemma: sorted[0][0], count: sorted[0][1], total, share: sorted[0][1] / total };
}
