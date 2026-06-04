import { and, count, gte } from 'drizzle-orm';
import { usageEvents } from '@language-drill/db';
import { db } from '../db';
import type { Plan } from './limits';

export type CapacityVerdict = 'ok' | 'killed' | 'capped';

// 60s module-scope cache of the trailing-24h global usage count so the soft
// cap doesn't add a COUNT(*) to every AI request. Upstash counters are the
// later scale path; at current volume a cached aggregate is plenty.
const CACHE_TTL_MS = 60_000;
let cache: { value: number; expiresAt: number } | null = null;

async function globalUsageLast24h(): Promise<number> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.value;
  const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ count: count() })
    .from(usageEvents)
    .where(and(gte(usageEvents.createdAt, oneDayAgo)));
  const value = Number(rows[0]?.count ?? 0);
  cache = { value, expiresAt: now + CACHE_TTL_MS };
  return value;
}

/** Test-only: reset the module cache between cases. */
export function __resetCapacityCache(): void {
  cache = null;
}

/**
 * Global cost/abuse brake, evaluated before the per-user cap.
 * - `killed`: AI_KILL_SWITCH is on and the caller is not an admin.
 * - `capped`: AI_GLOBAL_DAILY_CAP is set, the caller is on the free plan, and
 *   total AI usage in the trailing 24h has reached the cap. Boosted/admin pass.
 * - `ok`: otherwise.
 */
export async function checkGlobalCapacity(args: {
  plan: Plan;
  admin: boolean;
}): Promise<CapacityVerdict> {
  if ((process.env.AI_KILL_SWITCH ?? '').toLowerCase() === 'on' && !args.admin) {
    return 'killed';
  }
  // A positive integer enables the soft cap; unset, zero, or negative means
  // "no cap" (a 0 cap would block every free user — that's the kill switch's job).
  const cap = Number.parseInt(process.env.AI_GLOBAL_DAILY_CAP ?? '', 10);
  if (cap > 0 && args.plan === 'free') {
    if ((await globalUsageLast24h()) >= cap) return 'capped';
  }
  return 'ok';
}
