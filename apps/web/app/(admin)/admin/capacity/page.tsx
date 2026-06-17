'use client';

import { useMemo } from 'react';
import { useAuth } from '@clerk/nextjs';
import { createAuthenticatedFetch, useCapacity } from '@language-drill/api-client';

export default function CapacityPage() {
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  const capacity = useCapacity({ fetchFn });

  if (capacity.isLoading) return <p className="text-ink-soft text-[13px]">Loading…</p>;
  if (capacity.isError || !capacity.data) return <p className="text-ink-soft text-[13px]">Failed to load capacity.</p>;

  const { killSwitch, globalDailyCap, usage24h, topConsumers } = capacity.data;
  const usageLine =
    globalDailyCap !== null
      ? `${usage24h.total} / ${globalDailyCap} (${Math.round((usage24h.total / globalDailyCap) * 100)}%)`
      : `${usage24h.total} events · no cap`;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-[24px] font-semibold text-ink">Usage &amp; capacity</h1>

      <section className="flex flex-col gap-1 text-[13px]">
        <div className="flex gap-2 items-center">
          <span className="text-ink-soft">Kill switch</span>
          <span className={killSwitch ? 'text-red-700 font-medium' : 'text-ink'}>{killSwitch ? 'On' : 'Off'}</span>
          <span className="text-ink-soft">· Global cap</span>
          <span className="text-ink">{globalDailyCap !== null ? globalDailyCap : 'no cap'}</span>
        </div>
        <p className="text-[12px] text-ink-soft">
          Set via deploy (AI_KILL_SWITCH / AI_GLOBAL_DAILY_CAP) — UI toggle not yet available.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-ink-soft text-[12px]">Last 24h</h2>
        <p className="text-[13px] text-ink">{usageLine}</p>
        {usage24h.byEventType.length === 0 ? (
          <p className="text-ink-soft text-[13px]">No usage in the last 24h.</p>
        ) : (
          <table className="text-[13px]">
            <thead>
              <tr>
                <th>Event type</th>
                <th>24h count</th>
              </tr>
            </thead>
            <tbody>
              {usage24h.byEventType.map((e) => (
                <tr key={e.eventType}>
                  <td>{e.eventType}</td>
                  <td>{e.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-ink-soft text-[12px]">Top consumers (24h)</h2>
        {topConsumers.length === 0 ? (
          <p className="text-ink-soft text-[13px]">No consumers in the last 24h.</p>
        ) : (
          <table className="text-[13px]">
            <thead>
              <tr>
                <th>User</th>
                <th>24h count</th>
              </tr>
            </thead>
            <tbody>
              {topConsumers.map((c) => (
                <tr key={c.userId}>
                  <td>{c.userId}</td>
                  <td>{c.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
