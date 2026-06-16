/**
 * Pure computation of the debrief "skills you moved" panel. Replays the user's
 * exercise history for the grammar points a session touched, twice — excluding
 * vs including this session's rows — and bands the resulting from → to per point.
 * No raw scores leak out: only a band + confidence (see the design spec).
 */
import { replayHistory, type HistoryRow } from '@language-drill/db';
import { type CefrLevel, type SkillMovement, type SkillMovementBand } from '@language-drill/shared';

/** A history row plus its primary-key id, so session rows can be excluded. */
export type SkillHistoryRow = {
  id: string;
  grammarPointKey: string;
  score: number;
  difficulty: CefrLevel;
  evaluatedAt: Date;
};

// Tunable banding constants (design spec).
export const STEADY_EPS = 0.02;        // |Δ| below this → steady
export const STRONG_GAIN_DELTA = 0.08; // Δ at/above this → strong gain
export const CONFIDENCE_HIGH_CUTOFF = 0.6;

const BAND_ORDER: Record<SkillMovementBand, number> = {
  'strong-gain': 0,
  gain: 1,
  new: 2,
  slip: 3,
  steady: 4,
};

export function masteryBand(from: number | null, to: number): SkillMovementBand {
  if (from === null) return 'new';
  const delta = to - from;
  if (delta >= STRONG_GAIN_DELTA) return 'strong-gain';
  if (delta >= STEADY_EPS) return 'gain';
  if (delta <= -STEADY_EPS) return 'slip';
  return 'steady';
}

export function confidenceBand(confidence: number): 'high' | 'low' {
  return confidence >= CONFIDENCE_HIGH_CUTOFF ? 'high' : 'low';
}

function toHistoryRow(r: SkillHistoryRow): HistoryRow {
  return { grammarPointKey: r.grammarPointKey, score: r.score, difficulty: r.difficulty, evaluatedAt: r.evaluatedAt };
}

/**
 * @param rows  ALL history rows (this session's + prior) for the affected points.
 * @param sessionRowIds  ids of the rows belonging to THIS session (excluded for "from").
 * @param labels  affected grammarPointKey → human label; its keys define which points to emit.
 */
export function computeSkillMovements(params: {
  rows: readonly SkillHistoryRow[];
  sessionRowIds: ReadonlySet<string>;
  labels: ReadonlyMap<string, string>;
}): SkillMovement[] {
  const { rows, sessionRowIds, labels } = params;
  // `before` = the cell's mastery folding only its pre-session rows; `after` =
  // the same plus this session's rows. The band is the marginal effect of the
  // session. Note: `replayHistory` folds to each row's own `evaluatedAt` (it does
  // NOT decay to "now"), so the band is stable when the debrief is re-viewed
  // later rather than drifting under recency decay — deliberate, and it also
  // avoids a windowed replay ever mis-banding a long-known point as "new".
  const afterMap = replayHistory(rows.map(toHistoryRow));
  const beforeMap = replayHistory(rows.filter((r) => !sessionRowIds.has(r.id)).map(toHistoryRow));

  const out: SkillMovement[] = [];
  for (const [key, label] of labels) {
    const after = afterMap.get(key);
    if (!after) continue; // defensive: an affected point always has ≥1 row
    const before = beforeMap.get(key);
    out.push({
      grammarPointKey: key,
      label,
      band: masteryBand(before ? before.masteryScore : null, after.masteryScore),
      confidence: confidenceBand(after.confidence),
    });
  }
  out.sort((a, b) => BAND_ORDER[a.band] - BAND_ORDER[b.band] || a.label.localeCompare(b.label));
  return out;
}
