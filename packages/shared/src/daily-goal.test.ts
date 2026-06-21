import { describe, it, expect } from 'vitest';
import { targetItemCount, DAILY_GOAL_MAX_ITEMS, DAILY_GOALS } from './daily-goal';

describe('targetItemCount', () => {
  it('maps quick/medium/long to item counts', () => {
    expect(targetItemCount('quick')).toBe(5);
    expect(targetItemCount('medium')).toBe(8);
    expect(targetItemCount('long')).toBe(12);
  });
  it('defaults to medium (8) for null', () => {
    expect(targetItemCount(null)).toBe(8);
  });
  it('exposes the goals + the max', () => {
    expect(DAILY_GOALS).toEqual(['quick', 'medium', 'long']);
    expect(DAILY_GOAL_MAX_ITEMS).toBe(12);
  });
});
