'use client';

import Link from 'next/link';
import { useConsent } from '../consent/consent-provider';

export function LegalLinks({ className = '' }: { className?: string }) {
  const { openPreferences } = useConsent();
  return (
    <nav className={`flex flex-wrap items-center gap-s-3 t-small text-ink-mute ${className}`}>
      <Link href="/privacy" className="hover:text-accent">Privacy</Link>
      <Link href="/terms" className="hover:text-accent">Terms</Link>
      <Link href="/cookies" className="hover:text-accent">Cookies</Link>
      <button type="button" className="hover:text-accent" onClick={openPreferences}>
        Cookie preferences
      </button>
      <a href="mailto:info@langdrill.app" className="hover:text-accent">info@langdrill.app</a>
    </nav>
  );
}
