// ---------------------------------------------------------------------------
// Onboarding wizard reducer
// ---------------------------------------------------------------------------
// Pure reducer + selectors for the 4-step onboarding wizard. Owns the
// cross-field invariants (e.g., dropping the current primary language from
// `languages` resets `primaryLanguage`/`primaryLevel`) so the UI stays a
// thin shell. Tested independently in
// `apps/web/components/onboarding/__tests__/use-onboarding-reducer.test.ts`.
// ---------------------------------------------------------------------------

import {
  CefrLevel,
  type DailyMinutes,
  type GoalId,
  LANGUAGE_NATIVE_NAMES,
  type LearningLanguage,
  NOTES_MAX_LENGTH,
  type LanguageProfile,
} from '@language-drill/shared';
import type { PreferencesResponse } from '@language-drill/api-client';

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

export type OnboardingMode = 'new' | 'edit';

export type OnboardingStep = 1 | 2 | 3 | 4;

export type SubmissionState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success' }
  | {
      status: 'error';
      kind: '4xx' | '5xx' | 'network';
      message: string;
    };

export type OnboardingState = {
  mode: OnboardingMode;
  step: OnboardingStep;
  /** Selected learning languages, preserved in the order they were toggled. */
  languages: LearningLanguage[];
  primaryLanguage: LearningLanguage | null;
  primaryLevel: CefrLevel | null;
  /** Toggle-set of goal IDs. */
  goals: GoalId[];
  notes: string;
  dailyMinutes: DailyMinutes | null;
  gentleNudges: boolean;
  submission: SubmissionState;
};

// ---------------------------------------------------------------------------
// Action union
// ---------------------------------------------------------------------------

export type OnboardingAction =
  | { type: 'goNext' }
  | { type: 'goBack' }
  | { type: 'setLanguages'; languages: LearningLanguage[] }
  | { type: 'setPrimary'; language: LearningLanguage }
  | { type: 'setLevel'; level: CefrLevel }
  | { type: 'toggleGoal'; goal: GoalId }
  | { type: 'setNotes'; notes: string }
  | { type: 'setDailyMinutes'; minutes: DailyMinutes }
  | { type: 'setGentleNudges'; on: boolean }
  | { type: 'submitStart' }
  | { type: 'submitSuccess' }
  | {
      type: 'submitError';
      kind: '4xx' | '5xx' | 'network';
      message: string;
    };

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function reducer(
  state: OnboardingState,
  action: OnboardingAction,
): OnboardingState {
  switch (action.type) {
    case 'goNext': {
      if (state.step >= 4) return state;
      return { ...state, step: (state.step + 1) as OnboardingStep };
    }
    case 'goBack': {
      if (state.step <= 1) return state;
      return { ...state, step: (state.step - 1) as OnboardingStep };
    }
    case 'setLanguages': {
      // R2.7: at least one language must remain selected in edit mode.
      // Empty arrays are silently rejected; the UI shows the inline guard.
      if (state.mode === 'edit' && action.languages.length === 0) {
        return state;
      }

      const next: OnboardingState = {
        ...state,
        languages: action.languages,
      };

      // If the current primary language is no longer in the set, the
      // primary language and level are no longer meaningful.
      if (
        state.primaryLanguage !== null &&
        !action.languages.includes(state.primaryLanguage)
      ) {
        next.primaryLanguage = null;
        next.primaryLevel = null;
      }

      return next;
    }
    case 'setPrimary': {
      // Defensive: the UI shouldn't be able to send a language outside
      // the selected set, but the reducer is the line of defence.
      if (!state.languages.includes(action.language)) {
        return state;
      }
      return { ...state, primaryLanguage: action.language };
    }
    case 'setLevel': {
      return { ...state, primaryLevel: action.level };
    }
    case 'toggleGoal': {
      const has = state.goals.includes(action.goal);
      return {
        ...state,
        goals: has
          ? state.goals.filter((g) => g !== action.goal)
          : [...state.goals, action.goal],
      };
    }
    case 'setNotes': {
      return { ...state, notes: action.notes };
    }
    case 'setDailyMinutes': {
      return { ...state, dailyMinutes: action.minutes };
    }
    case 'setGentleNudges': {
      return { ...state, gentleNudges: action.on };
    }
    case 'submitStart': {
      return { ...state, submission: { status: 'loading' } };
    }
    case 'submitSuccess': {
      return { ...state, submission: { status: 'success' } };
    }
    case 'submitError': {
      return {
        ...state,
        submission: {
          status: 'error',
          kind: action.kind,
          message: action.message,
        },
      };
    }
    default: {
      // Exhaustiveness check.
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Initial-state factories
// ---------------------------------------------------------------------------

const DEFAULT_DAILY_MINUTES: DailyMinutes = 10;

export function initialNewUserState(): OnboardingState {
  return {
    mode: 'new',
    step: 1,
    languages: [],
    primaryLanguage: null,
    primaryLevel: null,
    goals: [],
    notes: '',
    dailyMinutes: DEFAULT_DAILY_MINUTES,
    gentleNudges: true,
    submission: { status: 'idle' },
  };
}

/**
 * Build the initial state for edit mode by hydrating from the language
 * profiles + preferences responses. Coalesces a `null` `dailyMinutes`
 * (returned for users who never completed onboarding) to the default `10`.
 */
export function initialEditState(
  profiles: LanguageProfile[],
  prefs: PreferencesResponse,
): OnboardingState {
  // Filter out any non-learning languages defensively; the API contract
  // already excludes EN, but guarding here keeps the wizard well-typed.
  const languages = profiles
    .map((p) => p.language)
    .filter((l): l is LearningLanguage => l !== 'EN') as LearningLanguage[];

  const primaryLanguage = prefs.primaryLanguage;

  const primaryProfile =
    primaryLanguage !== null
      ? profiles.find((p) => p.language === primaryLanguage)
      : undefined;
  const primaryLevel = primaryProfile?.proficiencyLevel ?? null;

  return {
    mode: 'edit',
    step: 1,
    languages,
    primaryLanguage,
    primaryLevel,
    goals: [...prefs.goals],
    notes: prefs.notes,
    dailyMinutes: prefs.dailyMinutes ?? DEFAULT_DAILY_MINUTES,
    gentleNudges: prefs.gentleNudges,
    submission: { status: 'idle' },
  };
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

/**
 * Per-step gate driving the "continue" / "finish setup" / "save changes"
 * CTA. The reducer doesn't enforce this on `goNext` directly — the UI also
 * disables the CTA — so this is the single source of truth.
 *
 * - Step 1: at least one language selected.
 * - Step 2: primary language + primary level both set.
 * - Step 3: notes within the 500-char limit (Step 3 is otherwise optional).
 * - Step 4: a daily-minutes value is selected.
 */
export function selectCanAdvance(state: OnboardingState): boolean {
  switch (state.step) {
    case 1:
      return state.languages.length >= 1;
    case 2:
      return state.primaryLanguage !== null && state.primaryLevel !== null;
    case 3:
      return state.notes.length <= NOTES_MAX_LENGTH;
    case 4:
      return state.dailyMinutes !== null;
    default:
      return false;
  }
}

/**
 * Per-step coach copy displayed in the left rail. Strings are pulled
 * verbatim from Requirement 6.3 — paraphrasing breaks downstream tests.
 */
export function selectCoachMessage(state: OnboardingState): string {
  switch (state.step) {
    case 1:
      return "let's start with languages. you can add more later.";
    case 2: {
      const name =
        state.primaryLanguage !== null
          ? LANGUAGE_NATIVE_NAMES[state.primaryLanguage]
          : 'your primary language';
      return `for ${name} — where would you place yourself? rough is fine.`;
    }
    case 3:
      return 'what do you want to drill? pick whatever fits — even all of them.';
    case 4:
      return 'last thing — how much time can you usually give me?';
    default:
      return '';
  }
}
