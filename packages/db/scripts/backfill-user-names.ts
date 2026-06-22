/**
 * `pnpm --filter @language-drill/db backfill:user-names [-- --apply]`
 *
 * One-off: populate users.first_name / users.last_name from Clerk for rows the
 * webhook predates. Dry-run by default; pass --apply to write. Run against the
 * TARGET env's DB (prod) — never dev (CI-fork pollution). Requires DATABASE_URL
 * and CLERK_SECRET_KEY.
 */
import { createClerkClient } from '@clerk/backend';
import { eq } from 'drizzle-orm';
import { createDb } from '../src/client';
import { users } from '../src/schema';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const databaseUrl = process.env.DATABASE_URL;
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');
  if (!secretKey) throw new Error('CLERK_SECRET_KEY is not set');

  const db = createDb(databaseUrl);
  const clerk = createClerkClient({ secretKey });

  let offset = 0;
  let updated = 0;
  const pageSize = 100;
  for (;;) {
    const page = await clerk.users.getUserList({ limit: pageSize, offset });
    if (page.data.length === 0) break;
    for (const u of page.data) {
      const firstName = u.firstName ?? null;
      const lastName = u.lastName ?? null;
      if (firstName == null && lastName == null) continue;
      console.log(`${apply ? 'UPDATE' : 'DRY'} ${u.id} -> ${firstName ?? ''} ${lastName ?? ''}`);
      if (apply) {
        await db.update(users).set({ firstName, lastName }).where(eq(users.id, u.id));
      }
      updated += 1;
    }
    offset += pageSize;
  }
  console.log(`${apply ? 'Applied' : 'Would update'} ${updated} user(s).`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
