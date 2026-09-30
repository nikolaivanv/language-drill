import type { MetadataRoute } from 'next';

/**
 * Crawlers get the public surfaces and nothing else.
 *
 * The disallow list is not a security control — every one of those paths is
 * already behind Clerk, and `/api` and `/ingest` are not content. It exists so
 * a crawl budget is not spent on redirects to sign-in.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin', '/api', '/ingest', '/onboarding', '/sign-in', '/sign-up'],
    },
    sitemap: 'https://www.langdrill.app/sitemap.xml',
  };
}
