import { describe, expect, it } from "vitest";

import {
  cellReuse,
  contentTokens,
  foldReuse,
  hotTokens,
  maxJaccard,
  reuseVerdict,
} from "./pool-reuse-metrics";

describe("contentTokens", () => {
  it("lowercases, strips diacritics, drops short words and stopwords, and prefixes to 5 chars", () => {
    // "Mi"/"en"/"el"/"con" < 4 chars; "está" → "esta" and "nosotros" are stopwords.
    expect([...contentTokens("Mi Hermana está en el café con nosotros")].sort()).toEqual(
      ["cafe", "herma"],
    );
  });

  it("drops English stopwords so translation sources are comparable", () => {
    // they/said/that/their/would are stopwords; sister → "siste".
    expect([...contentTokens("They said that their sister would visit")].sort()).toEqual(
      ["siste", "visit"],
    );
  });

  it("returns an empty set for text with no content words", () => {
    expect(contentTokens("— ___ ?")).toEqual(new Set());
  });
});

describe("hotTokens", () => {
  const pool = [
    "Mi hermana ___ en casa.",
    "La casa de mi hermana ___ grande.",
    "Mi hermana ___ médica.",
    "El perro ___ fuera.",
    "El tren ___ tarde.",
    "La tienda ___ cerrada.",
  ];

  it("returns tokens in ≥15% of stems and ≥3 rows, most frequent first", () => {
    expect(hotTokens(pool)).toEqual([{ token: "herma", rows: 3, share: 0.5 }]);
  });

  it("requires at least 3 rows even when the share is high", () => {
    expect(hotTokens(["Mi hermana ___.", "Mi hermana ___ aquí."])).toEqual([]);
  });

  it("excludes a structural token present in every stem", () => {
    const stems = [
      "Es el lugar donde vive la hermana ___.",
      "Es la casa donde vive la hermana ___.",
      "Es el pueblo donde trabaja la hermana ___.",
      "Es el parque donde juega el tren ___.",
      "Es la tienda donde compra la mesa ___.",
    ];
    // "hermana" is in 3/5 stems (hot filler); "donde" is in 5/5 (structural).
    expect(hotTokens(stems)).toEqual([{ token: "herma", rows: 3, share: 0.6 }]);
    expect(hotTokens(stems).map((h) => h.token)).not.toContain("donde");
  });

  it("uses the 15% share, not the 3-row floor, as the binding threshold", () => {
    const filler = (n: number): string[] =>
      Array.from({ length: 30 }, (_, i) => (i < n ? `Caso${i} zorro ___ w${i}x.` : `Caso${i} otra cosa${i} ___.`));
    expect(hotTokens(filler(3)).map((h) => h.token)).not.toContain("zorro");
    expect(hotTokens(filler(5)).map((h) => h.token)).toContain("zorro");
  });

  it("counts a token once per stem", () => {
    expect(hotTokens(["hermana hermana hermana ___", "otra frase ___", "más cosas ___"])).toEqual([]);
  });
});

describe("maxJaccard", () => {
  it("is 1 for an identical stem and 0 with no overlap or an empty pool", () => {
    expect(maxJaccard("Mi hermana ___ en casa.", ["Mi hermana ___ en casa."])).toBe(1);
    expect(maxJaccard("El tren ___ tarde.", ["Mi hermana ___ en casa."])).toBe(0);
    expect(maxJaccard("El tren ___ tarde.", [])).toBe(0);
  });

  it("takes the best match across the pool", () => {
    // draft {herma, medic}; pool[1] {herma, casa} → 1/3; pool[0] {perro, fuera} → 0
    expect(maxJaccard("Mi hermana ___ médica.", ["El perro ___ fuera.", "Mi hermana ___ en casa."])).toBeCloseTo(1 / 3, 10);
  });
});

describe("cellReuse + foldReuse", () => {
  const pool = ["Mi hermana ___ en casa.", "Mi hermana ___ médica.", "Mi hermana ___ aquí.", "El tren ___ tarde."];

  it("counts drafts containing any hot token and sums max-Jaccard", () => {
    const r = cellReuse(["Tu hermana ___ cansada.", "El vecino ___ ruidoso."], pool);
    expect(r.drafts).toBe(2);
    expect(r.hotHits).toBe(1);
    expect(r.jaccardSum).toBeGreaterThan(0);
  });

  it("does not count a draft containing only a structural token", () => {
    const stems = [
      "Es el lugar donde vive la hermana ___.",
      "Es la casa donde vive la hermana ___.",
      "Es el pueblo donde trabaja la hermana ___.",
      "Es el parque donde juega el tren ___.",
      "Es la tienda donde compra la mesa ___.",
    ];
    const r = cellReuse(["Es el sitio donde duerme el gato ___."], stems);
    expect(r.hotHits).toBe(0);
  });

  it("folds cells by pooling drafts, not averaging rates", () => {
    const fold = foldReuse([
      { drafts: 10, hotHits: 5, jaccardSum: 2 },
      { drafts: 30, hotHits: 3, jaccardSum: 3 },
    ]);
    expect(fold).toEqual({ drafts: 40, hotReuseRate: 8 / 40, meanMaxJaccard: 5 / 40 });
  });

  it("folds an empty input to zeros", () => {
    expect(foldReuse([])).toEqual({ drafts: 0, hotReuseRate: 0, meanMaxJaccard: 0 });
  });
});

describe("reuseVerdict", () => {
  const fold = (hotReuseRate: number, drafts = 100): { drafts: number; hotReuseRate: number; meanMaxJaccard: number } => ({
    drafts,
    hotReuseRate,
    meanMaxJaccard: 0,
  });

  it("is ship-ready when reuse falls to ≤0.7× and approval drops ≤5pp", () => {
    expect(reuseVerdict(fold(0.5), fold(0.35), -0.05)).toBe("ship-ready");
  });

  it("is inspect when reuse does not fall enough", () => {
    expect(reuseVerdict(fold(0.5), fold(0.36), 0)).toBe("inspect");
  });

  it("is inspect when approval drops more than 5pp", () => {
    expect(reuseVerdict(fold(0.5), fold(0.1), -0.06)).toBe("inspect");
  });

  it("is inconclusive when the baseline has no hot reuse or no drafts", () => {
    expect(reuseVerdict(fold(0), fold(0), 0)).toBe("inconclusive");
    expect(reuseVerdict(fold(0.5, 0), fold(0.1), 0)).toBe("inconclusive");
  });
});
