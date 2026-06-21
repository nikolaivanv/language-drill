/**
 * Deploy version-skew recovery.
 *
 * When a new release ships, the previously-deployed JS chunks can disappear (or
 * their webpack module-id map shifts). A tab still running the old build then
 * lazy-loads a route chunk and the dynamic `import()` rejects — surfacing as an
 * unhandled promise rejection (`ChunkLoadError`, "Loading chunk … failed",
 * "Failed to fetch dynamically imported module", …). The user sees a broken
 * page; a hard refresh fixes it because it re-fetches the current build.
 *
 * This module turns that broken state into a single automatic reload. It only
 * targets the *reliably-identifiable* chunk-load signatures — it deliberately
 * does NOT try to catch the rarer "module-id mismatch" variant (a generic
 * `TypeError: x is not a function` thrown from inside the webpack require
 * boundary), because that signature is indistinguishable from a real bug by
 * message alone and auto-reloading on it would mask genuine defects.
 */

const CHUNK_ERROR_PATTERNS: readonly RegExp[] = [
  // webpack: failed to load a JS or CSS chunk
  /Loading chunk [^\s]+ failed/i,
  /Loading CSS chunk [^\s]+ failed/i,
  // Chrome / Edge: dynamic import network failure
  /Failed to fetch dynamically imported module/i,
  // Firefox
  /error loading dynamically imported module/i,
  // Safari
  /Importing a module script failed/i,
];

/**
 * The reason attached to an `unhandledrejection` is often the thrown value
 * itself, but can be wrapped. Pull out the first Error-shaped object we find.
 */
function toErrorLike(
  value: unknown,
): { name?: unknown; message?: unknown } | null {
  if (value && typeof value === 'object') {
    return value as { name?: unknown; message?: unknown };
  }
  if (typeof value === 'string') {
    return { message: value };
  }
  return null;
}

/** True when `error` is a recoverable stale-/missing-chunk load failure. */
export function isChunkLoadError(error: unknown): boolean {
  const err = toErrorLike(error);
  if (!err) return false;

  if (typeof err.name === 'string' && err.name === 'ChunkLoadError') {
    return true;
  }

  const message = typeof err.message === 'string' ? err.message : '';
  if (!message) return false;
  return CHUNK_ERROR_PATTERNS.some((re) => re.test(message));
}

/**
 * If the same tab reloaded for a chunk error within this window, suppress
 * further reloads — the reload didn't fix it (e.g. the chunk genuinely 404s),
 * so let the error surface instead of trapping the user in a reload loop.
 */
export const RELOAD_SUPPRESS_WINDOW_MS = 10_000;

export interface ReloadGuardDeps {
  /** Current time (ms). Injected for deterministic testing. */
  now: number;
  /** Timestamp (ms) of the last chunk-triggered reload, or null if none. */
  getLastReloadAt: () => number | null;
  /** Persist the timestamp of the reload we're about to perform. */
  setLastReloadAt: (timestamp: number) => void;
  /** Perform the actual page reload. */
  reload: () => void;
}

/**
 * Reload once for a chunk-load error, with a short anti-loop window.
 *
 * Returns true when a reload was triggered, false otherwise (not a chunk
 * error, or a reload happened too recently to retry).
 */
export function handleChunkError(
  error: unknown,
  deps: ReloadGuardDeps,
): boolean {
  if (!isChunkLoadError(error)) return false;

  const last = deps.getLastReloadAt();
  if (last !== null && deps.now - last < RELOAD_SUPPRESS_WINDOW_MS) {
    return false;
  }

  deps.setLastReloadAt(deps.now);
  deps.reload();
  return true;
}
