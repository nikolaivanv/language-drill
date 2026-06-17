'use client';

import { useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { createAuthenticatedFetch, useUserFlagsQueue, useResolveUserFlag, type UserFlagStatus } from '@language-drill/api-client';
import { FlagCard } from './_components/flag-card';

const STATUSES: UserFlagStatus[] = ['open', 'resolved_rejected', 'resolved_dismissed', 'all'];

export default function FlagsPage() {
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  const [status, setStatus] = useState<UserFlagStatus>('open');

  const queue = useUserFlagsQueue({ fetchFn, status });
  const resolve = useResolveUserFlag({ fetchFn });
  const items = queue.data?.items ?? [];

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-[24px] font-semibold text-ink">User flags</h1>

      <div className="flex gap-2 text-[13px]">
        <select aria-label="status" value={status} onChange={(e) => setStatus(e.target.value as UserFlagStatus)}>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {queue.isLoading ? <p className="text-ink-soft text-[13px]">Loading…</p>
        : queue.isError ? <p className="text-ink-soft text-[13px]">Failed to load flags.</p>
        : items.length === 0 ? <p className="text-ink-soft text-[13px]">No {status === 'open' ? 'open ' : ''}flags.</p>
        : (
          <div className="flex flex-col gap-3">
            {items.map((flag) => (
              <FlagCard
                key={flag.id}
                flag={flag}
                disabled={resolve.isPending}
                onReject={() => resolve.mutate({ id: flag.id, action: 'reject' })}
                onDismiss={() => resolve.mutate({ id: flag.id, action: 'dismiss' })}
              />
            ))}
          </div>
        )}
    </div>
  );
}
