// Default test-user constants and on-disk artifact IO for the E2E suite.
//
// All paths are resolved relative to this source file so the helpers behave
// identically regardless of where Playwright is invoked from (repo root via
// `pnpm turbo`, inside `apps/web/` via `pnpm test:e2e`, or directly via
// `npx playwright test`).
//
// The `.auth/` directory itself is gitignored
// (`apps/web/e2e/.gitignore`), so anything written here stays out of source
// control. The directory is created lazily on the first write.

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Reserved Clerk test-mode email pattern: the `+clerk_test` infix tells
 * Clerk's dev instances to suppress real email delivery and accept the
 * fixed `424242` OTP code. See:
 * https://clerk.com/docs/testing/playwright/test-authenticated-flows
 */
export const DEFAULT_E2E_USER_EMAIL = 'e2e+clerk_test@example.com';

const E2E_ROOT = path.resolve(__dirname, '..');
const AUTH_DIR = path.join(E2E_ROOT, '.auth');

export const STORAGE_STATE_PATH = path.join(AUTH_DIR, 'storage-state.json');
export const TEST_USER_MANIFEST_PATH = path.join(AUTH_DIR, 'test-user.json');

export interface TestUserManifest {
  /** Clerk-issued user ID (`user_2…`). The Lambda dev server can be pointed
   *  at the same identity via `DEV_USER_ID=<this value>` — see
   *  `docs/testing.md`. */
  userId: string;
  email: string;
  /** ISO-8601 timestamp of provisioning. */
  createdAt: string;
}

async function ensureAuthDir(): Promise<void> {
  await mkdir(AUTH_DIR, { recursive: true });
}

export async function writeTestUserManifest(manifest: TestUserManifest): Promise<void> {
  await ensureAuthDir();
  await writeFile(TEST_USER_MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

export async function readTestUserManifest(): Promise<TestUserManifest | null> {
  try {
    const raw = await readFile(TEST_USER_MANIFEST_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<TestUserManifest>;
    if (
      typeof parsed.userId === 'string' &&
      typeof parsed.email === 'string' &&
      typeof parsed.createdAt === 'string'
    ) {
      return parsed as TestUserManifest;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Returns true iff the persisted storage state file exists, parses as a
 * Playwright storageState payload (has `cookies` and `origins` arrays), and
 * was last modified within `ttlMinutes` of now. Otherwise returns false —
 * the caller should re-sign and overwrite.
 */
export async function isStorageStateFresh(ttlMinutes: number): Promise<boolean> {
  let stats;
  try {
    stats = await stat(STORAGE_STATE_PATH);
  } catch {
    return false;
  }

  const ageMs = Date.now() - stats.mtimeMs;
  if (ageMs > ttlMinutes * 60_000) {
    return false;
  }

  try {
    const raw = await readFile(STORAGE_STATE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as { cookies?: unknown; origins?: unknown };
    return Array.isArray(parsed.cookies) && Array.isArray(parsed.origins);
  } catch {
    return false;
  }
}
