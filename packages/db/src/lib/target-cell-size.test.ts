import { describe, expect, it } from 'vitest';

import { targetCellSize } from './target-cell-size';

describe('targetCellSize', () => {
  it('returns 50 for idle cells (depletionRate7d < 1)', () => {
    expect(targetCellSize(0)).toBe(50);
    expect(targetCellSize(0.9)).toBe(50);
  });

  it('returns 75 for low-traffic cells (1 <= depletionRate7d < 5)', () => {
    expect(targetCellSize(1)).toBe(75);
    expect(targetCellSize(4.9)).toBe(75);
  });

  it('returns 100 for medium-traffic cells (5 <= depletionRate7d < 10)', () => {
    expect(targetCellSize(5)).toBe(100);
    expect(targetCellSize(9.9)).toBe(100);
  });

  it('returns 200 for high-traffic cells (depletionRate7d >= 10)', () => {
    expect(targetCellSize(10)).toBe(200);
    expect(targetCellSize(100)).toBe(200);
  });
});
