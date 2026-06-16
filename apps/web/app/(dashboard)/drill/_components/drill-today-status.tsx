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
    <div className="mb-s-5 flex items-center justify-between gap-s-4 text-ink-mute">
      <span className="t-small">
        today&apos;s quick drill: {done ? 'done ✓' : 'not finished'}
      </span>
      <Link href="/home" className="t-small underline hover:text-ink">
        view plan →
      </Link>
    </div>
  );
}
