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
    <div className="space-y-s-6">
      <h1 className="t-display-l">invites</h1>

      <Card padding="lg">
        <h2 className="t-display-s mb-s-3">generate codes</h2>
        <div className="flex flex-wrap items-end gap-s-3">
          <div>
            <label className="mb-s-1 block t-mono text-ink-mute">count</label>
            <Input
              type="number"
              min={1}
              max={50}
              value={count}
              onChange={(e) =>
                setCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))
              }
            />
          </div>
          <div className="flex-1">
            <label className="mb-s-1 block t-mono text-ink-mute">
              note (optional)
            </label>
            <Input
              type="text"
              value={note}
              placeholder="who is this for?"
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <Button
            variant="primary"
            loading={create.isPending}
            onClick={() => create.mutate({ count, note: note || undefined })}
          >
            generate
          </Button>
        </div>
      </Card>

      <Card padding="lg">
        <h2 className="t-display-s mb-s-3">all codes</h2>
        {list.isLoading && <p className="t-body text-ink-soft">loading…</p>}
        {list.data && (
          <table className="w-full t-body">
            <thead>
              <tr className="text-ink-mute">
                <th className="text-left">code</th>
                <th className="text-left">status</th>
                <th className="text-left">note</th>
                <th className="text-right">actions</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((inv) => (
                <tr key={inv.id} className="border-t border-rule">
                  <td className="t-mono">{inv.code}</td>
                  <td>{inv.status}</td>
                  <td>{inv.note ?? ''}</td>
                  <td className="text-right">
                    <button
                      type="button"
                      className="mr-s-3 text-accent-2"
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
      </Card>
    </div>
  );
}
