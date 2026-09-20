const BASE_URL =
  typeof process !== 'undefined'
    ? (process.env['NEXT_PUBLIC_API_URL'] ?? '')
    : '';

export type AuthenticatedFetch = (path: string, init?: RequestInit) => Promise<Response>;

/**
 * Thrown when a request needs a session token and there is none — the caller
 * signed out, or their session expired.
 *
 * Why this exists instead of just sending the request and reading the 401:
 * the API Gateway JWT authorizer rejects an unauthenticated request *before*
 * the Lambda, so the Hono CORS middleware never runs and the 401 reaches the
 * browser with no `Access-Control-Allow-Origin`. The browser discards it and
 * hands the caller an opaque `TypeError: Failed to fetch`, indistinguishable
 * from the network being down — which is how an expired session used to
 * surface as a dead-end "failed to load your profile" card. Failing here keeps
 * "signed out" a distinct, actionable state the UI can redirect on.
 */
export class AuthExpiredError extends Error {
  constructor(message = 'Your session has expired. Please sign in again.') {
    super(message);
    this.name = 'AuthExpiredError';
  }
}

/**
 * Identifies {@link AuthExpiredError} by `name` rather than `instanceof`, so
 * two bundled copies of this package (web + a future mobile build) can't
 * defeat the check with separate class identities.
 */
export function isAuthExpiredError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AuthExpiredError';
}

/**
 * Creates a fetch wrapper that attaches the Clerk session token
 * as a Bearer authorization header to all requests.
 *
 * Throws {@link AuthExpiredError} — without touching the network — when there
 * is no session token to send.
 */
export function createAuthenticatedFetch(
  getToken: (options?: { template?: string }) => Promise<string | null>,
): AuthenticatedFetch {
  return async (path: string, init?: RequestInit): Promise<Response> => {
    const token = await getToken({ template: 'api' });

    // Clerk's `getToken` awaits the client's load before resolving, so `null`
    // here always means "no session" — never "not hydrated yet". That makes it
    // safe to treat as a hard auth failure rather than a transient blank.
    if (!token) {
      throw new AuthExpiredError();
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(init?.headers as Record<string, string>),
      Authorization: `Bearer ${token}`,
    };

    const response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers,
    });

    if (!response.ok) {
      // Parse error body if available
      let errorBody: unknown;
      try {
        errorBody = await response.json();
      } catch {
        errorBody = null;
      }

      const message =
        errorBody && typeof errorBody === 'object' && 'error' in errorBody
          ? (errorBody as { error: string }).error
          : `Request failed: ${response.status}`;

      const error = new Error(message);
      (error as any).status = response.status;
      (error as any).body = errorBody;
      throw error;
    }

    return response;
  };
}
