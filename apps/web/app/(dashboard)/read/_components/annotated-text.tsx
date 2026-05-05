'use client';

// ---------------------------------------------------------------------------
// AnnotatedText — render the tokenized passage with flagged words as buttons
// ---------------------------------------------------------------------------
// Pure markup: tokenize once per `text` change, then walk the tokens and
// either render a `<button>` (flagged word) or a plain text fragment. The
// click handler measures the button's bounding rect and forwards it to the
// parent so the parent can position the popover relative to its own
// container (the parent applies its own `getBoundingClientRect()`).
//
// Visuals come from `word-flag-styles.module.css` (task 26a) — no inline
// styles, no global stylesheet edits.
// ---------------------------------------------------------------------------

import * as React from 'react';
import type { FlaggedMap } from '@language-drill/shared';
import { cn } from '../../../../lib/cn';
import { tokenize } from '../_lib/tokenize';
import type { Intensity } from '../_state/read-page-reducer';
import styles from './word-flag-styles.module.css';

type Props = {
  text: string;
  flaggedMap: FlaggedMap;
  intensity: Intensity;
  bankSet: Set<string>;
  activeWord: string | null;
  onWordClick: (word: string, rect: DOMRect) => void;
};

export function AnnotatedText({
  text,
  flaggedMap,
  intensity,
  bankSet,
  activeWord,
  onWordClick,
}: Props) {
  const tokens = React.useMemo(() => tokenize(text), [text]);

  return (
    <>
      {tokens.map((token, i) => {
        if (token.kind === 'sep' || !flaggedMap[token.key]) {
          return <React.Fragment key={i}>{token.raw}</React.Fragment>;
        }
        const inBank = bankSet.has(token.key);
        const isActive = activeWord === token.key;
        return (
          <button
            key={i}
            type="button"
            data-word={token.key}
            className={cn(
              styles.word,
              styles[intensity],
              inBank && styles.saved,
              isActive && styles.active,
            )}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              onWordClick(token.key, rect);
            }}
          >
            {token.raw}
          </button>
        );
      })}
    </>
  );
}
