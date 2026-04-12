import 'server-only';

import { auth } from '@clerk/nextjs/server';

/**
 * Server-side API fetch helper. For use in Server Components and Route Handlers only.
 * For client-side API calls, a separate lib/api-client.ts will be added in Phase 1.
 */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const { getToken } = await auth();
  const token = await getToken();

  if (!token) {
    throw new Error('Not authenticated — no Clerk session token available');
  }

  const baseUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!baseUrl) {
    throw new Error('NEXT_PUBLIC_API_URL is not set');
  }

  const url = `${baseUrl}${path}`;

  return fetch(url, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
}
