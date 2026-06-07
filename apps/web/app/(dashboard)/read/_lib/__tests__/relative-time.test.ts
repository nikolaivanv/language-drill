import { describe, it, expect } from 'vitest';
import { relativeTime } from '../relative-time';

// ---------------------------------------------------------------------------
// relativeTime — deterministic bucket tests (now is injected as a param)
// ---------------------------------------------------------------------------

const BASE = new Date('2026-06-07T12:00:00.000Z').getTime();

function iso(offsetMs: number): string {
  return new Date(BASE - offsetMs).toISOString();
}

const SEC = 1_000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('relativeTime', () => {
  it('returns "just now" when < 60 seconds ago', () => {
    expect(relativeTime(iso(30 * SEC), BASE)).toBe('just now');
    expect(relativeTime(iso(59 * SEC), BASE)).toBe('just now');
  });

  it('returns "just now" at exactly 0 seconds', () => {
    expect(relativeTime(iso(0), BASE)).toBe('just now');
  });

  it('returns "today" when >= 60 seconds and < 24 hours ago', () => {
    expect(relativeTime(iso(61 * SEC), BASE)).toBe('today');
    expect(relativeTime(iso(1 * HOUR), BASE)).toBe('today');
    expect(relativeTime(iso(23 * HOUR + 59 * MIN), BASE)).toBe('today');
  });

  it('returns "Nd ago" for 1..6 days ago', () => {
    expect(relativeTime(iso(1 * DAY + 1), BASE)).toBe('1d ago');
    expect(relativeTime(iso(3 * DAY), BASE)).toBe('3d ago');
    expect(relativeTime(iso(6 * DAY + 23 * HOUR), BASE)).toBe('6d ago');
  });

  it('returns "last week" when >= 7 days and < 14 days ago', () => {
    expect(relativeTime(iso(7 * DAY), BASE)).toBe('last week');
    expect(relativeTime(iso(13 * DAY + 23 * HOUR), BASE)).toBe('last week');
  });

  it('returns a short date string for >= 14 days ago', () => {
    const result = relativeTime(iso(14 * DAY), BASE);
    // Should not be one of the relative labels
    expect(result).not.toBe('just now');
    expect(result).not.toBe('today');
    expect(result).not.toMatch(/\d+d ago/);
    expect(result).not.toBe('last week');
    // Should be a non-empty string (locale date)
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns a short date for old dates', () => {
    const old = '2025-01-01T00:00:00.000Z';
    const result = relativeTime(old, BASE);
    expect(result.length).toBeGreaterThan(0);
    expect(result).not.toBe('just now');
    expect(result).not.toBe('today');
  });
});
