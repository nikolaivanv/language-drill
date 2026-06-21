import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

const nextConfig: NextConfig = {
  transpilePackages: ['@language-drill/api-client', '@language-drill/shared'],
  // PostHog reverse proxy (EU Cloud). Keeps ingestion first-party so ad-blockers
  // don't break it and no third-party host is contacted directly.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [
      { source: '/ingest/static/:path*', destination: 'https://eu-assets.i.posthog.com/static/:path*' },
      { source: '/ingest/:path*', destination: 'https://eu.i.posthog.com/:path*' },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  sourcemaps: { deleteSourcemapsAfterUpload: true },
  release: { name: process.env.VERCEL_GIT_COMMIT_SHA },
  disableLogger: true,
  // Route Sentry envelopes (errors + replay) through a same-origin tunnel so
  // ad-blockers can't drop them. `true` generates a randomized route per build
  // (harder to pattern-match than a fixed path). Runs as a Vercel function.
  tunnelRoute: true,
});
