import { describe, it, expect } from "vitest";
import { ExerciseType, type ClozeContent, type VocabRecallContent, type ConjugationContent } from "./index";
import {
  gradeFluencyAnswer,
  normalizeFluencyAnswer,
  isFluencyEligibleType,
  FLUENCY_MASTERY_THRESHOLD,
  MIN_FLUENCY_POOL,
  LATENCY_CEILING_MS,
  DEFAULT_FLUENCY_SESSION_SIZE,
  FLUENCY_ELIGIBLE_TYPES,
} from "./fluency";

const cloze = (over: Partial<ClozeContent> = {}): ClozeContent => ({
  type: ExerciseType.CLOZE,
  instructions: "fill the blank",
  sentence: "El gato ___ en la casa.",
  correctAnswer: "está",
  ...over,
});

const vocab = (over: Partial<VocabRecallContent> = {}): VocabRecallContent => ({
  type: ExerciseType.VOCAB_RECALL,
  instructions: "recall the word",
  prompt: "the opposite of big",
  expectedWord: "pequeño",
  hints: [],
  exampleSentence: "El perro es pequeño.",
  ...over,
});

describe("normalizeFluencyAnswer", () => {
  it("trims, collapses whitespace, lowercases — but preserves diacritics", () => {
    expect(normalizeFluencyAnswer("  Está  ")).toBe("está");
    expect(normalizeFluencyAnswer("el   gato")).toBe("el gato");
    // diacritics are meaningful in ES/DE/TR and must NOT be stripped
    expect(normalizeFluencyAnswer("está")).not.toBe(normalizeFluencyAnswer("esta"));
  });
});

describe("gradeFluencyAnswer — cloze", () => {
  it("accepts the correct answer case/space-insensitively", () => {
    expect(gradeFluencyAnswer(cloze(), "  EstÁ ")).toBe(true);
  });
  it("accepts any acceptableAnswers entry", () => {
    expect(gradeFluencyAnswer(cloze({ acceptableAnswers: ["se encuentra"] }), "se encuentra")).toBe(true);
  });
  it("rejects a wrong answer", () => {
    expect(gradeFluencyAnswer(cloze(), "estar")).toBe(false);
  });
});

describe("gradeFluencyAnswer — vocab", () => {
  it("accepts the expected word, rejects others", () => {
    expect(gradeFluencyAnswer(vocab(), "Pequeño")).toBe(true);
    expect(gradeFluencyAnswer(vocab(), "grande")).toBe(false);
  });
});

describe("gradeFluencyAnswer — unsupported type", () => {
  it("throws for non-eligible content", () => {
    expect(() =>
      gradeFluencyAnswer(
        { type: ExerciseType.TRANSLATION } as never,
        "x",
      ),
    ).toThrow('unsupported content type "translation"');
  });
});

const conj = (over: Partial<ConjugationContent> = {}): ConjugationContent => ({
  type: ExerciseType.CONJUGATION,
  instructions: "Write the correct form.",
  lemma: "ir",
  lemmaGloss: "to go",
  featureBundle: "condicional · 1ª pers. plural",
  targetForm: "iríamos",
  breakdown: "ir- + -íamos",
  exampleSentences: ["Iríamos al cine si tuviéramos tiempo."],
  ...over,
});

describe("conjugation fluency grading", () => {
  it("is fluency-eligible", () => {
    expect(isFluencyEligibleType(ExerciseType.CONJUGATION)).toBe(true);
  });
  it("accepts the exact target form (case/space-insensitive)", () => {
    expect(gradeFluencyAnswer(conj(), "  Iríamos ")).toBe(true);
  });
  it("accepts a listed variant", () => {
    expect(
      gradeFluencyAnswer(conj({ acceptableForms: ["nos iríamos"] }), "nos iríamos"),
    ).toBe(true);
  });
  it("rejects a wrong diacritic (diacritics are meaningful)", () => {
    expect(gradeFluencyAnswer(conj(), "iriamos")).toBe(false);
  });
  it("rejects a wrong form", () => {
    expect(gradeFluencyAnswer(conj(), "iremos")).toBe(false);
  });
});

describe("eligibility helpers + constants", () => {
  it("recognises the eligible types", () => {
    expect(isFluencyEligibleType(ExerciseType.CLOZE)).toBe(true);
    expect(isFluencyEligibleType(ExerciseType.VOCAB_RECALL)).toBe(true);
    expect(isFluencyEligibleType(ExerciseType.CONJUGATION)).toBe(true);
    expect(isFluencyEligibleType(ExerciseType.TRANSLATION)).toBe(false);
    expect(isFluencyEligibleType(ExerciseType.SENTENCE_CONSTRUCTION)).toBe(false);
  });
  it("exposes the locked constants", () => {
    expect(FLUENCY_MASTERY_THRESHOLD).toBe(0.8);
    expect(MIN_FLUENCY_POOL).toBe(4);
    expect(LATENCY_CEILING_MS).toBe(60_000);
    expect(DEFAULT_FLUENCY_SESSION_SIZE).toBe(8);
    expect(FLUENCY_ELIGIBLE_TYPES).toEqual([ExerciseType.CLOZE, ExerciseType.VOCAB_RECALL, ExerciseType.CONJUGATION]);
  });
});
