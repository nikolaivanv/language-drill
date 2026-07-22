/**
 * packages/ai — qa-sample-run CLI. Spot-checks the approved exercise pool by
 * crafting three intent-labeled answers per sampled exercise (Opus) and running
 * each through the production evaluator, flagging (exercise -> evaluator)
 * contract defects to ./qa-runs/<name>.json. Author-run; a spotlight, not a gate.
 *
 * Built bottom-up: this file currently holds only the pure sampling helpers
 * (Task 5). Orchestration + report + CLI entry land in Task 6.
 */

export type PoolRow = {
  id: string;
  type: string;
  language: string;
  difficulty: string;
  grammarPointKey: string | null;
  contentJson: unknown;
};

/** The six exercise-type db values routed through `evaluateAnswer`. */
export const QA_SAMPLE_TYPES = [
  "cloze",
  "translation",
  "vocab_recall",
  "sentence_construction",
  "conjugation",
  "contextual_paraphrase",
] as const;

/** Small deterministic PRNG (mulberry32) — reproducible sampling under --seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seeded Fisher–Yates. Returns a new array; does not mutate the input. */
function shuffle<T>(items: T[], rng: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Group rows by grammarPointKey (nulls share one bucket), shuffle each group
 * with the seeded RNG, and take up to `perPoint` from each. Deterministic for a
 * given (rows-set, perPoint, seed).
 */
export function samplePerPoint(rows: PoolRow[], perPoint: number, seed: number): PoolRow[] {
  const groups = new Map<string, PoolRow[]>();
  for (const r of rows) {
    const key = r.grammarPointKey ?? " null";
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }
  const rng = mulberry32(seed);
  const out: PoolRow[] = [];
  // Stable group order (sorted keys) so the seed alone determines the result.
  for (const key of [...groups.keys()].sort()) {
    out.push(...shuffle(groups.get(key)!, rng).slice(0, perPoint));
  }
  return out;
}
