/**
 * Build a URL query string (`?a=1&b=2` or `''`) from a params object.
 * Skips `undefined` and empty-string values; keeps `0` (so numeric
 * pagination params like `offset=0` are preserved).
 */
export function buildQueryString(
  params: Record<string, string | number | undefined>,
): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}
