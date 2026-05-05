'use client';

// ---------------------------------------------------------------------------
// HistoryView — vertical stack of past-passage cards (Requirement 10.3)
// ---------------------------------------------------------------------------
// Each card: title (Fraunces 18/500) + source line + Fraunces-italic preview
// on the left; mono "N flagged" tally + ok-variant "N saved" chip on the
// right. The whole card is the click target; clicking dispatches
// `onOpen(entryId)` and the page lifts the entry into the annotated view.
// ---------------------------------------------------------------------------

import type { ReadEntrySummary } from '@language-drill/api-client';
import { Chip } from '../../../../components/ui/chip';

type Props = {
  entries: readonly ReadEntrySummary[];
  onOpen: (entryId: string) => void;
};

export function HistoryView({ entries, onOpen }: Props) {
  return (
    <div className="max-w-[800px]">
      <div className="t-micro mb-[6px]">your reading</div>
      <h2 className="t-display-m mt-[4px] mb-[22px]">past texts</h2>
      <ul className="flex flex-col gap-[10px]">
        {entries.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              onClick={() => onOpen(entry.id)}
              className="grid w-full grid-cols-[1fr_auto] items-center gap-[16px] rounded-r-md border border-rule bg-card px-[20px] py-[16px] text-left transition-colors hover:border-ink hover:bg-paper-2"
            >
              <div className="min-w-0">
                <div
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 18,
                    fontWeight: 500,
                  }}
                >
                  {entry.title || 'untitled passage'}
                </div>
                {entry.source && (
                  <div className="t-small text-ink-soft">{entry.source}</div>
                )}
                <div
                  className="text-ink-2 mt-[4px]"
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontStyle: 'italic',
                    fontSize: 14,
                  }}
                >
                  {entry.preview}
                </div>
              </div>
              <div className="flex flex-col items-end gap-[4px]">
                <span className="t-mono text-[11px] text-ink-mute">
                  {entry.flaggedCount} flagged
                </span>
                <Chip variant="ok">{entry.savedCount} saved</Chip>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
