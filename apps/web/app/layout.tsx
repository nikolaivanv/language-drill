import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';

import SentryUserContext from '../components/sentry/sentry-user-context';
import { ChunkReloadGuard } from '../components/chunk-reload/chunk-reload-guard';

import { fraunces, inter, jetbrainsMono, caveat } from './fonts';
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
          className={`${fraunces.variable} ${inter.variable} ${jetbrainsMono.variable} ${caveat.variable}`}
        >
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
