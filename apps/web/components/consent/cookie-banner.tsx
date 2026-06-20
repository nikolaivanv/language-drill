'use client';

import Link from 'next/link';
import { useConsent } from './consent-provider';

export function CookieBanner() {
  const { state, ready, update, preferencesOpen, openPreferences, closePreferences } = useConsent();

  // Show the banner only after hydration, when no choice has been recorded.
  const showBanner = ready && state === null;

  if (preferencesOpen) {
    return (
      <div
        role="dialog"
        aria-label="Cookie preferences"
        className="fixed inset-x-0 bottom-0 z-50 border-t border-rule bg-paper p-s-5 shadow-lg"
      >
        <div className="mx-auto max-w-[760px]">
          <h2 className="t-display-m mb-s-2">Cookie preferences</h2>
          <ul className="mb-s-4 list-none p-0 m-0 flex flex-col gap-s-3">
            <li>
              <strong>Strictly necessary</strong> — always on. Required to sign you in and keep drafts.
            </li>
            <li>
              <strong>Analytics</strong> — optional. Off unless you turn it on. Not active today.
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
          We use only strictly-necessary cookies. We&rsquo;ll ask before enabling any analytics.{' '}
          <Link href="/cookies" className="underline">Learn more</Link>.
        </p>
        <div className="flex gap-s-3 shrink-0">
          <button type="button" className="btn-ghost" onClick={openPreferences}>Manage</button>
          <button type="button" className="btn-ghost" onClick={() => update({ analytics: false })}>Reject</button>
          <button type="button" className="btn" onClick={() => update({ analytics: true })}>Accept all</button>
        </div>
      </div>
    </div>
  );
}
