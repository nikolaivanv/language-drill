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
      <div className="flex items-baseline justify-between gap-s-4">
        <h2 className="t-display-m">work on these</h2>
        <Link href="/drill" className="t-micro underline">
          practice →
        </Link>
      </div>
      <ul className="mt-s-3 flex flex-col gap-s-2">
        {items.map((t) => (
          <li
            key={`${t.grammarPointKey ?? '∅'}:${t.errorType}`}
            className="flex items-baseline justify-between gap-s-3"
          >
            <span className="text-[14px] font-medium">{label(t)}</span>
            <span className="t-mono text-[12px] text-ink-soft">
              {t.sample.wrongText} → {t.sample.correction} · {t.count}×
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
