'use client';

// ---------------------------------------------------------------------------
// PostSignupRedeem
// ---------------------------------------------------------------------------
// After a user signs in via the /invite/[code] flow (Task 14), the invite code
// is stashed in localStorage['pending_invite']. This component — mounted once
// inside the authenticated dashboard shell — auto-redeems that stashed code
// exactly once, then surfaces a result banner.
//
// The redeem fires at most once: a `useRef` guard prevents double-firing under
// React strict mode / re-renders, and the localStorage key is removed BEFORE
// the mutation runs so a failed/in-flight attempt can never be retried on a
// later mount. The app has no toast library, so we render an inline
// `role="alert"` banner matching the existing soft-token banner pattern
// (success → ok tokens, error → accent tokens). Renders nothing when there is
// no pending invite and no banner to show.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import {
  createAuthenticatedFetch,
  useRedeemInvite,
  RedeemError,
} from '@language-drill/api-client';

const SUCCESS_TEXT = "Invite applied — you've got 10× the daily limit.";
const USED_TEXT = 'That invite was already used — you’re on the free plan.';
const EXPIRED_TEXT = 'That invite has expired — you’re on the free plan.';
const INVALID_TEXT = 'That invite code didn’t work — you’re on the free plan.';

function errorText(err: unknown): string {
  if (err instanceof RedeemError && err.kind === 'used') return USED_TEXT;
  if (err instanceof RedeemError && err.kind === 'expired') return EXPIRED_TEXT;
  return INVALID_TEXT;
}

export function PostSignupRedeem() {
  const { getToken } = useAuth();
  const fetchFn = useMemo(
    () => createAuthenticatedFetch(getToken),
    [getToken],
  );
  const redeem = useRedeemInvite({ fetchFn });
  const attempted = useRef(false);
  const [banner, setBanner] = useState<{
    kind: 'ok' | 'err';
    text: string;
  } | null>(null);

  useEffect(() => {
    if (attempted.current) return;

    let code: string | null = null;
    try {
      code = localStorage.getItem('pending_invite');
    } catch {
      /* localStorage unavailable — nothing to redeem */
    }
    if (!code) return;

    // Mark attempted and clear the key BEFORE mutating so the redeem can never
    // loop or be retried on a later mount.
    attempted.current = true;
    try {
      localStorage.removeItem('pending_invite');
    } catch {
      /* ignore — best-effort cleanup */
    }

    redeem.mutate(
      { code },
      {
        onSuccess: () => setBanner({ kind: 'ok', text: SUCCESS_TEXT }),
        onError: (err) =>
          setBanner({ kind: 'err', text: errorText(err) }),
      },
    );
    // Mount-only effect: dependencies are intentionally empty so this runs
    // exactly once. The useRef guard above hardens against strict-mode
    // double-invocation.
  }, []);

  if (!banner) return null;

  return (
    <div
      role="alert"
      className={`mb-s-4 rounded-r-md p-s-3 t-small ${
        banner.kind === 'ok'
          ? 'bg-ok-soft text-ok'
          : 'bg-accent-soft text-accent-2'
      }`}
    >
      {banner.text}
    </div>
  );
}
