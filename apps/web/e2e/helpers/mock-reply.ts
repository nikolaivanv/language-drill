import type { Route } from '@playwright/test';

type FulfillOptions = Parameters<Route['fulfill']>[0];

/**
 * Anything that validates a response body by throwing on mismatch: a Zod schema
 * (matched structurally via `.parse`, so we don't take a direct `zod` dep) or a
 * bare parse function (`parseFooJson`). Both come from `@language-drill/api-client`.
 */
type ResponseValidator =
  | { parse: (body: unknown) => unknown }
  | ((body: unknown) => unknown);

/**
 * JSON-response shorthand for `route.fulfill`. Use for error/non-2xx bodies or
 * responses the client doesn't parse through a shared schema.
 */
export function reply(body: unknown, status = 200): FulfillOptions {
  return { status, contentType: 'application/json', body: JSON.stringify(body) };
}

/**
 * Like {@link reply}, but first asserts the mock body satisfies the SAME
 * contract the real client parses the response with — pass the exact Zod schema
 * (`Foo Schema`) or parse function (`parseFooJson`) the production hook uses,
 * imported from `@language-drill/api-client`.
 *
 * Why: every E2E spec stubs the backend with hand-written fixtures. Without this
 * guard, a schema/field/status change on the real API leaves the fixtures stale
 * and the spec passes green against a contract that no longer exists. Routing
 * the fixture through the client's own validator makes that drift a loud test
 * failure at the mock site instead of a silent prod regression.
 *
 * Use for happy-path (2xx) success bodies only; validate against the success
 * schema, not error envelopes.
 */
export function validatedReply(
  validate: ResponseValidator,
  body: unknown,
  status = 200,
): FulfillOptions {
  // A Zod schema is an object exposing `.parse`; a parse helper is a function.
  const run =
    typeof validate === 'function'
      ? validate
      : (b: unknown) => validate.parse(b);
  try {
    run(body);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      'E2E mock body does not satisfy the client response contract — update ' +
        `the fixture (or the schema it drifted from):\n${detail}`,
    );
  }
  return reply(body, status);
}
