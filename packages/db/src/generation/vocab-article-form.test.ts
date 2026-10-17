import { describe, expect, it } from "vitest";
import type { Db } from "../client";
import {
  articleFormFor,
  languageHasArticles,
  matchTargetDisplayForm,
  resolveArticleForm,
} from "./vocab-article-form";

function dbReturning(rows: unknown[]): Db {
  return {
    select: () => ({ from: () => ({ where: () => Promise.resolve(rows) }) }),
  } as unknown as Db;
}

describe("articleFormFor", () => {
  it("prefers the curated display form", () => {
    expect(articleFormFor("espalda", "la espalda")).toBe("la espalda");
    expect(articleFormFor("el mano", "la mano")).toBe("la mano");
  });
  it("falls back to an article already on expectedWord", () => {
    expect(articleFormFor("die Küche", null)).toBe("die Küche");
  });
  it("is null for bare forms and indefinite-only forms", () => {
    expect(articleFormFor("correr", "correr")).toBeNull();
    expect(articleFormFor("empatía", null)).toBeNull();
    expect(articleFormFor("ein Hund", null)).toBeNull();
  });
});

describe("matchTargetDisplayForm", () => {
  const targets = [
    { lemma: "espalda", displayForm: "la espalda" },
    { lemma: "Schule", displayForm: "die Schule" },
  ];
  it("matches by lemma or display form, ignoring an article on expectedWord", () => {
    expect(matchTargetDisplayForm(targets, "Espalda")).toBe("la espalda");
    expect(matchTargetDisplayForm(targets, "die Schule")).toBe("die Schule");
    expect(matchTargetDisplayForm(targets, "cabeza")).toBeNull();
  });
});

describe("languageHasArticles", () => {
  it("covers ES and DE only", () => {
    expect(languageHasArticles("ES")).toBe(true);
    expect(languageHasArticles("DE")).toBe(true);
    expect(languageHasArticles("TR")).toBe(false);
  });
});

describe("resolveArticleForm pos gate", () => {
  const run = (lang: string, row: Record<string, unknown>, word: string) =>
    resolveArticleForm(dbReturning([row]), lang, "u", word);
  it("is null for phrase targets that start with an article", async () => {
    expect(
      await run(
        "DE",
        { lemma: "das heißt", displayForm: "das heißt", pos: "phrase" },
        "das heißt",
      ),
    ).toBeNull();
    expect(
      await run(
        "ES",
        {
          lemma: "la verdad es que",
          displayForm: "la verdad es que",
          pos: "phrase",
        },
        "la verdad es que",
      ),
    ).toBeNull();
  });
  it("keeps noun and legacy untagged behaviour", async () => {
    expect(
      await run(
        "ES",
        { lemma: "espalda", displayForm: "la espalda", pos: "noun" },
        "espalda",
      ),
    ).toBe("la espalda");
    expect(
      await run(
        "ES",
        { lemma: "espalda", displayForm: "la espalda", pos: null },
        "espalda",
      ),
    ).toBe("la espalda");
  });
  it("does not fall back to an article on expectedWord for a non-noun match", async () => {
    expect(
      await run(
        "DE",
        { lemma: "laufen", displayForm: "laufen", pos: "verb" },
        "laufen",
      ),
    ).toBeNull();
    expect(
      await run(
        "DE",
        { lemma: "die Küche", displayForm: "kochen", pos: "verb" },
        "die Küche",
      ),
    ).toBeNull();
  });
  it("still falls back to expectedWord when nothing matches", async () => {
    expect(
      await run(
        "DE",
        { lemma: "Schule", displayForm: "die Schule", pos: "noun" },
        "die Küche",
      ),
    ).toBe("die Küche");
  });
});
