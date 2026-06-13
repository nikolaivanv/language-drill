import { describe, it, expect } from "vitest";
import {
  Language,
  CefrLevel,
  ExerciseType,
  isClozeContent,
  isTranslationContent,
  isVocabRecallContent,
  isSentenceConstructionContent,
  isFreeWritingContent,
} from "./index";
import type {
  ApiError,
  ClozeContent,
  TranslationContent,
  VocabRecallContent,
  ExerciseContent,
  Exercise,
  EvaluationError,
  EvaluationResult,
  SentenceConstructionContent,
  FreeWritingContent,
} from "./index";

describe("Language enum", () => {
  it("has exactly 4 values", () => {
    const values = Object.values(Language);
    expect(values).toHaveLength(4);
  });

  it("contains EN, ES, DE, TR", () => {
    expect(Language.EN).toBe("EN");
    expect(Language.ES).toBe("ES");
    expect(Language.DE).toBe("DE");
    expect(Language.TR).toBe("TR");
  });
});

describe("CefrLevel enum", () => {
  it("has exactly 6 values", () => {
    const values = Object.values(CefrLevel);
    expect(values).toHaveLength(6);
  });

  it("contains A1, A2, B1, B2, C1, C2", () => {
    expect(CefrLevel.A1).toBe("A1");
    expect(CefrLevel.A2).toBe("A2");
    expect(CefrLevel.B1).toBe("B1");
    expect(CefrLevel.B2).toBe("B2");
    expect(CefrLevel.C1).toBe("C1");
    expect(CefrLevel.C2).toBe("C2");
  });
});

describe("ApiError type", () => {
  it("shape matches expected structure", () => {
    const err: ApiError = {
      error: "Not Found",
      code: "NOT_FOUND",
      status: 404,
    };

    expect(err.error).toBe("Not Found");
    expect(err.code).toBe("NOT_FOUND");
    expect(err.status).toBe(404);
    expect(typeof err.error).toBe("string");
    expect(typeof err.code).toBe("string");
    expect(typeof err.status).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// Exercise types
// ---------------------------------------------------------------------------

describe("ExerciseType enum", () => {
  it("has exactly 5 values", () => {
    const values = Object.values(ExerciseType);
    expect(values).toHaveLength(5);
  });

  it("contains CLOZE, TRANSLATION, VOCAB_RECALL, SENTENCE_CONSTRUCTION, FREE_WRITING", () => {
    expect(ExerciseType.CLOZE).toBe("cloze");
    expect(ExerciseType.TRANSLATION).toBe("translation");
    expect(ExerciseType.VOCAB_RECALL).toBe("vocab_recall");
    expect(ExerciseType.SENTENCE_CONSTRUCTION).toBe("sentence_construction");
    expect(ExerciseType.FREE_WRITING).toBe("free_writing");
  });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const clozeContent: ClozeContent = {
  type: ExerciseType.CLOZE,
  instructions: "Fill in the blank.",
  sentence: "She ___ to the store yesterday.",
  correctAnswer: "went",
  options: ["went", "go", "gone"],
  context: "Past tense of 'go'",
};

const translationContent: TranslationContent = {
  type: ExerciseType.TRANSLATION,
  instructions: "Translate the following sentence.",
  sourceText: "The cat is on the table.",
  sourceLanguage: Language.EN,
  targetLanguage: Language.ES,
  referenceTranslation: "El gato esta en la mesa.",
};

const vocabRecallContent: VocabRecallContent = {
  type: ExerciseType.VOCAB_RECALL,
  instructions: "What is the word?",
  prompt: "A place where you borrow books",
  expectedWord: "library",
  hints: ["starts with L", "has 7 letters"],
  exampleSentence: "I returned my books to the library.",
};

const sentenceConstructionContent: SentenceConstructionContent = {
  type: ExerciseType.SENTENCE_CONSTRUCTION,
  instructions: "Write one sentence in Spanish.",
  promptMode: "grammar_target",
  prompt: "Write a sentence using the present subjunctive to express a wish.",
  targetStructure: "present subjunctive",
  modelAnswers: ["Espero que tengas un buen día.", "Ojalá llueva mañana."],
};

// ---------------------------------------------------------------------------
// Type guard tests
// ---------------------------------------------------------------------------

describe("isClozeContent", () => {
  it("returns true for cloze content", () => {
    expect(isClozeContent(clozeContent)).toBe(true);
  });

  it("returns false for translation content", () => {
    expect(isClozeContent(translationContent)).toBe(false);
  });

  it("returns false for vocab_recall content", () => {
    expect(isClozeContent(vocabRecallContent)).toBe(false);
  });

  it("returns false for sentence-construction content", () => {
    expect(isClozeContent(sentenceConstructionContent)).toBe(false);
  });
});

describe("isTranslationContent", () => {
  it("returns true for translation content", () => {
    expect(isTranslationContent(translationContent)).toBe(true);
  });

  it("returns false for cloze content", () => {
    expect(isTranslationContent(clozeContent)).toBe(false);
  });

  it("returns false for vocab_recall content", () => {
    expect(isTranslationContent(vocabRecallContent)).toBe(false);
  });
});

describe("isVocabRecallContent", () => {
  it("returns true for vocab_recall content", () => {
    expect(isVocabRecallContent(vocabRecallContent)).toBe(true);
  });

  it("returns false for cloze content", () => {
    expect(isVocabRecallContent(clozeContent)).toBe(false);
  });

  it("returns false for translation content", () => {
    expect(isVocabRecallContent(translationContent)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Exercise type shape
// ---------------------------------------------------------------------------

describe("Exercise type", () => {
  it("shape matches expected structure", () => {
    const exercise: Exercise = {
      id: "ex-001",
      type: ExerciseType.CLOZE,
      language: Language.EN,
      difficulty: CefrLevel.B1,
      content: clozeContent,
    };

    expect(exercise.id).toBe("ex-001");
    expect(exercise.type).toBe(ExerciseType.CLOZE);
    expect(exercise.language).toBe(Language.EN);
    expect(exercise.difficulty).toBe(CefrLevel.B1);
    expect(exercise.content.type).toBe(ExerciseType.CLOZE);
  });
});

// ---------------------------------------------------------------------------
// ClozeContent with optional fields omitted
// ---------------------------------------------------------------------------

describe("ClozeContent optional fields", () => {
  it("works without options and context", () => {
    const minimal: ClozeContent = {
      type: ExerciseType.CLOZE,
      instructions: "Fill in the blank.",
      sentence: "I ___ happy.",
      correctAnswer: "am",
    };

    expect(isClozeContent(minimal)).toBe(true);
    expect(minimal.options).toBeUndefined();
    expect(minimal.context).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Evaluation types
// ---------------------------------------------------------------------------

describe("EvaluationResult type", () => {
  it("shape matches expected structure", () => {
    const evalError: EvaluationError = {
      type: "grammar",
      severity: "major",
      text: "She go to school",
      correction: "She goes to school",
      explanation: "Third person singular requires -s ending.",
    };

    const result: EvaluationResult = {
      score: 0.7,
      grammarAccuracy: 0.65,
      vocabularyRange: "B1",
      taskAchievement: 0.8,
      feedback: "Good attempt with minor grammar errors.",
      errors: [evalError],
      estimatedCefrEvidence: "B1",
    };

    expect(result.score).toBe(0.7);
    expect(result.grammarAccuracy).toBe(0.65);
    expect(result.vocabularyRange).toBe("B1");
    expect(result.taskAchievement).toBe(0.8);
    expect(result.feedback).toBe("Good attempt with minor grammar errors.");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].type).toBe("grammar");
    expect(result.errors[0].severity).toBe("major");
    expect(result.estimatedCefrEvidence).toBe("B1");
  });

  it("works with empty errors array", () => {
    const result: EvaluationResult = {
      score: 1.0,
      grammarAccuracy: 1.0,
      vocabularyRange: "C1",
      taskAchievement: 1.0,
      feedback: "Perfect!",
      errors: [],
      estimatedCefrEvidence: "C1",
    };

    expect(result.errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Discriminated union exhaustiveness
// ---------------------------------------------------------------------------

describe("ExerciseContent discriminated union", () => {
  it("can be narrowed via switch on type field", () => {
    const contents: ExerciseContent[] = [
      clozeContent,
      translationContent,
      vocabRecallContent,
      sentenceConstructionContent,
    ];
    const types: string[] = [];

    for (const content of contents) {
      switch (content.type) {
        case ExerciseType.CLOZE:
          types.push("cloze");
          break;
        case ExerciseType.TRANSLATION:
          types.push("translation");
          break;
        case ExerciseType.VOCAB_RECALL:
          types.push("vocab_recall");
          break;
        case ExerciseType.SENTENCE_CONSTRUCTION:
          types.push("sentence_construction");
          break;
      }
    }

    expect(types).toEqual(["cloze", "translation", "vocab_recall", "sentence_construction"]);
  });
});

// ---------------------------------------------------------------------------
// isSentenceConstructionContent type guard
// ---------------------------------------------------------------------------

describe("isSentenceConstructionContent", () => {
  it("returns true for sentence-construction content", () => {
    expect(isSentenceConstructionContent(sentenceConstructionContent)).toBe(true);
  });

  it("returns false for cloze content", () => {
    expect(isSentenceConstructionContent(clozeContent)).toBe(false);
  });

  it("returns false for vocab_recall content", () => {
    expect(isSentenceConstructionContent(vocabRecallContent)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isFreeWritingContent type guard
// ---------------------------------------------------------------------------

describe("isFreeWritingContent", () => {
  const content: FreeWritingContent = {
    type: ExerciseType.FREE_WRITING,
    instructions: "Write a paragraph.",
    title: "El teletrabajo",
    task: "Argue for or against remote work.",
    domain: "opinión · argumentación",
    register: "formal",
    minWords: 150,
    maxWords: 200,
    suggestedMinutes: 20,
    requiredElements: [{ id: "cond", label: "Use two conditionals" }],
  };

  it("returns true for free_writing content", () => {
    expect(isFreeWritingContent(content)).toBe(true);
  });

  it("returns false for another type", () => {
    const cloze = { type: ExerciseType.CLOZE } as unknown as ExerciseContent;
    expect(isFreeWritingContent(cloze)).toBe(false);
  });
});
