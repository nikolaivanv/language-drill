import type { AuthenticatedFetch } from '@language-drill/api-client';

/**
 * Fetches the user's full data export and triggers a browser download.
 * Throws on non-OK responses (createAuthenticatedFetch already throws).
 */
export async function downloadMyData(fetchFn: AuthenticatedFetch): Promise<void> {
  const res = await fetchFn('/me/export', { method: 'GET' });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const date = new Date().toISOString().slice(0, 10);
  const a = document.createElement('a');
  a.href = url;
  a.download = `drill-data-export-${date}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
