import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';

import SentryUserContext from '../components/sentry/sentry-user-context';
import { ChunkReloadGuard } from '../components/chunk-reload/chunk-reload-guard';

import { fraunces, inter, jetbrainsMono, caveat } from './fonts';
import { THEME_INIT_SCRIPT } from '../lib/theme/theme';
import { Providers } from './providers';
import { ConsentProvider } from '../components/consent/consent-provider';
import { CookieBanner } from '../components/consent/cookie-banner';
import { PostHogProvider } from '../components/analytics/posthog-provider';
import './globals.css';

export const metadata: Metadata = {
  // Resolves every page's relative `alternates.canonical` (and OG URLs) against
  // the www host. Without it Next emits the canonical as a bare path, and the
  // apex `langdrill.app` — which redirects to www — leaves Google picking the
  // canonical itself ("Duplicate without user-selected canonical"). Do NOT add
  // a canonical here: it would be inherited by every page that lacks its own.
  metadataBase: new URL('https://www.langdrill.app'),
  // The template applies to child segments only — `app/page.tsx` shares this
  // segment, so the home page's own title is used as-is.
  title: { default: 'drill', template: '%s · drill' },
  description: 'AI-powered language learning for active production practice',
  // Fallback for routes that don't set their own (the signed-in app). Public
  // pages build theirs via `publicPageMetadata` — see why in that helper.
  openGraph: { type: 'website', siteName: 'drill', locale: 'en' },
  twitter: { card: 'summary_large_image' },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider>
      <SentryUserContext />
      <html
          lang="en"
          suppressHydrationWarning
          className={`${fraunces.variable} ${inter.variable} ${jetbrainsMono.variable} ${caveat.variable}`}
        >
        <head>
          {/* Apply the saved theme before first paint so there is no flash of
              the wrong palette. suppressHydrationWarning above covers the
              class/style this writes onto <html> ahead of hydration. */}
          <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        </head>
        <body>
          <ChunkReloadGuard />
          <ConsentProvider>
            <PostHogProvider>
              <Providers>{children}</Providers>
            </PostHogProvider>
            <CookieBanner />
          </ConsentProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
