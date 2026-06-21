import Link from 'next/link';
import type { InsightsErrorTheme } from '@language-drill/api-client';

const MAX_ITEMS = 3;

function label(t: InsightsErrorTheme): string {
  return t.grammarPointName ?? t.grammarPointKey ?? `${t.errorType} errors`;
}

export function WorkOnThese({ themes }: { themes: InsightsErrorTheme[] }) {
  const items = themes.slice(0, MAX_ITEMS);
  if (items.length === 0) return null;

  return (
    <section>
      <h2 className="t-display-m">work on these</h2>
      <ul className="mt-s-3 flex flex-col gap-s-2">
        {items.map((t) => {
          const inner = (
            <span className="flex items-start justify-between gap-s-3">
              <span className="min-w-0 text-[14px] font-medium">{label(t)}</span>
              <span className="t-mono max-w-[48%] shrink-0 text-right text-[12px] text-ink-soft">
                {t.sample.wrongText} → {t.sample.correction} · {t.count}×
              </span>
            </span>
          );
          const key = `${t.grammarPointKey ?? '∅'}:${t.errorType}`;
          return (
            <li key={key}>
              {t.grammarPointKey ? (
                <Link
                  href={`/drill?start=quick&grammarPoint=${encodeURIComponent(t.grammarPointKey)}`}
                  className="block hover:text-accent"
                >
                  {inner}
                </Link>
              ) : (
                inner
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
