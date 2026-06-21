'use client';

import { LegalLinks } from '../legal/legal-links';

/**
 * Classic footer for the authenticated app, rendered at the bottom of the
 * main content area (desktop and mobile). Carries the legal links and a
 * copyright line — replaces the legal links that previously crowded the
 * left sidebar's account footer.
 */
export function AppFooter() {
  return (
    <footer className="mt-s-7 pt-s-5 border-t border-rule">
      <LegalLinks />
      <p className="mt-s-3 t-micro text-ink-mute">© 2026 drill · read, save, produce</p>
    </footer>
  );
}
