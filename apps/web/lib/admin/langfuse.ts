/**
 * Cell key for Langfuse trace filtering. Mirrors the canonical buildCellKey
 * (`@language-drill/db` lib/cell-key.ts) WITHOUT importing db into the web
 * bundle. Pinned by langfuse.test.ts — keep in sync if buildCellKey changes.
 * Returns null when any part is missing (flagged item fields are nullable).
 */
export function cellKeyFor(parts: {
  language: string | null;
  level: string | null;
  type: string | null;
  grammarPoint: string | null;
}): string | null {
  const { language, level, type, grammarPoint } = parts;
  if (!language || !level || !type || !grammarPoint) return null;
  return `${language.toLowerCase()}:${level.toLowerCase()}:${type.toLowerCase()}:${grammarPoint}`;
}

/**
 * Build a Langfuse traces-list URL by interpolating {cellKey} into the operator-
 * supplied template (`NEXT_PUBLIC_LANGFUSE_TRACE_URL_TEMPLATE`). Returns null
 * when the template is unset or has no {cellKey} placeholder, so the link is
 * hidden until configured. `template` is overridable for testing.
 */
export function buildLangfuseTracesUrl(
  cellKey: string,
  template: string | undefined = process.env.NEXT_PUBLIC_LANGFUSE_TRACE_URL_TEMPLATE,
): string | null {
  if (!template || !template.includes('{cellKey}')) return null;
  return template.replaceAll('{cellKey}', encodeURIComponent(cellKey));
}
