import { describe, expect, it } from "vitest";
import { getGrammarPoint } from "@language-drill/db";
import {
  buildCoverageSpecProposalUserPrompt,
  parseCoverageSpecProposal,
  COVERAGE_SPEC_PROPOSAL_PROMPT_VERSION,
} from "./coverage-spec-proposal";

describe("parseCoverageSpecProposal", () => {
  it("accepts a valid proposal and returns a CoverageSpec + rationale", () => {
    const out = parseCoverageSpecProposal({
      axes: [
        { name: "person", floors: { "1sg": 5, "3sg": 5 }, rationale: "finite tense", naValues: ["2pl"], rareValues: [] },
      ],
    });
    expect(out.spec.axes[0].name).toBe("person");
    expect(out.spec.axes[0].floors).toEqual({ "1sg": 5, "3sg": 5 });
  });
  it("rejects an unknown axis", () => {
    expect(() => parseCoverageSpecProposal({ axes: [{ name: "tense", floors: { past: 5 } }] })).toThrow(/unknown axis/);
  });
  it("rejects an illegal value", () => {
    expect(() => parseCoverageSpecProposal({ axes: [{ name: "person", floors: { "9sg": 5 } }] })).toThrow(/illegal value/);
  });
  it("rejects a non-positive-integer floor", () => {
    expect(() => parseCoverageSpecProposal({ axes: [{ name: "person", floors: { "1sg": 0 } }] })).toThrow(/positive integer/);
  });
  it("rejects more than 2 axes", () => {
    expect(() =>
      parseCoverageSpecProposal({
        axes: [
          { name: "person", floors: { "1sg": 5 } },
          { name: "polarity", floors: { affirmative: 5 } },
          { name: "sentenceType", floors: { declarative: 5 } },
        ],
      }),
    ).toThrow(/at most 2 axes/);
  });
});

describe("buildCoverageSpecProposalUserPrompt", () => {
  it("includes the point name and the legal axes for its kind", () => {
    const gp = getGrammarPoint("tr-a1-present-continuous")!;
    const prompt = buildCoverageSpecProposalUserPrompt(gp, null);
    expect(prompt).toContain(gp.name);
    expect(prompt).toContain("person");
    expect(COVERAGE_SPEC_PROPOSAL_PROMPT_VERSION).toMatch(/^coverage-spec@\d{4}-\d{2}-\d{2}$/);
  });
});
