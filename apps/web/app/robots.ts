import type { MetadataRoute } from 'next';

/**
 * Crawlers get the public surfaces and nothing else.
 *
 * The disallow list is not a security control — every one of those paths is
 * already behind Clerk, and `/api` and `/ingest` are not content. It exists so
 * a crawl budget is not spent on redirects to sign-in. `/theory` is the same
 * story: it is the authenticated grammar surface that the public `/grammar`
 * pages now duplicate content from, it already 307s to sign-in for a
 * crawler with no session, and disallowing it is about crawl budget, not
 * access control.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin', '/api', '/ingest', '/onboarding', '/sign-in', '/sign-up', '/theory'],
    },
    sitemap: 'https://www.langdrill.app/sitemap.xml',
  };
}
