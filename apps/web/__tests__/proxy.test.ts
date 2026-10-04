import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { isPublicRoute, config } from '../proxy';

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

  // F10: observed in production — without these entries, Clerk's middleware
  // ran on /sitemap.xml and /robots.txt (config.matcher excludes .png/.svg/
  // .webmanifest etc. but not .xml or .txt), neither matched any pattern
  // above, and auth.protect() 307'd BOTH to sign-in
  // (x-clerk-auth-reason: protect-rewrite). Googlebot could reach neither.
  // Observed in production: `/ingest/*` (the PostHog reverse proxy) was
  // neither public nor skipped by the matcher, so Clerk 404'd every analytics
  // request from a signed-out visitor (x-clerk-auth-reason: protect-rewrite)
  // and no anonymous event ever reached PostHog. The middleware must not run
  // on it at all. `unstable_doesMiddlewareMatch` applies the matcher exactly
  // as Next does, so this checks the real routing decision, not a regex copy.
  it('does not run Clerk on the PostHog ingestion proxy', () => {
    for (const url of ['/ingest/e/', '/ingest/flags/?v=2', '/ingest/s/', '/ingest/i/v0/e/']) {
      expect(unstable_doesMiddlewareMatch({ config, url }), url).toBe(false);
    }
  });

  it('still runs Clerk on pages and on a sibling of /ingest', () => {
    for (const url of ['/home', '/spanish/grammar', '/ingestion']) {
      expect(unstable_doesMiddlewareMatch({ config, url }), url).toBe(true);
    }
  });

  it('treats the crawler-facing metadata routes as public', () => {
    expect(isPublicRoute(req('/sitemap.xml'))).toBe(true);
    expect(isPublicRoute(req('/robots.txt'))).toBe(true);
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

  // F10 sibling guard: `collectPageUrls` above walks `page.tsx` files, so it
  // structurally cannot see Next's file-based metadata-route conventions
  // (sitemap.ts, robots.ts, icon.*, apple-icon.*, manifest.*, opengraph-image.*,
  // twitter-image.*, favicon.*) — exactly how /sitemap.xml and /robots.txt went
  // unreachable in production without anything catching it. This enumerates
  // those files directly and checks each one's SERVED url.

  // `sitemap.ts` / `robots.ts` serve a different extension than their source
  // file (Next's own special-cased convention) — stated explicitly rather than
  // derived by a general "strip the extension" rule, which would get every
  // other convention (icon.svg -> /icon.svg, unchanged) wrong.
  const METADATA_ROUTE_URL: Record<string, string> = {
    'sitemap.ts': '/sitemap.xml',
    'robots.ts': '/robots.txt',
  };

  // Every basename Next.js recognises as a file-based metadata-route
  // convention, any extension. See
  // https://nextjs.org/docs/app/api-reference/file-conventions — favicon,
  // icon, apple-icon, opengraph-image, twitter-image, sitemap, robots,
  // manifest.
  const METADATA_BASENAME =
    /^(sitemap|robots|favicon|icon|apple-icon|opengraph-image|twitter-image|manifest)\.[a-z0-9]+$/i;

  /**
   * Whether `config.matcher`'s own static-extension exclusion already keeps
   * Clerk's middleware from running on `filename` at all — in which case
   * `isPublicRoute`'s answer is moot (the middleware function is never
   * invoked for that path), not a reason to trust the file is fine on faith.
   * Parsed from `config.matcher[0]` itself (not a hand-copied list) so this
   * cannot silently drift from what the middleware actually excludes.
   */
  function matcherSkipsFile(filename: string): boolean {
    const ext = filename.slice(filename.lastIndexOf('.') + 1).toLowerCase();
    const pattern = config.matcher[0];
    // One alternative inside the extension group is itself a group
    // (`js(?!on)`), so a naive "stop at the first `)`" regex truncates mid-
    // pattern. Walk paren depth to find the group's REAL matching close.
    const marker = '(?:';
    const openIdx = pattern.indexOf(marker, pattern.indexOf('\\.'));
    if (openIdx === -1) {
      throw new Error('proxy.ts matcher shape changed — update matcherSkipsFile()');
    }
    let depth = 0;
    let closeIdx = -1;
    for (let i = openIdx; i < pattern.length; i++) {
      if (pattern[i] === '(') depth++;
      else if (pattern[i] === ')') {
        depth--;
        if (depth === 0) {
          closeIdx = i;
          break;
        }
      }
    }
    if (closeIdx === -1) {
      throw new Error('proxy.ts matcher shape changed — update matcherSkipsFile()');
    }
    const alternatives = pattern.slice(openIdx + marker.length, closeIdx).split('|');
    return alternatives.some((alt) => new RegExp(`^${alt}$`, 'i').test(ext));
  }

  it('treats every file-based metadata route as public, or documents why checking it is moot', () => {
    const metaUrl = import.meta.url;
    const appDir = fileURLToPath(new URL('../app', metaUrl));
    const metadataFiles = readdirSync(appDir, { withFileTypes: true })
      .filter((e) => e.isFile() && METADATA_BASENAME.test(e.name))
      .map((e) => e.name);

    // Guards a renamed convention or a wrong path silently passing: without
    // this, an empty candidate list makes `missing` vacuously `[]`.
    expect(metadataFiles.length).toBeGreaterThan(0);

    const exemptByMatcher = metadataFiles.filter(matcherSkipsFile).sort();
    // Pins exactly which files this exempts, so a reader never has to run the
    // parser themselves — and so a NEW metadata file landing in an already-
    // excluded extension (safe) or a matcher change that stops excluding one
    // of these two (not safe) both show up as a diff here, not a silent pass.
    expect(exemptByMatcher).toEqual(['apple-icon.png', 'icon.svg']);

    const checked = metadataFiles.filter((name) => !matcherSkipsFile(name));
    expect(checked.length).toBeGreaterThan(0);

    const missing = checked
      .map((name) => METADATA_ROUTE_URL[name] ?? `/${name}`)
      .filter((url) => !isPublicRoute(req(url)));
    expect(missing).toEqual([]);
  });
});
