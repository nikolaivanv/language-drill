import { verifyToken } from "@clerk/backend";

/**
 * Clerk JWT verification for the streaming-annotate Function URL.
 *
 * The Function URL has `AuthType: NONE` (the SSE response is incompatible
 * with API Gateway's JWT authorizer integration), so this module owns the
 * security boundary. It never throws — the handler treats `null` as
 * "unauthenticated" and returns a 401 JSON response before opening the SSE
 * stream.
 *
 * Verification is networked: `verifyToken` fetches Clerk's JWKS the first
 * time and caches it. Subsequent requests in the same warm Lambda container
 * reuse the cached keyset, so verification cost on warm invocations is
 * effectively zero.
 */

// Audience matches the `aud` claim baked into the Clerk `api` JWT template
// (see CLAUDE.md → "Clerk JWT setup"). Same value the API Gateway authorizer
// already enforces for every non-streaming `/read/*` route.
const CLERK_AUDIENCE = "language-drill";

// Optional CSV of `azp`-claim values to allow. Production sets this to the
// frontend hostnames; dev/preview leaves it empty (skipping the `azp` check
// in `verifyToken` matches the API Gateway authorizer's behaviour).
const AUTHORIZED_PARTIES = (process.env.CLERK_AUTHORIZED_PARTIES ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * Verifies the `Authorization: Bearer <jwt>` header and returns the `sub`
 * claim (the Clerk user ID) on success. Returns `null` on every failure mode
 * — missing/empty header, missing `Bearer ` prefix, expired token, wrong
 * audience, wrong issuer, JWKS-fetch failure, etc.
 */
export async function verifyClerkJwt(
  authHeader: string | undefined,
): Promise<string | null> {
  // Local-dev bypass: matches the Hono dev server's convention
  // (`infra/lambda/src/dev.ts`). Production never sets this env var, so this
  // branch is effectively dead code in the deployed Function URL.
  if (process.env.DEV_USER_ID) return process.env.DEV_USER_ID;

  if (!authHeader) return null;

  const trimmed = authHeader.trim();
  if (!trimmed.toLowerCase().startsWith("bearer ")) return null;

  const token = trimmed.slice("bearer ".length).trim();
  if (!token) return null;

  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) return null;

  try {
    const payload = await verifyToken(token, {
      secretKey,
      audience: CLERK_AUDIENCE,
      ...(AUTHORIZED_PARTIES.length > 0
        ? { authorizedParties: AUTHORIZED_PARTIES }
        : {}),
    });
    const sub = payload?.sub;
    return typeof sub === "string" && sub.length > 0 ? sub : null;
  } catch {
    return null;
  }
}
