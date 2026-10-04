import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { readdirSync } from 'node:fs';
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
  // check can see.
  //
  // Unlike the earlier version of this test, candidates are not limited to a
  // directory with a DIRECT `page.tsx` one level under `app/` — that silently
  // dropped `/try` (only `try/forms/page.tsx` exists) and `/invite` (only
  // `invite/[code]/page.tsx` exists), and excluded route-group directories
  // (`(admin)`, `(dashboard)`, `(legal)`) wholesale, so a future
  // `app/(public)/blog/page.tsx` would not be checked either. Instead this
  // walks the WHOLE tree and derives one URL candidate per `page.tsx` found at
  // any depth: a route-group segment (`(admin)`) contributes no URL segment
  // (Next.js strips it), and a dynamic segment (`[code]`, `[[...sign-in]]`) is
  // skipped rather than embedded literally, since there is no single concrete
  // string that is "the" value for it.
  //
  // `PRIVATE_BY_DESIGN` is keyed by the derived URL's FIRST segment (not the
  // directory name — a nested route group's own name never appears in the
  // URL). Every genuinely protected first segment the widened walk surfaces
  // is listed here; this is the one list this test cannot derive for itself,
  // because "should this be public" is a product decision, not a filesystem
  // fact.
  const PRIVATE_BY_DESIGN = new Set([
    'onboarding', 'sign-in', 'sign-up', 'api', 'ingest',
    // The authenticated dashboard (route group `(dashboard)`) and the admin
    // panel (route group `(admin)`) — every page beneath either requires an
    // account, so their first URL segments are protected by design.
    'admin', 'drill', 'fluency', 'home', 'practice', 'progress', 'read',
    'review', 'settings', 'theory', 'vocab',
  ]);

  function isRouteGroup(name: string): boolean {
    return name.startsWith('(') && name.endsWith(')');
  }

  function isDynamicSegment(name: string): boolean {
    return name.startsWith('[') && name.endsWith(']');
  }

  /**
   * Collects one URL candidate per `page.tsx` found anywhere beneath `dir`,
   * skipping `_`-prefixed directories (Next.js private folders, never
   * routable) and deriving the URL path from the directory chain per the
   * group/dynamic rules above.
   */
  function collectPageUrls(dir: string, segments: string[], out: Set<string>): void {
    const entries = readdirSync(dir, { withFileTypes: true });
    if (entries.some((e) => e.isFile() && e.name === 'page.tsx')) {
      out.add(segments.length === 0 ? '/' : `/${segments.join('/')}`);
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('_')) continue;
      if (isRouteGroup(e.name) || isDynamicSegment(e.name)) {
        collectPageUrls(join(dir, e.name), segments, out);
      } else {
        collectPageUrls(join(dir, e.name), [...segments, e.name], out);
      }
    }
  }

  it('treats every public app page as public, walking the whole tree', () => {
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

    const urls = new Set<string>();
    collectPageUrls(appDir, [], urls);
    // Guards a wrong path silently passing: without this, a mis-resolved
    // appDir yields an empty candidate list, `missing` is `[]`, and the test
    // passes while checking nothing — the precise failure mode this test
    // exists to prevent.
    expect(urls.size).toBeGreaterThan(0);

    const candidates = [...urls].filter((url) => {
      const firstSegment = url.split('/')[1] ?? '';
      return !PRIVATE_BY_DESIGN.has(firstSegment);
    });

    const missing = candidates.filter((url) => !isPublicRoute(req(url)));
    expect(missing).toEqual([]);
  });
});
