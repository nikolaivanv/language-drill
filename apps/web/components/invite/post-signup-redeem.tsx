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
// later mount. The app has no toast library, so we render a `role="alert"`
// banner matching the existing soft-token banner pattern (success → ok tokens,
// error → accent tokens). Renders nothing when there is no pending invite and
// no banner to show.
//
// The banner is a transient, dismissible *overlay*, not in-flow content. This
// component is mounted in the persistent (dashboard) layout, so an in-flow
// banner would (a) survive client-side navigation and linger over every page
// (today, drill, …) until a full reload, and (b) overlap pages that pull
// themselves flush with negative margins (the drill grid uses `-my-[36px]`).
// Fixing both: position the banner `fixed` so it never participates in flow,
// auto-dismiss it after a few seconds, and give it a manual dismiss button.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import {
  createAuthenticatedFetch,
  useRedeemInvite,
  RedeemError,
} from '@language-drill/api-client';

// How long the result banner lingers before auto-dismissing (ms).
const AUTO_DISMISS_MS = 8000;

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

  // Auto-dismiss the banner so it never lingers across navigation.
  useEffect(() => {
    if (!banner) return;
    const timer = setTimeout(() => setBanner(null), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [banner]);

  if (!banner) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center px-s-4 pt-s-4">
      <div
        role="alert"
        className={`pointer-events-auto flex max-w-md items-start gap-s-3 rounded-r-md p-s-3 t-small shadow-1 ${
          banner.kind === 'ok'
            ? 'bg-ok-soft text-ok'
            : 'bg-accent-soft text-accent-2'
        }`}
      >
        <span className="flex-1">{banner.text}</span>
        <button
          type="button"
          aria-label="dismiss"
          onClick={() => setBanner(null)}
          className="-m-s-1 shrink-0 rounded-r-sm p-s-1 leading-none opacity-70 transition-opacity hover:opacity-100"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
