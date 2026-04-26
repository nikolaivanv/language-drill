"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import {
  useLanguageProfiles,
  createAuthenticatedFetch,
} from "@language-drill/api-client";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { getToken } = useAuth();
  const fetchFn = useMemo(
    () => createAuthenticatedFetch(getToken),
    [getToken],
  );

  const { data, isLoading, error, refetch } = useLanguageProfiles({
    fetchFn,
  });

  // Loading state
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-blue-600" />
      </div>
    );
  }

  // Error state — do NOT redirect to onboarding on fetch failure
  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="max-w-md rounded-lg border border-red-200 bg-red-50 p-6 text-center">
          <p className="font-medium text-red-700">
            Failed to load your profile
          </p>
          <p className="mt-1 text-sm text-red-600">{error.message}</p>
          <button
            onClick={() => refetch()}
            className="mt-4 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Loaded, no profiles — redirect to onboarding
  if (data && data.profiles.length === 0) {
    router.push("/onboarding");
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-blue-600" />
      </div>
    );
  }

  // Loaded, has profiles — render children
  return <>{children}</>;
}
