import { describe, it, expect } from "vitest";
import { TOPIC_DOMAINS, TOPIC_HINT_VALUES, isTopicDomain } from "./topic-domains";

describe("topic-domains", () => {
  it("exposes 16 unique neutral domains", () => {
    expect(TOPIC_DOMAINS.length).toBe(16);
    expect(new Set(TOPIC_DOMAINS).size).toBe(16);
  });

  it("TOPIC_HINT_VALUES is the domains plus 'other'", () => {
    expect(TOPIC_HINT_VALUES).toEqual([...TOPIC_DOMAINS, "other"]);
  });

  it("isTopicDomain accepts a domain and rejects 'other'/unknown", () => {
    expect(isTopicDomain("travel")).toBe(true);
    expect(isTopicDomain("other")).toBe(false);
    expect(isTopicDomain("nonsense")).toBe(false);
  });
});
