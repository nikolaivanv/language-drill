'use client';

// ---------------------------------------------------------------------------
// Onboarding context
// ---------------------------------------------------------------------------
// Exposes `(state, dispatch)` from `useOnboardingReducer` to the wizard's
// step components and the coach pane without prop drilling. Throws when
// `useOnboarding` is read outside the provider so misuse is loud.
// ---------------------------------------------------------------------------

import {
  createContext,
  useContext,
  useReducer,
  type Dispatch,
  type ReactNode,
} from 'react';
import {
  reducer,
  type OnboardingAction,
  type OnboardingState,
} from './use-onboarding-reducer';

type OnboardingContextValue = {
  state: OnboardingState;
  dispatch: Dispatch<OnboardingAction>;
};

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function OnboardingProvider({
  initialState,
  children,
}: {
  initialState: OnboardingState;
  children: ReactNode;
}) {
  const [state, dispatch] = useReducer(reducer, initialState);

  return (
    <OnboardingContext.Provider value={{ state, dispatch }}>
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding(): OnboardingContextValue {
  const ctx = useContext(OnboardingContext);
  if (!ctx) {
    throw new Error('useOnboarding must be used within an OnboardingProvider');
  }
  return ctx;
}
