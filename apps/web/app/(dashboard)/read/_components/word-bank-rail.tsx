'use client';

// ---------------------------------------------------------------------------
// WordBankRail — sticky right column listing locally-banked words
// ---------------------------------------------------------------------------
// Walks `bank` in insertion order, renders a paper-2 row per entry that
// resolves to a flag in `flaggedMap`. Bank entries that fail to resolve
// (defensive: a saved entry whose flag was somehow dropped server-side)
// are skipped silently — no row, no error. Empty-bank renders the dashed-
// border "tap a highlighted word…" card; the footer note + "from your
// reading" chip render in both states (Requirements 6.3, 8.7, 8.8).
// ---------------------------------------------------------------------------

import type { FlaggedMap } from '@language-drill/shared';
import { Chip } from '../../../../components/ui/chip';

type Props = {
  bank: string[];
  flaggedMap: FlaggedMap;
  onRemove: (word: string) => void;
};

export function WordBankRail({ bank, flaggedMap, onRemove }: Props) {
  return (
    <aside
      className="sticky top-[24px] flex flex-col rounded-r-lg border border-rule bg-card pt-[18px] px-[18px] pb-[12px]"
      style={{ maxHeight: 'calc(100vh - 80px)' }}
    >
      <div className="flex items-baseline justify-between mb-[10px]">
        <div className="t-display-s">word bank</div>
        <div className="t-mono text-[11px] text-ink-mute">{bank.length}</div>
      </div>
      <div className="t-small mb-[14px]">marked from this passage</div>

      {bank.length === 0 ? (
        <div
          className="t-small text-ink-mute rounded-r-md border border-dashed border-rule p-[18px] text-center leading-[1.5]"
        >
          tap a highlighted word to see its meaning, then save it here.
        </div>
      ) : (
        <ul className="-mr-[8px] flex min-h-0 flex-col gap-[6px] overflow-y-auto pr-[8px]">
          {bank.map((word) => {
            const flag = flaggedMap[word];
            if (!flag) return null;
            return (
              <li
                key={word}
                className="flex items-start gap-[8px] rounded-r-sm bg-paper-2 px-[10px] py-[8px]"
              >
                <div className="min-w-0 flex-1">
                  <div
                    style={{
                      fontFamily: 'var(--font-display)',
                      fontSize: 14,
                      fontWeight: 500,
                    }}
                  >
                    {flag.lemma}
                  </div>
                  <div className="t-small text-[11px] text-ink-soft">
                    {flag.gloss}
                  </div>
                </div>
                <span className="t-mono mt-[2px] text-[10px] text-ink-mute">
                  {flag.cefr}
                </span>
                <button
                  type="button"
                  aria-label={`remove ${flag.lemma}`}
                  onClick={() => onRemove(word)}
                  className="mt-[2px] cursor-pointer border-none bg-transparent p-0 text-[14px] leading-none text-ink-mute hover:text-ink"
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-auto border-t border-dashed border-rule pt-[12px]">
        <p className="t-small text-[11px] leading-[1.5] text-ink-mute">
          saved words appear in cloze, vocab recall, and translation drills
          tagged{' '}
          <Chip
            variant="accent"
            className="ml-[4px] py-[1px] px-[6px] text-[10px]"
          >
            from your reading
          </Chip>
        </p>
      </div>
    </aside>
  );
}
