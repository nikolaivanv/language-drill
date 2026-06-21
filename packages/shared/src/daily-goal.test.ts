import { describe, it, expect } from 'vitest';
import { targetItemCount, DAILY_GOAL_MAX_ITEMS } from './daily-goal';

describe('targetItemCount', () => {
  it('maps the four dailyMinutes anchors to item counts', () => {
    expect(targetItemCount(5)).toBe(5);
    expect(targetItemCount(10)).toBe(8);
    expect(targetItemCount(20)).toBe(10);
    expect(targetItemCount(30)).toBe(12);
  });
  it('defaults to standard (8) for null / unknown values', () => {
    expect(targetItemCount(null)).toBe(8);
    expect(targetItemCount(0)).toBe(8);
    expect(targetItemCount(15)).toBe(8);
  });
  it('never exceeds DAILY_GOAL_MAX_ITEMS', () => {
    expect(DAILY_GOAL_MAX_ITEMS).toBe(12);
    expect(targetItemCount(30)).toBeLessThanOrEqual(DAILY_GOAL_MAX_ITEMS);
  });
});
