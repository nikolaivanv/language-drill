'use client';

import { Button } from '../../../../components/ui/button';
import { hideWordInExample } from '../../../../lib/drill/example-sentence';
import { letterCountLabel } from '../../../../lib/drill/syllabify';

export interface HintRowProps {
  expectedWord: string;
  exampleSentence?: string;
  level: 0 | 1 | 2 | 3;
  onAdvance: () => void;
}

export function HintRow({
  expectedWord,
  exampleSentence,
  level,
  onAdvance,
}: HintRowProps) {
  const showL3 = Boolean(exampleSentence);
  // first letter → letter count → (example sentence, if one exists). A single
  // "show me a hint" chip escalates one level per click and hides once the
  // deepest available hint is shown — the same progressive control the
  // translation exercise uses, so every drill type shares one hint affordance.
  const maxLevel = showL3 ? 3 : 2;
  const maskedExampleSentence =
    level >= 3 && exampleSentence
      ? hideWordInExample(exampleSentence, expectedWord)
      : '';

  return (
    <div className="flex flex-col gap-s-3">
      {level < maxLevel && (
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={onAdvance}
        >
          show me a hint
        </Button>
      )}
      {level >= 1 && (
        <p className="t-small">
          first letter:{' '}
          <strong>{expectedWord[0]?.toLowerCase() ?? ''}</strong>
        </p>
      )}
      {level >= 2 && <p className="t-small">{letterCountLabel(expectedWord)}</p>}
      {level >= 3 && exampleSentence && (
        <p className="t-small">{maskedExampleSentence}</p>
      )}
    </div>
  );
}
