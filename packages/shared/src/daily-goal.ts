// Daily-goal → plan length. Length derives from the existing `dailyMinutes`
// preference (5/10/20/30) — no separate preference. Shared so the today-plan
// preview (Lambda) and the drilled-session count (web) use one source of truth.

export const DAILY_GOAL_MAX_ITEMS = 12;

const ITEMS_BY_MINUTES: Readonly<Record<number, number>> = {
  5: 5,
  10: 8,
  20: 10,
  30: 12,
};

const STANDARD_ITEMS = 8;

/** Target plan length for a `dailyMinutes` value; standard (8) when unset/unknown. */
export function targetItemCount(dailyMinutes: number | null): number {
  if (dailyMinutes == null) return STANDARD_ITEMS;
  return ITEMS_BY_MINUTES[dailyMinutes] ?? STANDARD_ITEMS;
}
