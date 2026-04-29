import type { Language } from "./index";

// ---------------------------------------------------------------------------
// Learning languages
// ---------------------------------------------------------------------------
// EN is a source-only language for translation exercises, not a learning
// target. The wizard, the API contract, and any UI affordance that asks the
// user to pick a language they're learning all narrow to this subset.
//
// Note: `Language` is imported as a type only. Importing the runtime enum
// here would create a module-init cycle with `./index` (which re-exports
// from this file), leading to `Language` being `undefined` at evaluation
// time in some bundlers. The string-literal keys below match the enum
// values exactly.
// ---------------------------------------------------------------------------

export type LearningLanguage = Exclude<Language, Language.EN>;

export const LANGUAGE_NATIVE_NAMES: Record<LearningLanguage, string> = {
  ES: "español",
  DE: "deutsch",
  TR: "türkçe",
};

// ---------------------------------------------------------------------------
// Onboarding goals
// ---------------------------------------------------------------------------

export const GOAL_IDS = [
  "grammar",
  "speaking",
  "listening",
  "writing",
  "vocab",
  "travel",
] as const;

export type GoalId = (typeof GOAL_IDS)[number];

// ---------------------------------------------------------------------------
// Daily time commitment
// ---------------------------------------------------------------------------

export const DAILY_MINUTES = [5, 10, 20, 30] as const;

export type DailyMinutes = (typeof DAILY_MINUTES)[number];

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export const NOTES_MAX_LENGTH = 500;
