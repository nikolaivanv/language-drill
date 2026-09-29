// Module-scope pool cache for the unauthenticated public endpoints.
//
// An unauthenticated GET that runs a window query per request lets anyone spin
// our Neon compute and degrade the database for real users; API Gateway's
// default throttling is orders of magnitude too permissive to prevent it. The
// public conjugation pools are tiny (<=~220 rows per language/level), so we
// hold the whole window in Lambda memory and re-query at most once per key per
// TTL. Cost ceiling: 12 queries per Lambda instance per 5 minutes.

export const PUBLIC_POOL_TTL_MS = 5 * 60_000;

// Negative-cache TTL for a failed load. Deliberately much shorter than the
// happy-path TTL: a database outage should self-heal into this cache within
// seconds of recovering, not minutes. Deliberately much longer than a single
// request: without it, a degraded database gets re-queried at the full open-web
// request rate — the exact amplification this cache exists to prevent, arriving
// exactly when the database is weakest.
export const PUBLIC_POOL_NEGATIVE_TTL_MS = 20_000;

type Entry<T> =
  | { kind: 'rows'; rows: T[]; fetchedAt: number }
  | { kind: 'error'; error: unknown; fetchedAt: number };

export function createPoolCache<T>(
  opts: { ttlMs?: number; negativeTtlMs?: number; now?: () => number } = {},
) {
  const ttlMs = opts.ttlMs ?? PUBLIC_POOL_TTL_MS;
  const negativeTtlMs = opts.negativeTtlMs ?? PUBLIC_POOL_NEGATIVE_TTL_MS;
  const now = opts.now ?? Date.now;
  const store = new Map<string, Entry<T>>();

  return {
    /**
     * Resolves to the cached (or freshly loaded) rows for `key`. If `load`
     * throws, the failure itself is cached for `negativeTtlMs` — a repeat call
     * within that window re-throws the same error without calling `load`
     * again — and the original error is re-thrown to the caller either way.
     */
    async get(key: string, load: () => Promise<T[]>): Promise<T[]> {
      const at = now();
      const hit = store.get(key);
      if (hit) {
        const age = at - hit.fetchedAt;
        if (hit.kind === 'rows' && age < ttlMs) return hit.rows;
        if (hit.kind === 'error' && age < negativeTtlMs) throw hit.error;
      }
      try {
        const rows = await load();
        store.set(key, { kind: 'rows', rows, fetchedAt: at });
        return rows;
      } catch (error) {
        store.set(key, { kind: 'error', error, fetchedAt: at });
        throw error;
      }
    },
    size(): number {
      return store.size;
    },
    clear(): void {
      store.clear();
    },
  };
}

/**
 * Fisher-Yates over a COPY. Never shuffles in place: the array handed in is the
 * cached one, shared by every concurrent request, and two requests interleaving
 * around their awaits would otherwise reorder each other's rows mid-iteration.
 */
export function shuffled<T>(rows: readonly T[], rng: () => number = Math.random): T[] {
  const out = [...rows];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
