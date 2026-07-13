// Per-grammar-point mastery update rule. Pure; shared by the submit handler
// (via the @language-drill/db barrel) and the backfill CLI.
//
// Model: an asymmetric, difficulty-weighted, recency-decayed Bayesian average.
// See docs/superpowers/specs/2026-06-13-personalized-drill-plan-design.md §3.
import { CefrLevel } from '@language-drill/shared';

export type MasteryState = {
  masteryScore: number; // 0..1
  confidence: number; // 0..1
  evidenceCount: number;
  lastPracticedAt: Date;
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

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const confidenceFor = (n: number) => 1 - Math.exp(-n / K_EVIDENCE);

export function updateMastery(
  prev: MasteryState | null,
  obs: MasteryObservation,
): MasteryState {
  const dw = DIFFICULTY_WEIGHTS[obs.difficulty];

  if (prev === null) {
    return {
      masteryScore: clamp01(obs.score),
      confidence: confidenceFor(1),
      evidenceCount: 1,
      lastPracticedAt: obs.at,
    };
  }

  const days = Math.max(
    0,
    (obs.at.getTime() - prev.lastPracticedAt.getTime()) / MS_PER_DAY,
  );
  const decay = Math.exp(-days / HALFLIFE_DAYS);
  const priorW = PRIOR_BASE * prev.evidenceCount * decay;

  // Asymmetric observation weight: gains scale with difficulty (reward hard
  // correct), losses scale with INVERSE difficulty (punish easy errors).
  const ew = obs.evidenceWeight == null ? 1 : clamp01(obs.evidenceWeight);
  const obsW = (obs.score >= prev.masteryScore ? dw : DW_PIVOT - dw) * ew;

  const masteryScore = clamp01(
    (priorW * prev.masteryScore + obsW * obs.score) / (priorW + obsW),
  );
  const evidenceCount = prev.evidenceCount + 1;

  return {
    masteryScore,
    confidence: confidenceFor(evidenceCount),
    evidenceCount,
    lastPracticedAt: obs.at,
  };
}

/** Folds raw history rows into a final mastery state per grammar point. */
export function replayHistory(
  rows: readonly HistoryRow[],
): Map<string, MasteryState> {
  const sorted = [...rows].sort(
    (a, b) => a.evaluatedAt.getTime() - b.evaluatedAt.getTime(),
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
