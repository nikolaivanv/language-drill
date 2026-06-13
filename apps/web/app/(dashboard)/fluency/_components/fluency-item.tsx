'use client';

import * as React from 'react';
import {
  ExerciseType,
  type ExerciseContent,
  type ClozeContent,
  type VocabRecallContent,
} from '@language-drill/shared';
import { Button, Input } from '../../../../components/ui';

export type FluencyVerdict = { correct: boolean; correctAnswer: string } | null;

export interface FluencyItemProps {
  content: ExerciseContent;
  elapsedMs: number;
  verdict: FluencyVerdict;
  onSubmit: (answer: string) => void;
  onNext: () => void;
  isLast: boolean;
}

function promptText(content: ExerciseContent): string {
  if (content.type === ExerciseType.CLOZE) {
    return (content as ClozeContent).sentence;
  }
  if (content.type === ExerciseType.VOCAB_RECALL) {
    return (content as VocabRecallContent).prompt;
  }
  return '';
}

export function FluencyItem({ content, elapsedMs, verdict, onSubmit, onNext, isLast }: FluencyItemProps) {
  const [answer, setAnswer] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const locked = verdict !== null;

  React.useEffect(() => {
    setAnswer('');
    inputRef.current?.focus();
  }, [content]);

  return (
    <div className="flex flex-col gap-s-4">
      <p className="t-small text-ink-mute" aria-live="off">
        {(elapsedMs / 1000).toFixed(1)}s
      </p>
      <p className="t-display-s">{promptText(content)}</p>
      <Input
        ref={inputRef}
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        readOnly={locked}
        disabled={locked}
      />
      {!locked ? (
        <Button variant="primary" onClick={() => answer.trim() && onSubmit(answer)} disabled={!answer.trim()}>
          submit
        </Button>
      ) : (
        <div className="flex flex-col gap-s-2">
          <p className="t-body" role="status">
            {verdict.correct ? '✓ correct' : `✗ — ${verdict.correctAnswer}`} · {(elapsedMs / 1000).toFixed(1)}s
          </p>
          <Button variant="primary" onClick={onNext}>
            {isLast ? 'finish' : 'next'}
          </Button>
        </div>
      )}
    </div>
  );
}
