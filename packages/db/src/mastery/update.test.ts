import { describe, it, expect } from 'vitest';
import { CefrLevel } from '@language-drill/shared';
import { updateMastery, replayHistory, type MasteryState } from './update';

const d = (s: string) => new Date(s);

describe('updateMastery', () => {
  it('initializes from the first observation', () => {
    const next = updateMastery(null, { score: 0.8, difficulty: CefrLevel.B1, at: d('2026-01-01') });
    expect(next.masteryScore).toBeCloseTo(0.8, 5);
    expect(next.evidenceCount).toBe(1);
    expect(next.confidence).toBeCloseTo(1 - Math.exp(-1 / 5), 5);
    expect(next.lastPracticedAt).toEqual(d('2026-01-01'));
  });

  it('rewards a correct answer on a hard item more than on an easy item', () => {
    const prior: MasteryState = {
      masteryScore: 0.5, confidence: 0.5, evidenceCount: 4, lastPracticedAt: d('2026-01-01'),
    };
    const at = d('2026-01-01');
    const hard = updateMastery(prior, { score: 1, difficulty: CefrLevel.C2, at });
    const easy = updateMastery(prior, { score: 1, difficulty: CefrLevel.A1, at });
    expect(hard.masteryScore).toBeGreaterThan(easy.masteryScore);
  });

  it('punishes an error on an easy item more than on a hard item', () => {
    const prior: MasteryState = {
      masteryScore: 0.5, confidence: 0.5, evidenceCount: 4, lastPracticedAt: d('2026-01-01'),
    };
    const at = d('2026-01-01');
    const easy = updateMastery(prior, { score: 0, difficulty: CefrLevel.A1, at });
    const hard = updateMastery(prior, { score: 0, difficulty: CefrLevel.C2, at });
    expect(easy.masteryScore).toBeLessThan(hard.masteryScore);
  });

  it('lets new evidence dominate a stale prior (recency decay)', () => {
    const prior: MasteryState = {
      masteryScore: 0.9, confidence: 0.9, evidenceCount: 10, lastPracticedAt: d('2026-01-01'),
    };
    const recent = updateMastery(prior, { score: 0, difficulty: CefrLevel.B1, at: d('2026-01-01') });
    const stale = updateMastery(prior, { score: 0, difficulty: CefrLevel.B1, at: d('2026-03-02') });
    expect(stale.masteryScore).toBeLessThan(recent.masteryScore);
  });

  it('grows confidence with evidence and clamps mastery to [0,1]', () => {
    let s = updateMastery(null, { score: 1, difficulty: CefrLevel.C2, at: d('2026-01-01') });
    const c1 = s.confidence;
    s = updateMastery(s, { score: 1, difficulty: CefrLevel.C2, at: d('2026-01-02') });
    expect(s.confidence).toBeGreaterThan(c1);
    expect(s.masteryScore).toBeLessThanOrEqual(1);
    expect(s.masteryScore).toBeGreaterThanOrEqual(0);
  });
});

describe('replayHistory', () => {
  it('folds rows per grammar point in chronological order', () => {
    const map = replayHistory([
      { grammarPointKey: 'es-b1-x', score: 1, difficulty: CefrLevel.B1, evaluatedAt: d('2026-01-02') },
      { grammarPointKey: 'es-b1-x', score: 0, difficulty: CefrLevel.B1, evaluatedAt: d('2026-01-01') },
      { grammarPointKey: 'es-b2-y', score: 1, difficulty: CefrLevel.B2, evaluatedAt: d('2026-01-03') },
    ]);
    expect(map.get('es-b1-x')!.evidenceCount).toBe(2);
    expect(map.get('es-b2-y')!.evidenceCount).toBe(1);
  });

  it('is order-independent on input (sorts by evaluatedAt internally)', () => {
    const rows = [
      { grammarPointKey: 'k', score: 0.2, difficulty: CefrLevel.B1, evaluatedAt: d('2026-01-01') },
      { grammarPointKey: 'k', score: 0.9, difficulty: CefrLevel.B1, evaluatedAt: d('2026-01-05') },
    ];
    const a = replayHistory(rows);
    const b = replayHistory([...rows].reverse());
    expect(a.get('k')!.masteryScore).toBeCloseTo(b.get('k')!.masteryScore, 10);
  });
});

describe('updateMastery evidenceWeight', () => {
  const prev = { masteryScore: 0.5, confidence: 0.5, evidenceCount: 3, lastPracticedAt: new Date('2026-07-01') };
  const at = new Date('2026-07-01'); // same day → no decay

  it('a down-weighted correct answer moves mastery less than a full-weight one', () => {
    const full = updateMastery(prev, { score: 1, difficulty: CefrLevel.A1, at });
    const hinted = updateMastery(prev, { score: 1, difficulty: CefrLevel.A1, at, evidenceWeight: 0.1 });
    expect(hinted.masteryScore).toBeLessThan(full.masteryScore);
    expect(hinted.masteryScore).toBeGreaterThan(prev.masteryScore);
    // confidence still grows via evidenceCount regardless of weight
    expect(hinted.confidence).toBe(full.confidence);
  });

  it('evidenceWeight defaults to 1 (unchanged behavior)', () => {
    const a = updateMastery(prev, { score: 1, difficulty: CefrLevel.A1, at });
    const b = updateMastery(prev, { score: 1, difficulty: CefrLevel.A1, at, evidenceWeight: 1 });
    expect(a.masteryScore).toBe(b.masteryScore);
  });

  it('replayHistory honors per-row evidenceWeight', () => {
    // Second observation is a MISS (score 0 < prior masteryScore 1), so the
    // threaded evidenceWeight is load-bearing: a down-weighted miss must move
    // mastery LESS than a full-weight miss. (Both series use the same seed,
    // so an all-hits series would pass even with evidenceWeight deleted.)
    const downWeighted = [
      { grammarPointKey: 'g', score: 1, difficulty: CefrLevel.A1, evaluatedAt: d('2026-07-01') },
      { grammarPointKey: 'g', score: 0, difficulty: CefrLevel.A1, evaluatedAt: d('2026-07-02'), evidenceWeight: 0.1 },
    ];
    const fullWeight = [
      { grammarPointKey: 'g', score: 1, difficulty: CefrLevel.A1, evaluatedAt: d('2026-07-01') },
      { grammarPointKey: 'g', score: 0, difficulty: CefrLevel.A1, evaluatedAt: d('2026-07-02') },
    ];
    expect(replayHistory(downWeighted).get('g')!.masteryScore)
      .toBeGreaterThan(replayHistory(fullWeight).get('g')!.masteryScore);
  });
});
