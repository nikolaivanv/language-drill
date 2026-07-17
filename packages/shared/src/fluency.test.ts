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
  it("accepts any acceptableAnswers entry (near-synonym headwords)", () => {
    const c = vocab({ expectedWord: "istasyon", acceptableAnswers: ["gar"] });
    expect(gradeFluencyAnswer(c, "gar")).toBe(true);
    expect(gradeFluencyAnswer(c, "istasyon")).toBe(true);
    expect(gradeFluencyAnswer(c, "durak")).toBe(false);
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
  it("accepts Turkish mobile auto-capitalization: İ (TR keyboard) and I (EN keyboard) for a target starting with i", () => {
    const c = conj({
      lemma: "istemek",
      lemmaGloss: "to want",
      featureBundle: "şimdiki zaman · 1. tekil",
      targetForm: "istiyorum",
      breakdown: "iste- + -iyor + -um",
      exampleSentences: ["Su istiyorum."],
    });
    // Turkish keyboard capitalizes i → İ (dotted capital)
    expect(gradeFluencyAnswer(c, "İstiyorum")).toBe(true);
    // Non-Turkish keyboard capitalizes i → I (dotless capital)
    expect(gradeFluencyAnswer(c, "Istiyorum")).toBe(true);
  });
  it("accepts Turkish mobile auto-capitalization: I for a target starting with ı", () => {
    const c = conj({
      lemma: "ısınmak",
      lemmaGloss: "to warm up",
      featureBundle: "şimdiki zaman · 3. tekil",
      targetForm: "ısınıyor",
      breakdown: "ısın- + -ıyor",
      exampleSentences: ["Hava ısınıyor."],
    });
    // Turkish keyboard capitalizes ı → I
    expect(gradeFluencyAnswer(c, "Isınıyor")).toBe(true);
  });
  it("ignores trailing sentence punctuation (mobile keyboards auto-insert a period)", () => {
    const c = conj({
      lemma: "kalmak",
      lemmaGloss: "to stay",
      featureBundle: "şimdiki zaman · 2. çoğul şahıs",
      targetForm: "kalıyorsunuz",
      breakdown: "kal- + -ıyor + -sunuz",
      exampleSentences: ["Siz otelde mi kalıyorsunuz?"],
    });
    expect(gradeFluencyAnswer(c, "Kalıyorsunuz.")).toBe(true); // iOS double-space period
    expect(gradeFluencyAnswer(c, "kalıyorsunuz!")).toBe(true);
    expect(gradeFluencyAnswer(c, "kalıyorsunuz?")).toBe(true);
    // punctuation forgiveness must not forgive a wrong form
    expect(gradeFluencyAnswer(c, "kalıyorsun.")).toBe(false);
  });
  it("still rejects a genuinely wrong i/ı vowel (no false accepts from case folding)", () => {
    expect(gradeFluencyAnswer(conj({ targetForm: "istiyorum" }), "ıstiyorum")).toBe(false);
    expect(gradeFluencyAnswer(conj({ targetForm: "ısınıyor" }), "isiniyor")).toBe(false);
  });
  it("grades a stacked Turkish nominal form (possessive + ablative)", () => {
    const c = conj({
      lemma: "ev",
      lemmaGloss: "house",
      featureBundle: "1. çoğul iyelik · çıkma · çoğul",
      targetForm: "evlerimizden",
      breakdown: "ev + -ler + -imiz + -den",
      exampleSentences: ["Evlerimizden çıktık."],
    });
    expect(gradeFluencyAnswer(c, "Evlerimizden")).toBe(true);
    expect(gradeFluencyAnswer(c, "evlerimizdan")).toBe(false); // wrong harmony: -dan vs -den
  });
  it("grades a multi-word German NP target (DE nominal declension)", () => {
    // German marks case on the article/adjective, so the stored target is a
    // full NP — grading must survive whitespace, case folding, and umlauts.
    const c = conj({
      lemma: "Tisch",
      lemmaGloss: "table",
      featureBundle: "Akkusativ · Singular · Maskulinum · unbestimmter Artikel",
      targetForm: "einen neuen Tisch",
      breakdown: "ein → einen (Akk. mask.) + neu → neuen (-en nach ein-) + Tisch",
      exampleSentences: ["Ich kaufe einen neuen Tisch."],
    });
    expect(gradeFluencyAnswer(c, "einen neuen Tisch")).toBe(true);
    expect(gradeFluencyAnswer(c, "  Einen   neuen   tisch. ")).toBe(true); // whitespace + case fold + trailing period
    expect(gradeFluencyAnswer(c, "ein neuer Tisch")).toBe(false); // nominative — wrong case
    expect(gradeFluencyAnswer(c, "einen neuen Tische")).toBe(false); // spurious -e on the noun
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
