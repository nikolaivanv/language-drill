'use client';

import { useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { createAuthenticatedFetch, useAuditLog, type AuditQuery } from '@language-drill/api-client';

const PAGE_SIZE = 50;
const ACTIONS = [
  'flagged.approve', 'flagged.reject', 'content.demote', 'content.reject',
  'generation.trigger', 'invite.create', 'invite.revoke',
];
const TARGET_TYPES = ['exercise', 'theory_topic', 'cell', 'invite'];

export default function AuditPage() {
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  const [filters, setFilters] = useState<{ action?: string; targetType?: string; adminUserId?: string }>({});
  const [offset, setOffset] = useState(0);

  const params: AuditQuery = { ...filters, limit: PAGE_SIZE, offset };
  const audit = useAuditLog({ fetchFn, params });
  const total = audit.data?.total ?? 0;
  const items = audit.data?.items ?? [];

  const setFilter = (key: keyof typeof filters, value: string) => {
    setFilters((f) => ({ ...f, [key]: value || undefined }));
    setOffset(0);
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-[24px] font-semibold text-ink">Audit log</h1>

      <div className="flex gap-2 flex-wrap text-[13px]">
        <select aria-label="action" value={filters.action ?? ''} onChange={(e) => setFilter('action', e.target.value)}>
          <option value="">All actions</option>
          {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select aria-label="target type" value={filters.targetType ?? ''} onChange={(e) => setFilter('targetType', e.target.value)}>
          <option value="">All targets</option>
          {TARGET_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input aria-label="admin user id" placeholder="admin user id" value={filters.adminUserId ?? ''} onChange={(e) => setFilter('adminUserId', e.target.value)} />
      </div>

      {audit.isLoading ? <p className="text-ink-soft text-[13px]">Loading…</p>
        : audit.isError ? <p className="text-ink-soft text-[13px]">Failed to load the audit log.</p>
        : items.length === 0 ? <p className="text-ink-soft text-[13px]">No audit events.</p>
        : (
          <>
            <p className="text-[12px] text-ink-soft">
              {total} event{total === 1 ? '' : 's'} · page {Math.floor(offset / PAGE_SIZE) + 1}/{Math.max(1, Math.ceil(total / PAGE_SIZE))}
            </p>
            <table className="text-[13px]">
              <thead>
                <tr><th>Time</th><th>Admin</th><th>Action</th><th>Target</th><th>Details</th></tr>
              </thead>
              <tbody>
                {items.map((e) => (
                  <tr key={e.id}>
                    <td className="text-ink-soft">{e.createdAt ? new Date(e.createdAt).toLocaleString() : '—'}</td>
                    <td>{e.adminUserId}</td>
                    <td>{e.action}</td>
                    <td className="text-ink-soft">{e.targetType}{e.targetId ? ` · ${e.targetId}` : ''}</td>
                    <td>
                      {e.metadata !== null && e.metadata !== undefined ? (
                        <details>
                          <summary className="cursor-pointer text-ink-soft">{JSON.stringify(e.metadata)}</summary>
                          <pre className="mt-1 whitespace-pre-wrap break-words text-[12px]">{JSON.stringify(e.metadata, null, 2)}</pre>
                        </details>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex gap-2 items-center text-[13px]">
              <button disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))} className="text-ink-soft disabled:opacity-40">‹ prev</button>
              <button disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset((o) => o + PAGE_SIZE)} className="text-ink-soft disabled:opacity-40">next ›</button>
            </div>
          </>
        )}
    </div>
  );
}
