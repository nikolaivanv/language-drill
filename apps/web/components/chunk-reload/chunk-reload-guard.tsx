'use client';

import { useEffect } from 'react';

import { handleChunkError } from '../../lib/chunk-reload/chunk-reload';

const LAST_RELOAD_KEY = 'ld:chunk-reload-at';

function getLastReloadAt(): number | null {
  try {
    const raw = sessionStorage.getItem(LAST_RELOAD_KEY);
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function setLastReloadAt(timestamp: number): void {
  try {
    sessionStorage.setItem(LAST_RELOAD_KEY, String(timestamp));
  } catch {
    // sessionStorage can be unavailable (private mode quotas, etc.) — a
    // failure here just means we can't dedupe; the worst case is one extra
    // reload, which is still better than a broken page.
  }
}

/**
 * Recovers from deploy version-skew by reloading once when a stale/missing
 * code chunk fails to load. Mounted globally in the root layout. See
 * `lib/chunk-reload/chunk-reload.ts` for the detection + anti-loop logic.
 *
 * Renders nothing.
 */
export function ChunkReloadGuard(): null {
  useEffect(() => {
    const deps = () => ({
      now: Date.now(),
      getLastReloadAt,
      setLastReloadAt,
      reload: () => window.location.reload(),
    });

    const onRejection = (event: PromiseRejectionEvent) => {
      handleChunkError(event.reason, deps());
    };
    const onError = (event: ErrorEvent) => {
      // Failed `<script>`/chunk loads surface as window 'error' events whose
      // `error` is often empty; fall back to the message string.
      handleChunkError(event.error ?? event.message, deps());
    };

    window.addEventListener('unhandledrejection', onRejection);
    window.addEventListener('error', onError);
    return () => {
      window.removeEventListener('unhandledrejection', onRejection);
      window.removeEventListener('error', onError);
    };
  }, []);

  return null;
}
