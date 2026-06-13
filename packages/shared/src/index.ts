export enum Language {
  EN = "EN",
  ES = "ES",
  DE = "DE",
  TR = "TR",
}

/** Native (endonym) display name per language — used in Read copy + tags. */
export const LANGUAGE_NATIVE_NAME: Record<Language, string> = {
  [Language.EN]: "English",
  [Language.ES]: "español",
  [Language.DE]: "Deutsch",
  [Language.TR]: "Türkçe",
};

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

// Score >= this counts as correct in session summaries; matches the 'solid' tier in apps/web/lib/drill/verdict-tier.ts
export const CORRECT_THRESHOLD = 0.7;

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
  SENTENCE_CONSTRUCTION = "sentence_construction",
  FREE_WRITING = "free_writing",
}

export type ClozeContent = {
  type: ExerciseType.CLOZE;
  instructions: string;
  sentence: string;
  correctAnswer: string;
  /**
   * Optional. Every additional lexeme/form that fits the blank under the
   * targeted grammar point. Used when the sentence's surrounding context does
   * not single out one specific word (e.g. "Sınıfta sekiz ___ var" — chair,
   * student, book all satisfy the no-plural-after-numerals rule). The
   * evaluator accepts any entry here as a fully-correct answer.
   * `correctAnswer` is NOT auto-included in this list; the evaluator checks
   * both fields independently.
   */
  acceptableAnswers?: string[];
  options?: string[];
  context?: string;
  /**
   * Optional L1 (English) gloss shown as a disambiguation aid. Used for
   * Turkish case clozes at A1–A2, where context alone may not force the
   * required case (notably accusative, which marks definiteness). Omitted by
   * default for B1+. MUST NOT state the rule outcome or the required form —
   * it disambiguates meaning, it does not spoil the answer (see the
   * generation prompt's "Spoiled blank" rule). Rendered in the same
   * above-sentence slot as `context`.
   */
  glossEn?: string;
  topicHint?: string;
};

export type TranslationContent = {
  type: ExerciseType.TRANSLATION;
  instructions: string;
  sourceText: string;
  sourceLanguage: Language;
  targetLanguage: Language;
  referenceTranslation: string;
  topicHint?: string;
};

export type VocabRecallContent = {
  type: ExerciseType.VOCAB_RECALL;
  instructions: string;
  prompt: string;
  expectedWord: string;
  hints: string[];
  exampleSentence: string;
  topicHint?: string;
};

export type SentenceConstructionContent = {
  type: ExerciseType.SENTENCE_CONSTRUCTION;
  instructions: string;
  /** Which framing the prompt uses. Drives generation variety, not pooling. */
  promptMode: "keywords" | "situation" | "grammar_target";
  /** The rendered task shown to the learner. */
  prompt: string;
  /** The words the learner must use; required & non-empty when promptMode is "keywords" (enforced when the generated draft is parsed). */
  keywords?: string[];
  /** Human label of the target structure; present for grammar_target mode. */
  targetStructure?: string;
  /** Optional register constraint. */
  register?: "informal" | "neutral" | "formal";
  /** Valid example sentences (2–3, enforced when the generated draft is parsed). Used by the validator and the "show an example" hint. */
  modelAnswers: string[];
  topicHint?: string;
};

export type FreeWritingRequiredElement = {
  /** Stable id used as a React key and as the checklist row id. */
  id: string;
  /** What the learner must do, in the target language. */
  label: string;
  /** Optional hint on how to satisfy it (e.g. the grammar trigger). */
  detail?: string;
};

export type FreeWritingContent = {
  type: ExerciseType.FREE_WRITING;
  instructions: string;
  /** Short headline for the prompt, e.g. "El teletrabajo: ¿avance o aislamiento?". */
  title: string;
  /** The task statement shown to the learner. */
  task: string;
  /** Topic-domain label, e.g. "opinión · argumentación". */
  domain: string;
  register: "informal" | "neutral" | "formal";
  minWords: number;
  maxWords: number;
  /** Countdown length (minutes) for exam-simulation mode. */
  suggestedMinutes?: number;
  requiredElements: FreeWritingRequiredElement[];
  topicHint?: string;
};

export type ExerciseContent =
  | ClozeContent
  | TranslationContent
  | VocabRecallContent
  | SentenceConstructionContent
  | FreeWritingContent;

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

export function isSentenceConstructionContent(
  content: ExerciseContent,
): content is SentenceConstructionContent {
  return content.type === ExerciseType.SENTENCE_CONSTRUCTION;
}

export function isFreeWritingContent(
  content: ExerciseContent,
): content is FreeWritingContent {
  return content.type === ExerciseType.FREE_WRITING;
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
// Free Writing evaluation — richer than the flat EvaluationResult above.
// Claude returns EXACT substrings (error.original, goodSpans, improved.upgrades)
// so the client can splice highlights into the learner's original text without
// trusting Claude to reproduce it verbatim. A span that can't be located is
// dropped, never corrupting the text.
// ---------------------------------------------------------------------------

export type FreeWritingSeverity = "high" | "med" | "low";

export type FreeWritingCriterionId = "task" | "coherence" | "lexis" | "grammar";

export type FreeWritingCriterion = {
  id: FreeWritingCriterionId;
  label: string;
  score: number; // 0..1
  cefr: string; // per-criterion CEFR estimate, e.g. "B2", "B1+"
  note: string;
};

export type FreeWritingError = {
  n: number; // 1-based stable index, referenced by the markup
  severity: FreeWritingSeverity;
  type: string; // category label, e.g. "Modo verbal"
  original: string; // EXACT substring of the learner's text
  correction: string;
  where?: string; // human locus, e.g. "oración condicional · §3"
  note: string;
};

export type FreeWritingImproved = {
  text: string; // full improved paragraph(s), freshly written
  upgrades?: string[]; // EXACT substrings within `text` to highlight green
};

export type FreeWritingEvaluation = {
  overallScore: number; // 0..1 — stored in user_exercise_history.score
  overallCefr: string;
  headline: string;
  summary: string;
  criteria: FreeWritingCriterion[]; // exactly 4, task/coherence/lexis/grammar order
  errors: FreeWritingError[];
  goodSpans: string[]; // EXACT substrings to highlight as done-well
  improved: FreeWritingImproved;
  wordCount: number;
  improvedWordCount: number;
};

// ---------------------------------------------------------------------------
// Onboarding constants
// ---------------------------------------------------------------------------

export * from "./onboarding";

// ---------------------------------------------------------------------------
// Read & Collect constants and schemas
// ---------------------------------------------------------------------------

export * from "./read";

// ---------------------------------------------------------------------------
// Vocabulary Review (Part 2) domain schemas
// ---------------------------------------------------------------------------

export * from "./review";

// ---------------------------------------------------------------------------
// Shared passage tokenizer (used by both web renderer and server pre-filter)
// ---------------------------------------------------------------------------

export * from "./tokenize";

// ---------------------------------------------------------------------------
// Shared CORS allow-list (Hono middleware + Function URL CORS)
// ---------------------------------------------------------------------------

export * from "./cors";

// ---------------------------------------------------------------------------
// Canonical generation reason codes (exercise-generation rejection/flag reasons)
// ---------------------------------------------------------------------------

export * from "./generation-reasons";

// ---------------------------------------------------------------------------
// Theory content JSON taxonomy
// ---------------------------------------------------------------------------

export type {
  TheoryTopicJson,
  TheorySectionJson,
  TheoryBlockJson,
  TheoryInlineJson,
} from "./theory";
export { parseTheoryTopicJson, parseBlock, parseInline } from "./theory";

// ---------------------------------------------------------------------------
// Theory library — curriculum-anchored category taxonomy
// ---------------------------------------------------------------------------

export * from "./theory-categories";

// ---------------------------------------------------------------------------
// Phase 4 — moved here from `@language-drill/db` to break the build cycle
// (the db barrel still re-exports both for back-compat).
// ---------------------------------------------------------------------------

export { deterministicUuid } from "./deterministic-uuid";
export type { CurriculumCefrLevel, GrammarPoint } from "./curriculum-types";

export * from "./coverage";
