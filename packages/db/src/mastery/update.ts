// Per-grammar-point mastery update rule. Pure; shared by the submit handler
// (via the @language-drill/db barrel) and the backfill CLI.
//
// Model: an asymmetric, difficulty-weighted, recency-decayed Bayesian average
// over a BOUNDED window of evidence.
// See docs/superpowers/specs/2026-06-13-personalized-drill-plan-design.md §3.
//
// Two quantities track "how much evidence" and they are deliberately separate:
//   - `evidenceCount` — the raw number of observations. Drives `confidence`
//     only; never decays, never caps.
//   - `effectiveWeight` — how hard the current estimate resists a new
//     observation. Decays with time since last practice, is CAPPED at
//     `MAX_PRIOR_WEIGHT`, and the decayed value is what gets persisted.
// Before 2026-11-08 the prior weight was `evidenceCount × decay`, recomputed
// from the raw count every step. That had two effects: decay only touched the
// first answer after a gap (the next answer saw the full count again), and a
// heavily-practised point became immovable — at 134 observations a perfect
// A1 answer moved mastery by ~0.1%.
import { CefrLevel } from '@language-drill/shared';

export type MasteryState = {
  masteryScore: number; // 0..1
  confidence: number; // 0..1
  evidenceCount: number;
  lastPracticedAt: Date;
  /** Decayed, capped prior weight (see module header). */
  effectiveWeight: number;
};

/**
 * A stored state as read back from the DB. `effectiveWeight` is absent/null on
 * rows written before the column existed; they fall back to
 * `min(evidenceCount, MAX_PRIOR_WEIGHT)` until the next rebuild rewrites them.
 */
export type MasteryPrev = Omit<MasteryState, 'effectiveWeight'> & {
  effectiveWeight?: number | null;
};

export type MasteryObservation = {
  score: number; // 0..1
  difficulty: CefrLevel;
  at: Date;
  /** Multiplier in (0,1] shrinking this observation's evidence weight (hint penalty). Default 1. */
  evidenceWeight?: number;
};

export type HistoryRow = {
  grammarPointKey: string;
  score: number;
  difficulty: CefrLevel;
  evaluatedAt: Date;
  evidenceWeight?: number;
  /**
   * Which writer produced this observation: 0 = host (the exercise's own
   * grammar point), 1 = incidental (an evaluator error attributed to another
   * point). Absent means host. Used only as a tie-break at equal timestamps —
   * it does NOT mirror the live submit path, which folds incidental first and
   * host last (`infra/lambda/src/routes/exercises.ts`). That live order has
   * no effect on the result: `incidentalObservations` already excludes any
   * error attributed to the host point, so within one submission the host
   * point and the incidental points are disjoint sets, and this module folds
   * per grammar point — the two orders can never touch the same point at the
   * same instant. `sourceRank` is defence in depth against that invariant
   * changing, not a replay of live ordering.
   */
  sourceRank?: 0 | 1;
};

// Mirrors progress-aggregation.ts DIFFICULTY_WEIGHTS — keep in sync.
const DIFFICULTY_WEIGHTS: Record<CefrLevel, number> = {
  [CefrLevel.A1]: 0.5,
  [CefrLevel.A2]: 0.7,
  [CefrLevel.B1]: 0.9,
  [CefrLevel.B2]: 1.1,
  [CefrLevel.C1]: 1.3,
  [CefrLevel.C2]: 1.5,
};
const DW_PIVOT = 2.0; // DW_MAX + DW_MIN (1.5 + 0.5); inverse weight = pivot - dw
const MS_PER_DAY = 86_400_000;
const HALFLIFE_DAYS = 30;
const PRIOR_BASE = 1.0;
const K_EVIDENCE = 5; // confidence = 1 - exp(-n / K_EVIDENCE)
// Upper bound on the prior's weight, in observation units — the estimate
// behaves like an exponentially-weighted window over roughly the last
// MAX_PRIOR_WEIGHT answers. At 10, a perfect A1 answer closes ~4.8% of the
// gap to 1.0 and a full miss on an A1 item costs ~13% of the current score
// (losses at A1 weigh 3× gains — see the asymmetric weight below).
export const MAX_PRIOR_WEIGHT = 10;

// A first observation is folded against a weak virtual prior rather than taken
// raw, so one lucky (or unlucky) answer cannot pin a point at 1.0 / 0.0 and
// leave the model nowhere to move but back. The pseudo-count is a WEIGHT, not
// evidence — it never reaches `evidenceCount` or `confidence`.
const NEUTRAL_PRIOR = 0.5;
const PRIOR_PSEUDO_COUNT = 0.5;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const confidenceFor = (n: number) => 1 - Math.exp(-n / K_EVIDENCE);

export function updateMastery(
  prev: MasteryPrev | null,
  obs: MasteryObservation,
): MasteryState {
  const dw = DIFFICULTY_WEIGHTS[obs.difficulty];

  // `lastPracticedAt: obs.at` ⇒ days = 0 ⇒ decay = 1, so the virtual prior
  // enters at its full (already small) weight.
  const base = prev ?? {
    masteryScore: NEUTRAL_PRIOR,
    lastPracticedAt: obs.at,
  };
  const storedW = prev
    ? (prev.effectiveWeight ?? Math.min(prev.evidenceCount, MAX_PRIOR_WEIGHT))
    : PRIOR_PSEUDO_COUNT;

  const days = Math.max(
    0,
    (obs.at.getTime() - base.lastPracticedAt.getTime()) / MS_PER_DAY,
  );
  const decay = Math.exp(-days / HALFLIFE_DAYS);
  const priorW = Math.min(MAX_PRIOR_WEIGHT, PRIOR_BASE * storedW * decay);

  // Asymmetric observation weight: gains scale with difficulty (reward hard
  // correct), losses scale with INVERSE difficulty (punish easy errors).
  const ew = obs.evidenceWeight == null ? 1 : clamp01(obs.evidenceWeight);
  const obsW = (obs.score >= base.masteryScore ? dw : DW_PIVOT - dw) * ew;

  const masteryScore = clamp01(
    (priorW * base.masteryScore + obsW * obs.score) / (priorW + obsW),
  );
  const evidenceCount = (prev?.evidenceCount ?? 0) + 1;
  // The virtual prior's pseudo-count is a one-shot seed weight: like
  // `evidenceCount`, the persisted weight starts from 0 on a first
  // observation. A hinted answer adds proportionally less weight.
  const effectiveWeight = Math.min(MAX_PRIOR_WEIGHT, (prev ? priorW : 0) + ew);

  return {
    masteryScore,
    confidence: confidenceFor(evidenceCount),
    evidenceCount,
    lastPracticedAt: obs.at,
    effectiveWeight,
  };
}

/** Folds raw history rows into a final mastery state per grammar point. */
export function replayHistory(
  rows: readonly HistoryRow[],
): Map<string, MasteryState> {
  const sorted = [...rows].sort(
    (a, b) =>
      a.evaluatedAt.getTime() - b.evaluatedAt.getTime() ||
      (a.sourceRank ?? 0) - (b.sourceRank ?? 0),
  );
  const out = new Map<string, MasteryState>();
  for (const r of sorted) {
    const prev = out.get(r.grammarPointKey) ?? null;
    out.set(
      r.grammarPointKey,
      updateMastery(prev, {
        score: r.score,
        difficulty: r.difficulty,
        at: r.evaluatedAt,
        evidenceWeight: r.evidenceWeight,
      }),
    );
  }
  return out;
}
