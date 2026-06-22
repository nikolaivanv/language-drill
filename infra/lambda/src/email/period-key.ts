const MS_PER_DAY = 86_400_000;

/**
 * ISO-8601 week key, e.g. '2026-W25'. Uses the standard "nearest Thursday"
 * algorithm so the week's year matches the ISO year across boundaries.
 */
export function isoWeekKey(date: Date): string {
  // Work in UTC. Copy so we don't mutate the input.
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  // ISO weekday: Mon=1 … Sun=7.
  const dayNum = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  // Shift to the Thursday of this week.
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const isoYear = d.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / MS_PER_DAY + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

/**
 * The 7-day window the summary covers: [now-7d, now), keyed by the ISO week of
 * the window start (the just-completed week when run on a Monday).
 */
export function weeklyWindow(now: Date): { start: Date; end: Date; periodKey: string } {
  const start = new Date(now.getTime() - 7 * MS_PER_DAY);
  return { start, end: now, periodKey: isoWeekKey(start) };
}
