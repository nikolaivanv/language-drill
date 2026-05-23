import { useSyncExternalStore } from 'react';

// Single source of truth for the responsive breakpoint. The Tailwind `mobile:`
// custom variant in `app/globals.css` and every `@media (max-width: 760px)`
// block are documented to mirror this constant — keep them in sync.
export const MOBILE_MAX_WIDTH = 760;
export const MOBILE_MEDIA_QUERY = `(max-width: ${MOBILE_MAX_WIDTH}px)`;

function subscribe(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {};
  }
  const mql = window.matchMedia(MOBILE_MEDIA_QUERY);
  mql.addEventListener('change', onStoreChange);
  return () => mql.removeEventListener('change', onStoreChange);
}

function getSnapshot(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia(MOBILE_MEDIA_QUERY).matches;
}

// The server (and the first client render during hydration) always reports the
// desktop layout, so the server-rendered tree is stable and never throws a
// hydration mismatch. `useSyncExternalStore` reconciles to the real viewport
// immediately after mount.
function getServerSnapshot(): boolean {
  return false;
}

// SSR-safe viewport branching. Returns `false` on the server and during the
// first client render, then reflects `(max-width: 760px)` and updates on
// change. Falls back to `false` (desktop) when `matchMedia` is unavailable so
// older browsers / non-DOM environments degrade gracefully rather than crash.
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
