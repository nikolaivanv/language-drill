import { describe, it, expect } from "vitest";
import { Language, CefrLevel } from "./index";
import type { ApiError } from "./index";

describe("Language enum", () => {
  it("has exactly 4 values", () => {
    const values = Object.values(Language);
    expect(values).toHaveLength(4);
  });

  it("contains EN, ES, DE, TR", () => {
    expect(Language.EN).toBe("EN");
    expect(Language.ES).toBe("ES");
    expect(Language.DE).toBe("DE");
    expect(Language.TR).toBe("TR");
  });
});

describe("CefrLevel enum", () => {
  it("has exactly 6 values", () => {
    const values = Object.values(CefrLevel);
    expect(values).toHaveLength(6);
  });

  it("contains A1, A2, B1, B2, C1, C2", () => {
    expect(CefrLevel.A1).toBe("A1");
    expect(CefrLevel.A2).toBe("A2");
    expect(CefrLevel.B1).toBe("B1");
    expect(CefrLevel.B2).toBe("B2");
    expect(CefrLevel.C1).toBe("C1");
    expect(CefrLevel.C2).toBe("C2");
  });
});

describe("ApiError type", () => {
  it("shape matches expected structure", () => {
    const err: ApiError = {
      error: "Not Found",
      code: "NOT_FOUND",
      status: 404,
    };

    expect(err.error).toBe("Not Found");
    expect(err.code).toBe("NOT_FOUND");
    expect(err.status).toBe(404);
    expect(typeof err.error).toBe("string");
    expect(typeof err.code).toBe("string");
    expect(typeof err.status).toBe("number");
  });
});
