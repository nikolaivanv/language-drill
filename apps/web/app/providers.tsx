"use client";

import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { useState } from "react";
import { useClerk } from "@clerk/nextjs";
import { isAuthExpiredError } from "@language-drill/api-client";

import { reportApiError } from "../lib/sentry/report-api-error";
import { createAuthExpiredHandler } from "../lib/auth/auth-expired";
import { ThemeProvider } from "../components/theme/theme-provider";

/**
 * Builds the app's QueryClient. The cache-level `onError` handlers forward
 * failed queries/mutations to Sentry — the app handles these rejections in the
 * UI (error cards), so without this they'd be invisible to Sentry. See
 * `reportApiError` for the skip rules (expected 429 / 503 GLOBAL_CAPACITY).
 *
 * An expired session is routed to `onAuthExpired` instead of Sentry: it is a
 * handled state that drives a sign-in redirect, not a fault. Without this the
 * failure had nowhere to go but the dashboard's terminal "failed to load your
 * profile" card.
 */
export function createQueryClient(onAuthExpired?: () => void): QueryClient {
  const onError = (error: unknown) => {
    if (isAuthExpiredError(error)) {
      onAuthExpired?.();
      return;
    }
    reportApiError(error);
  };

  return new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000,
        // Retrying cannot conjure a session token, so an auth failure is
        // terminal — retrying it only fires the redirect handler twice.
        retry: (failureCount, error) =>
          !isAuthExpiredError(error) && failureCount < 1,
      },
    },
  });
}

export function Providers({ children }: { children: React.ReactNode }) {
  const clerk = useClerk();
  const [queryClient] = useState(() =>
    createQueryClient(
      createAuthExpiredHandler({
        redirectToSignIn: (opts) => clerk.redirectToSignIn(opts),
        // Read at redirect time, not at mount, so the user returns to the page
        // they are actually on — including its query string.
        currentUrl: () => window.location.href,
      }),
    ),
  );

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ThemeProvider>
  );
}
