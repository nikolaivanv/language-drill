/**
 * packages/db — Deterministic frequency-seed picker for cloze/translation
 * generation (exercise-generation-quality R5).
 *
 * Each ordinal in a cell is assigned a distinct content-word seed drawn from
 * the bundled per-language frequency dictionary, restricted to a CEFR→rank
 * band. The seed is a pure function of `(batchSeed, ordinal)` (hashed) over the
 * band, so the same cell+batch reproduces the same seeds — a prerequisite for
 * the same-day idempotent scheduler. The generator receives the seed as a loose
 * "build around this word" hint in the per-draft user prompt (task 13), so the
 * cached system-prompt prefix is unaffected (R5.4).
 *
 * Pure function — no I/O, no Claude calls. The `exclude` set (live-pool seeds,
 * supplied by the caller) is what makes seeding cross-run-aware (R5.3): words
 * already anchored in the cell are skipped so the cell keeps spreading across
 * lexical space instead of re-proposing the same anchors.
 */

import { type CefrLevel, type LearningLanguage } from '@language-drill/shared';
import { cefrRankWindow, frequencyBand } from '@language-drill/ai';

import { deterministicUuid } from '../lib/deterministic-uuid';

export type PickSeedsOptions = {
  language: LearningLanguage;
  /** Cell CEFR level — selects the frequency rank band (`cefrRankWindow`). */
  cefrLevel: CefrLevel;
  /** Per-cell+batch seed string; combined with the ordinal to index the band. */
  batchSeed: string;
  /** Number of ordinals to assign (one seed slot per ordinal). */
  count: number;
  /** Lemmas already anchored in the cell's live pool — never re-proposed. */
  exclude: ReadonlySet<string>;
};

/**
 * Maps a string key to a non-negative 32-bit integer by reusing the FNV-based
 * `deterministicUuid` (the generation path's one hashing primitive) and reading
 * the top 32 bits of its 128-bit digest. The first 8 hex chars precede the
 * UUID's first `-`, so `parseInt(_, 16)` is always `<= 0xffffffff`.
 */
function hashIndex(key: string): number {
  return parseInt(deterministicUuid(key).slice(0, 8), 16);
}

/**
 * Returns `count` seed slots, one per ordinal, each a distinct frequency-band
 * lemma or `null`.
 *
 * Per ordinal: hash `(batchSeed, ordinal)` to a start index in the band, then
 * linear-probe forward for the first lemma that is neither in `exclude` (live
 * pool, R5.3) nor already chosen in this batch (distinctness, R5.1). When the
 * whole band is exhausted for an ordinal — or the band is empty for this
 * `(language, window)` — that slot is `null`, signalling the caller to fall
 * back to unseeded generation for it (R5.6). Stopword/rank-band filtering is
 * handled upstream by `frequencyBand` (R5.2).
 *
 * Deterministic: identical options produce identical output.
 */
export function pickSeeds(opts: PickSeedsOptions): (string | null)[] {
  const { language, cefrLevel, batchSeed, count, exclude } = opts;

  const window = cefrRankWindow(cefrLevel);
  const band = frequencyBand(language, window.rankMin, window.rankMax);

  // Normalise the exclude set to the band's lowercase lemma space.
  const excludeLc = new Set<string>();
  for (const word of exclude) excludeLc.add(word.toLowerCase());

  const result: (string | null)[] = [];

  if (band.length === 0) {
    // R5.6 — no eligible candidates for this band → every ordinal unseeded.
    for (let ordinal = 0; ordinal < count; ordinal++) result.push(null);
    return result;
  }

  const chosen = new Set<string>();
  for (let ordinal = 0; ordinal < count; ordinal++) {
    const start = hashIndex(`${batchSeed}|${ordinal}`) % band.length;
    let pick: string | null = null;
    for (let step = 0; step < band.length; step++) {
      const lemma = band[(start + step) % band.length];
      if (excludeLc.has(lemma) || chosen.has(lemma)) continue;
      pick = lemma;
      chosen.add(lemma);
      break;
    }
    result.push(pick);
  }

  return result;
}
