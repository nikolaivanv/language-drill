'use client';

import { useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { createAuthenticatedFetch, useAuditLog, type AuditQuery } from '@language-drill/api-client';
import { Input } from '../../../../components/ui';
import { FilterSelect } from '../../../../components/admin/filter-select';
import { DataTable, Th, Td } from '../../../../components/admin/data-table';

const PAGE_SIZE = 50;
const ACTIONS = [
  'flagged.approve', 'flagged.reject', 'content.demote', 'content.reject',
  'generation.trigger', 'revalidate.apply', 'invite.create', 'invite.revoke',
  'user_flag.reject', 'user_flag.dismiss',
];
const TARGET_TYPES = ['exercise', 'theory_topic', 'cell', 'invite', 'exercise_flag'];

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

      <div className="flex items-center gap-2 flex-wrap">
        <FilterSelect aria-label="action" value={filters.action ?? ''} onChange={(e) => setFilter('action', e.target.value)}>
          <option value="">All actions</option>
          {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
        </FilterSelect>
        <FilterSelect aria-label="target type" value={filters.targetType ?? ''} onChange={(e) => setFilter('targetType', e.target.value)}>
          <option value="">All targets</option>
          {TARGET_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </FilterSelect>
        <div className="w-[220px]">
          <Input aria-label="admin user id" className="rounded-md" placeholder="admin user id" value={filters.adminUserId ?? ''} onChange={(e) => setFilter('adminUserId', e.target.value)} />
        </div>
      </div>

      {audit.isLoading ? <p className="text-ink-soft text-[13px]">Loading…</p>
        : audit.isError ? <p className="text-ink-soft text-[13px]">Failed to load the audit log.</p>
        : items.length === 0 ? <p className="text-ink-soft text-[13px]">No audit events.</p>
        : (
          <>
            <p className="text-[12px] text-ink-soft">
              {total} event{total === 1 ? '' : 's'} · page {Math.floor(offset / PAGE_SIZE) + 1}/{Math.max(1, Math.ceil(total / PAGE_SIZE))}
            </p>
            <DataTable>
              <thead>
                <tr><Th>Time</Th><Th>Admin</Th><Th>Action</Th><Th>Target</Th><Th>Details</Th></tr>
              </thead>
              <tbody>
                {items.map((e) => (
                  <tr key={e.id}>
                    <Td className="text-ink-soft whitespace-nowrap">{e.createdAt ? new Date(e.createdAt).toLocaleString() : '—'}</Td>
                    <Td className="t-mono">{e.adminUserId}</Td>
                    <Td>{e.action}</Td>
                    <Td className="text-ink-soft">{e.targetType}{e.targetId ? ` · ${e.targetId}` : ''}</Td>
                    <Td className="max-w-[420px]">
                      {e.metadata !== null && e.metadata !== undefined ? (
                        <details>
                          <summary className="cursor-pointer text-ink-soft truncate">{JSON.stringify(e.metadata)}</summary>
                          <pre className="mt-1 whitespace-pre-wrap break-words text-[12px]">{JSON.stringify(e.metadata, null, 2)}</pre>
                        </details>
                      ) : '—'}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
            <div className="flex gap-2 items-center text-[13px]">
              <button disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))} className="text-ink-soft disabled:opacity-40">‹ prev</button>
              <button disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset((o) => o + PAGE_SIZE)} className="text-ink-soft disabled:opacity-40">next ›</button>
            </div>
          </>
        )}
    </div>
  );
}
