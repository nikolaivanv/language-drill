import { describe, it, expect } from "vitest";
import { ExerciseType } from "@language-drill/shared";
import type {
  ClozeContent,
  TranslationContent,
  SentenceConstructionContent,
  ConjugationContent,
  VocabRecallContent,
  ContextualParaphraseContent,
} from "@language-drill/shared";
import { renderLearnerView, classifyVerdicts } from "./qa-sample.js";

describe("renderLearnerView", () => {
  it("cloze: shows sentence + instructions, hides correctAnswer/acceptableAnswers", () => {
    const c: ClozeContent = {
      type: ExerciseType.CLOZE,
      instructions: "Fill the blank.",
      sentence: "Sınıfta sekiz ___ var.",
      correctAnswer: "sandalye",
      acceptableAnswers: ["öğrenci", "kitap"],
      context: "In a classroom.",
    };
    const view = renderLearnerView(c);
    expect(view).toContain("Sınıfta sekiz ___ var.");
    expect(view).toContain("Fill the blank.");
    expect(view).not.toContain("sandalye");
    expect(view).not.toContain("öğrenci");
  });

  it("translation: shows sourceText, hides referenceTranslation/acceptableAnswers", () => {
    const c: TranslationContent = {
      type: ExerciseType.TRANSLATION,
      instructions: "Translate to Turkish.",
      sourceText: "In my opinion, it is late.",
      sourceLanguage: "EN" as TranslationContent["sourceLanguage"],
      targetLanguage: "TR" as TranslationContent["targetLanguage"],
      referenceTranslation: "Bence geç.",
      acceptableAnswers: ["Bana göre geç."],
    };
    const view = renderLearnerView(c);
    expect(view).toContain("In my opinion, it is late.");
    expect(view).not.toContain("Bence");
    expect(view).not.toContain("Bana göre");
  });

  it("sentence_construction: hides modelAnswers", () => {
    const c: SentenceConstructionContent = {
      type: ExerciseType.SENTENCE_CONSTRUCTION,
      instructions: "Write a sentence.",
      promptMode: "keywords",
      prompt: "Use these words in a sentence.",
      keywords: ["gitmek", "okul"],
      modelAnswers: ["Okula gidiyorum.", "Okula gittim."],
    };
    const view = renderLearnerView(c);
    expect(view).toContain("gitmek");
    expect(view).not.toContain("gidiyorum");
    expect(view).not.toContain("gittim");
  });

  it("conjugation: shows lemma + featureBundle, hides targetForm/breakdown/examples", () => {
    const c: ConjugationContent = {
      type: ExerciseType.CONJUGATION,
      instructions: "Write the correct form.",
      lemma: "gitmek",
      lemmaGloss: "to go",
      featureBundle: "geniş zaman · 1. çoğul",
      targetForm: "gideriz",
      breakdown: "git- + -er + -iz",
      exampleSentences: ["Her gün okula gideriz."],
    };
    const view = renderLearnerView(c);
    expect(view).toContain("gitmek");
    expect(view).toContain("geniş zaman · 1. çoğul");
    expect(view).not.toContain("gideriz");
    expect(view).not.toContain("git- + -er");
  });

  it("vocab_recall: shows prompt, hides expectedWord/acceptableAnswers", () => {
    const c: VocabRecallContent = {
      type: ExerciseType.VOCAB_RECALL,
      instructions: "Name the word for this definition.",
      prompt: "A place where trains stop.",
      expectedWord: "istasyon",
      acceptableAnswers: ["gar"],
      hints: ["Starts with i"],
      exampleSentence: "Trenim burada bekliyor.",
    };
    const view = renderLearnerView(c);
    expect(view).toContain("A place where trains stop.");
    expect(view).toContain("Name the word for this definition.");
    expect(view).not.toContain("istasyon");
    expect(view).not.toContain("gar");
  });

  it("contextual_paraphrase: shows sourceText/constraintLabel, hides referenceParaphrases", () => {
    const c: ContextualParaphraseContent = {
      type: ExerciseType.CONTEXTUAL_PARAPHRASE,
      instructions: "Rewrite the sentence.",
      sourceText: "Me gusta mucho el chocolate.",
      constraintKind: "avoid",
      bannedTerms: ["gustar"],
      constraintLabel: "Say this without using «gustar».",
      referenceParaphrases: ["El chocolate me encanta.", "Adoro el chocolate."],
    };
    const view = renderLearnerView(c);
    expect(view).toContain("Me gusta mucho el chocolate.");
    expect(view).toContain("Say this without using «gustar».");
    expect(view).not.toContain("El chocolate me encanta.");
    expect(view).not.toContain("Adoro el chocolate.");
  });
});

describe("classifyVerdicts", () => {
  const HIGH = 0.9; // PASS band
  const LOW = 0.2; // FAIL band
  const MID = 0.6; // dead zone
  const CONF = 0.95;

  it("clean exercise: correct passes, wrong fails, alt passes → no flags", () => {
    expect(classifyVerdicts({ correct: HIGH, wrong: LOW, alt: HIGH }, CONF)).toEqual([]);
  });

  it("false_negative: correct answer lands in FAIL band", () => {
    expect(classifyVerdicts({ correct: LOW, wrong: LOW, alt: HIGH }, CONF)).toEqual(["false_negative"]);
  });

  it("false_positive: wrong answer lands in PASS band", () => {
    expect(classifyVerdicts({ correct: HIGH, wrong: HIGH, alt: HIGH }, CONF)).toEqual(["false_positive"]);
  });

  it("acceptable_answers_gap: alt lands in FAIL band", () => {
    expect(classifyVerdicts({ correct: HIGH, wrong: LOW, alt: LOW }, CONF)).toEqual(["acceptable_answers_gap"]);
  });

  it("dead-zone scores produce no correct/alt flag", () => {
    expect(classifyVerdicts({ correct: MID, wrong: LOW, alt: MID }, CONF)).toEqual([]);
  });

  it("null alt is skipped (no acceptable_answers_gap possible)", () => {
    expect(classifyVerdicts({ correct: HIGH, wrong: LOW, alt: null }, CONF)).toEqual([]);
  });

  it("confidence gate: low confidence suppresses false_negative + aA_gap, emits low_confidence_solve, keeps false_positive", () => {
    const flags = classifyVerdicts({ correct: LOW, wrong: HIGH, alt: LOW }, 0.5);
    expect(flags).toContain("low_confidence_solve");
    expect(flags).toContain("false_positive");
    expect(flags).not.toContain("false_negative");
    expect(flags).not.toContain("acceptable_answers_gap");
  });

  it("boundary: exactly 0.8 passes and exactly 0.4 fails → clean case, no flags", () => {
    // correct=0.8 is PASS (>=0.8); wrong=0.4 is FAIL (<=0.4) → the intended outcome.
    expect(classifyVerdicts({ correct: 0.8, wrong: 0.4, alt: null }, CONF)).toEqual([]);
  });

  it("boundary: correct=0.4 fails, wrong=0.8 passes → both defect flags in emission order", () => {
    // Emission order is stable: false_negative before false_positive.
    expect(classifyVerdicts({ correct: 0.4, wrong: 0.8, alt: null }, CONF)).toEqual([
      "false_negative",
      "false_positive",
    ]);
  });
});
