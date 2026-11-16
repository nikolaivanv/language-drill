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
  // An idle pooled client whose socket the Neon pooler closes (typical after
  // a Lambda sits frozen between sparse requests) makes the Pool emit
  // 'error'. With no listener, Node escalates that to an uncaught exception
  // and kills the whole process (prod 2026-11-15: `Connection terminated
  // unexpectedly` → Runtime.ExitError, 500 on a public theory page). The pool
  // already discards the dead client, so logging is all that is needed; the
  // next query checks out a fresh connection.
  pool.on('error', (err: Error) => {
    console.warn(`db pool: idle client error (client discarded): ${describeDbError(err)}`);
  });
  return drizzle(pool);
}

export type Db = ReturnType<typeof createDb>;

/**
 * One-line description of a DB error including its `.cause` chain. Drizzle
 * wraps driver errors as `Failed query: <sql>` and keeps the driver's own
 * message (e.g. `Connection terminated unexpectedly`) only in `.cause`, so
 * logging `.message` alone hides the reason a query failed.
 */
export function describeDbError(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current !== undefined && current !== null && depth < 5; depth++) {
    parts.push(current instanceof Error ? current.message : String(current));
    current = current instanceof Error ? current.cause : undefined;
  }
  return parts.join(' — caused by: ');
}
