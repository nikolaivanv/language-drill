import { describe, it, expect } from "vitest";
import { type ClozeContent, ExerciseType } from "@language-drill/shared";

import {
  checkTurkishCloze,
  extractSuffixalStem,
  firstVowel,
  harmonize,
  lastVowel,
  VOWELS,
  type TurkishVowel,
} from "./turkish-harmony";

// ---------------------------------------------------------------------------
// Deterministic Turkish vowel-harmony + word-formedness checker
// (tr-harmony-eval-grounding spec R1, R2). Uses the REAL bundled tr.json so
// the word-formedness fixtures pin actual lexicon behaviour.
// ---------------------------------------------------------------------------

function cloze(sentence: string, correctAnswer: string): ClozeContent {
  return {
    type: ExerciseType.CLOZE,
    instructions: "Fill in the blank.",
    sentence,
    correctAnswer,
  };
}

describe("VOWELS table", () => {
  it("partitions the 8 vowels into front/back and rounded/unrounded", () => {
    expect([...VOWELS.front].sort()).toEqual(["e", "i", "ö", "ü"]);
    expect([...VOWELS.back].sort()).toEqual(["a", "o", "u", "ı"]);
    expect([...VOWELS.rounded].sort()).toEqual(["o", "u", "ö", "ü"]);
    expect([...VOWELS.unrounded].sort()).toEqual(["a", "e", "i", "ı"]);
  });
});

describe("firstVowel / lastVowel", () => {
  it("finds the first and last vowel across all eight vowels", () => {
    expect(firstVowel("domat")).toBe("o"); // d-O-m-a-t
    expect(lastVowel("domat")).toBe("a");
    expect(lastVowel("domates")).toBe("e");
    expect(lastVowel("okul")).toBe("u");
    expect(lastVowel("gül")).toBe("ü");
    expect(lastVowel("kapı")).toBe("ı");
    expect(lastVowel("köprü")).toBe("ü");
    expect(firstVowel("ler")).toBe("e");
    expect(firstVowel("yı")).toBe("ı");
  });

  it("handles Turkish dotted/dotless I casing without locale lowercasing", () => {
    expect(firstVowel("İstanbul")).toBe("i"); // dotted capital → i
    expect(firstVowel("Irmak")).toBe("ı"); // dotless capital → ı
  });

  it("returns null for a word with no vowel", () => {
    expect(firstVowel("rk")).toBeNull();
    expect(lastVowel("")).toBeNull();
  });
});

describe("harmonize", () => {
  it("2-way: front → e, back → a", () => {
    expect(harmonize("e", "2-way")).toBe("e");
    expect(harmonize("a", "2-way")).toBe("a");
    expect(harmonize("ü", "2-way")).toBe("e");
    expect(harmonize("o", "2-way")).toBe("a");
  });

  it("4-way: covers all front/back × rounded/unrounded combinations", () => {
    expect(harmonize("a", "4-way")).toBe("ı"); // back, unrounded
    expect(harmonize("ı", "4-way")).toBe("ı"); // back, unrounded
    expect(harmonize("o", "4-way")).toBe("u"); // back, rounded
    expect(harmonize("u", "4-way")).toBe("u"); // back, rounded
    expect(harmonize("e", "4-way")).toBe("i"); // front, unrounded
    expect(harmonize("i", "4-way")).toBe("i"); // front, unrounded
    expect(harmonize("ö", "4-way")).toBe("ü"); // front, rounded
    expect(harmonize("ü", "4-way")).toBe("ü"); // front, rounded
  });
});

describe("extractSuffixalStem", () => {
  it("returns the letter run immediately before a suffixal blank", () => {
    expect(extractSuffixalStem("Pazarda taze domat___ satıyorlar.")).toBe("domat");
    expect(extractSuffixalStem("Kitab___ okudum.")).toBe("Kitab");
  });

  it("returns null for a lexical blank (whitespace before ___)", () => {
    expect(extractSuffixalStem("Sınıfta sekiz ___ var.")).toBeNull();
  });

  it("returns null when there is no blank marker or it is at the start", () => {
    expect(extractSuffixalStem("Bir cümle.")).toBeNull();
    expect(extractSuffixalStem("___ geldi.")).toBeNull();
  });
});

describe("checkTurkishCloze — harmony", () => {
  it("flags the motivating defect domat___ / ler as wrong-harmony", () => {
    const v = checkTurkishCloze(cloze("Pazarda taze domat___ satıyorlar.", "ler"));
    expect(v.kind).toBe("wrong-harmony");
    if (v.kind === "wrong-harmony") {
      expect(v.expected).toBe("lar"); // domat ends in back vowel a
      expect(v.actual).toBe("ler");
      expect(v.stem).toBe("domat");
    }
  });

  it("accepts a correct back-vowel plural okul___ / lar", () => {
    expect(checkTurkishCloze(cloze("Yeni okul___ açıldı.", "lar")).kind).toBe("ok");
  });

  it("accepts a correct front-vowel plural ev___ / ler", () => {
    expect(checkTurkishCloze(cloze("Sokakta ev___ var.", "ler")).kind).toBe("ok");
  });

  it("accepts a 4-way accusative with buffer consonant araba___ / yı", () => {
    // araba ends in back-unrounded a → 4-way expects ı; first vowel of "yı" is ı.
    expect(checkTurkishCloze(cloze("Araba___ yıkadım.", "yı")).kind).toBe("ok");
  });
});

describe("checkTurkishCloze — word-formedness", () => {
  it("accepts the corrected domates___ / ler (domates is a real lexeme)", () => {
    expect(checkTurkishCloze(cloze("Pazarda taze domates___ satıyorlar.", "ler")).kind).toBe("ok");
  });

  it("accepts kitab___ / ı via final-consonant de-mutation to kitap", () => {
    expect(checkTurkishCloze(cloze("Kitab___ okudum.", "ı")).kind).toBe("ok");
  });

  it("flags a harmony-valid but non-lexeme stem as non-word-stem", () => {
    // "domeş" ends in front vowel e → "ler" is harmonically correct, but
    // "domeş"/"domeşler" are not Turkish words.
    const v = checkTurkishCloze(cloze("Bu domeş___ geldi.", "ler"));
    expect(v.kind).toBe("non-word-stem");
    if (v.kind === "non-word-stem") {
      expect(v.reconstructed).toBe("domeşler");
      expect(v.stem).toBe("domeş");
    }
  });

  it("does not flag an invariant suffix oku___ / rken as wrong-harmony", () => {
    // okurken: -ken does not harmonise; e after back-vowel stem is correct.
    expect(checkTurkishCloze(cloze("Kitap oku___ uyudum.", "rken")).kind).not.toBe(
      "wrong-harmony",
    );
  });
});

describe("checkTurkishCloze — not-applicable / defensive", () => {
  it("is not-applicable for a lexical (whole-word) blank", () => {
    expect(checkTurkishCloze(cloze("Sınıfta sekiz ___ var.", "öğrenci")).kind).toBe(
      "not-applicable",
    );
  });

  it("is not-applicable for a consonant-only answer", () => {
    expect(checkTurkishCloze(cloze("Git___ sonra geldi.", "tk")).kind).toBe(
      "not-applicable",
    );
  });

  it("never throws — empty answer / missing marker → not-applicable", () => {
    expect(checkTurkishCloze(cloze("Pazarda domat___ var.", "")).kind).toBe(
      "not-applicable",
    );
    expect(checkTurkishCloze(cloze("Hiç boşluk yok.", "ler")).kind).toBe(
      "not-applicable",
    );
  });
});
