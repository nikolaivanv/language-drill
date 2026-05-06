/**
 * Shared CLI argument-parsing scaffolding for the `pnpm` scripts in
 * `packages/db/scripts/` (Phase 3).
 *
 * Phase 2 had a single CLI (`pnpm generate:exercises`) and inlined these
 * helpers. Phase 3 adds `pnpm review:flagged` (Tasks 20-23), which needs the
 * same `--flag value` parsing semantics. Lifting the helpers here avoids the
 * ~50 LOC duplication; both parsers stay free of third-party CLI deps.
 */

/**
 * Names of every boolean (no-value) flag accepted across all CLIs in this
 * package. New CLIs that introduce additional boolean flags should extend
 * this set rather than maintain their own copy — `collectRawFlags` consults
 * it to decide when a token like `--dry-run` should consume the next argv
 * entry as its value or be treated as a presence-only flag.
 */
export const BOOLEAN_FLAGS: ReadonlySet<string> = new Set([
  'dry-run',
  'allow-prod',
  'help',
]);

/**
 * Parse a `--flag value` / `--flag=value` / `--bool` argv into a map. Throws
 * on positional arguments or `--flag` without a following value (when the
 * flag is not in `BOOLEAN_FLAGS`).
 */
export function collectRawFlags(
  argv: readonly string[],
): Map<string, string> {
  const out = new Map<string, string>();

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      throw new Error(`unexpected positional argument '${token}'`);
    }

    const eqIdx = token.indexOf('=');
    let name: string;
    let value: string | undefined;

    if (eqIdx >= 0) {
      name = token.slice(2, eqIdx);
      value = token.slice(eqIdx + 1);
    } else {
      name = token.slice(2);
      value = undefined;
    }

    if (BOOLEAN_FLAGS.has(name)) {
      out.set(name, 'true');
      continue;
    }

    if (value === undefined) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        throw new Error(`--${name} requires a value`);
      }
      value = next;
      i++;
    }

    out.set(name, value);
  }

  return out;
}

/**
 * Read a required string flag from a parsed flag map. Throws with a uniform
 * message when missing or empty.
 */
export function requireString(
  raw: Map<string, string>,
  name: string,
): string {
  const value = raw.get(name);
  if (value === undefined || value === '') {
    throw new Error(`--${name} is required`);
  }
  return value;
}
