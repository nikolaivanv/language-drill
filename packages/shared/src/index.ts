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

// Upper bound on a submitted exercise answer (chars). A free-form answer is
// interpolated raw into the evaluation prompt and forwarded to Claude, so an
// unbounded answer is a token-cost amplification lever (a 100 KB answer is
// ~25k input tokens per evaluation). 2000 chars comfortably covers any
// legitimate cloze / translation / short-writing answer — including a
// free-writing paragraph (the longest band targets ~200 words ≈ 1.4k chars) —
// while capping the blast radius; matches READ_TEXT_MAX_CHARS for the annotate
// surfaces. Enforced server-side in `SubmitAnswerSchema`; the free-writing
// composer mirrors it as a textarea `maxLength`.
export const EXERCISE_ANSWER_MAX_CHARS = 2000;

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
  DICTATION = "dictation",
  FREE_WRITING = "free_writing",
  CONJUGATION = "conjugation",
  CONTEXTUAL_PARAPHRASE = "contextual_paraphrase",
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

/**
 * One unit of a translation word-hint map: an ordered slice of the source
 * sentence. `hintable:false` units (articles, function words, punctuation)
 * carry no lemma and are not tappable in the UI.
 */
export type WordHintUnit = {
  text: string;
  hintable: boolean;
  lemma?: string;
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

export type DictationContent = {
  type: ExerciseType.DICTATION;
  /** Short title for the clip card, e.g. "El tiempo lo cura todo". */
  title: string;
  /** Optional one-line brief shown under the title. */
  blurb?: string;
  /** The full transcription target — the grading reference. */
  referenceText: string;
  /** Per-sentence reference, for display/segmentation. */
  sentences: string[];
  /** Human label of the accent, e.g. "español peninsular · centro". */
  accent: string;
  /** Polly voice id used to synthesize the audio (e.g. "Sergio"). */
  voiceId: string;
  domain?: string;
  register?: string;
  /** "What this tests" chips shown on the brief card. */
  tested: string[];
  durationSec: number;
  /** Decorative amplitude envelope (0..1) for the waveform UI. */
  waveform: number[];
  /**
   * Presigned S3 GET URL for the clip audio. NOT stored in the DB; injected by
   * the API at response time from `exercises.audioS3Key`. Absent in stored JSON.
   */
  audioUrl?: string;
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

export type ConjugationContent = {
  type: ExerciseType.CONJUGATION;
  /** Short imperative, e.g. "Write the correct form." */
  instructions: string;
  /** Citation/dictionary form: "ir" / "fahren" / "gitmek". */
  lemma: string;
  /** L1 (English) gloss of the lemma: "to go". */
  lemmaGloss: string;
  /**
   * Human-readable feature bundle shown to the learner, e.g.
   * "condicional · 1ª persona del plural" or
   * "geniş zaman · olumsuz · 1. çoğul". Tense/mood is fixed by the grammar
   * point; this names the cell the learner must produce.
   */
  featureBundle: string;
  /**
   * Ordered grammar dimensions OTHER than person/number — tense/mood, and
   * polarity where the language marks it — each as a target-language term plus
   * a short English gloss. Optional: only new (regenerated) rows carry it; older
   * rows fall back to `featureBundle`.
   * e.g. [{ term: "geçmiş zaman", gloss: "past" }, { term: "olumlu", gloss: "affirmative" }]
   */
  features?: Array<{ term: string; gloss: string }>;
  /**
   * Person/number cue, surfaced prominently. `pronoun` is the representative
   * target-language subject pronoun; `gloss` is its English. Optional for the
   * same backward-compatibility reason as `features`.
   * e.g. { pronoun: "o", gloss: "he / she / it" }
   */
  subject?: { pronoun: string; gloss: string };
  /** The canonical expected form: "iríamos". */
  targetForm: string;
  /** Other fully-correct forms (regional / orthographic variants). Rare. */
  acceptableForms?: string[];
  /**
   * Post-answer teaching: stem + ending (ES/DE) or stem + ordered suffix
   * gloss (TR). Shown on the result, never before submission.
   */
  breakdown: string;
  /** 1–2 short sentences using the form in context (post-answer teaching). */
  exampleSentences: string[];
  topicHint?: string;
};

export type ContextualParaphraseContent = {
  type: ExerciseType.CONTEXTUAL_PARAPHRASE;
  instructions: string;
  /** The sentence the learner must rewrite. */
  sourceText: string;
  /** Which transformation is required. Drives rendering + eval framing. */
  constraintKind: "avoid" | "register" | "simplify";
  /** avoid: words/structures that must NOT appear in the answer (≥1 when kind==="avoid"). */
  bannedTerms?: string[];
  /** register: the register the rewrite must adopt (required when kind==="register"). */
  targetRegister?: "informal" | "neutral" | "formal";
  /** simplify: the audience to simplify for, e.g. "a child" (required when kind==="simplify"). */
  audience?: string;
  /** Rendered task shown to the learner, e.g. "Say this without using «gustar»". */
  constraintLabel: string;
  /** 2–3 model paraphrases that satisfy the constraint AND preserve meaning.
   *  Used by the validator and the reveal hint. */
  referenceParaphrases: string[];
  topicHint?: string;
};

export type ExerciseContent =
  | ClozeContent
  | TranslationContent
  | VocabRecallContent
  | SentenceConstructionContent
  | DictationContent
  | FreeWritingContent
  | ConjugationContent
  | ContextualParaphraseContent;

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

export function isDictationContent(content: ExerciseContent): content is DictationContent {
  return content.type === ExerciseType.DICTATION;
}

export function isFreeWritingContent(
  content: ExerciseContent,
): content is FreeWritingContent {
  return content.type === ExerciseType.FREE_WRITING;
}

export function isConjugationContent(
  content: ExerciseContent,
): content is ConjugationContent {
  return content.type === ExerciseType.CONJUGATION;
}

export function isContextualParaphraseContent(
  content: ExerciseContent,
): content is ContextualParaphraseContent {
  return content.type === ExerciseType.CONTEXTUAL_PARAPHRASE;
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
  /**
   * The curriculum grammar-point key this specific error violates, when the
   * evaluator could attribute it to one of the in-scope points. Null/absent
   * when no in-scope point applies. Populated by the generic evaluator and the
   * free-writing evaluator (each from its level's closed key set); the
   * dictation path leaves it unset.
   */
  grammarPointKey?: string | null;
};

export type EvaluationResult = {
  score: number;
  grammarAccuracy: number;
  vocabularyRange: string;
  taskAchievement: number;
  feedback: string;
  errors: EvaluationError[];
  estimatedCefrEvidence: string;
  /**
   * How this evaluation was produced. 'deterministic' = exact-match
   * short-circuit (no LLM ran; eligible for on-demand "Explain why").
   * Absent on rows written before 2026-07-05 — treat as 'llm'.
   */
  evaluationSource?: 'deterministic' | 'llm';
};

// ---------------------------------------------------------------------------
// Dictation result types
// ---------------------------------------------------------------------------

/** One ordered segment of the results diff prose. */
export type DictationDiffSegment =
  | { kind: "match"; text: string }
  | { kind: "error"; id: number; got: string; expected: string; severity: "low" | "high" }
  | { kind: "accepted"; id: number; got: string; expected: string };

/** One flagged difference, classified by Claude. */
export type DictationDifference = {
  id: number;
  kind: "error" | "accepted";
  /** Short category, e.g. "word boundary", "silent h", "b/v". */
  category: string;
  /** Severity for genuine errors; null for accepted differences. */
  severity: "low" | "high" | null;
  got: string;
  expected: string;
  note: string;
};

/** One accuracy-criterion row (0–1 + CEFR). */
export type DictationCriterion = {
  id: string;
  label: string;
  score: number;
  cefr: string;
  note: string;
};

/**
 * Dictation grading result. A superset of EvaluationResult: it carries every
 * EvaluationResult field (so `user_exercise_history` storage, the debrief read,
 * and progress aggregation work unchanged) plus dictation-specific detail.
 * `kind: "dictation"` discriminates it from a plain EvaluationResult on the wire.
 */
export type DictationResult = {
  kind: "dictation";
  // EvaluationResult-compatible fields:
  score: number; // == adjustedCharAccuracy
  grammarAccuracy: number; // == adjustedCharAccuracy (no grammar axis; shape compat)
  vocabularyRange: string; // == listeningCefr
  taskAchievement: number; // == wordAccuracy
  feedback: string; // == summary
  errors: EvaluationError[]; // mapped from genuine-error differences
  estimatedCefrEvidence: string; // == listeningCefr
  evaluationSource?: "deterministic" | "llm"; // mirrors EvaluationResult (dictation grading is LLM-sourced)
  // dictation-specific:
  rawCharAccuracy: number;
  adjustedCharAccuracy: number;
  wordAccuracy: number;
  listeningCefr: string;
  headline: string;
  summary: string;
  diff: DictationDiffSegment[];
  differences: DictationDifference[];
  criteria: DictationCriterion[];
};

export function isDictationResult(
  result: EvaluationResult | DictationResult,
): result is DictationResult {
  return (result as { kind?: string }).kind === "dictation";
}

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
  /**
   * The curriculum grammar-point key this error violates, when the evaluator
   * could attribute it to one of the level's in-scope points. Null/absent when
   * none applies. Constrained to the closed key set the route injects.
   */
  grammarPointKey?: string | null;
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
// Canonical vocab surface-form normalization (coverage read model + generation
// seed matching)
// ---------------------------------------------------------------------------

export * from "./vocab-normalize";

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

// ---------------------------------------------------------------------------
// Fluency mode — deterministic grader + locked constants
// ---------------------------------------------------------------------------

export * from "./fluency";

// ---------------------------------------------------------------------------
// Session debrief — banded grammar-point skill movements
// ---------------------------------------------------------------------------

export * from "./skill-movement";

// ---------------------------------------------------------------------------
// Daily goal — target item count from dailyMinutes
// ---------------------------------------------------------------------------

export * from "./daily-goal";
