import { describe, expect, it } from "vitest";

import { capabilityFor, shapeToolRequest } from "../src/index.js";
import { SURFACE_MODELS, VERIFY_MODELS, VERIFY_SURFACES, VERIFY_TOOL } from "./verify-model-requests";

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

  it("--surfaces covers all 8 migrated call sites", () => {
    const names = VERIFY_SURFACES.map((s) => s.surface);
    for (const prefix of [
      "evaluation",
      "validation-",
      "generation-",
      "free-writing-evaluation",
      "free-writing-dedup",
      "theory-generation",
      "theory-validation",
      "qa-crafter",
    ]) {
      expect(names.some((n) => n === prefix || n.startsWith(prefix))).toBe(true);
    }
  });

  it("every surface tool shapes without throwing for both auto-mode families", () => {
    for (const m of SURFACE_MODELS) {
      for (const { tool } of VERIFY_SURFACES) {
        const shaped = shapeToolRequest(m, { tool, thinking: "off", temperature: 0 });
        expect(shaped.tool_choice).toEqual({ type: "auto" });
        expect(shaped.tools[0]).toMatchObject({ strict: true });
      }
    }
  });
});
