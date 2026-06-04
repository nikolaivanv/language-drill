'use client';

import { useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import {
  createAuthenticatedFetch,
  useRedeemInvite,
} from '@language-drill/api-client';
import { Button, Input } from '../ui';

export function RedeemCodeBox() {
  const { getToken } = useAuth();
  const fetchFn = useMemo(
    () => createAuthenticatedFetch(getToken),
    [getToken],
  );
  const redeem = useRedeemInvite({ fetchFn });
  const [code, setCode] = useState('');

  const ready = code.trim().length === 8;
  const submit = () => {
    if (ready) redeem.mutate({ code: code.trim().toUpperCase() });
  };

  return (
    <div>
      <label className="mb-s-2 block text-sm font-medium" htmlFor="invite-code">
        redeem an invite code
      </label>
      <div className="flex gap-s-2">
        <Input
          id="invite-code"
          type="text"
          placeholder="XXXXXXXX"
          value={code}
          maxLength={8}
          autoCapitalize="characters"
          className="uppercase"
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />
        <Button
          variant="primary"
          onClick={submit}
          loading={redeem.isPending}
          disabled={!ready}
        >
          apply
        </Button>
      </div>
      {redeem.isError && (
        <p role="alert" className="mt-s-2 text-sm text-accent-2">
          {redeem.error.message}
        </p>
      )}
      {redeem.isSuccess && (
        <p role="alert" className="mt-s-2 text-sm text-ink-soft">
          applied — you now have 10× the daily limit.
        </p>
      )}
    </div>
  );
}
