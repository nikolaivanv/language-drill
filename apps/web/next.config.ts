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
      { source: '/ingest/decide', destination: 'https://eu.i.posthog.com/decide' },
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
});
