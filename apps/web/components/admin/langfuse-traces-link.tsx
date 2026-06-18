import { buildLangfuseTracesUrl } from '../../lib/admin/langfuse';

// Config-gated deep-link to a tag-filtered Langfuse traces list for a cell.
// Renders nothing unless NEXT_PUBLIC_LANGFUSE_TRACE_URL_TEMPLATE is set AND a
// cellKey is available, so it self-hides in environments without Langfuse.
export function LangfuseTracesLink({ cellKey }: { cellKey: string | null }) {
  const href = cellKey ? buildLangfuseTracesUrl(cellKey) : null;
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className="text-[13px] text-ink underline">
      View traces in Langfuse ↗
    </a>
  );
}
