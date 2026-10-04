import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPublicRoute } from '../proxy';

function req(path: string) {
  return new NextRequest(new URL(path, 'https://langdrill.app'));
}

describe('isPublicRoute', () => {
  it('treats the public try surface as public', () => {
    expect(isPublicRoute(req('/try'))).toBe(true);
    expect(isPublicRoute(req('/try/conjugation'))).toBe(true);
    expect(isPublicRoute(req('/try/conjugation?lang=TR&level=B1'))).toBe(true);
  });

  it('does not treat a sibling of /try as public', () => {
    // Pins the `:path*` form (matches on path-segment boundaries) over the
    // deprecated `(.*)` form, which would also match `/trybeta`, `/try-pro`, etc.
    expect(isPublicRoute(req('/tryadmin'))).toBe(false);
  });

  it('keeps the existing public pages public', () => {
    expect(isPublicRoute(req('/'))).toBe(true);
    expect(isPublicRoute(req('/privacy'))).toBe(true);
  });

  it('still protects the dashboard', () => {
    expect(isPublicRoute(req('/home'))).toBe(false);
    expect(isPublicRoute(req('/drill'))).toBe(false);
  });

  // The landing pages are the public entry points. A missing entry here does
  // not fail a build or a type check — it silently redirects the whole feature
  // to sign-in, which is why this list is asserted at all.
  it('treats every language landing page as public', () => {
    expect(isPublicRoute(req('/spanish'))).toBe(true);
    expect(isPublicRoute(req('/german'))).toBe(true);
    expect(isPublicRoute(req('/turkish'))).toBe(true);
  });

  it('does not make sibling paths public by accident', () => {
    expect(isPublicRoute(req('/spanishx'))).toBe(false);
    expect(isPublicRoute(req('/germany'))).toBe(false);
  });

  it('treats the grammar hub and topic pages as public', () => {
    expect(isPublicRoute(req('/spanish/grammar'))).toBe(true);
    expect(isPublicRoute(req('/german/grammar'))).toBe(true);
    expect(isPublicRoute(req('/turkish/grammar'))).toBe(true);
    expect(isPublicRoute(req('/spanish/grammar/a2-ser-vs-estar'))).toBe(true);
    expect(isPublicRoute(req('/turkish/grammar/a1-vowel-harmony'))).toBe(true);
  });

  it('still does not make a sibling of a language path public', () => {
    expect(isPublicRoute(req('/spanishx/grammar'))).toBe(false);
  });

  // Derived from the app tree rather than a hand-kept list: the failure mode this
  // guards is a new public page silently 307ing to sign-in, which no build or type
  // check can see. Route groups in parens are layout-only and contribute no URL
  // segment, so only top-level non-group directories are candidates.
  const PRIVATE_BY_DESIGN = new Set([
    'onboarding', 'sign-in', 'sign-up', 'api', 'ingest',
  ]);

  it('treats every top-level public app directory as public', () => {
    // __dirname is a CommonJS global that Vitest's ESM transform does not
    // guarantee; import.meta.url always resolves in an ESM test module. See
    // task-6-rulings.md R4. `import.meta.url` is read into a variable before
    // being passed to `new URL()` because Vite statically recognises the
    // literal pattern `new URL('...', import.meta.url)` as its asset-URL
    // syntax and rewrites it to a dev-server URL — which silently resolves to
    // `http://localhost:3000/app`, not this file's path on disk. Routing
    // through a variable defeats that static match.
    const metaUrl = import.meta.url;
    const appDir = fileURLToPath(new URL('../app', metaUrl));
    const entries = readdirSync(appDir, { withFileTypes: true });
    // Guards a wrong path silently passing: without this, a mis-resolved
    // appDir yields an empty candidate list, `missing` is `[]`, and the test
    // passes while checking nothing — the precise failure mode this test
    // exists to prevent.
    expect(entries.length).toBeGreaterThan(0);

    const candidates = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((name) => !name.startsWith('(') && !name.startsWith('_') && !name.startsWith('['))
      .filter((name) => !PRIVATE_BY_DESIGN.has(name))
      .filter((name) => existsSync(join(appDir, name, 'page.tsx')));

    const missing = candidates.filter((name) => !isPublicRoute(req(`/${name}`)));
    expect(missing).toEqual([]);
  });
});
