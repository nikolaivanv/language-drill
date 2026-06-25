'use client';

import { useEffect, useRef, useState } from 'react';
import './cookie-banner.css';
import { useConsent } from './consent-provider';

export function CookieBanner() {
  const { state, ready, update, preferencesOpen, closePreferences } = useConsent();
  const [dismissed, setDismissed] = useState(false);

  // The dark card shows on first visit (no stored choice) and whenever it is
  // reopened from the footer "Cookie preferences" link (preferencesOpen). The ✕
  // ("Decide later") hides it without recording a choice — on first visit that
  // is local-only, so it returns next visit; when reopened it just closes.
  const open = preferencesOpen || (ready && state === null && !dismissed);

  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);

  // Move focus into the card when it opens and restore it to the opener (the
  // footer link, or wherever focus sat) when it closes. The card is non-modal
  // (aria-modal="false"), matching the design, so focus is not trapped.
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      wasOpenRef.current = true;
      restoreFocusRef.current = document.activeElement as HTMLElement | null;
      dialogRef.current?.focus();
    } else if (!open && wasOpenRef.current) {
      wasOpenRef.current = false;
      restoreFocusRef.current?.focus?.();
    }
  }, [open]);

  if (!open) return null;

  // ✕ = decide later: close the reopened view, or locally hide the first-visit
  // banner without persisting a choice.
  const dismiss = () => {
    if (preferencesOpen) closePreferences();
    else setDismissed(true);
  };

  return (
    <div className="ckb-root">
      <div
        ref={dialogRef}
        className="ckb-card"
        role="dialog"
        aria-label="Cookie preferences"
        aria-modal="false"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            dismiss();
          }
        }}
      >
        <button type="button" className="ckb-x" aria-label="Decide later" onClick={dismiss}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M5 5l14 14M19 5L5 19" />
          </svg>
        </button>
        <h2 className="ckb-title">Cookie preferences</h2>
        <div className="ckb-body">
          <p>
            <b>Strictly necessary</b> — always on. Required to sign you in and keep your drafts.
          </p>
          <p>
            <b>Analytics</b> — optional. Off unless you turn it on. Powered by PostHog (EU); your
            typed answers are masked.
          </p>
        </div>
        <div className="ckb-actions">
          <button type="button" className="ckb-btn ghost" onClick={() => update({ analytics: false })}>
            Necessary only
          </button>
          <button type="button" className="ckb-btn primary" onClick={() => update({ analytics: true })}>
            Allow analytics
          </button>
        </div>
        <div className="ckb-foot">change anytime · footer → cookie preferences</div>
      </div>
    </div>
  );
}
