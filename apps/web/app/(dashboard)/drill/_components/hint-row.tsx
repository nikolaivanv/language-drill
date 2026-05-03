'use client';

import { Button } from '../../../../components/ui/button';
import { letterCountLabel } from '../../../../lib/drill/syllabify';

export interface HintRowProps {
  expectedWord: string;
  exampleSentence?: string;
  level: 0 | 1 | 2 | 3;
  onAdvance: () => void;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function maskExampleSentence(sentence: string, word: string): string {
  if (!word) return sentence;
  const pattern = new RegExp(`\\b${escapeRegExp(word)}\\b`, 'iu');
  return sentence.replace(new RegExp(pattern.source, 'giu'), '___');
}

export function HintRow({
  expectedWord,
  exampleSentence,
  level,
  onAdvance,
}: HintRowProps) {
  const showL3 = Boolean(exampleSentence);
  const maskedExampleSentence =
    level >= 3 && exampleSentence
      ? maskExampleSentence(exampleSentence, expectedWord)
      : '';

  return (
    <div className="flex flex-col gap-s-3">
      <div className="flex flex-wrap gap-s-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onAdvance}
          disabled={level !== 0}
          aria-pressed={level >= 1}
        >
          first letter
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onAdvance}
          disabled={level !== 1}
          aria-pressed={level >= 2}
        >
          letter count
        </Button>
        {showL3 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onAdvance}
            disabled={level !== 2}
            aria-pressed={level >= 3}
          >
            example sentence
          </Button>
        )}
      </div>
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
