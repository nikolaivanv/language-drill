'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { createAuthenticatedFetch } from '@language-drill/api-client';
import { Section, Row } from './section';
import { useConsent } from '../consent/consent-provider';
import { downloadMyData } from '../../lib/data-export';

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
        <button type="button" className="btn" onClick={onDownload} disabled={busy}>
          {busy ? 'preparing…' : 'download my data'}
        </button>
        {error && <p role="alert" className="t-small text-accent-2 mt-s-2">{error}</p>}
      </Row>
      <Row label="delete your account" hint="permanent erasure of your account and all data.">
        <p className="t-small text-ink-soft m-0">
          Go to <strong>account → Security → Delete account</strong> above to permanently remove your data.
        </p>
      </Row>
      <Row label="policies" hint="how we handle your data.">
        <div className="flex flex-col gap-s-1">
          <Link href="/privacy" className="underline">Privacy Policy</Link>
          <Link href="/terms" className="underline">Terms of Service</Link>
          <Link href="/cookies" className="underline">Cookie Policy</Link>
          <button type="button" className="underline text-left" onClick={openPreferences}>
            Cookie preferences
          </button>
        </div>
      </Row>
    </Section>
  );
}
