'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import {
  createAuthenticatedFetch,
  useGetPreferences,
  useUpdatePreferences,
} from '@language-drill/api-client';
import { DAILY_GOALS, GOAL_IDS, type DailyGoal, type GoalId } from '@language-drill/shared';
import { Section, Row } from './section';
import { GOAL_COPY } from './goal-copy';
import { Choice, Checkbox } from '../ui';

const DAILY_GOAL_HINTS: Record<DailyGoal, string> = {
  quick: '~5',
  medium: '~8',
  long: '~12',
};

export function GoalsSection() {
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  const prefsQuery = useGetPreferences({ fetchFn });
  const update = useUpdatePreferences({ fetchFn });

  const [goals, setGoals] = useState<GoalId[]>([]);
  const [dailyGoal, setDailyGoal] = useState<DailyGoal | null>(null);

  useEffect(() => {
    if (prefsQuery.data) {
      setGoals(prefsQuery.data.goals);
      setDailyGoal(prefsQuery.data.dailyGoal);
    }
  }, [prefsQuery.data]);

  const pickGoal = (g: DailyGoal) => {
    setDailyGoal(g);
    update.mutate({ dailyGoal: g });
  };
  const toggleGoal = (id: GoalId) => {
    const next = goals.includes(id) ? goals.filter((g) => g !== id) : [...goals, id];
    setGoals(next);
    update.mutate({ goals: next });
  };

  return (
    <Section id="goals" title="goals" sub="what you want from this. tweak any time.">
      <Row label="daily target" hint="how much you want to drill each day." align="top">
        <div role="radiogroup" aria-label="daily target" className="grid grid-cols-3 gap-[12px] max-w-[420px]">
          {DAILY_GOALS.map((g) => (
            <Choice key={g} mode="radio" hideIndicator selected={dailyGoal === g} onSelect={() => pickGoal(g)}>
              <span className="flex flex-col items-center text-center w-full">
                <span className="t-display-s leading-none">{g}</span>
                <span className="t-micro text-ink-mute whitespace-nowrap mt-[5px]">{DAILY_GOAL_HINTS[g]}</span>
              </span>
            </Choice>
          ))}
        </div>
      </Row>

      <Row label="why you're learning" hint="we lean drills toward these." align="top">
        <div className="flex flex-col gap-s-2">
          {GOAL_IDS.map((id) => {
            const checked = goals.includes(id);
            const labelId = `goal-${id}`;
            return (
              <label key={id} className="flex items-center gap-s-3 cursor-pointer">
                <Checkbox checked={checked} onChange={() => toggleGoal(id)} aria-labelledby={labelId} />
                <span id={labelId} className="t-body text-ink">{GOAL_COPY[id].label}</span>
              </label>
            );
          })}
        </div>
      </Row>
    </Section>
  );
}
