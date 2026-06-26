'use client';

import { useMemo } from 'react';
import { useAuth } from '@clerk/nextjs';
import { createAuthenticatedFetch, useMe } from '@language-drill/api-client';
import { Section } from './section';
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
    <Section id="plan" title="plan & limits" sub="your tier and today's usage.">
      {me.isLoading && <p className="t-body text-ink-soft">loading…</p>}
      {me.error && (
        <p role="alert" className="t-body text-accent-2">
          couldn’t load your plan.
        </p>
      )}
      {me.data && (
        <>
          <p className="mb-s-5 text-[16px] text-ink-2">
            plan:{' '}
            <strong className="text-ink font-semibold">
              {me.data.plan === 'boosted'
                ? `${me.data.isAdmin ? '★ ' : ''}10× plan`
                : 'free plan'}
            </strong>
          </p>
          <div className="mb-s-5 grid grid-cols-3 gap-s-3 mobile:grid-cols-1">
            {BUCKETS.map(([label, key]) => (
              <div key={key} className="rounded-md border border-rule p-s-4">
                <div className="t-mono text-[24px] text-ink tracking-wide">
                  {me.data!.usageToday[key]}{' '}
                  <span className="text-ink-mute">/ {me.data!.limits[key]}</span>
                </div>
                <div className="t-micro text-ink-mute mt-s-2">{label} today</div>
              </div>
            ))}
          </div>
          {me.data.plan === 'free' && <RedeemCodeBox />}
        </>
      )}
    </Section>
  );
}
