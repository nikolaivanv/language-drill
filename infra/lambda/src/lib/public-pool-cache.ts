// Module-scope pool cache for the unauthenticated public endpoints.
//
// An unauthenticated GET that runs a window query per request lets anyone spin
// our Neon compute and degrade the database for real users; API Gateway's
// default throttling is orders of magnitude too permissive to prevent it. The
// public conjugation pools are tiny (<=~220 rows per language/level), so we
// hold the whole window in Lambda memory and re-query at most once per key per
// TTL. Cost ceiling: 12 queries per Lambda instance per 5 minutes.

export const PUBLIC_POOL_TTL_MS = 5 * 60_000;

type Entry<T> = { rows: T[]; fetchedAt: number };

export function createPoolCache<T>(opts: { ttlMs?: number; now?: () => number } = {}) {
  const ttlMs = opts.ttlMs ?? PUBLIC_POOL_TTL_MS;
  const now = opts.now ?? Date.now;
  const store = new Map<string, Entry<T>>();

  return {
    async get(key: string, load: () => Promise<T[]>): Promise<T[]> {
      const at = now();
      const hit = store.get(key);
      if (hit && at - hit.fetchedAt < ttlMs) return hit.rows;
      const rows = await load();
      store.set(key, { rows, fetchedAt: at });
      return rows;
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
