/**
 * Pure helpers for vocab_recall target-seeding (generation-seeding alignment,
 * Spec 2). `computeUncoveredTargetBand` water-fills toward gaps: it drops any
 * curated target already covered by an approved exercise. `pickTargetSeeds`
 * assigns the uncovered band to draft ordinals in priority order (the band is
 * pre-sorted core/high-frequency first), so a partial batch covers the most
 * important words first. See
 * docs/superpowers/specs/2026-07-10-vocab-generation-seeding-design.md.
 */

import { normalizeWord } from '@language-drill/shared';

export type VocabTargetRow = { lemma: string; displayForm: string };

/**
 * Target lemmas not yet covered. `covered` holds already-`normalizeWord`-ed
 * surfaces (from approved exercises' expectedWord); a target is covered when
 * EITHER its normalized lemma OR its normalized displayForm is present — the
 * same lemma-or-displayForm match the Spec-1 coverage read model uses.
 */
export function computeUncoveredTargetBand(
  targets: readonly VocabTargetRow[],
  covered: ReadonlySet<string>,
): string[] {
  return targets
    .filter(
      (t) =>
        !covered.has(normalizeWord(t.lemma)) &&
        !covered.has(normalizeWord(t.displayForm)),
    )
    .map((t) => t.lemma);
}

export type PickTargetSeedsOptions = {
  /** Uncovered target lemmas, priority-ordered (core/high-frequency first). */
  band: readonly string[];
  /** Number of ordinal slots (one seed per draft). */
  count: number;
  /** In-flight seeds already anchored in the cell (case-insensitive). */
  exclude: ReadonlySet<string>;
};

/**
 * Sequential, priority-preserving picker: walk the band once, assigning each
 * non-excluded, not-yet-chosen lemma to the next ordinal. Unlike the hashing
 * `pickSeeds`, this keeps the band's priority order so a batch smaller than the
 * band still covers the most important words. Slots past the band's end are
 * `null` (the caller falls back to unseeded generation for them).
 */
export function pickTargetSeeds(opts: PickTargetSeedsOptions): (string | null)[] {
  const { band, count, exclude } = opts;
  const excludeLc = new Set<string>();
  for (const w of exclude) excludeLc.add(w.toLowerCase());

  const result: (string | null)[] = [];
  const chosen = new Set<string>();
  let bandIdx = 0;
  for (let ordinal = 0; ordinal < count; ordinal++) {
    let pick: string | null = null;
    while (bandIdx < band.length) {
      const lemma = band[bandIdx++];
      const lc = lemma.toLowerCase();
      if (excludeLc.has(lc) || chosen.has(lc)) continue;
      pick = lemma;
      chosen.add(lc);
      break;
    }
    result.push(pick);
  }
  return result;
}

/**
 * A curated vocab_recall cell generates only the drafts the picker could seed.
 * `pickTargetSeeds` returns `null` for slots past the uncovered band, and an
 * unseeded draft free-generates: off-list words, piled onto the same few
 * surfaces. The band runs short whenever a target's only row is flagged — the
 * scheduler counts it uncovered (approved rows only) while the picker excludes
 * it (live seeds include flagged) — so on 2026-10-20 306 of 380 new-umbrella
 * rows were unseeded. Nulls are always trailing, so the seeded prefix is kept.
 * `seeds === undefined` (no curated list) leaves the cell on free generation.
 */
export function capToSeededTargets(
  seeds: readonly (string | null)[] | undefined,
  count: number,
): { seeds: readonly (string | null)[] | undefined; count: number } {
  if (seeds === undefined) return { seeds, count };
  const seeded = seeds.filter((s): s is string => s !== null);
  return { seeds: seeded, count: Math.min(count, seeded.length) };
}
