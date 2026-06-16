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
    expect(out[0].confidence === 'high' || out[0].confidence === 'low').toBe(true);
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
