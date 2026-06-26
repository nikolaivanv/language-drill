'use client';

// ---------------------------------------------------------------------------
// WordBankRail — sticky right column listing words saved from this passage
// ---------------------------------------------------------------------------
// Renders every `user_vocabulary` row sourced from this entry — flagged-banked
// words AND on-demand deep-card saves alike — in save order. Each row shows the
// lemma + gloss + CEFR (or a "phr" marker for phrases); ✕ unsaves it (deletes
// the vocabulary record, server-side also dropping the orphaned review card).
// Empty state nudges the save gesture; the footer note + "from your reading"
// chip render in both states (Requirements 6.3, 8.7, 8.8).
// ---------------------------------------------------------------------------

import type { SavedVocabItem } from '@language-drill/api-client';
import { Chip } from '../../../../components/ui/chip';

type Props = {
  saved: SavedVocabItem[];
  onUnsave: (item: SavedVocabItem) => void;
};

export function WordBankRail({ saved, onUnsave }: Props) {
  return (
    <aside
      className="sticky top-[24px] flex flex-col rounded-lg border border-rule bg-card pt-[18px] px-[18px] pb-[12px]"
      style={{ maxHeight: 'calc(100vh - 80px)' }}
    >
      <div className="flex items-baseline justify-between mb-[10px]">
        <div className="t-display-s">word bank</div>
        <div className="t-mono text-[11px] text-ink-mute">{saved.length}</div>
      </div>
      <div className="t-small mb-[14px]">saved from this passage</div>

      {saved.length === 0 ? (
        <div className="t-small text-ink-mute rounded-md border border-dashed border-rule p-[18px] text-center leading-[1.5]">
          tap a word to see its meaning, then save it here.
        </div>
      ) : (
        <ul className="-mr-[8px] flex min-h-0 flex-col gap-[6px] overflow-y-auto pr-[8px]">
          {saved.map((item) => (
            <li
              key={item.id}
              className="flex items-start gap-[8px] rounded-sm bg-paper-2 px-[10px] py-[8px]"
            >
              <div className="min-w-0 flex-1">
                <div
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 14,
                    fontWeight: 500,
                  }}
                >
                  {item.lemma}
                </div>
                <div className="t-small text-[11px] text-ink-soft">
                  {item.gloss}
                </div>
              </div>
              <span className="t-mono mt-[2px] text-[10px] text-ink-mute">
                {item.type === 'phrase' ? 'phr' : (item.cefr ?? '')}
              </span>
              <button
                type="button"
                aria-label={`remove ${item.lemma}`}
                onClick={() => onUnsave(item)}
                className="mt-[2px] cursor-pointer border-none bg-transparent p-0 text-[14px] leading-none text-ink-mute hover:text-ink"
              >
                ×
              </button>
            </li>
          ))}
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
