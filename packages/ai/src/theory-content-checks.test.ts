import { describe, expect, it } from "vitest";

import { findMixedScriptWords, mixedScriptFactualErrors } from "./theory-content-checks.js";

describe("findMixedScriptWords", () => {
  it("flags Cyrillic look-alikes inside a Turkish form (the 2026-11-01 audit cases)", () => {
    const content = {
      sections: [
        { body: [{ kind: "text", text: "gelmен, gelme" }] },
        { body: [{ kind: "example", target: "gelivер- / gidiverdі" }] },
      ],
    };
    expect(findMixedScriptWords(content)).toEqual(["gelmен,", "gelivер-", "gidiverdі"]);
  });

  it("ignores IPA in slashes, including Greek theta", () => {
    expect(findMixedScriptWords({ text: "pronounced /θ/ in Spain, (/θ/)." })).toEqual([]);
  });

  it("ignores pure-Greek or pure-Cyrillic words and plain Latin text", () => {
    expect(findMixedScriptWords({ a: "α and Москва", b: "Straße, çocuğun, niño" })).toEqual([]);
  });

  it("deduplicates repeats", () => {
    expect(findMixedScriptWords(["gelmен", { x: "gelmен" }])).toEqual(["gelmен"]);
  });
});

describe("mixedScriptFactualErrors", () => {
  it("returns one factual-error string per offending word", () => {
    const errors = mixedScriptFactualErrors({ t: "gelmен" });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('"gelmен"');
  });

  it("returns nothing for a clean page", () => {
    expect(mixedScriptFactualErrors({ t: "hepsi temiz" })).toEqual([]);
  });
});
