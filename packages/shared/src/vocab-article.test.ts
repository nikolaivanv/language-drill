import { describe, expect, it } from "vitest";
import { ExerciseType, type VocabRecallContent } from "./index";
import { gradeFluencyAnswer } from "./fluency";
import { articleChoicesLabel, bareVocabWord, gradeVocabArticle, splitArticle } from "./vocab-article";

const espalda = { expectedWord: "espalda", articleForm: "la espalda" };
const mano = { expectedWord: "la mano", articleForm: "la mano" };
const schule = { expectedWord: "Schule", articleForm: "die Schule" };

describe("splitArticle / bareVocabWord", () => {
  it("splits a leading article", () => {
    expect(splitArticle("La espalda")).toEqual({ article: "la", word: "espalda" });
    expect(bareVocabWord("der jüngere Bruder")).toBe("jüngere Bruder");
  });
  it("leaves single tokens and non-article starts alone", () => {
    expect(splitArticle("la")).toEqual({ article: null, word: "la" });
    expect(bareVocabWord("sich bewerben")).toBe("sich bewerben");
  });
});

describe("gradeVocabArticle", () => {
  it("accepts the word with its article (case-insensitive)", () => {
    expect(gradeVocabArticle(espalda, "la espalda")).toBe("exact");
    expect(gradeVocabArticle(schule, "Die schule.")).toBe("exact");
    expect(gradeVocabArticle(mano, "la mano")).toBe("exact");
  });
  it("flags a bare noun as missing its article", () => {
    expect(gradeVocabArticle(espalda, "espalda")).toBe("missing-article");
    expect(gradeVocabArticle(mano, "mano")).toBe("missing-article");
  });
  it("flags a wrong-gender article", () => {
    expect(gradeVocabArticle(mano, "el mano")).toBe("wrong-article");
    expect(gradeVocabArticle(schule, "das Schule")).toBe("wrong-article");
  });
  it("accepts a right-gender indefinite article", () => {
    expect(gradeVocabArticle(espalda, "una espalda")).toBe("exact");
    expect(gradeVocabArticle(schule, "eine Schule")).toBe("exact");
    expect(gradeVocabArticle(schule, "ein Schule")).toBe("wrong-article");
  });
  it("uses a synonym's own article", () => {
    const coche = { expectedWord: "coche", articleForm: "el coche", acceptableAnswers: ["la carro"] };
    expect(gradeVocabArticle(coche, "la carro")).toBe("exact");
    expect(gradeVocabArticle(coche, "el carro")).toBe("wrong-article");
  });
  it("returns no-match for a different word or a row without articleForm", () => {
    expect(gradeVocabArticle(espalda, "la cabeza")).toBe("no-match");
    expect(gradeVocabArticle({ expectedWord: "correr" }, "correr")).toBe("no-match");
  });
});

describe("gradeFluencyAnswer applies the article rule", () => {
  const content: VocabRecallContent = {
    type: ExerciseType.VOCAB_RECALL,
    instructions: "",
    prompt: "",
    hints: [],
    exampleSentence: "",
    ...espalda,
  };
  it("requires the article when articleForm is set", () => {
    expect(gradeFluencyAnswer(content, "la espalda")).toBe(true);
    expect(gradeFluencyAnswer(content, "espalda")).toBe(false);
  });
  it("keeps plain matching without articleForm", () => {
    expect(gradeFluencyAnswer({ ...content, articleForm: undefined }, "espalda")).toBe(true);
  });
});

describe("articleChoicesLabel", () => {
  it("names the article set per language and number", () => {
    expect(articleChoicesLabel("la espalda")).toBe("el/la");
    expect(articleChoicesLabel("las gafas")).toBe("los/las");
    expect(articleChoicesLabel("das Haus")).toBe("der/die/das");
    expect(articleChoicesLabel("correr")).toBeNull();
  });
});
