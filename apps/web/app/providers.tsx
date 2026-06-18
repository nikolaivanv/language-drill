"use client";

import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { useState } from "react";

import { reportApiError } from "../lib/sentry/report-api-error";

/**
 * Builds the app's QueryClient. The cache-level `onError` handlers forward
 * failed queries/mutations to Sentry — the app handles these rejections in the
 * UI (error cards), so without this they'd be invisible to Sentry. See
 * `reportApiError` for the skip rules (expected 429 / 503 GLOBAL_CAPACITY).
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({ onError: reportApiError }),
    mutationCache: new MutationCache({ onError: reportApiError }),
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000,
        retry: 1,
      },
    },
  });
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
