import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseTheoryTopicJson, type TheoryTopicJson } from "./theory";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(
  __dirname,
  "../../db/scripts/__fixtures__/theory-json",
);

const subjunctiveJson: unknown = JSON.parse(
  readFileSync(path.join(fixturesDir, "subjunctive.json"), "utf-8"),
);
const minimalJson: unknown = JSON.parse(
  readFileSync(path.join(fixturesDir, "minimal.json"), "utf-8"),
);

// Returns a deep-cloned copy of minimalJson cast to `any` so tests can mutate
// fields into intentionally-invalid shapes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cloneMinimal = (): any => JSON.parse(JSON.stringify(minimalJson));

describe("parseTheoryTopicJson — happy paths", () => {
  it("round-trips the subjunctive fixture (deep-equal)", () => {
    const parsed = parseTheoryTopicJson(subjunctiveJson);
    expect(parsed).toEqual(subjunctiveJson);
  });

  it("accepts the minimal fixture", () => {
    const parsed = parseTheoryTopicJson(minimalJson);
    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0].id).toBe("only");
  });

  it("preserves nested inline (em > strong > text) round-trip", () => {
    const parsed = parseTheoryTopicJson(subjunctiveJson);
    const what = parsed.sections.find((s) => s.id === "what");
    expect(what).toBeDefined();
    const body1 = what!.body[1];
    if (body1.kind !== "paragraph") throw new Error("expected paragraph");
    const em = body1.text[1];
    if (em.kind !== "em") throw new Error("expected em wrapper");
    const strong = em.children[1];
    if (strong.kind !== "strong") throw new Error("expected nested strong");
    expect(strong.children[0]).toEqual({ kind: "text", text: "be" });
  });

  it("returns a value typed as TheoryTopicJson (compile-time narrowing)", () => {
    const t: TheoryTopicJson = parseTheoryTopicJson(subjunctiveJson);
    expect(t.sections.length).toBeGreaterThan(0);
  });
});

describe("parseTheoryTopicJson — defensive sections-as-string decode", () => {
  // Anthropic's tool-use occasionally serializes nested arrays as JSON
  // string literals. Production audit row 2026-05-18
  // `tr:a1:tr-a1-locative` failed for this reason; probe runs on
  // 2026-05-23 reproduced it on ~75% of attempts. The parser must
  // tolerate this by JSON-parsing a string-valued `sections` field.
  it("accepts sections as a JSON-encoded string", () => {
    const original = cloneMinimal();
    const stringified = {
      ...original,
      sections: JSON.stringify(original.sections),
    };
    const parsed = parseTheoryTopicJson(stringified);
    expect(parsed).toEqual(original);
  });

  it("still rejects an unparseable string", () => {
    const bad = cloneMinimal();
    bad.sections = "this is not JSON";
    expect(() => parseTheoryTopicJson(bad)).toThrow(/sections.*non-empty/);
  });

  it("still rejects a string that parses to a non-array", () => {
    const bad = cloneMinimal();
    bad.sections = JSON.stringify({ not: "an array" });
    expect(() => parseTheoryTopicJson(bad)).toThrow(/sections.*non-empty/);
  });
});

describe("parseTheoryTopicJson — best-effort repair of malformed stringified sections (Req 1.7)", () => {
  // R1.7 (a) native array unchanged → "happy paths" block above.
  // R1.7 (b) valid stringified decoded → "accepts sections as a JSON-encoded
  //          string" above.
  // R1.7 (d) unrecoverable garbage throws → "still rejects an unparseable
  //          string" above. This block adds (c) and (c2).

  // (c) A stringified `sections` array whose `text` value carries an inner
  // quoted token (`"var"`) with unescaped quotes — the recoverable subset that
  // jsonrepair fixes deterministically without a Claude re-roll.
  const recoverableSections =
    '[{"id":"only","title":"t","body":[{"kind":"paragraph","text":[{"kind":"text","text":"the word "var" means there is"}]}]}]';

  it("(c) recovers a malformed stringified sections via best-effort repair", () => {
    const topic = { ...cloneMinimal(), sections: recoverableSections };
    const parsed = parseTheoryTopicJson(topic);
    expect(parsed.sections).toHaveLength(1);
    const body0 = parsed.sections[0].body[0];
    if (body0.kind !== "paragraph") throw new Error("expected paragraph");
    const inline0 = body0.text[0];
    if (inline0.kind !== "text") throw new Error("expected text inline");
    expect(inline0.text).toContain("var");
  });

  it("(c) repair is deterministic — same input yields identical output", () => {
    const a = parseTheoryTopicJson({
      ...cloneMinimal(),
      sections: recoverableSections,
    });
    const b = parseTheoryTopicJson({
      ...cloneMinimal(),
      sections: recoverableSections,
    });
    expect(a).toEqual(b);
  });

  // (c2) The captured 2026-06-01 shape: MULTIPLE unescaped inner quotes
  // adjacent to `(` `)` `/`, which defeats jsonrepair's delimiter heuristic.
  // The parser must NOT silently mangle it — it falls through to a clear throw
  // so the generator's regenerate retry (the guaranteed recovery) kicks in.
  const capturedShapeSections =
    '[{"id":"only","title":"t","body":[{"kind":"paragraph","text":[{"kind":"text","text":"Turkish uses "var" ("there is / exists") and "yok" ("there is not")."}]}]}]';

  it("(c2) throws a clear error on the captured multi-quote shape (repair cannot fix it)", () => {
    const topic = { ...cloneMinimal(), sections: capturedShapeSections };
    expect(() => parseTheoryTopicJson(topic)).toThrow(/sections.*non-empty/);
  });
});

describe("parseTheoryTopicJson — top-level rejection", () => {
  it("rejects a number", () => {
    expect(() => parseTheoryTopicJson(42)).toThrow(
      /topic.*must be an object/,
    );
  });

  it("rejects null", () => {
    expect(() => parseTheoryTopicJson(null)).toThrow(
      /topic.*must be an object/,
    );
  });

  it("rejects an array", () => {
    expect(() => parseTheoryTopicJson([])).toThrow(
      /topic.*must be an object/,
    );
  });

  it("rejects a missing required top-level field", () => {
    const bad = cloneMinimal();
    delete bad.id;
    expect(() => parseTheoryTopicJson(bad)).toThrow(/id.*must be present/);
  });
});

describe("parseTheoryTopicJson — empty-content rejection", () => {
  it("rejects empty sections array", () => {
    const bad = cloneMinimal();
    bad.sections = [];
    expect(() => parseTheoryTopicJson(bad)).toThrow(/sections.*non-empty/);
  });

  it("rejects empty section body", () => {
    const bad = cloneMinimal();
    bad.sections[0].body = [];
    expect(() => parseTheoryTopicJson(bad)).toThrow(
      /sections\[0\]\.body.*non-empty/,
    );
  });

  it("rejects empty paragraph text array", () => {
    const bad = cloneMinimal();
    bad.sections[0].body[0] = { kind: "paragraph", text: [] };
    expect(() => parseTheoryTopicJson(bad)).toThrow(
      /sections\[0\]\.body\[0\]\.text.*non-empty/,
    );
  });

  it("rejects empty inline wrapper children", () => {
    const bad = cloneMinimal();
    bad.sections[0].body[0] = {
      kind: "paragraph",
      text: [{ kind: "em", children: [] }],
    };
    expect(() => parseTheoryTopicJson(bad)).toThrow(/children.*non-empty/);
  });

  it("rejects empty inline text leaf string", () => {
    const bad = cloneMinimal();
    bad.sections[0].body[0] = {
      kind: "paragraph",
      text: [{ kind: "text", text: "" }],
    };
    expect(() => parseTheoryTopicJson(bad)).toThrow(/text.*non-empty string/);
  });
});

describe("parseTheoryTopicJson — example block rejection", () => {
  it("rejects empty example.target", () => {
    const bad = cloneMinimal();
    bad.sections[0].body[0] = { kind: "example", target: [], en: "hi" };
    expect(() => parseTheoryTopicJson(bad)).toThrow(/target.*non-empty/);
  });

  it("rejects empty example.en string", () => {
    const bad = cloneMinimal();
    bad.sections[0].body[0] = {
      kind: "example",
      target: [{ kind: "text", text: "hola" }],
      en: "",
    };
    expect(() => parseTheoryTopicJson(bad)).toThrow(/en.*non-empty string/);
  });

  it("rejects empty example.note when present", () => {
    const bad = cloneMinimal();
    bad.sections[0].body[0] = {
      kind: "example",
      target: [{ kind: "text", text: "hola" }],
      en: "hi",
      note: [],
    };
    expect(() => parseTheoryTopicJson(bad)).toThrow(
      /note.*non-empty.*when present/,
    );
  });
});

describe("parseTheoryTopicJson — list block rejection", () => {
  it("rejects empty list.items", () => {
    const bad = cloneMinimal();
    bad.sections[0].body[0] = { kind: "list", items: [] };
    expect(() => parseTheoryTopicJson(bad)).toThrow(/items.*non-empty/);
  });

  it("rejects an empty single list item", () => {
    const bad = cloneMinimal();
    bad.sections[0].body[0] = { kind: "list", items: [[]] };
    expect(() => parseTheoryTopicJson(bad)).toThrow(/items\[0\].*non-empty/);
  });
});

describe("parseTheoryTopicJson — conjugation-table rejection", () => {
  it("rejects empty head", () => {
    const bad = cloneMinimal();
    bad.sections[0].body[0] = {
      kind: "conjugation-table",
      head: [],
      rows: [["a"]],
    };
    expect(() => parseTheoryTopicJson(bad)).toThrow(/head.*non-empty/);
  });

  it("rejects empty rows", () => {
    const bad = cloneMinimal();
    bad.sections[0].body[0] = {
      kind: "conjugation-table",
      head: ["col"],
      rows: [],
    };
    expect(() => parseTheoryTopicJson(bad)).toThrow(/rows.*non-empty/);
  });

  it("rejects row width mismatch", () => {
    const bad = cloneMinimal();
    bad.sections[0].body[0] = {
      kind: "conjugation-table",
      head: ["a", "b", "c"],
      rows: [["1", "2"]],
    };
    expect(() => parseTheoryTopicJson(bad)).toThrow(/length 3.*got 2/);
  });
});

describe("parseTheoryTopicJson — unknown kind rejection", () => {
  it("rejects an unknown block kind", () => {
    const bad = cloneMinimal();
    bad.sections[0].body[0] = { kind: "paragraf", text: [] };
    expect(() => parseTheoryTopicJson(bad)).toThrow(/unknown block kind/);
  });

  it("rejects an unknown inline kind", () => {
    const bad = cloneMinimal();
    bad.sections[0].body[0] = {
      kind: "paragraph",
      text: [{ kind: "italic", children: [{ kind: "text", text: "x" }] }],
    };
    expect(() => parseTheoryTopicJson(bad)).toThrow(/unknown inline kind/);
  });
});

describe("parseTheoryTopicJson — section id rejection", () => {
  it("rejects a section id with a space", () => {
    const bad = cloneMinimal();
    bad.sections[0].id = "Bad Id";
    expect(() => parseTheoryTopicJson(bad)).toThrow(
      /sections\[0\]\.id.*kebab/,
    );
  });

  it("rejects a section id with a leading digit", () => {
    const bad = cloneMinimal();
    bad.sections[0].id = "1leading";
    expect(() => parseTheoryTopicJson(bad)).toThrow(
      /sections\[0\]\.id.*kebab/,
    );
  });

  it("rejects an empty section id", () => {
    const bad = cloneMinimal();
    bad.sections[0].id = "";
    expect(() => parseTheoryTopicJson(bad)).toThrow(
      /sections\[0\]\.id.*kebab/,
    );
  });

  it("rejects duplicate section ids", () => {
    const bad = cloneMinimal();
    bad.sections.push({
      id: bad.sections[0].id,
      title: "duplicate",
      body: [
        {
          kind: "paragraph",
          text: [{ kind: "text", text: "duplicate body" }],
        },
      ],
    });
    expect(() => parseTheoryTopicJson(bad)).toThrow(
      /duplicates sections\[0\]\.id/,
    );
  });
});
