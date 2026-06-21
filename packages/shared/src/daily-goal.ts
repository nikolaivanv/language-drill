// Daily-goal → plan length. The user-facing setting is a coarse "how much today"
// (quick/medium/long), since we don't measure real per-exercise minutes. Shared so
// the today-plan preview (Lambda) and the drilled-session count (web) agree.

export const DAILY_GOALS = ['quick', 'medium', 'long'] as const;
export type DailyGoal = (typeof DAILY_GOALS)[number];

export const DAILY_GOAL_MAX_ITEMS = 12;

const ITEMS_BY_GOAL: Readonly<Record<DailyGoal, number>> = {
  quick: 5,
  medium: 8,
  long: 12,
};

const MEDIUM_ITEMS = 8;

/** Target plan length for a daily goal; medium (8) when unset/unknown. */
export function targetItemCount(goal: DailyGoal | null): number {
  if (goal == null) return MEDIUM_ITEMS;
  return ITEMS_BY_GOAL[goal] ?? MEDIUM_ITEMS;
}
