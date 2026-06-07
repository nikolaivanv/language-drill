'use client';

// ---------------------------------------------------------------------------
// HistoryView — library card grid (Task 13)
// ---------------------------------------------------------------------------
// Displays past reading entries as a 2-column card grid with generated vs
// pasted provenance metadata, relative timestamps, and a dashed "add" card
// to trigger new text generation.
// ---------------------------------------------------------------------------

import type { ReadEntrySummary } from '@language-drill/api-client';
import { Chip } from '../../../../components/ui/chip';
import { relativeTime } from '../_lib/relative-time';

type Props = {
  entries: readonly ReadEntrySummary[];
  onOpen: (entryId: string) => void;
  onGenerateNew: () => void;
};

export function HistoryView({ entries, onOpen, onGenerateNew }: Props) {
  return (
    <div className="max-w-[800px] mobile:max-w-none">
      <div className="t-micro mb-[6px]">YOUR READING</div>
      <h2 className="t-display-m mt-[4px] mb-[22px]">past texts</h2>

      <div className="grid grid-cols-2 gap-[16px] mobile:grid-cols-1">
        {entries.map((entry) => {
          const isGenerated = entry.kind === 'generated';
          const subtitle = isGenerated ? entry.prompt : entry.source;

          return (
            <button
              key={entry.id}
              type="button"
              role="button"
              onClick={() => onOpen(entry.id)}
              className="bg-card border border-rule rounded-r-md p-s-4 cursor-pointer text-left transition-colors hover:border-ink hover:bg-paper-2 flex flex-col gap-[8px]"
            >
              {/* Title row + relative time */}
              <div className="flex items-start justify-between gap-[8px]">
                <div className="t-display-s min-w-0 flex-1">
                  {entry.title || 'untitled passage'}
                </div>
                <span className="t-mono text-ink-mute text-[11px] shrink-0 whitespace-nowrap">
                  {relativeTime(entry.pastedAt, Date.now())}
                </span>
              </div>

              {/* Prompt / source in italic quotes */}
              {subtitle ? (
                <div className="t-small text-ink-soft italic">
                  &ldquo;{subtitle}&rdquo;
                </div>
              ) : null}

              {/* Tag row */}
              <div className="flex flex-wrap gap-[4px]">
                {isGenerated ? (
                  <>
                    {entry.category && (
                      <Chip variant="accent">
                        {entry.category.toUpperCase()}
                      </Chip>
                    )}
                    {entry.cefr && (
                      <Chip variant="default">{entry.cefr}</Chip>
                    )}
                    {entry.length && (
                      <Chip variant="default">
                        {entry.length.toUpperCase()}
                      </Chip>
                    )}
                  </>
                ) : (
                  <Chip variant="default">pasted</Chip>
                )}
                <Chip variant="ok">{entry.savedCount} saved</Chip>
              </div>
            </button>
          );
        })}

        {/* Dashed "add" card */}
        <button
          type="button"
          role="button"
          onClick={onGenerateNew}
          className="border-2 border-dashed border-rule rounded-r-md p-s-4 cursor-pointer text-left transition-colors hover:border-ink flex flex-col items-center justify-center gap-[8px] min-h-[100px]"
        >
          <span className="t-display-m text-ink-mute">+</span>
          <span className="t-small text-ink-mute">generate a new text</span>
        </button>
      </div>
    </div>
  );
}
