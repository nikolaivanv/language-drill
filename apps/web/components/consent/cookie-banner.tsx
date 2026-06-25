'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { useConsent } from './consent-provider';

export function CookieBanner() {
  const { state, ready, update, preferencesOpen, openPreferences, closePreferences } = useConsent();

  const dialogRef = useRef<HTMLDivElement>(null);
  const manageRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef(false);

  // Move focus into the preferences dialog when it opens, and return focus to
  // the Manage button when it closes. The component swaps views in place, so we
  // key off the `preferencesOpen` transition rather than mount/unmount. Refs
  // attach during commit before this effect runs, so on close the re-rendered
  // banner's Manage button is already available. Closing via Allow/Necessary
  // hides the whole banner (no Manage button) → manageRef is null → harmless.
  useEffect(() => {
    if (preferencesOpen) {
      dialogRef.current?.focus();
      returnFocusRef.current = true;
    } else if (returnFocusRef.current) {
      returnFocusRef.current = false;
      manageRef.current?.focus();
    }
  }, [preferencesOpen]);

  // Show the banner only after hydration, when no choice has been recorded.
  const showBanner = ready && state === null;

  if (preferencesOpen) {
    return (
      <div
        ref={dialogRef}
        role="dialog"
        aria-label="Cookie preferences"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            closePreferences();
          }
        }}
        className="fixed inset-x-0 bottom-0 z-50 border-t border-rule bg-paper p-s-5 shadow-lg outline-none"
      >
        <div className="mx-auto max-w-[760px]">
          <h2 className="t-display-m mb-s-2">Cookie preferences</h2>
          <ul className="mb-s-4 list-none p-0 m-0 flex flex-col gap-s-3">
            <li>
              <strong>Strictly necessary</strong> — always on. Required to sign you in and keep drafts.
            </li>
            <li>
              <strong>Analytics</strong> — optional. Off unless you turn it on. Powered by PostHog (EU); masks your typed answers.
            </li>
          </ul>
          <div className="flex gap-s-3">
            <button type="button" className="btn" onClick={() => update({ analytics: true })}>
              Allow analytics
            </button>
            <button type="button" className="btn" onClick={() => update({ analytics: false })}>
              Necessary only
            </button>
            <button type="button" className="btn-ghost" onClick={closePreferences}>
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!showBanner) return null;

  return (
    <div
      role="region"
      aria-label="Cookie notice"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-rule bg-paper p-s-5 shadow-lg"
    >
      <div className="mx-auto max-w-[760px] flex flex-col gap-s-3 mobile:items-stretch sm:flex-row sm:items-center sm:justify-between">
        <p className="t-small text-ink-soft m-0">
          We use strictly-necessary cookies, and analytics only if you opt in.{' '}
          <Link href="/cookies" className="underline">Learn more</Link>.
        </p>
        <div className="flex gap-s-3 shrink-0">
          <button ref={manageRef} type="button" className="btn-ghost" onClick={openPreferences}>Manage</button>
          <button type="button" className="btn-ghost" onClick={() => update({ analytics: false })}>Reject</button>
          <button type="button" className="btn" onClick={() => update({ analytics: true })}>Accept all</button>
        </div>
      </div>
    </div>
  );
}
