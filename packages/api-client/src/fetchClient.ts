const BASE_URL =
  typeof process !== 'undefined'
    ? (process.env['NEXT_PUBLIC_API_URL'] ?? '')
    : '';

export type AuthenticatedFetch = (path: string, init?: RequestInit) => Promise<Response>;

/**
 * Creates a fetch wrapper that attaches the Clerk session token
 * as a Bearer authorization header to all requests.
 */
export function createAuthenticatedFetch(
  getToken: () => Promise<string | null>,
): AuthenticatedFetch {
  return async (path: string, init?: RequestInit): Promise<Response> => {
    const token = await getToken();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(init?.headers as Record<string, string>),
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

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
