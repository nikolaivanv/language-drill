'use client';

import { useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import {
  createAuthenticatedFetch,
  useAdminInvites,
  useCreateInvites,
  useRevokeInvite,
} from '@language-drill/api-client';
import { Button } from '../../../../components/ui';

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
        <h2 className="text-ink-soft text-[12px]">Generate codes</h2>
        <div className="flex flex-wrap items-end gap-2 text-[13px]">
          <label className="flex flex-col gap-1">
            <span className="text-ink-soft text-[12px]">count</span>
            <input
              type="number"
              min={1}
              max={50}
              value={count}
              onChange={(e) =>
                setCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))
              }
              className="w-20"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1 min-w-[200px]">
            <span className="text-ink-soft text-[12px]">note (optional)</span>
            <input
              type="text"
              value={note}
              placeholder="who is this for?"
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <Button
            variant="primary"
            size="sm"
            loading={create.isPending}
            onClick={() => create.mutate({ count, note: note || undefined })}
          >
            generate
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-ink-soft text-[12px]">All codes</h2>
        {list.isLoading ? (
          <p className="text-ink-soft text-[13px]">Loading…</p>
        ) : list.isError ? (
          <p className="text-ink-soft text-[13px]">Failed to load codes.</p>
        ) : (list.data?.length ?? 0) === 0 ? (
          <p className="text-ink-soft text-[13px]">No invite codes yet.</p>
        ) : (
          <table className="text-[13px]">
            <thead>
              <tr>
                <th>Code</th>
                <th>Status</th>
                <th>Note</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.data?.map((inv) => (
                <tr key={inv.id}>
                  <td className="t-mono">{inv.code}</td>
                  <td className="text-ink-soft">{inv.status}</td>
                  <td>{inv.note ?? ''}</td>
                  <td>
                    <button
                      type="button"
                      className="mr-3 text-accent-2"
                      onClick={() => copyLink(inv.code)}
                    >
                      copy link
                    </button>
                    {inv.status === 'unused' && (
                      <button
                        type="button"
                        className="text-ink-soft"
                        onClick={() => revoke.mutate({ id: inv.id })}
                      >
                        revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
