'use client';

import { useState } from 'react';
import type { VocabWord } from '@language-drill/api-client';
import { Chip } from '../../../../components/ui/chip';
import { revealWordInExample } from '../../../../lib/drill/example-sentence';

type VocabWordCellProps = {
  word: VocabWord;
};

/**
 * One word tile in the topic detail grid. The gloss + example stay hidden
 * (tap-to-reveal) so the grid reads as a recall drill rather than a glossary
 * dump; `data-state` carries the coverage tint (see `.vocab-cell` in
 * globals.css) and doubles as the assertion hook in tests.
 */
export function VocabWordCell({ word }: VocabWordCellProps) {
  const [revealed, setRevealed] = useState(false);

  return (
    <button
      type="button"
      data-state={word.state}
      onClick={() => setRevealed((r) => !r)}
      className="vocab-cell text-left"
      aria-expanded={revealed}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[14px] font-medium text-ink">{word.displayForm}</span>
        {word.freqRank !== null ? <Chip className="t-mono">#{word.freqRank}</Chip> : null}
      </div>
      {revealed ? (
        <div className="mt-1 text-[13px]">
          <div className="text-ink-soft">{word.gloss}</div>
          <div className="mt-[2px] italic text-ink-mute">
            {revealWordInExample(word.exampleSentence, word.displayForm)}
          </div>
        </div>
      ) : null}
    </button>
  );
}
