import { eq } from 'drizzle-orm';
import { users } from '@language-drill/db';
import { db } from '../db';
import type { Plan } from './limits';

/** True if the Clerk userId is in the ADMIN_USER_IDS allowlist. */
export function isAdmin(userId: string): boolean {
  return (process.env.ADMIN_USER_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(userId);
}

/** Layer the dynamic admin override on top of a stored plan. */
export function effectivePlanFor(userId: string, storedPlan: string): Plan {
  if (isAdmin(userId)) return 'boosted';
  return storedPlan === 'boosted' ? 'boosted' : 'free';
}

/** Load the stored plan for a user and apply the admin override. */
export async function getEffectivePlan(userId: string): Promise<Plan> {
  if (isAdmin(userId)) return 'boosted';
  const rows = await db
    .select({ plan: users.plan })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return effectivePlanFor(userId, rows[0]?.plan ?? 'free');
}
