import { describe, expect, it } from "vitest";

import { checkMixedScript } from "./mixed-script.js";

describe("checkMixedScript", () => {
  // Real prod rows found on 2026-11-11.
  it("flags a visible Cyrillic letter in a translation reference", () => {
    const v = checkMixedScript({
      type: "translation",
      referenceTranslation: "Senin şemsiyен çantanda mı?",
      acceptableAnswers: ["Şemsiyен çantanda mı?"],
    });
    expect(v).toEqual({
      kind: "mixed-script",
      hits: ["referenceTranslation: şemsiyен", "acceptableAnswers[0]: Şemsiyен"],
    });
  });

  it("flags an invisible homoglyph (Cyrillic е) in a cloze answer", () => {
    const v = checkMixedScript({ correctAnswer: "sepеtle", sentence: "Adam ___ satıyor." });
    expect(v).toEqual({ kind: "mixed-script", hits: ["correctAnswer: sepеtle"] });
  });

  it("flags a stray Han character", () => {
    const v = checkMixedScript({ task: "sopesando las dos posiciones y终 defendiendo" });
    expect(v.kind).toBe("mixed-script");
  });

  it("descends into nested objects with a dotted path", () => {
    const v = checkMixedScript({ subject: { pronoun: "sеn" } });
    expect(v).toEqual({ kind: "mixed-script", hits: ["subject.pronoun: sеn"] });
  });

  it("accepts Latin with every TR/ES/DE diacritic", () => {
    expect(
      checkMixedScript({
        a: "Çocuklar gösteriden çok heyecanlandı; ığüşöç İĞÜŞÖÇ",
        b: "¿Por qué no? ñ á é í ó ú ü",
        c: "Straße, Bekannter, Kürbisse",
      }),
    ).toEqual({ kind: "ok" });
  });

  it("accepts Greek, which conjugation breakdowns use for IPA", () => {
    expect(checkMixedScript({ breakdown: "z → c before -é, to preserve /θ/ sound" })).toEqual({
      kind: "ok",
    });
  });

  it("skips writer-only underscore keys", () => {
    expect(checkMixedScript({ _dedupKey: "şemsiyен", sentence: "ok" })).toEqual({ kind: "ok" });
  });

  it("caps the number of reported hits", () => {
    const v = checkMixedScript({ s: "ан ен он ун ин рн тн" });
    expect(v.kind === "mixed-script" && v.hits.length).toBe(5);
  });

  it("is total on non-object input", () => {
    expect(checkMixedScript(null)).toEqual({ kind: "ok" });
    expect(checkMixedScript(42)).toEqual({ kind: "ok" });
  });
});
