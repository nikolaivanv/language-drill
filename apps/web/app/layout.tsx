import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';

import { Providers } from './providers';
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
      <html lang="en">
        <body>
          <Providers>{children}</Providers>
        </body>
      </html>
    </ClerkProvider>
  );
}
