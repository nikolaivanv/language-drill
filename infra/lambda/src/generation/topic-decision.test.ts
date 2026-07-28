import { describe, it, expect } from "vitest";
import { TOPIC_DOMAINS } from "@language-drill/shared";
import { decideTopicTargets } from "./topic-decision";

describe("decideTopicTargets", () => {
  it("returns [] when nothing is needed", () => {
    expect(decideTopicTargets({ domains: TOPIC_DOMAINS, need: 0, approvedByDomain: {} })).toEqual([]);
  });

  it("assigns one draft to each least-represented domain first (empty pool)", () => {
    const out = decideTopicTargets({ domains: TOPIC_DOMAINS, need: TOPIC_DOMAINS.length, approvedByDomain: {} });
    // Empty pool + one draft per domain → each domain exactly once.
    expect([...out].sort()).toEqual([...TOPIC_DOMAINS].sort());
  });

  it("fills the deficit against an existing skewed pool", () => {
    // Pool is all travel; 3 drafts must go to three different non-travel domains.
    const out = decideTopicTargets({
      domains: ["travel", "food", "home"],
      need: 3,
      approvedByDomain: { travel: 10 },
    });
    expect(out).toEqual(["food", "home", "food"]); // food(0)->home(0)->food(1); travel stays saturated
  });

  it("only ever emits domains from the supplied set", () => {
    const out = decideTopicTargets({ domains: TOPIC_DOMAINS, need: 5, approvedByDomain: { travel: 2 } });
    for (const d of out) expect(TOPIC_DOMAINS).toContain(d);
  });
});
