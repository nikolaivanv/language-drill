/**
 * Shared environment-variable helpers for the `@language-drill/db` package.
 *
 * Originally introduced in Phase 3 as `packages/db/scripts/env-helpers.ts` for
 * the generator + review CLIs. Phase 4 lifts it here so the generation Lambda
 * (`infra/lambda/src/generation/`) can import it through the package barrel —
 * `packages/db/scripts/` is not in the Lambda's bundling tree, but
 * `packages/db/src/` is (per the esbuild aliases in `infra/lib/constructs/lambda.ts`).
 *
 * The Phase 3 location (`scripts/env-helpers.ts`) becomes a one-line re-export
 * for back-compat with existing Phase 3 callers.
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
