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
