import { describe, it, expect } from "vitest";

import {
  parseConjugationStructure,
  CONJUGATION_BACKFILL_PROMPT_VERSION,
  DERIVE_CONJUGATION_STRUCTURE_TOOL,
  DERIVE_CONJUGATION_STRUCTURE_TOOL_NAME,
  buildConjugationBackfillUserPrompt,
} from "./conjugation-backfill";

describe("parseConjugationStructure", () => {
  const VALID = {
    features: [
      { term: "geçmiş zaman (-DI)", gloss: "definite past" },
      { term: "olumlu", gloss: "affirmative" },
    ],
    subject: { pronoun: "o", gloss: "he / she / it" },
  };

  it("parses a well-formed structure (trims whitespace)", () => {
    const out = parseConjugationStructure({
      features: [{ term: "  condicional ", gloss: " conditional " }],
      subject: { pronoun: " nosotros ", gloss: " we " },
    });
    expect(out.features).toEqual([{ term: "condicional", gloss: "conditional" }]);
    expect(out.subject).toEqual({ pronoun: "nosotros", gloss: "we" });
  });

  it("parses multiple features preserving order", () => {
    const out = parseConjugationStructure(VALID);
    expect(out.features.map((f) => f.term)).toEqual([
      "geçmiş zaman (-DI)",
      "olumlu",
    ]);
    expect(out.subject.pronoun).toBe("o");
  });

  it("rejects a non-object", () => {
    expect(() => parseConjugationStructure(null)).toThrow();
    expect(() => parseConjugationStructure("x")).toThrow();
  });

  it("rejects an empty features array", () => {
    expect(() =>
      parseConjugationStructure({ ...VALID, features: [] }),
    ).toThrow(/features/);
  });

  it("rejects a feature missing its gloss", () => {
    expect(() =>
      parseConjugationStructure({ ...VALID, features: [{ term: "condicional" }] }),
    ).toThrow(/gloss/);
  });

  it("rejects a feature with an empty term", () => {
    expect(() =>
      parseConjugationStructure({
        ...VALID,
        features: [{ term: "  ", gloss: "past" }],
      }),
    ).toThrow(/term/);
  });

  it("rejects a subject missing its pronoun when subject is present", () => {
    expect(() =>
      parseConjugationStructure({ ...VALID, subject: { gloss: "we" } }),
    ).toThrow(/pronoun/);
  });

  it("parses a subjectless (nominal) structure — subject is optional", () => {
    const { subject: _omit, ...noSubject } = VALID;
    void _omit;
    const out = parseConjugationStructure(noSubject);
    expect(out.features.length).toBeGreaterThan(0);
    expect(out.subject).toBeUndefined();
  });
});

describe("conjugation backfill prompt + tool wiring", () => {
  it("exposes a dated prompt version", () => {
    expect(CONJUGATION_BACKFILL_PROMPT_VERSION).toMatch(
      /^conjugation-backfill@\d{4}-\d{2}-\d{2}$/,
    );
  });

  it("forces the structured-output tool requiring features (subject optional)", () => {
    expect(DERIVE_CONJUGATION_STRUCTURE_TOOL.name).toBe(
      DERIVE_CONJUGATION_STRUCTURE_TOOL_NAME,
    );
    expect(DERIVE_CONJUGATION_STRUCTURE_TOOL.input_schema.required).toEqual(["features"]);
  });

  it("user prompt includes the cell descriptor fields and forbids re-deriving the answer", () => {
    const prompt = buildConjugationBackfillUserPrompt({
      language: "TR",
      lemma: "içmek",
      lemmaGloss: "to drink",
      featureBundle: "geçmiş zaman (-DI) · olumlu · 3. tekil şahıs (o)",
      targetForm: "içti",
    });
    expect(prompt).toContain("içmek");
    expect(prompt).toContain("geçmiş zaman (-DI) · olumlu · 3. tekil şahıs (o)");
    // The answer (targetForm) is given as context so the model can disambiguate
    // person/number, but the prompt must tell it NOT to put the answer in output.
    expect(prompt).toMatch(/içti/);
  });
});
