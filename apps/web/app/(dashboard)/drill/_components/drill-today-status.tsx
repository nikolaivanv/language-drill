'use client';

// ---------------------------------------------------------------------------
// DrillTodayStatus — the hub's thin "today" status strip (Plan 2)
// ---------------------------------------------------------------------------
// The /drill hub is the on-demand surface; the plan lives on /home. This strip
// reminds the user where today's quick drill stands and links back to the
// plan. Read-only: it reuses GET /sessions/today (summary present ⇒ today's
// quick drill is finished).
// ---------------------------------------------------------------------------

import { useMemo } from 'react';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { createAuthenticatedFetch, useTodayPlan } from '@language-drill/api-client';
import { useActiveLanguage } from '../../../../components/shell';

export function DrillTodayStatus() {
  const { getToken } = useAuth();
  const { activeLanguage } = useActiveLanguage();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  const todayPlan = useTodayPlan({ fetchFn, language: activeLanguage });

  if (todayPlan.isLoading || !todayPlan.data) return null;

  const done = todayPlan.data.summary !== null;

  return (
    <div className="flex items-baseline justify-between gap-s-6 mobile:gap-s-3">
      <span className="text-[20px] leading-[1.4] text-ink-soft mobile:text-[15px]">
        today&apos;s quick drill:{' '}
        <span className="font-medium text-ink-2">
          {done ? 'done ✓' : 'not finished'}
        </span>
      </span>
      <Link
        href="/home"
        className="whitespace-nowrap text-[18px] text-ink-2 underline decoration-rule-strong underline-offset-4 hover:decoration-ink-mute mobile:text-[15px]"
      >
        view plan →
      </Link>
    </div>
  );
}
