import { Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';

// WebSocket-based driver. The HTTP variant (`drizzle-orm/neon-http`) is
// stateless and cannot hold transactions, which `PUT /profiles/languages`
// requires for the atomic profiles + preferences write. The serverless
// Pool opens a fresh connection per query and supports transactions.
export function createDb(connectionString: string) {
  const pool = new Pool({ connectionString });
  return drizzle(pool);
}

export type Db = ReturnType<typeof createDb>;
