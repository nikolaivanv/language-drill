function renderValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (Array.isArray(value)) return value.map((v) => renderValue(v)).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

// Type-agnostic read-only view of an exercise's contentJson: every field except
// the discriminator `type` and the writer-only `_dedupKey` is shown as a labeled
// row, with the full JSON available in a disclosure. Works for all exercise types.
export function ContentFieldView({ content }: { content: unknown }) {
  if (!content || typeof content !== 'object') {
    return (
      <pre className="text-[12px] whitespace-pre-wrap break-words text-ink-soft">
        {JSON.stringify(content)}
      </pre>
    );
  }
  const entries = Object.entries(content as Record<string, unknown>).filter(
    ([k]) => k !== '_dedupKey' && k !== 'type',
  );
  return (
    <div className="flex flex-col gap-2">
      <dl className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-1 text-[13px]">
        {entries.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-ink-soft">{k}</dt>
            <dd className="text-ink break-words">{renderValue(v)}</dd>
          </div>
        ))}
      </dl>
      <details className="text-[12px]">
        <summary className="cursor-pointer text-ink-soft">raw JSON</summary>
        <pre className="mt-1 whitespace-pre-wrap break-words">
          {JSON.stringify(content, null, 2)}
        </pre>
      </details>
    </div>
  );
}
