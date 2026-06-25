import Link from 'next/link';
import type { InsightsErrorTheme } from '@language-drill/api-client';
import { cn } from '../../../lib/cn';

const MAX_ITEMS = 3;

// Whole-row hover surface, matching the curriculum-map rows + sidebar nav:
// neutral --paper-2 fill (no terracotta), rounded, with `active:` for mobile
// touch feedback (no hover on touch). The `-mx-s-3` on the <ul> lets the fill
// bleed slightly past the text without shifting the text off the section edge.
const ROW_INTERACTIVE =
  'group block w-full cursor-pointer rounded-r-md px-s-3 py-s-2 text-left transition-colors hover:bg-paper-2 active:bg-paper-2';

function label(t: InsightsErrorTheme): string {
  return t.grammarPointName ?? t.grammarPointKey ?? `${t.errorType} errors`;
}

// One row's content. When `interactive`, the right-side "example · count"
// cross-fades into "drill →" in place on hover (no layout shift): both occupy
// the same box, toggled by opacity. "drill →" is decorative (the row itself is
// the link), so it's aria-hidden.
function RowInner({
  t,
  interactive,
}: {
  t: InsightsErrorTheme;
  interactive: boolean;
}) {
  return (
    <span className="flex items-start justify-between gap-s-3">
      <span className="min-w-0 text-[14px] font-medium">{label(t)}</span>
      <span className="relative max-w-[48%] shrink-0 text-right">
        <span
          className={cn(
            't-mono block text-[12px] text-ink-soft',
            interactive && 'transition-opacity group-hover:opacity-0',
          )}
        >
          {t.sample.wrongText} → {t.sample.correction} · {t.count}×
        </span>
        {interactive && (
          <span
            aria-hidden
            className="t-mono absolute inset-0 flex items-center justify-end text-[13px] font-medium text-ink opacity-0 transition-opacity group-hover:opacity-100"
          >
            drill →
          </span>
        )}
      </span>
    </span>
  );
}

export function WorkOnThese({
  themes,
  onSelect,
}: {
  themes: InsightsErrorTheme[];
  onSelect?: (grammarPointKey: string) => void;
}) {
  const items = themes.slice(0, MAX_ITEMS);
  if (items.length === 0) return null;

  return (
    <section>
      <h2 className="t-display-m">work on these</h2>
      <ul className="mt-s-3 -mx-s-3 flex flex-col gap-s-1">
        {items.map((t) => {
          const key = `${t.grammarPointKey ?? '∅'}:${t.errorType}`;
          return (
            <li key={key}>
              {t.grammarPointKey ? (
                onSelect ? (
                  <button
                    type="button"
                    onClick={() => onSelect(t.grammarPointKey!)}
                    className={ROW_INTERACTIVE}
                  >
                    <RowInner t={t} interactive />
                  </button>
                ) : (
                  <Link
                    href={`/drill?start=quick&grammarPoint=${encodeURIComponent(t.grammarPointKey)}`}
                    className={ROW_INTERACTIVE}
                  >
                    <RowInner t={t} interactive />
                  </Link>
                )
              ) : (
                <div className="px-s-3 py-s-2">
                  <RowInner t={t} interactive={false} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
