import { describe, expect, it } from "vitest";
import { type ClozeContent, ExerciseType, Language } from "@language-drill/shared";

import { checkLexemeHint } from "./lexeme-hint.js";

/** Every fixture below is a real row from the prod `es-b1-imperative-negative-pronouns` cell. */
function cloze(sentence: string, correctAnswer = "x"): ClozeContent {
  return {
    type: ExerciseType.CLOZE,
    instructions: "Fill in the blank.",
    sentence,
    correctAnswer,
  };
}

describe("checkLexemeHint", () => {
  describe("missing hint — the defect class", () => {
    it("flags the learner-reported row (instrument phrase is not a hint)", () => {
      // Scored 0.90 by the LLM validator and survived the #730 repass: the judge
      // read "con la mano sucia, usa una servilleta" as entailing `tocar`.
      const c = cloze(
        "Tienes una mancha en la mejilla. ___ con la mano sucia, usa una servilleta.",
        "No te la toques",
      );
      expect(checkLexemeHint(c, Language.ES)).toEqual({ kind: "missing-hint" });
    });

    it("flags the original reported row", () => {
      const c = cloze(
        "Tienes razón, ese problema es importante. ___ ahora, espera hasta mañana.",
        "No lo comentes",
      );
      expect(checkLexemeHint(c, Language.ES)).toEqual({ kind: "missing-hint" });
    });

    it("flags a well-anchored row too — the gate does not judge entailment", () => {
      // `espera a las rebajas` genuinely forces `comprar`, so this row is good.
      // The gate still flags it: for a point where the lexeme is NEVER the
      // target, "the stem happens to entail it" is not a property worth relying
      // on. This is the accepted cost of taking the judgment out.
      const c = cloze(
        "Esta chaqueta es muy cara. ___ todavía; espera a las rebajas.",
        "No la compres",
      );
      expect(checkLexemeHint(c, Language.ES)).toEqual({ kind: "missing-hint" });
    });
  });

  describe("hint present", () => {
    it("accepts a bare infinitive after the sentence", () => {
      const c = cloze(
        "Tienes que hablar con tu jefe hoy — ___ mañana. (irse)",
        "no te vayas",
      );
      expect(checkLexemeHint(c, Language.ES)).toEqual({ kind: "ok" });
    });

    it("accepts a mid-sentence parenthetical", () => {
      const c = cloze("Tu formación es muy importante. ___ (olvidar) nunca.", "No la olvides");
      expect(checkLexemeHint(c, Language.ES)).toEqual({ kind: "ok" });
    });

    it("accepts the slash-separated verb+clitic form the affirmative half uses", () => {
      const c = cloze(
        "Las sábanas están limpias. ___ a tu hermano ahora mismo, por favor. (dar / se / las)",
        "Dáselas",
      );
      expect(checkLexemeHint(c, Language.ES)).toEqual({ kind: "ok" });
    });

    it("accepts the comma-separated form", () => {
      const c = cloze(
        "Tengo las fotos del viaje en mi teléfono — ___ a tus padres esta noche. (enseñar, se las)",
        "Enséñaselas",
      );
      expect(checkLexemeHint(c, Language.ES)).toEqual({ kind: "ok" });
    });

    it("accepts a clitic-bearing hint — out of scope, left to the validator", () => {
      // `(enviarlo)` spoils the pronoun whose placement is the point, but the
      // item is answerable, which is what this gate is for.
      const c = cloze(
        "El informe todavía tiene errores — no ___ todavía. (enviarlo)",
        "lo envíes",
      );
      expect(checkLexemeHint(c, Language.ES)).toEqual({ kind: "ok" });
    });
  });

  describe("not applicable", () => {
    it("passes a stem with no blank", () => {
      expect(checkLexemeHint(cloze("No hay hueco aquí."), Language.ES)).toEqual({ kind: "ok" });
    });

    it("does not count a non-verb parenthetical as a hint", () => {
      // A noun cue is not an infinitive, so it cannot rescue a verb blank.
      const c = cloze("Tienes una mancha. ___ ahora. (la mancha)", "No la toques");
      expect(checkLexemeHint(c, Language.ES)).toEqual({ kind: "missing-hint" });
    });

    it("errs toward ok on a noun cue ending in an infinitive suffix", () => {
      // Known, deliberate limitation: detection is morphological, so `(lugar)`
      // reads as an infinitive. The safe direction for a downgrade-only gate —
      // the row simply stays where the LLM validator put it.
      const c = cloze("Es un sitio bonito. ___ ahora. (lugar)", "No lo dejes");
      expect(checkLexemeHint(c, Language.ES)).toEqual({ kind: "ok" });
    });

    it("tolerates an empty parenthetical", () => {
      expect(checkLexemeHint(cloze("___ ahora. ()"), Language.ES)).toEqual({
        kind: "missing-hint",
      });
    });
  });

  describe("other languages", () => {
    it("accepts a German infinitive", () => {
      const c = cloze("Mein Bruder ___ seit drei Jahren in München. (wohnen)", "wohnt");
      expect(checkLexemeHint(c, Language.DE)).toEqual({ kind: "ok" });
    });

    it("accepts a Turkish infinitive", () => {
      const c = cloze("Her sabah okula ___. (gitmek)", "gidiyorum");
      expect(checkLexemeHint(c, Language.TR)).toEqual({ kind: "ok" });
    });

    it("does not accept a Turkish citation NOUN as a verb hint", () => {
      // TR case clozes hint with the noun's citation form — a different rule.
      const c = cloze("Her sabah ___ gidiyorum. (okul)", "okula");
      expect(checkLexemeHint(c, Language.TR)).toEqual({ kind: "missing-hint" });
    });
  });
});
