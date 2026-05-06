/**
 * Shared environment-variable helpers for `pnpm` scripts in
 * `packages/db/scripts/` (Phase 3).
 *
 * Phase 2's generator CLI inlined `requireEnv`; Phase 3 lifts it here so the
 * Phase 3 review CLI (`review-flagged.ts`, Tasks 21-23) can share it without
 * duplicating the function body.
 */

/**
 * Read a required environment variable. Throws with a uniform error message
 * when missing or empty so the operator sees the variable name immediately.
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} environment variable is not set`);
  }
  return value;
}
