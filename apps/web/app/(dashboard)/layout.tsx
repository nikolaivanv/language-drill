"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import {
  useLanguageProfiles,
  createAuthenticatedFetch,
} from "@language-drill/api-client";
import type { LanguageProfile } from "@language-drill/shared";
import { ActiveLanguageProvider, AppShell } from "../../components/shell";
import { PostSignupRedeem } from "../../components/invite/post-signup-redeem";

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
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-paper-2 border-t-ink" />
      </div>
    );
  }

  // Error state — do NOT redirect to onboarding on fetch failure
  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <div className="max-w-md rounded-lg border border-rule bg-card p-s-6 text-center shadow-1">
          <p className="t-display-s">failed to load your profile</p>
          <p className="t-small mt-s-2">{error.message}</p>
          <button
            onClick={() => refetch()}
            className="mt-s-4 rounded-md bg-ink text-paper px-s-4 py-s-2 text-[13px] font-medium transition-all duration-150 hover:bg-accent-2"
          >
            retry
          </button>
        </div>
      </div>
    );
  }

  // Loaded, no profiles — redirect to onboarding
  if (data && data.profiles.length === 0) {
    router.push("/onboarding");
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-paper-2 border-t-ink" />
      </div>
    );
  }

  // Loaded, has profiles — render shell wrapping children. The API-client
  // schema validates `language` and `proficiencyLevel` as native enums, so
  // `data.profiles` is already typed as `LanguageProfile[]`-compatible.
  const profiles: LanguageProfile[] = data?.profiles ?? [];
  return (
    <ActiveLanguageProvider profiles={profiles}>
      <AppShell profiles={profiles}>
        <PostSignupRedeem />
        {children}
      </AppShell>
    </ActiveLanguageProvider>
  );
}
