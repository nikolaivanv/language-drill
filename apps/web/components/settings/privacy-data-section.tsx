'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { createAuthenticatedFetch } from '@language-drill/api-client';
import { Section, Row } from './section';
import { useConsent } from '../consent/consent-provider';
import { downloadMyData } from '../../lib/data-export';

// Shared underlined-link treatment for the policy list — the underline warms
// from a faint rule colour to ink-mute on hover, matching the prototype.
const POLICY_LINK =
  'text-left text-[17px] text-ink-2 underline underline-offset-4 decoration-rule-strong transition-colors duration-150 hover:text-ink hover:decoration-ink-mute';

export function PrivacyDataSection() {
  const { getToken } = useAuth();
  const { openPreferences } = useConsent();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onDownload = async () => {
    setBusy(true);
    setError(null);
    try {
      await downloadMyData(fetchFn);
    } catch {
      setError('Could not export your data. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section id="privacy" title="privacy & data" sub="your data, your rights.">
      <Row label="download my data" hint="a JSON copy of everything tied to your account.">
        <button
          type="button"
          onClick={onDownload}
          disabled={busy}
          className="inline-flex items-center gap-s-2 rounded-md border border-rule-strong bg-transparent px-s-4 py-s-3 text-[15px] font-semibold text-ink transition-all duration-150 hover:bg-paper-2 hover:border-ink-mute disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none"
        >
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
          </svg>
          {busy ? 'preparing…' : 'download my data'}
        </button>
        {error && <p role="alert" className="t-small text-accent-2 mt-s-2">{error}</p>}
      </Row>
      <Row label="delete your account" hint="permanent erasure of your account and all data." align="top">
        <p className="text-[15px] leading-relaxed text-ink-soft m-0">
          Go to <strong className="text-ink-2 font-semibold">account → Security → Delete account</strong>{' '}
          <button
            type="button"
            onClick={() =>
              document
                .getElementById('set-account')
                ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }
            className="text-ink-2 font-semibold underline underline-offset-[3px] decoration-rule-strong transition-colors duration-150 hover:text-ink hover:decoration-ink-mute focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_var(--ring-app)] rounded-sm"
          >
            above
          </button>{' '}
          to permanently remove your data.
        </p>
      </Row>
      <Row label="policies" hint="how we handle your data." align="top">
        <div className="flex flex-col gap-s-2 items-start">
          <Link href="/privacy" className={POLICY_LINK}>Privacy Policy</Link>
          <Link href="/terms" className={POLICY_LINK}>Terms of Service</Link>
          <Link href="/cookies" className={POLICY_LINK}>Cookie Policy</Link>
          <button type="button" className={POLICY_LINK} onClick={openPreferences}>
            Cookie preferences
          </button>
        </div>
      </Row>
    </Section>
  );
}
