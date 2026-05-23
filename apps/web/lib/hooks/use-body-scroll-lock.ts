import { useEffect } from 'react';

// Locks page scroll while `active`. Caches the previous `overflow` values on
// both <html> and <body> (iOS Safari needs both) and restores them on
// deactivation/unmount. Single-instance hook — we never have two panels open
// simultaneously, so we don't need a reference counter.
export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    if (typeof document === 'undefined') return;

    const body = document.body;
    const html = document.documentElement;
    const previousBodyOverflow = body.style.overflow;
    const previousHtmlOverflow = html.style.overflow;

    body.style.overflow = 'hidden';
    html.style.overflow = 'hidden';

    return () => {
      body.style.overflow = previousBodyOverflow;
      html.style.overflow = previousHtmlOverflow;
    };
  }, [active]);
}
