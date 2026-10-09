import { describe, expect, it } from "vitest";

import { capabilityFor, shapeToolRequest } from "../src/index.js";
import { VERIFY_MODELS, VERIFY_TOOL } from "./verify-model-requests";

describe("verify-model-requests", () => {
  it("covers every family in use or under evaluation", () => {
    expect(VERIFY_MODELS.map((m) => capabilityFor(m).family).sort()).toEqual(
      ["haiku-4-5", "haiku-5-5", "opus-4-7-8", "opus-5-5", "sonnet-4-6", "sonnet-5", "sonnet-5-5"].sort(),
    );
  });

  it("uses a tool schema containing keywords strict mode strips", () => {
    expect(JSON.stringify(VERIFY_TOOL.input_schema)).toMatch(/minItems|maxLength|minimum/);
  });

  it("every model shapes without throwing", () => {
    for (const m of VERIFY_MODELS) expect(() => shapeToolRequest(m, { tool: VERIFY_TOOL, thinking: "off", temperature: 0 })).not.toThrow();
  });
});
