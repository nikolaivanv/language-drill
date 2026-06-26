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
  title: 'Language Drill',
  description: 'AI-powered language learning for active production practice',
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
