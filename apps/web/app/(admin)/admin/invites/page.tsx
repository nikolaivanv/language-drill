'use client';

import { useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import {
  createAuthenticatedFetch,
  useAdminInvites,
  useCreateInvites,
  useRevokeInvite,
} from '@language-drill/api-client';
import { Button, Card, Input } from '../../../../components/ui';
import { DataTable, Th, Td } from '../../../../components/admin/data-table';

export default function AdminInvitesPage() {
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);

  const list = useAdminInvites({ fetchFn });
  const create = useCreateInvites({ fetchFn });
  const revoke = useRevokeInvite({ fetchFn });

  const [count, setCount] = useState(1);
  const [note, setNote] = useState('');

  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  const copyLink = (code: string) => {
    void navigator.clipboard?.writeText(`${origin}/invite/${code}`);
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-[24px] font-semibold text-ink">Invites</h1>

      <section className="flex flex-col gap-2">
        <h2 className="text-ink-soft text-[12px] uppercase tracking-wide">Generate codes</h2>
        <Card padding="md">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-ink-soft text-[12px]">Count</span>
              <Input
                type="number"
                min={1}
                max={50}
                value={count}
                onChange={(e) =>
                  setCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))
                }
                className="w-24 rounded-md"
              />
            </label>
            <label className="flex flex-1 flex-col gap-1 min-w-[200px]">
              <span className="text-ink-soft text-[12px]">Note (optional)</span>
              <Input
                type="text"
                value={note}
                placeholder="who is this for?"
                onChange={(e) => setNote(e.target.value)}
                className="rounded-md"
              />
            </label>
            <Button
              variant="primary"
              size="md"
              loading={create.isPending}
              onClick={() => create.mutate({ count, note: note || undefined })}
            >
              Generate
            </Button>
          </div>
        </Card>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-ink-soft text-[12px] uppercase tracking-wide">All codes</h2>
        {list.isLoading ? (
          <p className="text-ink-soft text-[13px]">Loading…</p>
        ) : list.isError ? (
          <p className="text-ink-soft text-[13px]">Failed to load codes.</p>
        ) : (list.data?.length ?? 0) === 0 ? (
          <p className="text-ink-soft text-[13px]">No invite codes yet.</p>
        ) : (
          <DataTable>
            <thead>
              <tr>
                <Th>Code</Th>
                <Th>Status</Th>
                <Th>Note</Th>
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {list.data?.map((inv) => (
                <tr key={inv.id}>
                  <Td className="t-mono">{inv.code}</Td>
                  <Td>
                    <span
                      className={
                        inv.status === 'unused'
                          ? 'text-ink-soft'
                          : 'text-ink-mute line-through'
                      }
                    >
                      {inv.status}
                    </span>
                  </Td>
                  <Td className="text-ink-soft">{inv.note ?? '—'}</Td>
                  <Td align="right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        className="rounded-r-sm px-2 py-1 text-[12px] font-medium text-accent-2 hover:bg-accent-soft"
                        onClick={() => copyLink(inv.code)}
                      >
                        Copy link
                      </button>
                      {inv.status === 'unused' && (
                        <button
                          type="button"
                          className="rounded-r-sm px-2 py-1 text-[12px] font-medium text-ink-soft hover:bg-paper-2 hover:text-ink"
                          onClick={() => revoke.mutate({ id: inv.id })}
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </section>
    </div>
  );
}
