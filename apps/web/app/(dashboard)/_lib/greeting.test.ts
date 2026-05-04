import { describe, it, expect } from 'vitest';
import {
  isoWeekNumber,
  lowercaseWeekday,
  timeOfDayGreeting,
} from './greeting';

// ---------------------------------------------------------------------------
// timeOfDayGreeting — boundary tests for the three windows
// ---------------------------------------------------------------------------
// 04:00–11:59 → morning, 12:00–17:59 → afternoon, otherwise evening.
// ---------------------------------------------------------------------------

describe('timeOfDayGreeting', () => {
  function at(hour: number, minute = 0): Date {
    return new Date(2026, 4, 4, hour, minute); // local time, Mon 2026-05-04
  }

  it('returns "good evening" at 03:59 (still pre-morning)', () => {
    expect(timeOfDayGreeting(at(3, 59))).toBe('good evening');
  });

  it('returns "good morning" at 04:00 (morning window opens)', () => {
    expect(timeOfDayGreeting(at(4, 0))).toBe('good morning');
  });

  it('returns "good morning" at 11:59 (last morning minute)', () => {
    expect(timeOfDayGreeting(at(11, 59))).toBe('good morning');
  });

  it('returns "good afternoon" at 12:00 (noon flips the window)', () => {
    expect(timeOfDayGreeting(at(12, 0))).toBe('good afternoon');
  });

  it('returns "good afternoon" at 17:59 (last afternoon minute)', () => {
    expect(timeOfDayGreeting(at(17, 59))).toBe('good afternoon');
  });

  it('returns "good evening" at 18:00 (evening window opens)', () => {
    expect(timeOfDayGreeting(at(18, 0))).toBe('good evening');
  });

  it('returns "good evening" at 23:59 (late night still evening)', () => {
    expect(timeOfDayGreeting(at(23, 59))).toBe('good evening');
  });
});

// ---------------------------------------------------------------------------
// lowercaseWeekday
// ---------------------------------------------------------------------------

describe('lowercaseWeekday', () => {
  it('returns "monday" for 2026-05-04 (a Monday)', () => {
    // Local midday avoids a timezone-flip into the previous/next day.
    expect(lowercaseWeekday(new Date(2026, 4, 4, 12))).toBe('monday');
  });

  it('returns "sunday" for 2026-05-03', () => {
    expect(lowercaseWeekday(new Date(2026, 4, 3, 12))).toBe('sunday');
  });

  it('returns "saturday" for 2026-05-09', () => {
    expect(lowercaseWeekday(new Date(2026, 4, 9, 12))).toBe('saturday');
  });
});

// ---------------------------------------------------------------------------
// isoWeekNumber — year-boundary cases
// ---------------------------------------------------------------------------

describe('isoWeekNumber', () => {
  it('2024-01-01 (Monday) is in ISO week 1', () => {
    expect(isoWeekNumber(new Date(Date.UTC(2024, 0, 1)))).toBe(1);
  });

  it('2024-01-04 (Thursday) is in ISO week 1', () => {
    expect(isoWeekNumber(new Date(Date.UTC(2024, 0, 4)))).toBe(1);
  });

  it('2024-12-30 (Monday) is in ISO week 1 of 2025', () => {
    expect(isoWeekNumber(new Date(Date.UTC(2024, 11, 30)))).toBe(1);
  });

  it('2025-12-29 (Monday) is in ISO week 1 of 2026', () => {
    expect(isoWeekNumber(new Date(Date.UTC(2025, 11, 29)))).toBe(1);
  });

  it('2026-05-04 (today) is in ISO week 19', () => {
    expect(isoWeekNumber(new Date(Date.UTC(2026, 4, 4)))).toBe(19);
  });
});
