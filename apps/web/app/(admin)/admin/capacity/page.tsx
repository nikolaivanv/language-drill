'use client';

import { useMemo } from 'react';
import { useAuth } from '@clerk/nextjs';
import { createAuthenticatedFetch, useCapacity, useGenerationStats } from '@language-drill/api-client';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[12px] text-ink-soft">{label}</span>
      <span className="text-[15px] text-ink">{value}</span>
    </div>
  );
}

export default function CapacityPage() {
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  const capacity = useCapacity({ fetchFn });
  const stats = useGenerationStats({ fetchFn });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-[24px] font-semibold text-ink">Usage &amp; cost</h1>

      <section className="flex flex-col gap-2">
        <h2 className="text-ink-soft text-[12px]">Cost &amp; generation</h2>
        {stats.isLoading ? (
          <p className="text-ink-soft text-[13px]">Loading…</p>
        ) : stats.isError || !stats.data ? (
          <p className="text-ink-soft text-[13px]">Failed to load generation stats.</p>
        ) : (
          <div className="flex gap-8 flex-wrap">
            <Stat label="Cost this week" value={`$${stats.data.costThisWeekUsd.toFixed(2)}`} />
            <Stat label="Cost this month" value={`$${stats.data.costThisMonthUsd.toFixed(2)}`} />
            <Stat
              label="Jobs (7d)"
              value={`✓ ${stats.data.jobsThisWeek.succeeded} · ✗ ${stats.data.jobsThisWeek.failed} · ${stats.data.jobsThisWeek.running} running · ${stats.data.jobsThisWeek.queued} queued`}
            />
          </div>
        )}
      </section>

      {capacity.isLoading ? (
        <p className="text-ink-soft text-[13px]">Loading…</p>
      ) : capacity.isError || !capacity.data ? (
        <p className="text-ink-soft text-[13px]">Failed to load capacity.</p>
      ) : (
        <>
          <section className="flex flex-col gap-1">
            <h2 className="text-ink-soft text-[12px]">Brakes</h2>
            <div className="flex gap-2 items-center text-[13px]">
              <span className="text-ink-soft">Kill switch</span>
              <span className={capacity.data.killSwitch ? 'text-red-700 font-medium' : 'text-ink'}>
                {capacity.data.killSwitch ? 'On' : 'Off'}
              </span>
              <span className="text-ink-soft">· Global cap</span>
              <span className="text-ink">
                {capacity.data.globalDailyCap !== null ? capacity.data.globalDailyCap : 'no cap'}
              </span>
            </div>
            <p className="text-[12px] text-ink-soft">
              Set via deploy (AI_KILL_SWITCH / AI_GLOBAL_DAILY_CAP) — UI toggle not yet available.
            </p>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-ink-soft text-[12px]">Consumption (24h)</h2>
            <p className="text-[13px] text-ink">
              {capacity.data.globalDailyCap !== null
                ? `${capacity.data.usage24h.total} / ${capacity.data.globalDailyCap} (${Math.round((capacity.data.usage24h.total / capacity.data.globalDailyCap) * 100)}%)`
                : `${capacity.data.usage24h.total} events · no cap`}
            </p>

            <div className="flex flex-col gap-1">
              <h3 className="text-[12px] text-ink-soft">By event type</h3>
              {capacity.data.usage24h.byEventType.length === 0 ? (
                <p className="text-ink-soft text-[13px]">No usage in the last 24h.</p>
              ) : (
                <table className="text-[13px]">
                  <thead>
                    <tr><th>Event type</th><th>24h count</th></tr>
                  </thead>
                  <tbody>
                    {capacity.data.usage24h.byEventType.map((e) => (
                      <tr key={e.eventType}><td>{e.eventType}</td><td>{e.count}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="flex flex-col gap-1">
              <h3 className="text-[12px] text-ink-soft">Top consumers</h3>
              {capacity.data.topConsumers.length === 0 ? (
                <p className="text-ink-soft text-[13px]">No consumers in the last 24h.</p>
              ) : (
                <table className="text-[13px]">
                  <thead>
                    <tr><th>User</th><th>24h count</th></tr>
                  </thead>
                  <tbody>
                    {capacity.data.topConsumers.map((c) => (
                      <tr key={c.userId}><td>{c.userId}</td><td>{c.count}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
