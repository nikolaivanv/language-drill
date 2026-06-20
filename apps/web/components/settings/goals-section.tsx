'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import {
  createAuthenticatedFetch,
  useGetPreferences,
  useUpdatePreferences,
} from '@language-drill/api-client';
import { DAILY_MINUTES, GOAL_IDS, type GoalId } from '@language-drill/shared';
import { Section, Row } from './section';
import { GOAL_COPY } from './goal-copy';
import { Choice, Checkbox, Switch } from '../ui';

export function GoalsSection() {
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  const prefsQuery = useGetPreferences({ fetchFn });
  const update = useUpdatePreferences({ fetchFn });

  const [goals, setGoals] = useState<GoalId[]>([]);
  const [daily, setDaily] = useState<number | null>(null);
  const [nudges, setNudges] = useState(true);

  useEffect(() => {
    if (prefsQuery.data) {
      setGoals(prefsQuery.data.goals);
      setDaily(prefsQuery.data.dailyMinutes);
      setNudges(prefsQuery.data.gentleNudges);
    }
  }, [prefsQuery.data]);

  const pickDaily = (m: (typeof DAILY_MINUTES)[number]) => {
    setDaily(m);
    update.mutate({ dailyMinutes: m });
  };
  const toggleGoal = (id: GoalId) => {
    const next = goals.includes(id) ? goals.filter((g) => g !== id) : [...goals, id];
    setGoals(next);
    update.mutate({ goals: next });
  };
  const toggleNudges = (next: boolean) => {
    setNudges(next);
    update.mutate({ gentleNudges: next });
  };

  return (
    <Section id="goals" title="goals" sub="what you want from this. tweak any time.">
      <Row label="daily target" hint="how much you want to drill each day." align="top">
        <div role="radiogroup" aria-label="daily target" className="grid grid-cols-4 gap-[12px] max-w-[360px]">
          {DAILY_MINUTES.map((m) => (
            <Choice key={m} mode="radio" selected={daily === m} onSelect={() => pickDaily(m)}>
              <span className="flex flex-col items-start">
                <span className="t-display-s">{m}</span>
                <span className="t-micro text-ink-mute">min / day</span>
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

      <Row label="gentle nudges" hint="one calm note if you've missed two days, never more.">
        <Switch checked={nudges} onChange={toggleNudges} aria-label="gentle nudges" />
      </Row>
    </Section>
  );
}
