import { neonConfig, Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from 'ws';

// WebSocket-based driver. The HTTP variant (`drizzle-orm/neon-http`) is
// stateless and cannot hold transactions, which `PUT /profiles/languages`
// requires for the atomic profiles + preferences write. The serverless
// Pool opens a fresh WebSocket per query and supports transactions.
//
// Node.js Lambda runtimes don't expose a global WebSocket, so the Neon
// driver needs an explicit constructor. The browser case (Edge runtime,
// Vercel preview) ships a global WebSocket and ignores this assignment.
neonConfig.webSocketConstructor = ws;

export function createDb(connectionString: string) {
  const pool = new Pool({ connectionString });
  return drizzle(pool);
}

export type Db = ReturnType<typeof createDb>;
