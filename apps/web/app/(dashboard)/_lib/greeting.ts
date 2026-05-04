// ---------------------------------------------------------------------------
// Greeting helpers — time-of-day phrase, weekday name, ISO week number
// ---------------------------------------------------------------------------
// All three accept an explicit `Date` argument so they're testable. The page
// calls them from a `useEffect` after mount with `new Date()` to avoid a
// hydration mismatch on time-dependent strings (Req 10.3).
//
// Pure functions — no globals, no side effects.
// ---------------------------------------------------------------------------

export function timeOfDayGreeting(
  now: Date,
): 'good morning' | 'good afternoon' | 'good evening' {
  const h = now.getHours();
  if (h >= 4 && h < 12) return 'good morning';
  if (h >= 12 && h < 18) return 'good afternoon';
  return 'good evening';
}

/**
 * `tuesday`, `wednesday`, … — lowercased English weekday name in the user's
 * local time. Locked to `en-US` so server / client agree on spelling; the
 * dashboard's editorial chrome is English-only in v1.
 */
export function lowercaseWeekday(now: Date): string {
  return now.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
}

/**
 * ISO 8601 week-of-year for the supplied date.
 *
 * Inlined here instead of pulling `date-fns` for one helper. Algorithm:
 *   1. Normalise to UTC midnight on the same calendar day.
 *   2. Shift to the Thursday of the same ISO week (ISO weeks start Monday;
 *      Thursday is always in the year that "owns" the week).
 *   3. Find Jan 1 of that Thursday's year.
 *   4. Week number = ceil((days since Jan 1 + 1) / 7).
 *
 * Year-boundary cases the tests pin:
 *   - 2024-12-30 → week 1 of 2025 (the Thursday of that week is 2025-01-02)
 *   - 2024-01-01 → week 1 of 2024
 *   - 2024-01-04 → week 1 of 2024
 */
export function isoWeekNumber(now: Date): number {
  const d = new Date(
    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()),
  );
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
  );
}
