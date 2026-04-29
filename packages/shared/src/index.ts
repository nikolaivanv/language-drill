export enum Language {
  EN = "EN",
  ES = "ES",
  DE = "DE",
  TR = "TR",
}

export enum CefrLevel {
  A1 = "A1",
  A2 = "A2",
  B1 = "B1",
  B2 = "B2",
  C1 = "C1",
  C2 = "C2",
}

// ---------------------------------------------------------------------------
// Language profile types
// ---------------------------------------------------------------------------

export type LanguageProfile = {
  language: Language;
  proficiencyLevel: CefrLevel;
};

export const CEFR_DESCRIPTIONS: Record<CefrLevel, string> = {
  [CefrLevel.A1]: "I know basic words and phrases",
  [CefrLevel.A2]: "I can handle simple conversations",
  [CefrLevel.B1]: "I can discuss familiar topics",
  [CefrLevel.B2]: "I can speak fluently on most topics",
  [CefrLevel.C1]: "I can express myself precisely",
  [CefrLevel.C2]: "I understand virtually everything",
};

export const LANGUAGE_NAMES: Record<Language, string> = {
  [Language.EN]: "English",
  [Language.ES]: "Spanish",
  [Language.DE]: "German",
  [Language.TR]: "Turkish",
};

export type ApiError = {
  error: string;
  code: string;
  status: number;
};

export type InviteCode = {
  code: string;
  expiresAt?: string;
};

// ---------------------------------------------------------------------------
// Exercise types
// ---------------------------------------------------------------------------

export enum ExerciseType {
  CLOZE = "cloze",
  TRANSLATION = "translation",
  VOCAB_RECALL = "vocab_recall",
}

export type ClozeContent = {
  type: ExerciseType.CLOZE;
  instructions: string;
  sentence: string;
  correctAnswer: string;
  options?: string[];
  context?: string;
};

export type TranslationContent = {
  type: ExerciseType.TRANSLATION;
  instructions: string;
  sourceText: string;
  sourceLanguage: Language;
  targetLanguage: Language;
  referenceTranslation: string;
};

export type VocabRecallContent = {
  type: ExerciseType.VOCAB_RECALL;
  instructions: string;
  prompt: string;
  expectedWord: string;
  hints: string[];
  exampleSentence: string;
};

export type ExerciseContent = ClozeContent | TranslationContent | VocabRecallContent;

export type Exercise = {
  id: string;
  type: ExerciseType;
  language: Language;
  difficulty: CefrLevel;
  content: ExerciseContent;
};

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

export function isClozeContent(content: ExerciseContent): content is ClozeContent {
  return content.type === ExerciseType.CLOZE;
}

export function isTranslationContent(content: ExerciseContent): content is TranslationContent {
  return content.type === ExerciseType.TRANSLATION;
}

export function isVocabRecallContent(content: ExerciseContent): content is VocabRecallContent {
  return content.type === ExerciseType.VOCAB_RECALL;
}

// ---------------------------------------------------------------------------
// Evaluation types
// ---------------------------------------------------------------------------

export type EvaluationError = {
  type: "grammar" | "vocabulary" | "spelling" | "pragmatics";
  severity: "minor" | "major";
  text: string;
  correction: string;
  explanation: string;
};

export type EvaluationResult = {
  score: number;
  grammarAccuracy: number;
  vocabularyRange: string;
  taskAchievement: number;
  feedback: string;
  errors: EvaluationError[];
  estimatedCefrEvidence: string;
};

// ---------------------------------------------------------------------------
// Onboarding constants
// ---------------------------------------------------------------------------

export * from "./onboarding";
