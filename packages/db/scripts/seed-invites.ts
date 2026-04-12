/**
 * Seed invite codes into the `invitations` table.
 *
 * Usage:
 *   npx ts-node packages/db/scripts/seed-invites.ts --count 10 --expires-days 30
 *   npx ts-node packages/db/scripts/seed-invites.ts --count 5
 *
 * CLI args:
 *   --count N         Number of invite codes to generate (required, default: 1)
 *   --expires-days D  Days until expiry (optional; omit for no expiry)
 *
 * Requires DATABASE_URL env var to be set.
 */

import { createDb } from '../src/client';
import { invitations } from '../src/schema/index';

// ---------------------------------------------------------------------------
// Parse CLI arguments
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { count: number; expiresDays: number | null } {
  let count = 1;
  let expiresDays: number | null = null;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--count' && argv[i + 1] !== undefined) {
      const parsed = parseInt(argv[i + 1], 10);
      if (isNaN(parsed) || parsed < 1) {
        console.error('Error: --count must be a positive integer');
        process.exit(1);
      }
      count = parsed;
      i++;
    } else if (argv[i] === '--expires-days' && argv[i + 1] !== undefined) {
      const parsed = parseInt(argv[i + 1], 10);
      if (isNaN(parsed) || parsed < 1) {
        console.error('Error: --expires-days must be a positive integer');
        process.exit(1);
      }
      expiresDays = parsed;
      i++;
    }
  }

  return { count, expiresDays };
}

// ---------------------------------------------------------------------------
// Generate a random 8-character alphanumeric code
// ---------------------------------------------------------------------------

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function generateCode(): string {
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return code;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    console.error('Error: DATABASE_URL environment variable is not set');
    process.exit(1);
  }

  const args = parseArgs(process.argv.slice(2));
  const { count, expiresDays } = args;

  const db = createDb(databaseUrl);

  const expiresAt = expiresDays !== null
    ? new Date(Date.now() + expiresDays * 24 * 60 * 60 * 1000)
    : null;

  const rows = Array.from({ length: count }, () => ({
    code: generateCode(),
    expiresAt,
  }));

  console.log(`Inserting ${count} invite code(s)...`);

  const inserted = await db
    .insert(invitations)
    .values(rows)
    .returning({ id: invitations.id, code: invitations.code, expiresAt: invitations.expiresAt });

  console.log('\nGenerated invite codes:');
  for (const row of inserted) {
    const expiry = row.expiresAt ? ` (expires: ${row.expiresAt.toISOString()})` : ' (no expiry)';
    console.log(`  ${row.code}${expiry}`);
  }

  console.log(`\nDone. ${inserted.length} invite code(s) created.`);
}

main().catch((err) => {
  console.error('Seed script failed:', err);
  process.exit(1);
});
