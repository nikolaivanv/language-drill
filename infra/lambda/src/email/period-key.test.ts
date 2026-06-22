import { describe, it, expect } from 'vitest';
import { isoWeekKey, weeklyWindow } from './period-key';

describe('isoWeekKey', () => {
  it('formats an ISO week as YYYY-Www', () => {
    // 2026-06-15 is a Monday in ISO week 25 of 2026.
    expect(isoWeekKey(new Date('2026-06-15T08:00:00Z'))).toBe('2026-W25');
  });

  it('zero-pads single-digit weeks', () => {
    expect(isoWeekKey(new Date('2026-01-05T00:00:00Z'))).toBe('2026-W02');
  });

  it('assigns the ISO year correctly across a year boundary', () => {
    // 2027-01-01 is a Friday; ISO week 53 belongs to 2026.
    expect(isoWeekKey(new Date('2027-01-01T00:00:00Z'))).toBe('2026-W53');
  });
});

describe('weeklyWindow', () => {
  it('spans the 7 days before now and keys on the window start', () => {
    const now = new Date('2026-06-22T08:00:00Z');
    const w = weeklyWindow(now);
    expect(w.end).toEqual(now);
    expect(w.start).toEqual(new Date('2026-06-15T08:00:00Z'));
    expect(w.periodKey).toBe('2026-W25');
  });
});
