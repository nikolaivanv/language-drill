"use client";

import { Suspense, useCallback, useEffect, useMemo } from "react";
import { useAuth, useUser } from "@clerk/nextjs";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useLanguageProfiles,
  useUpdateLanguages,
  useUpdatePreferences,
  useUpdateWeeklySummary,
  createAuthenticatedFetch,
  type AuthenticatedFetch,
} from "@language-drill/api-client";
import {
  OnboardingProvider,
  OnboardingShell,
  initialNewUserState,
  useOnboarding,
} from "../../components/onboarding";
import { track } from "../../lib/analytics/track";

// ---------------------------------------------------------------------------
// OnboardingPage — routing/loading/hydration + submit orchestration
// ---------------------------------------------------------------------------
// Owns the data plumbing for the onboarding route:
//   - reads `?edit=1` to decide whether to redirect to /settings (the
//     canonical editor for returning users)
//   - hydrates language profiles (always) for the returning-user redirect
//   - shows a spinner card while profiles query is loading
//   - shows a paper-card error with retry when profiles hydration fails
//   - redirects returning users with profiles to `/home` when not in edit mode
//   - redirects `?edit=1` to `/settings` immediately
//   - mounts the wizard inside an `OnboardingProvider` so `OnboardingPageBody`
//     can read state + dispatch and orchestrate the final submit
//
// Submit orchestration lives in `OnboardingPageBody` so it can read the
// wizard's reducer state via `useOnboarding()`. The shell stays stateless and
// assumes the provider is wrapped above it.
//
// `useSearchParams()` forces the page out of static prerendering. Next.js
// requires the bailout to be wrapped in a Suspense boundary, so the default
// export is a thin Suspense wrapper around the real page content.
// ---------------------------------------------------------------------------

export default function OnboardingPage() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <OnboardingPageContent />
    </Suspense>
  );
}

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-paper-2 border-t-ink" />
    </div>
  );
}

function OnboardingPageContent() {
  const { getToken } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const editMode = searchParams?.get("edit") === "1";

  // Stable fetchFn so TanStack Query doesn't see a new function every render.
  const fetchFn = useMemo(
    () => createAuthenticatedFetch(getToken),
    [getToken],
  );

  // Edit mode no longer runs in the wizard — settings is the canonical editor.
  useEffect(() => {
    if (editMode) router.replace("/settings");
  }, [editMode, router]);

  // Profiles always — needed for the returning-user redirect predicate.
  const profilesQuery = useLanguageProfiles({ fetchFn });

  const isLoading = profilesQuery.isLoading;
  const hasError = profilesQuery.isError;

  const hasProfiles =
    profilesQuery.data !== undefined && profilesQuery.data.profiles.length > 0;
  const shouldRedirect = hasProfiles && !editMode;

  // Redirect side-effect lives in useEffect to keep render pure and to be
  // safe under React strict mode. The matching render branch returns null
  // so the screen stays clean during the navigation tick.
  useEffect(() => {
    if (shouldRedirect) {
      router.replace("/home");
    }
  }, [shouldRedirect, router]);

  // In edit mode, the effect navigates away — render nothing while in flight.
  if (editMode) {
    return null;
  }

  if (isLoading) {
    // Mirrors the dashboard layout's loading state (apps/web/app/(dashboard)/layout.tsx).
    return <LoadingScreen />;
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

  // All gates have passed — render the wizard with fresh initial state.
  const initialState = initialNewUserState();

  return (
    <OnboardingProvider initialState={initialState}>
      <OnboardingPageBody fetchFn={fetchFn} />
    </OnboardingProvider>
  );
}

// ---------------------------------------------------------------------------
// OnboardingPageBody — submit orchestration + redirect
// ---------------------------------------------------------------------------
// Lives inside `OnboardingProvider` so it can `useOnboarding()` to read state
// + dispatch. Wires `useUpdateLanguages` + `useUpdatePreferences` and
// orchestrates the step-4 submit:
//   1. `submitStart` → CTA enters loading state.
//   2. Build `profiles` from `state.languages` × `state.levels` map — throws
//      defensively if a level is missing (the gate should prevent this).
//   3. `updateLanguages.mutateAsync({ profiles, primaryLanguage })` — throws
//      on non-2xx (status code attached to the Error by
//      `createAuthenticatedFetch`).
//   4. `updatePreferences.mutateAsync({ goals, dailyMinutes, ... })`.
//   5. On resolve: dispatch `submitSuccess` and `router.push('/home')`.
//   6. On reject: classify the error (4xx / 5xx / network) and dispatch
//      `submitError` so `WizardFooter` can announce it via `role="alert"`.
// ---------------------------------------------------------------------------

function OnboardingPageBody({ fetchFn }: { fetchFn: AuthenticatedFetch }) {
  const { state, dispatch } = useOnboarding();
  const router = useRouter();
  const { user } = useUser();
  const updateLanguages = useUpdateLanguages({ fetchFn });
  const updatePreferences = useUpdatePreferences({ fetchFn });
  const updateWeeklySummary = useUpdateWeeklySummary({ fetchFn });

  const handleComplete = useCallback(async () => {
    dispatch({ type: "submitStart" });
    try {
      const profiles = state.languages.map((language) => {
        const proficiencyLevel = state.levels[language];
        if (!proficiencyLevel) {
          throw new Error(`missing level for ${language}`);
        }
        return { language, proficiencyLevel };
      });
      if (state.primaryLanguage === null || state.dailyMinutes === null) {
        throw new Error("missing primaryLanguage or dailyMinutes");
      }
      await updateLanguages.mutateAsync({
        profiles,
        primaryLanguage: state.primaryLanguage,
      });
      await updatePreferences.mutateAsync({
        goals: state.goals,
        dailyMinutes: state.dailyMinutes,
        gentleNudges: state.gentleNudges,
        notes: state.notes.replace(/\r\n/g, "\n").trim(),
      });

      // Name + weekly-summary are best-effort side effects: the user has
      // already committed their core profile, so a failure here must not
      // block completion or surface a blocking error. We await them (so the
      // confirmation email is in flight before we navigate) but swallow
      // failures.
      await Promise.allSettled([
        saveDisplayName(user, state.name),
        state.weeklySummary
          ? updateWeeklySummary.mutateAsync({ enabled: true })
          : Promise.resolve(),
      ]);

      track('onboarding_step_completed', { step: state.step });
      dispatch({ type: "submitSuccess" });
      router.push("/home");
    } catch (err) {
      const { kind, message } = classifyError(err);
      dispatch({ type: "submitError", kind, message });
    }
  }, [state, dispatch, updateLanguages, updatePreferences, updateWeeklySummary, user, router]);

  return <OnboardingShell mode="new" onComplete={handleComplete} />;
}

// ---------------------------------------------------------------------------
// saveDisplayName — write the optional onboarding name to Clerk.
// ---------------------------------------------------------------------------
// OTP/passwordless signups arrive with no first/last name (the account menu
// would otherwise show "?"). When the user fills in the optional name field we
// split it on the first run of whitespace into first + last and persist it to
// Clerk. We only write when the field is non-empty AND Clerk currently has no
// name, so we never clobber a name Clerk already collected (e.g. Google OAuth).
type ClerkUserLike = {
  firstName: string | null;
  lastName: string | null;
  update: (params: { firstName?: string; lastName?: string }) => Promise<unknown>;
};

async function saveDisplayName(
  user: ClerkUserLike | null | undefined,
  rawName: string,
): Promise<void> {
  const name = rawName.trim().replace(/\s+/g, " ");
  if (!user || name === "") return;
  if (user.firstName || user.lastName) return;
  const spaceAt = name.indexOf(" ");
  const firstName = spaceAt === -1 ? name : name.slice(0, spaceAt);
  const lastName = spaceAt === -1 ? "" : name.slice(spaceAt + 1);
  await user.update({ firstName, lastName });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map a thrown error from `useUpdateLanguages` / `useUpdatePreferences` to a
 * discriminated `kind` + user-facing message. `createAuthenticatedFetch`
 * attaches `.status` to the Error on non-2xx responses; absent status means
 * the request never reached the server (network error / fetch failure).
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
