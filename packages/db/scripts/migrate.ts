/**
 * Apply pending Drizzle migrations.
 *
 * Replaces `drizzle-kit migrate` because drizzle-kit's CLI instantiates its
 * own `@neondatabase/serverless` connection without the `ws` websocket
 * polyfill the rest of the app uses (`packages/db/src/client.ts`). On Node
 * runners (no global `WebSocket`), drizzle-kit's CLI exits with `Exit
 * status 1` after sub-second spinner frames and prints no error — see CI
 * run https://github.com/nikolaivanv/language-drill/actions/runs/25397146620.
 *
 * This script reuses the project's `createDb` helper (websocket polyfill
 * applied on import) and surfaces any failure with a real stack trace.
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { migrate } from 'drizzle-orm/neon-serverless/migrator';

import { createDb } from '../src/client';

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }

  const migrationsFolder = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'migrations',
  );

  const db = createDb(databaseUrl);

  console.log(`applying migrations from ${migrationsFolder}`);
  await migrate(db, { migrationsFolder });
  console.log('migrations applied');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
