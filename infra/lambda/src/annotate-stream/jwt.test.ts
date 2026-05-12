import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `vi.mock` hoists above all imports — the mock factory cannot reference outer
// variables, so we look up the spy from the mocked module after import.
vi.mock("@clerk/backend", () => ({
  verifyToken: vi.fn(),
}));

import { verifyToken } from "@clerk/backend";
import { verifyClerkJwt } from "./jwt";

const mockedVerifyToken = vi.mocked(verifyToken);

const ORIGINAL_CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;
const ORIGINAL_DEV_USER_ID = process.env.DEV_USER_ID;

beforeEach(() => {
  mockedVerifyToken.mockReset();
  process.env.CLERK_SECRET_KEY = "sk_test_stub";
  // Ensure DEV_USER_ID never leaks across tests — only the dedicated
  // DEV_USER_ID block sets it.
  delete process.env.DEV_USER_ID;
});

afterEach(() => {
  if (ORIGINAL_CLERK_SECRET_KEY === undefined) {
    delete process.env.CLERK_SECRET_KEY;
  } else {
    process.env.CLERK_SECRET_KEY = ORIGINAL_CLERK_SECRET_KEY;
  }
  if (ORIGINAL_DEV_USER_ID === undefined) {
    delete process.env.DEV_USER_ID;
  } else {
    process.env.DEV_USER_ID = ORIGINAL_DEV_USER_ID;
  }
});

describe("verifyClerkJwt — happy path", () => {
  it("returns the sub claim for a valid Bearer token", async () => {
    mockedVerifyToken.mockResolvedValueOnce({ sub: "user_42" } as never);

    const result = await verifyClerkJwt("Bearer valid.jwt.token");

    expect(result).toBe("user_42");
    expect(mockedVerifyToken).toHaveBeenCalledWith(
      "valid.jwt.token",
      expect.objectContaining({
        secretKey: "sk_test_stub",
        audience: "language-drill",
      }),
    );
  });

  it("is case-insensitive on the Bearer prefix", async () => {
    mockedVerifyToken.mockResolvedValueOnce({ sub: "user_42" } as never);

    const result = await verifyClerkJwt("bearer valid.jwt.token");

    expect(result).toBe("user_42");
  });
});

describe("verifyClerkJwt — header gates", () => {
  it("returns null when the header is undefined", async () => {
    expect(await verifyClerkJwt(undefined)).toBeNull();
    expect(mockedVerifyToken).not.toHaveBeenCalled();
  });

  it("returns null when the header is an empty string", async () => {
    expect(await verifyClerkJwt("")).toBeNull();
    expect(mockedVerifyToken).not.toHaveBeenCalled();
  });

  it("returns null when the Bearer prefix is missing", async () => {
    expect(await verifyClerkJwt("Token abc.def.ghi")).toBeNull();
    expect(mockedVerifyToken).not.toHaveBeenCalled();
  });

  it("returns null when only the Bearer prefix is present (empty token)", async () => {
    expect(await verifyClerkJwt("Bearer ")).toBeNull();
    expect(mockedVerifyToken).not.toHaveBeenCalled();
  });

  it("returns null when CLERK_SECRET_KEY is missing", async () => {
    delete process.env.CLERK_SECRET_KEY;
    expect(await verifyClerkJwt("Bearer abc.def.ghi")).toBeNull();
    expect(mockedVerifyToken).not.toHaveBeenCalled();
  });
});

describe("verifyClerkJwt — verifyToken failures", () => {
  it("returns null when verifyToken throws (expired token)", async () => {
    mockedVerifyToken.mockRejectedValueOnce(
      new Error("Token expired"),
    );

    expect(await verifyClerkJwt("Bearer expired.jwt")).toBeNull();
  });

  it("returns null when verifyToken throws (wrong audience)", async () => {
    mockedVerifyToken.mockRejectedValueOnce(
      new Error("Invalid audience"),
    );

    expect(await verifyClerkJwt("Bearer wrong-aud.jwt")).toBeNull();
  });

  it("returns null when verifyToken throws (JWKS fetch failure)", async () => {
    mockedVerifyToken.mockRejectedValueOnce(
      new Error("Failed to fetch JWKS"),
    );

    expect(await verifyClerkJwt("Bearer net-fail.jwt")).toBeNull();
  });

  it("returns null when the payload has no sub claim", async () => {
    mockedVerifyToken.mockResolvedValueOnce({} as never);

    expect(await verifyClerkJwt("Bearer no-sub.jwt")).toBeNull();
  });

  it("returns null when sub is an empty string", async () => {
    mockedVerifyToken.mockResolvedValueOnce({ sub: "" } as never);

    expect(await verifyClerkJwt("Bearer empty-sub.jwt")).toBeNull();
  });

  it("returns null when sub is not a string", async () => {
    mockedVerifyToken.mockResolvedValueOnce({ sub: 42 } as never);

    expect(await verifyClerkJwt("Bearer non-string-sub.jwt")).toBeNull();
  });
});

describe("verifyClerkJwt — DEV_USER_ID local-dev bypass", () => {
  it("returns DEV_USER_ID when set, ignoring an undefined authHeader", async () => {
    process.env.DEV_USER_ID = "dev_user_001";

    expect(await verifyClerkJwt(undefined)).toBe("dev_user_001");
    expect(mockedVerifyToken).not.toHaveBeenCalled();
  });

  it("returns DEV_USER_ID when set, even if a valid Bearer header is provided", async () => {
    process.env.DEV_USER_ID = "dev_user_001";
    // `verifyToken` should never be invoked — the bypass short-circuits first.
    expect(await verifyClerkJwt("Bearer valid.jwt.token")).toBe("dev_user_001");
    expect(mockedVerifyToken).not.toHaveBeenCalled();
  });

  it("ignores DEV_USER_ID when env var is an empty string (falsy)", async () => {
    process.env.DEV_USER_ID = "";
    mockedVerifyToken.mockResolvedValueOnce({ sub: "user_42" } as never);

    expect(await verifyClerkJwt("Bearer valid.jwt.token")).toBe("user_42");
    expect(mockedVerifyToken).toHaveBeenCalledOnce();
  });
});
