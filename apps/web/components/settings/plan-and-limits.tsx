'use client';

import { useMemo } from 'react';
import { useAuth } from '@clerk/nextjs';
import { createAuthenticatedFetch, useMe } from '@language-drill/api-client';
import { Card } from '../ui';
import { RedeemCodeBox } from '../invite/redeem-code-box';

const BUCKETS = [
  ['evaluations', 'evaluation'],
  ['annotations', 'annotation'],
  ['deep taps', 'deepSpan'],
] as const;

export function PlanAndLimits() {
  const { getToken } = useAuth();
  const fetchFn = useMemo(
    () => createAuthenticatedFetch(getToken),
    [getToken],
  );
  const me = useMe({ fetchFn });

  return (
    <Card padding="lg">
      <h2 className="t-display-s mb-s-3">plan &amp; limits</h2>
      {me.isLoading && <p className="t-body text-ink-soft">loading…</p>}
      {me.error && (
        <p role="alert" className="t-body text-accent-2">
          couldn’t load your plan.
        </p>
      )}
      {me.data && (
        <>
          <p className="mb-s-3 text-sm">
            plan:{' '}
            <strong>
              {me.data.plan === 'boosted'
                ? `${me.data.isAdmin ? '★ ' : ''}10× plan`
                : 'free plan'}
            </strong>
          </p>
          <div className="mb-s-4 grid grid-cols-3 gap-s-3">
            {BUCKETS.map(([label, key]) => (
              <div key={key} className="rounded-r-md border border-rule p-s-3">
                <div className="t-mono text-lg">
                  {me.data!.usageToday[key]} / {me.data!.limits[key]}
                </div>
                <div className="t-micro text-ink-mute">{label} today</div>
              </div>
            ))}
          </div>
          {me.data.plan === 'free' && <RedeemCodeBox />}
        </>
      )}
    </Card>
  );
}
