import { describe, expect, it } from "vitest";

import { ExerciseType, type ClozeContent } from "@language-drill/shared";

import { checkClozeOverlap } from "./cloze-overlap.js";

function cloze(sentence: string, correctAnswer: string): ClozeContent {
  return {
    type: ExerciseType.CLOZE,
    instructions: "Fill in the blank.",
    sentence,
    correctAnswer,
  };
}

describe("checkClozeOverlap", () => {
  describe("certain overlap (multi-token answer) → reject tier", () => {
    // Every case below is a real prod row demoted on 2026-08-08.
    it.each([
      [
        "ES B1 nominalizers — contracted del left in the stem",
        "No me gusta este abrigo; prefiero ___ del escaparate.",
        "el del",
        "del",
      ],
      [
        "ES B1 nominalizers — plural variant",
        "Estos zapatos me gustan, pero ___ del escaparate son más bonitos.",
        "los del",
        "del",
      ],
      [
        "DE A1 accusative — noun restated",
        "Ich habe ___ Bruder.",
        "einen Bruder",
        "Bruder.",
      ],
      [
        "DE A2 two-way prepositions — noun restated ahead of the lemma cue",
        "Die Kinder laufen ___ Park. (der Park)",
        "in den Park",
        // Raw stem token, punctuation included — it is quoted verbatim in the
        // reason detail an operator reads.
        "Park.",
      ],
      [
        "DE B1 genitive — inflected noun restated",
        "Wegen ___ Regens konnten wir nicht draußen spielen. (der Regen)",
        "des Regens",
        "Regens",
      ],
      [
        "ES A2 personal a — proper noun restated",
        "Hoy no he visto ___ Tomás en clase.",
        "a Tomás",
        "Tomás",
      ],
      [
        "ES A2 reflexive verbs — verb restated",
        "El entrenador ___ ducha después de cada partido.",
        "se ducha",
        "ducha",
      ],
    ])("%s", (_name, sentence, answer, token) => {
      expect(checkClozeOverlap(cloze(sentence, answer))).toMatchObject({
        kind: "answer-stem-overlap",
        confidence: "certain",
        side: "after",
        token,
      });
    });

    it("reports the broken substitution as evidence", () => {
      const verdict = checkClozeOverlap(
        cloze("No me gusta este abrigo; prefiero ___ del escaparate.", "el del"),
      );
      expect(verdict).toMatchObject({
        substituted: "No me gusta este abrigo; prefiero el del del escaparate.",
      });
    });

    it("compares case-insensitively and ignores punctuation glued to the stem word", () => {
      expect(
        checkClozeOverlap(cloze("Sie fragte: ___ Buch, bitte.", "das Buch")),
      ).toMatchObject({ kind: "answer-stem-overlap", token: "Buch," });
    });

    it("catches an overlap on the token BEFORE the blank", () => {
      expect(
        checkClozeOverlap(
          cloze("Hep bu şehirde yaşıyorum — küçüklüğümden ___ buradayım.", "küçüklüğümden beri"),
        ),
      ).toMatchObject({
        kind: "answer-stem-overlap",
        confidence: "certain",
        side: "before",
        token: "küçüklüğümden",
      });
    });
  });

  describe("suspected overlap (single-token answer) → flag tier", () => {
    it.each([
      [
        "DE A1 zero article — noun restated",
        "Mein Vater ist ___ Arzt.",
        "Arzt",
      ],
      [
        "ES A2 article use — profession restated",
        "Mi hermano trabaja mucho; es ___ enfermero en un hospital grande.",
        "enfermero",
      ],
    ])("%s", (_name, sentence, answer) => {
      expect(checkClozeOverlap(cloze(sentence, answer))).toMatchObject({
        kind: "answer-stem-overlap",
        confidence: "suspected",
      });
    });

    it("tiers TR reduplication as suspected, not certain, so it is only flagged", () => {
      // "ikişer ikişer oturdu" is valid Turkish distributive reduplication —
      // the tier exists so a real construction is never hard-rejected.
      expect(
        checkClozeOverlap(
          cloze("Öğrenciler sıraya geçti; ___ ikişer oturdu.", "ikişer"),
        ),
      ).toMatchObject({ confidence: "suspected" });
    });
  });

  describe("no overlap", () => {
    it.each([
      ["clean cloze", "Ich habe ___ Hund.", "einen"],
      [
        "clean nominalizer — answer stops before the stem's preposition",
        "Mi batería está casi vacía; voy a usar ___ Ana.",
        "la de",
      ],
      [
        "word repeated elsewhere in the sentence, not adjacent to the blank",
        "Ich habe ___ Hund. Der Hund ist sehr süß.",
        "einen",
      ],
      ["blank at the end of the sentence", "Mein Vater ist ___", "Arzt"],
      ["blank at the start of the sentence", "___ Apfel ist rot.", "Der"],
    ])("%s", (_name, sentence, answer) => {
      expect(checkClozeOverlap(cloze(sentence, answer))).toEqual({ kind: "ok" });
    });

    it("ignores a parenthetical lemma cue directly after the blank", () => {
      // "(portakal)" is scaffolding, not sentence text — "birkaç portakal var"
      // is the correct, non-duplicating reading.
      expect(
        checkClozeOverlap(
          cloze("Masanın üzerinde iki elma ve birkaç ___ (portakal) var.", "portakal"),
        ),
      ).toEqual({ kind: "ok" });
    });

  });

  describe("total function", () => {
    it.each([
      ["no blank marker", "Ich habe einen Hund.", "einen"],
      ["empty answer", "Ich habe ___ Hund.", "   "],
    ])("%s → not-applicable", (_name, sentence, answer) => {
      expect(checkClozeOverlap(cloze(sentence, answer))).toEqual({
        kind: "not-applicable",
      });
    });

    it("never throws on a malformed content object", () => {
      const malformed = { type: ExerciseType.CLOZE } as unknown as ClozeContent;
      expect(() => checkClozeOverlap(malformed)).not.toThrow();
      expect(checkClozeOverlap(malformed)).toEqual({ kind: "not-applicable" });
    });
  });
});

describe("clause boundary before the blank", () => {
  // Found 2026-08-13 by the first `revalidate:cloze --deterministic-only` sweep
  // of prod: 6 of the 7 auto-approved rows it wanted to flag were German
  // Konjunktiv II conditionals, where the repetition spans a comma and the
  // substituted sentence is perfectly grammatical. Punctuation between the two
  // words means they sit in different clauses, so the repetition is not a
  // duplication — whatever the answer's token count.
  it.each([
    [
      "DE B1 Konjunktiv II — main-clause verb after the subordinate clause",
      "Wenn ich mehr Zeit gehabt hätte, ___ ich einen besseren Plan entworfen.",
      "hätte",
    ],
    [
      "DE B1 Konjunktiv II — plural",
      "Wenn die Kinder früher ins Bett gegangen wären, ___ sie heute Morgen nicht so müde gewesen.",
      "wären",
    ],
    [
      "DE B1 Konjunktiv II — 2nd person",
      "Wenn du mehr Gemüse gegessen hättest, ___ du dich bestimmt besser gefühlt.",
      "hättest",
    ],
  ])("%s", (_label, sentence, answer) => {
    expect(checkClozeOverlap(cloze(sentence, answer))).toEqual({ kind: "ok" });
  });

  it("suppresses the certain tier too — a multi-token answer across a comma is still two clauses", () => {
    expect(
      checkClozeOverlap(
        cloze("Wenn ich Zeit gehabt hätte, ___ einen Plan entworfen.", "hätte ich"),
      ),
    ).toEqual({ kind: "ok" });
  });

  it("suppresses across a sentence boundary as well", () => {
    // The blank opens a NEW sentence, so restating the previous sentence's last
    // word is ordinary German. (Had the duplicate sat *after* the blank it would
    // be the real defect — see the regression case below.)
    expect(
      checkClozeOverlap(cloze("Ich habe einen Hund. ___ ist sehr süß.", "Hund")),
    ).toEqual({ kind: "ok" });
  });

  it("still catches a genuine repetition with no boundary between the words", () => {
    // TR A1, the one true positive in that same prod sweep.
    const verdict = checkClozeOverlap(
      cloze("Her gün evden çıkıp markete ___ yürüyorum. (market)", "markete"),
    );
    expect(verdict).toMatchObject({
      kind: "answer-stem-overlap",
      confidence: "suspected",
      side: "before",
    });
  });

  it("does not suppress an overlap AFTER the blank when the stem word carries a period", () => {
    // Regression guard: "einen Bruder" / "Bruder." is the original defect class
    // — the period trails the duplicated word, it does not separate the two.
    expect(
      checkClozeOverlap(cloze("Ich habe ___ Bruder.", "einen Bruder")),
    ).toMatchObject({ kind: "answer-stem-overlap", side: "after" });
  });
});
