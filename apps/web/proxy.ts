import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

export const isPublicRoute = createRouteMatcher([
  '/', // public marketing landing page (signed-in users are bounced to /home)
  '/why-not-chatgpt', // standalone marketing comparison page
  '/academic-rigour', // standalone marketing deep-dive on how the material is made
  // Public, unauthenticated drill surface — no signup required. `:path*`
  // matches on path-segment boundaries (unlike the deprecated `(.*)` used by
  // the entries above, which also matches siblings — `/try(.*)` would make
  // `/trybeta` public too).
  '/spanish', // per-language landing pages: public entry points + SEO
  '/spanish/:path*', // …and everything under them (/spanish/grammar/<topic>)
  '/german',
  '/german/:path*',
  '/turkish',
  '/turkish/:path*',
  '/try',
  '/try/:path*',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/invite(.*)',
  '/api/webhooks(.*)',
  '/privacy',
  '/terms',
  '/cookies',
  // Crawler-facing metadata routes. `config.matcher` below excludes static
  // file extensions (.png, .svg, .webmanifest, …) but NOT `.xml` or `.txt`,
  // so without these two entries Clerk's middleware runs on them, neither
  // matches any pattern above, and `auth.protect()` 307s them to sign-in.
  // Observed in production: `curl https://www.langdrill.app/sitemap.xml`
  // redirected to `/sign-in` with `x-clerk-auth-reason: protect-rewrite` —
  // this is not theoretical, robots.txt and sitemap.xml were both
  // unreachable by Googlebot. See `apps/web/app/sitemap.ts` / `robots.ts`.
  '/sitemap.xml',
  '/robots.txt',
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and static files unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};
