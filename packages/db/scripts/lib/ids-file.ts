/**
 * Shared `--ids-file` handling for the one-off pool CLIs.
 *
 * Extracted from `revalidate-cloze-pool.ts` (2026-08-24) when `demote:pool`
 * needed the same flag. The motivating case: a demotion driven by
 * `coverage_tags` is not expressible through `demote:pool`'s filters at all,
 * because those read `content_json` while `case`/`number` live in a separate
 * column — so the only honest way to say "demote exactly these rows" is to
 * hand the CLI the ids a read-only query already picked.
 *
 * One copy, not two: the parse rules (UUID-only, `#` comments, dedupe) and the
 * path-resolution rules are the contract an operator learns once and reuses.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Repo root, from `<root>/packages/db/scripts/lib/` — four levels up. */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/**
 * Where to look for an `--ids-file`, in order.
 *
 * `pnpm --filter @language-drill/db <script>` runs with cwd `packages/db`, so a
 * path copied from the docs (`docs/analysis/…`) is repo-relative and would
 * ENOENT. Try the literal (cwd-relative) path first, then the same path from
 * the repo root; an absolute path is used as given.
 */
export function idsFileCandidates(rawPath: string, cwd: string, repoRoot: string): string[] {
  if (path.isAbsolute(rawPath)) return [rawPath];
  const fromCwd = path.resolve(cwd, rawPath);
  const fromRoot = path.resolve(repoRoot, rawPath);
  return fromCwd === fromRoot ? [fromCwd] : [fromCwd, fromRoot];
}

/**
 * Read an `--ids-file` from the first candidate that exists, or fail naming
 * every path tried — a bare ENOENT stack does not tell the operator that the
 * script's cwd is `packages/db`, not the repo root.
 */
export function readIdsFile(rawPath: string): string {
  const candidates = idsFileCandidates(rawPath, process.cwd(), REPO_ROOT);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(
      `--ids-file '${rawPath}' not found. Tried:\n` +
        candidates.map((candidate) => `  ${candidate}`).join('\n'),
    );
  }
  return readFileSync(found, 'utf8');
}

/**
 * Parse an `--ids-file` body: one exercise id per line, blank lines and `#`
 * comments ignored, duplicates collapsed.
 *
 * Non-UUID lines throw rather than being dropped — the whole point of the flag
 * is that a read-only SQL query picked these rows, so a malformed line means
 * the worklist is not what the operator thinks it is. Silently selecting fewer
 * rows would read as "nothing to do".
 */
export function parseIdsFile(text: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();

  for (const [index, rawLine] of text.split('\n').entries()) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    if (!UUID_RE.test(line)) {
      throw new Error(`--ids-file line ${index + 1} is not a UUID: '${line}'`);
    }
    const id = line.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }

  if (ids.length === 0) {
    throw new Error('--ids-file contained no ids');
  }
  return ids;
}
