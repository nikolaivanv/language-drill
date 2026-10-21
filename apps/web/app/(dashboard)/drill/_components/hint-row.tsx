'use client';

import { Button } from '../../../../components/ui/button';
import { hasBlank, hideWordInExample } from '../../../../lib/drill/example-sentence';
import { letterCountLabel } from '../../../../lib/drill/syllabify';

export interface HintRowProps {
  /** The bare headword the first-letter / letter-count hints describe. */
  expectedWord: string;
  /** The article form ("la espalda") to mask first in the example sentence, so
   *  the visible article cannot give away the gender being tested. */
  articleForm?: string;
  exampleSentence?: string;
  level: 0 | 1 | 2 | 3;
  onAdvance: () => void;
  /** When set, a "show answer" chip replaces the hint chip once every hint has
   *  been shown — the learner can give up instead of typing a throwaway guess. */
  onGiveUp?: () => void;
  /** Disables the give-up chip (e.g. while a submit is in flight). */
  disabled?: boolean;
}

export function HintRow({
  expectedWord,
  articleForm,
  exampleSentence,
  level,
  onAdvance,
  onGiveUp,
  disabled = false,
}: HintRowProps) {
  const maskedExampleSentence = exampleSentence
    ? hideWordInExample(
        articleForm ? hideWordInExample(exampleSentence, articleForm) : exampleSentence,
        expectedWord,
      )
    : '';
  // Only offer the sentence when the word was actually blanked: a form the
  // masking cannot reach ("spricht" for "sprechen") would hand over the answer.
  const showL3 = hasBlank(maskedExampleSentence);
  // first letter → letter count → (example sentence, if one exists). A single
  // "show me a hint" chip escalates one level per click and hides once the
  // deepest available hint is shown — the same progressive control the
  // translation exercise uses, so every drill type shares one hint affordance.
  const maxLevel = showL3 ? 3 : 2;

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
      {level >= maxLevel && onGiveUp && (
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={onGiveUp}
          disabled={disabled}
        >
          show answer
        </Button>
      )}
      {level >= 1 && (
        <p className="t-small">
          first letter:{' '}
          <strong>{expectedWord[0]?.toLowerCase() ?? ''}</strong>
        </p>
      )}
      {level >= 2 && <p className="t-small">{letterCountLabel(expectedWord)}</p>}
      {level >= 3 && showL3 && (
        <p className="t-small">{maskedExampleSentence}</p>
      )}
    </div>
  );
}
