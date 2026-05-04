'use client';

// ---------------------------------------------------------------------------
// GreetingBlock — time-dependent eyebrow + greeting heading
// ---------------------------------------------------------------------------
// The strings here depend on the browser's local clock, so server- and
// client-rendered HTML would otherwise diverge. To avoid the React hydration
// mismatch warning (Req 10.3), we render an empty placeholder server-side and
// fill the strings in after `useEffect` flushes on the client.
//
// The placeholder uses a fixed `min-h` matching the eyebrow + title rows so
// the rest of the page doesn't shift on hydration.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react';
import {
  LANGUAGE_NAMES,
  type LearningLanguage,
} from '@language-drill/shared';
import {
  isoWeekNumber,
  lowercaseWeekday,
  timeOfDayGreeting,
} from '../_lib/greeting';

type Props = {
  language: LearningLanguage;
  firstName: string | null;
};

// Eyebrow (`t-micro` ≈ 15px line) + title (`t-display-xl` ≈ 59px line) +
// the `space-y-s-2` gap between them. 84px keeps the page stable on hydrate.
const PLACEHOLDER_MIN_H = 'min-h-[84px]';

export function GreetingBlock({ language, firstName }: Props) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
  }, []);

  if (!now) {
    return <div aria-hidden className={PLACEHOLDER_MIN_H} />;
  }

  const weekday = lowercaseWeekday(now);
  const week = isoWeekNumber(now);
  const languageName = LANGUAGE_NAMES[language].toLowerCase();
  const greeting = timeOfDayGreeting(now);
  const title = `${greeting}${firstName ? `, ${firstName}` : ''}.`;

  return (
    <div className="space-y-s-2">
      <p className="t-micro">
        {weekday} · week {week} · {languageName}
      </p>
      <h1 className="t-display-xl">{title}</h1>
    </div>
  );
}
