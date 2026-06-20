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
  dispatchOverride,
  children,
}: {
  initialState: OnboardingState;
  dispatchOverride?: Dispatch<OnboardingAction>;
  children: ReactNode;
}) {
  const [state, realDispatch] = useReducer(reducer, initialState);
  const dispatch = dispatchOverride ?? realDispatch;

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
