import { describe, it, expect } from "vitest";
import { ExerciseType } from "@language-drill/shared";
import type {
  ClozeContent,
  TranslationContent,
  SentenceConstructionContent,
  ConjugationContent,
} from "@language-drill/shared";
import { renderLearnerView } from "./qa-sample.js";

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
});
