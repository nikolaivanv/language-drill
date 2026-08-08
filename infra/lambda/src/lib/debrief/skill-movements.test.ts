import { describe, expect, it } from 'vitest';
import { CefrLevel } from '@language-drill/shared';
import {
  masteryBand,
  confidenceBand,
  computeSkillMovements,
  type SkillHistoryRow,
} from './skill-movements.js';

describe('masteryBand', () => {
  it('is "new" when there is no prior evidence', () => {
    expect(masteryBand(null, 0.4)).toBe('new');
  });
  it('bands gains by magnitude', () => {
    expect(masteryBand(0.6, 0.61)).toBe('steady');   // < 0.02
    expect(masteryBand(0.6, 0.64)).toBe('gain');      // >= 0.02
    expect(masteryBand(0.6, 0.70)).toBe('strong-gain'); // >= 0.08
  });
  it('bands a drop as a slip', () => {
    expect(masteryBand(0.6, 0.55)).toBe('slip');      // <= -0.02
    expect(masteryBand(0.6, 0.59)).toBe('steady');    // within epsilon
  });
});

describe('confidenceBand', () => {
  it('is high at/above the cutoff, low below', () => {
    expect(confidenceBand(0.6)).toBe('high');
    expect(confidenceBand(0.59)).toBe('low');
  });
});

describe('computeSkillMovements', () => {
  const at = (iso: string) => new Date(iso);
  const labels = new Map([['gp-a', 'Point A'], ['gp-b', 'Point B']]);

  it('returns [] when there are no affected points', () => {
    expect(computeSkillMovements({ rows: [], sessionRowIds: new Set(), labels: new Map() })).toEqual([]);
  });

  it('marks a first-ever-practiced point as "new"', () => {
    const rows: SkillHistoryRow[] = [
      { id: 's1', grammarPointKey: 'gp-a', score: 0.4, difficulty: CefrLevel.B2, evaluatedAt: at('2026-06-16T04:00:00Z') },
    ];
    const out = computeSkillMovements({ rows, sessionRowIds: new Set(['s1']), labels: new Map([['gp-a', 'Point A']]) });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ grammarPointKey: 'gp-a', label: 'Point A', band: 'new' });
    // One evidence row → confidenceFor(1) ≈ 0.18 < 0.6 → low.
    expect(out[0].confidence).toBe('low');
  });

  it('bands a point that dropped this session as a slip (via replay)', () => {
    const rows: SkillHistoryRow[] = [
      { id: 'p1', grammarPointKey: 'gp-a', score: 0.9, difficulty: CefrLevel.B2, evaluatedAt: at('2026-06-10T04:00:00Z') },
      { id: 's1', grammarPointKey: 'gp-a', score: 0.1, difficulty: CefrLevel.B2, evaluatedAt: at('2026-06-16T04:00:00Z') },
    ];
    const out = computeSkillMovements({ rows, sessionRowIds: new Set(['s1']), labels: new Map([['gp-a', 'Point A']]) });
    expect(out[0].band).toBe('slip');
  });

  it('excludes the session rows when computing the "from" baseline (a prior point gains)', () => {
    const rows: SkillHistoryRow[] = [
      { id: 'p1', grammarPointKey: 'gp-a', score: 0.6, difficulty: CefrLevel.B2, evaluatedAt: at('2026-06-10T04:00:00Z') },
      { id: 's1', grammarPointKey: 'gp-a', score: 0.95, difficulty: CefrLevel.B2, evaluatedAt: at('2026-06-16T04:00:00Z') },
    ];
    const out = computeSkillMovements({ rows, sessionRowIds: new Set(['s1']), labels: new Map([['gp-a', 'Point A']]) });
    expect(out[0].band === 'gain' || out[0].band === 'strong-gain').toBe(true);
  });

  it('aggregates multiple session rows on one point into a single movement', () => {
    const rows: SkillHistoryRow[] = [
      { id: 's1', grammarPointKey: 'gp-b', score: 0.5, difficulty: CefrLevel.B1, evaluatedAt: at('2026-06-16T04:00:00Z') },
      { id: 's2', grammarPointKey: 'gp-b', score: 0.9, difficulty: CefrLevel.B1, evaluatedAt: at('2026-06-16T04:05:00Z') },
    ];
    const out = computeSkillMovements({ rows, sessionRowIds: new Set(['s1', 's2']), labels: new Map([['gp-b', 'Point B']]) });
    expect(out).toHaveLength(1);
    expect(out[0].grammarPointKey).toBe('gp-b');
  });

  it('carries evidenceWeight into the replay: a down-weighted miss avoids a slip band', () => {
    // Same prior-hit + session-miss shape as the "slip" test above, but the
    // session row is re-run with a heavy hint penalty (evidenceWeight 0.01).
    // Genuinely discriminating: deleting the evidenceWeight threading would
    // make both branches replay identically and both come out 'slip'.
    const rows: SkillHistoryRow[] = [
      { id: 'p1', grammarPointKey: 'gp-a', score: 0.9, difficulty: CefrLevel.B2, evaluatedAt: at('2026-06-10T04:00:00Z') },
      { id: 's1', grammarPointKey: 'gp-a', score: 0.1, difficulty: CefrLevel.B2, evaluatedAt: at('2026-06-16T04:00:00Z') },
    ];
    const fullWeight = computeSkillMovements({ rows, sessionRowIds: new Set(['s1']), labels: new Map([['gp-a', 'Point A']]) });
    expect(fullWeight[0].band).toBe('slip');

    const downWeighted = computeSkillMovements({
      rows: rows.map((r) => (r.id === 's1' ? { ...r, evidenceWeight: 0.01 } : r)),
      sessionRowIds: new Set(['s1']),
      labels: new Map([['gp-a', 'Point A']]),
    });
    expect(downWeighted[0].band).toBe('steady');
  });

  it('reports low confidence for a slip measured against a single-observation prior', () => {
    // Regression: prod session ec7dd00f (es-b1-impersonal-plural). One prior row
    // at 1.0 pins mastery to the ceiling with confidence ~0.18; five *correct*
    // answers (all >= CORRECT_THRESHOLD, so the header reads "5 of 5 · 100%")
    // then replay to ~0.927 with confidence ~0.70. Banding as 'slip' is honest,
    // but the badge must not claim "we're confident" about a delta whose
    // baseline is a single sample — confidence is bounded by the weaker side.
    const rows: SkillHistoryRow[] = [
      { id: 'p1', grammarPointKey: 'gp-a', score: 1, difficulty: CefrLevel.B1, evaluatedAt: at('2026-07-29T22:29:17.763Z') },
      { id: 's1', grammarPointKey: 'gp-a', score: 0.82, difficulty: CefrLevel.B1, evaluatedAt: at('2026-08-08T17:57:51.737Z') },
      { id: 's2', grammarPointKey: 'gp-a', score: 0.92, difficulty: CefrLevel.B1, evaluatedAt: at('2026-08-08T18:00:09.790Z') },
      { id: 's3', grammarPointKey: 'gp-a', score: 1, difficulty: CefrLevel.B1, evaluatedAt: at('2026-08-08T18:03:37.818Z') },
      { id: 's4', grammarPointKey: 'gp-a', score: 0.88, difficulty: CefrLevel.B1, evaluatedAt: at('2026-08-08T18:05:29.227Z') },
      { id: 's5', grammarPointKey: 'gp-a', score: 1, difficulty: CefrLevel.B1, evaluatedAt: at('2026-08-08T18:06:11.554Z') },
    ];
    const out = computeSkillMovements({
      rows,
      sessionRowIds: new Set(['s1', 's2', 's3', 's4', 's5']),
      labels: new Map([['gp-a', 'Point A']]),
    });
    expect(out[0].band).toBe('slip');
    // after.confidence alone is ~0.70 → would band 'high'; before.confidence is
    // ~0.18, so the movement is only an early signal.
    expect(out[0].confidence).toBe('low');
  });

  it('keeps high confidence when both sides of the delta are well-evidenced', () => {
    // Counterpart to the test above: enough prior rows that before.confidence
    // clears the cutoff too, so gating on the weaker side must NOT downgrade it.
    const prior: SkillHistoryRow[] = Array.from({ length: 8 }, (_, i) => ({
      id: `p${i}`,
      grammarPointKey: 'gp-a',
      score: 0.9,
      difficulty: CefrLevel.B1,
      evaluatedAt: at(`2026-08-0${i + 1}T04:00:00Z`),
    }));
    const rows: SkillHistoryRow[] = [
      ...prior,
      { id: 's1', grammarPointKey: 'gp-a', score: 0.1, difficulty: CefrLevel.B1, evaluatedAt: at('2026-08-09T04:00:00Z') },
    ];
    const out = computeSkillMovements({ rows, sessionRowIds: new Set(['s1']), labels: new Map([['gp-a', 'Point A']]) });
    expect(out[0].band).toBe('slip');
    expect(out[0].confidence).toBe('high');
  });

  it('orders movers before steady, deterministically', () => {
    const rows: SkillHistoryRow[] = [
      { id: 'p1', grammarPointKey: 'gp-a', score: 0.6, difficulty: CefrLevel.B2, evaluatedAt: at('2026-06-10T00:00:00Z') },
      { id: 's1', grammarPointKey: 'gp-a', score: 0.6, difficulty: CefrLevel.B2, evaluatedAt: at('2026-06-16T00:00:00Z') }, // ~steady
      { id: 'p2', grammarPointKey: 'gp-b', score: 0.5, difficulty: CefrLevel.B2, evaluatedAt: at('2026-06-10T00:00:00Z') },
      { id: 's2', grammarPointKey: 'gp-b', score: 0.99, difficulty: CefrLevel.B2, evaluatedAt: at('2026-06-16T00:00:00Z') }, // gain
    ];
    const out = computeSkillMovements({ rows, sessionRowIds: new Set(['s1', 's2']), labels });
    expect(out.map((m) => m.grammarPointKey)).toEqual(['gp-b', 'gp-a']); // gain before steady
  });
});
