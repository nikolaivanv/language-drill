// Mastery-aware ordering of today-plan pool candidates. Pure: prerequisite
// lookup is injected so this needs no curriculum/DB import. The route passes a
// `prereqsOf` backed by getGrammarPoint. See spec §4.
import type { PoolDraw } from '../today-plan';

export type PointMastery = {
  masteryScore: number;
  lastPracticedAt: Date;
};

export type RankContext = {
  masteryByPoint: ReadonlyMap<string, PointMastery>;
  errorCountByPoint: ReadonlyMap<string, number>;
  /** Prerequisite keys for a grammar point (empty if none/unknown). */
  prereqsOf: (grammarPointKey: string) => readonly string[];
  now: Date;
};

const MS_PER_DAY = 86_400_000;
const HALFLIFE_DAYS = 30;
const NEUTRAL_PRIORITY = 0.5; // unmapped/unknown grammar key
const GROWTH_LO = 0.3;
const GROWTH_HI = 0.7;
const GROWTH_BOOST = 0.15;
const PREREQ_THRESHOLD = 0.3; // mastery at/above this counts as positive evidence
const PREREQ_PENALTY = 0.5; // multiplicative, per unmet prerequisite
const ERROR_WEIGHT = 0.15;
const ERROR_CAP = 5;
const ERROR_FIX_MIN = 2;
const SOLID_MASTERY = 0.8;

function hasPositiveEvidence(
  key: string,
  masteryByPoint: ReadonlyMap<string, PointMastery>,
): boolean {
  const m = masteryByPoint.get(key);
  return m != null && m.masteryScore >= PREREQ_THRESHOLD;
}

function priorityOf(c: PoolDraw, ctx: RankContext): number {
  if (!c.grammarPointKey) return NEUTRAL_PRIORITY;

  const m = ctx.masteryByPoint.get(c.grammarPointKey);
  let gap: number;
  if (m == null) {
    gap = 1.0; // missing evidence → maximal gap
  } else {
    const days = Math.max(
      0,
      (ctx.now.getTime() - m.lastPracticedAt.getTime()) / MS_PER_DAY,
    );
    const idle = Math.exp(-days / HALFLIFE_DAYS);
    const effMastery = m.masteryScore * idle; // stale evidence → larger effective gap
    gap = 1 - effMastery;
    if (effMastery >= GROWTH_LO && effMastery <= GROWTH_HI) gap += GROWTH_BOOST;
  }

  let penalty = 1.0;
  for (const pk of ctx.prereqsOf(c.grammarPointKey)) {
    if (!hasPositiveEvidence(pk, ctx.masteryByPoint)) penalty *= PREREQ_PENALTY;
  }

  const errorCount = ctx.errorCountByPoint.get(c.grammarPointKey) ?? 0;
  const errorTerm = ERROR_WEIGHT * Math.min(errorCount, ERROR_CAP);
  return gap * penalty + errorTerm;
}

/**
 * Returns the candidates ordered by descending selection priority. Input order
 * (the exposure-controlled pool order) is the stable tiebreak, so freshness is
 * preserved among equal-priority points. Soft by construction: prerequisite
 * gaps only *lower* priority, never remove a candidate — so the plan is never
 * starved, including at cold start.
 */
export function rankPlanCandidates(
  candidates: readonly PoolDraw[],
  ctx: RankContext,
): PoolDraw[] {
  return candidates
    .map((c, i) => ({ c, i, p: priorityOf(c, ctx) }))
    .sort((a, b) => (b.p - a.p) || (a.i - b.i))
    .map((x) => x.c);
}

export type PlanReason = 'new' | 'reinforce' | 'review' | 'error-fix';

/** Classifies a plan item's dominant driver, from the same context as the ranker. */
export function reasonFor(grammarPointKey: string | null, ctx: RankContext): PlanReason {
  if (!grammarPointKey) return 'reinforce';
  const errorCount = ctx.errorCountByPoint.get(grammarPointKey) ?? 0;
  if (errorCount >= ERROR_FIX_MIN) return 'error-fix';
  const m = ctx.masteryByPoint.get(grammarPointKey);
  if (m == null) return 'new';
  const days = Math.max(0, (ctx.now.getTime() - m.lastPracticedAt.getTime()) / MS_PER_DAY);
  const effMastery = m.masteryScore * Math.exp(-days / HALFLIFE_DAYS);
  // was solid, decayed back below solid → due for review
  if (m.masteryScore >= SOLID_MASTERY && effMastery < SOLID_MASTERY) return 'review';
  return 'reinforce';
}
