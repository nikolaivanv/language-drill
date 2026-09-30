import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

const nextConfig: NextConfig = {
  transpilePackages: ['@language-drill/api-client', '@language-drill/shared'],
  // PostHog reverse proxy (EU Cloud). Keeps ingestion first-party so ad-blockers
  // don't break it and no third-party host is contacted directly.
  skipTrailingSlashRedirect: true,
  // `/try/conjugation` was the original public drill path. The surface also
  // covers noun and adjective declension, so it was renamed to `/try/forms`;
  // the old path is kept permanently redirected in case anything already links
  // to it.
  async redirects() {
    return [
      { source: '/try/conjugation', destination: '/try/forms', permanent: true },
    ];
  },
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
  // Tree-shakes Sentry's own debug logging out of the bundle. Next 16 builds
  // with Turbopack by default, where Sentry does not apply build-time
  // instrumentation, so this currently no-ops — it is kept so the intent
  // survives a `--webpack` build.
  webpack: { treeshake: { removeDebugLogging: true } },
  // Route Sentry envelopes (errors + replay) through a same-origin tunnel so
  // ad-blockers can't drop them. `true` generates a randomized route per build
  // (harder to pattern-match than a fixed path). Runs as a Vercel function.
  tunnelRoute: true,
});
