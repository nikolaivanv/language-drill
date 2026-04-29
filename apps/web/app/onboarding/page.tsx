"use client";

import { useCallback, useEffect, useMemo } from "react";
import { useAuth } from "@clerk/nextjs";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useLanguageProfiles,
  useGetPreferences,
  useSavePreferences,
  createAuthenticatedFetch,
  type AuthenticatedFetch,
  type SavePreferencesArgs,
} from "@language-drill/api-client";
import {
  OnboardingProvider,
  OnboardingShell,
  initialEditState,
  initialNewUserState,
  useOnboarding,
} from "../../components/onboarding";
import type { OnboardingState } from "../../components/onboarding";

// ---------------------------------------------------------------------------
// OnboardingPage — routing/loading/hydration + submit orchestration
// ---------------------------------------------------------------------------
// Owns the data plumbing for the onboarding route:
//   - reads `?edit=1` to decide whether to hydrate preferences
//   - hydrates language profiles (always) and preferences (edit mode only)
//   - shows a spinner card while either query is loading
//   - shows a paper-card error with retry when hydration fails in edit mode
//   - redirects returning users with profiles to `/` when not in edit mode
//   - mounts the wizard inside an `OnboardingProvider` so `OnboardingPageBody`
//     can read state + dispatch and orchestrate the final submit
//
// Submit orchestration (task 31c) lives in `OnboardingPageBody` so it can
// read the wizard's reducer state via `useOnboarding()`. The shell stays
// stateless and assumes the provider is wrapped above it.
// ---------------------------------------------------------------------------

export default function OnboardingPage() {
  const { getToken } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const editMode = searchParams?.get("edit") === "1";

  // Stable fetchFn so TanStack Query doesn't see a new function every render.
  const fetchFn = useMemo(
    () => createAuthenticatedFetch(getToken),
    [getToken],
  );

  // Profiles always — needed for the returning-user redirect predicate.
  const profilesQuery = useLanguageProfiles({ fetchFn });

  // Preferences only in edit mode — `enabled: false` makes this a no-op
  // (isLoading=false, isError=false, data=undefined) for new users.
  const preferencesQuery = useGetPreferences({ fetchFn, enabled: editMode });

  const isLoading = profilesQuery.isLoading || preferencesQuery.isLoading;

  // In edit mode both queries are required; in new-user mode only profiles.
  const hasError = editMode
    ? profilesQuery.isError || preferencesQuery.isError
    : profilesQuery.isError;

  const hasProfiles =
    profilesQuery.data !== undefined && profilesQuery.data.profiles.length > 0;
  const shouldRedirect = hasProfiles && !editMode;

  // Redirect side-effect lives in useEffect to keep render pure and to be
  // safe under React strict mode. The matching render branch returns null
  // so the screen stays clean during the navigation tick.
  useEffect(() => {
    if (shouldRedirect) {
      router.replace("/");
    }
  }, [shouldRedirect, router]);

  if (isLoading) {
    // Mirrors the dashboard layout's loading state (apps/web/app/(dashboard)/layout.tsx).
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-paper-2 border-t-ink" />
      </div>
    );
  }

  if (hasError) {
    // Paper-card error state matching the dashboard layout's error markup.
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <div className="max-w-md rounded-r-lg border border-rule bg-card p-s-6 text-center shadow-1">
          <p className="t-display-s">couldn&apos;t load your settings</p>
          <p className="t-small mt-s-2">
            we couldn&apos;t reach the server. check your connection and try
            again.
          </p>
          <button
            onClick={() => {
              void profilesQuery.refetch();
              if (editMode) void preferencesQuery.refetch();
            }}
            className="mt-s-4 rounded-r-md bg-ink text-paper px-s-4 py-s-2 text-[13px] font-medium transition-all duration-150 hover:bg-accent-2"
          >
            try again
          </button>
        </div>
      </div>
    );
  }

  if (shouldRedirect) {
    // Effect above is in flight — render nothing while the route changes.
    return null;
  }

  // All gates have passed — render the wizard with hydrated state.
  // In edit mode the loading + error gates above guarantee
  // `preferencesQuery.data` is defined, so the non-null assertion is safe.
  const initialState = editMode
    ? initialEditState(
        profilesQuery.data?.profiles ?? [],
        preferencesQuery.data!,
      )
    : initialNewUserState();

  return (
    <OnboardingProvider initialState={initialState}>
      <OnboardingPageBody
        mode={editMode ? "edit" : "new"}
        fetchFn={fetchFn}
      />
    </OnboardingProvider>
  );
}

// ---------------------------------------------------------------------------
// OnboardingPageBody — submit orchestration + redirect
// ---------------------------------------------------------------------------
// Lives inside `OnboardingProvider` so it can `useOnboarding()` to read state
// + dispatch. Wires `useSavePreferences` and orchestrates the step-4 submit:
//   1. `submitStart` → CTA enters loading state.
//   2. `mutateAsync(buildSaveArgs(state))` — throws on non-2xx (status code
//      attached to the Error by `createAuthenticatedFetch`).
//   3. On resolve: dispatch `submitSuccess` and navigate.
//      - new mode  → `router.push('/')`.
//      - edit mode → same-origin referrer if any, else `/settings`. The
//        same-origin guard prevents an open-redirect via a crafted referrer.
//   4. On reject: classify the error (4xx / 5xx / network) and dispatch
//      `submitError` so `WizardFooter` can announce it via `role="alert"`.
// ---------------------------------------------------------------------------

interface OnboardingPageBodyProps {
  mode: "new" | "edit";
  fetchFn: AuthenticatedFetch;
}

function OnboardingPageBody({ mode, fetchFn }: OnboardingPageBodyProps) {
  const { state, dispatch } = useOnboarding();
  const router = useRouter();
  const saveMutation = useSavePreferences({ fetchFn });

  const handleComplete = useCallback(async () => {
    const args = buildSaveArgs(state);
    dispatch({ type: "submitStart" });
    try {
      await saveMutation.mutateAsync(args);
      dispatch({ type: "submitSuccess" });
      if (mode === "new") {
        router.push("/");
      } else {
        router.push(sameOriginReferrer() ?? "/settings");
      }
    } catch (err) {
      const { kind, message } = classifyError(err);
      dispatch({ type: "submitError", kind, message });
    }
  }, [state, dispatch, saveMutation, router, mode]);

  return <OnboardingShell mode={mode} onComplete={handleComplete} />;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the wire payload for `useSavePreferences` from the wizard's reducer
 * state. The reducer's `selectCanAdvance` gate ensures `primaryLanguage`,
 * `primaryLevel`, and `dailyMinutes` are non-null on Step 4 — but we throw
 * defensively so a bug in the gate manifests as a clear error rather than
 * a silent bad payload.
 */
function buildSaveArgs(state: OnboardingState): SavePreferencesArgs {
  if (
    state.primaryLanguage === null ||
    state.primaryLevel === null ||
    state.dailyMinutes === null
  ) {
    throw new Error(
      "cannot submit without primaryLanguage, primaryLevel, and dailyMinutes",
    );
  }
  return {
    languages: state.languages,
    primaryLanguage: state.primaryLanguage,
    primaryLevel: state.primaryLevel,
    goals: state.goals,
    notes: state.notes,
    dailyMinutes: state.dailyMinutes,
    gentleNudges: state.gentleNudges,
  };
}

/**
 * Returns `document.referrer` only when it parses cleanly AND its origin
 * matches the current window's origin. Returns `null` for empty, malformed,
 * or cross-origin referrers — protecting against an open-redirect via a
 * crafted referrer header.
 */
function sameOriginReferrer(): string | null {
  if (typeof window === "undefined") return null;
  if (!document.referrer) return null;
  try {
    const ref = new URL(document.referrer);
    if (ref.origin === window.location.origin) {
      return document.referrer;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Map a thrown error from `useSavePreferences` to a discriminated `kind` +
 * user-facing message. `createAuthenticatedFetch` attaches `.status` to the
 * Error on non-2xx responses; absent status means the request never reached
 * the server (network error / fetch failure).
 *
 *   4xx → show server message verbatim (R7.5)
 *   5xx → "something went wrong — try again." (R7.6)
 *   network → "something went wrong — try again." (design.md error scenario 3)
 */
function classifyError(err: unknown): {
  kind: "4xx" | "5xx" | "network";
  message: string;
} {
  if (err instanceof Error) {
    const status = (err as Error & { status?: number }).status;
    if (typeof status === "number") {
      if (status >= 400 && status < 500) {
        return {
          kind: "4xx",
          message: err.message || "invalid input. please check the form.",
        };
      }
      if (status >= 500) {
        return { kind: "5xx", message: "something went wrong — try again." };
      }
    }
  }
  // No status property → fetch never produced a response (network error or
  // pre-flight failure). Surface the same friendly message as 5xx.
  return { kind: "network", message: "something went wrong — try again." };
}
