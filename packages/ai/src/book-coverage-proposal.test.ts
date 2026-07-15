import { describe, expect, it } from "vitest";

import {
  buildBookCoverageProposalUserPrompt,
  parseBookCoverageProposal,
  renderBookCoverageFragment,
} from "./book-coverage-proposal";

const ANCHORS = new Set(["ch29", "29-1", "29-2", "29-3"]);
const KEYS = new Set(["es-a2-si-present-conditional", "es-b2-remote-conditionals"]);

const VALID = {
  sections: [
    { anchor: "ch29", excluded: "chapter intro" },
    { anchor: "29-1", points: ["es-a2-si-present-conditional"] },
    { anchor: "29-2", gap: "remote conditionals construction has no owning point" },
    { anchor: "29-3", excluded: "regional/dialectal" },
  ],
};

describe("parseBookCoverageProposal", () => {
  it("accepts a valid proposal and preserves order and shapes", () => {
    const result = parseBookCoverageProposal(VALID, ANCHORS, KEYS);
    expect(result).toEqual([
      { anchor: "ch29", excluded: "chapter intro" },
      { anchor: "29-1", points: ["es-a2-si-present-conditional"] },
      { anchor: "29-2", gap: "remote conditionals construction has no owning point" },
      { anchor: "29-3", excluded: "regional/dialectal" },
    ]);
  });

  it("rejects an unknown anchor (hallucination guard)", () => {
    const bad = { sections: [{ anchor: "99-9", excluded: "x" }] };
    expect(() => parseBookCoverageProposal(bad, ANCHORS, KEYS)).toThrow(/unknown anchor/);
  });

  it("rejects an unknown curriculum key", () => {
    const bad = { sections: [{ anchor: "29-1", points: ["es-b9-nope"] }] };
    expect(() => parseBookCoverageProposal(bad, ANCHORS, KEYS)).toThrow(
      /unknown curriculum key/,
    );
  });

  it("rejects a duplicate anchor", () => {
    const bad = {
      sections: [
        { anchor: "29-1", excluded: "a" },
        { anchor: "29-1", excluded: "b" },
      ],
    };
    expect(() => parseBookCoverageProposal(bad, ANCHORS, KEYS)).toThrow(/duplicate/);
  });

  it("rejects a section with no decision kind at all", () => {
    expect(() =>
      parseBookCoverageProposal({ sections: [{ anchor: "29-1" }] }, ANCHORS, KEYS),
    ).toThrow(/no decision/);
  });

  it("resolves multiple decision kinds by precedence gap > points > excluded", () => {
    // A gap is a flag for human review — when the model hedges, keep the flag
    // rather than fail the whole chapter (a real Hammer ch. 11 run emitted all
    // three kinds on one section and dead-loop retried).
    expect(
      parseBookCoverageProposal(
        {
          sections: [
            { anchor: "29-1", excluded: "x", gap: "y" },
            {
              anchor: "29-2",
              points: ["es-a2-si-present-conditional"],
              gap: "z",
            },
            { anchor: "29-3", points: ["es-a2-si-present-conditional"], excluded: "w" },
          ],
        },
        ANCHORS,
        KEYS,
      ),
    ).toEqual([
      { anchor: "29-1", gap: "y" },
      { anchor: "29-2", gap: "z" },
      { anchor: "29-3", points: ["es-a2-si-present-conditional"] },
    ]);
  });

  it("rejects empty points arrays and blank reasons", () => {
    expect(() =>
      parseBookCoverageProposal({ sections: [{ anchor: "29-1", points: [] }] }, ANCHORS, KEYS),
    ).toThrow(/non-empty/);
    expect(() =>
      parseBookCoverageProposal(
        { sections: [{ anchor: "29-1", excluded: "  " }] },
        ANCHORS,
        KEYS,
      ),
    ).toThrow(/non-empty/);
  });
});

describe("renderBookCoverageFragment", () => {
  it("renders claims and exclusions as ledger rows and gaps as comments", () => {
    const fragment = renderBookCoverageFragment(
      parseBookCoverageProposal(VALID, ANCHORS, KEYS),
    );
    expect(fragment).toBe(
      [
        "  'ch29': { excluded: 'chapter intro' },",
        "  '29-1': { points: ['es-a2-si-present-conditional'] },",
        "  // GAP '29-2': remote conditionals construction has no owning point — author a point or exclude with a reason.",
        "  '29-3': { excluded: 'regional/dialectal' },",
      ].join("\n"),
    );
  });

  it("escapes single quotes in exclusion reasons", () => {
    const fragment = renderBookCoverageFragment([
      { anchor: "29-1", excluded: "folded into 'es-b2-remote-conditionals'" },
    ]);
    expect(fragment).toContain("\\'es-b2-remote-conditionals\\'");
  });
});

describe("buildBookCoverageProposalUserPrompt", () => {
  it("lists every section anchor and truncates enormous chapters", () => {
    const prompt = buildBookCoverageProposalUserPrompt({
      book: "Test Grammar",
      languageName: "Spanish",
      sections: [{ anchor: "29-1", title: "29.1 Open conditions" }],
      chapterMarkdown: "x".repeat(200_000),
      curriculumSummary: "es-a2-si-present-conditional — Open conditions (A2): …",
      curriculumKeys: ["es-a2-si-present-conditional"],
    });
    expect(prompt).toContain("- 29-1: 29.1 Open conditions");
    expect(prompt).toContain("[... chapter text truncated ...]");
    expect(prompt.length).toBeLessThan(130_000);
  });
});
