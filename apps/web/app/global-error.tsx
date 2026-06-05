'use client';

import { useEffect } from 'react';

import { Button } from '../components/ui/button';
import { reportBoundaryError } from '../lib/sentry/report';
import './globals.css';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportBoundaryError(error, 'global');
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main className="flex min-h-screen items-center justify-center bg-paper px-s-4 py-s-8 text-ink-2">
          <div className="mx-auto w-full max-w-md text-center">
            <h1 className="font-display text-4xl text-ink leading-display">
              Something went wrong
            </h1>
            <p className="mt-s-4 text-ink-soft leading-body">
              An unexpected error interrupted what you were doing. The issue
              has been reported. You can try again or head back to the
              dashboard.
            </p>
            <div className="mt-s-7 flex flex-col items-center gap-s-3 sm:flex-row sm:justify-center">
              <Button variant="primary" onClick={reset}>
                Try again
              </Button>
              <Button variant="default" href="/home">
                Go to dashboard
              </Button>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
