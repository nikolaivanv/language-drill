'use client';

import * as React from 'react';
import type { ConjugationContent } from '@language-drill/shared';
import { AccentPicker, Button, Card, Input } from '../ui';
import { ConjugationPromptCard } from './conjugation-prompt';
import { conjugationVerdict } from '../../lib/drill/verdict-tier';
import { submitOnEnter } from '../../lib/drill/keyboard';

export type PublicVerdict = { correct: boolean } | null;

export interface PublicConjugationItemProps {
  content: ConjugationContent;
  language: 'ES' | 'DE' | 'TR';
  verdict: PublicVerdict;
  onSubmit: (answer: string) => void;
  onNext: () => void;
  isLast: boolean;
}

/**
 * One item of the anonymous conjugation drill.
 *
 * Deliberately independent of the dashboard: `FeedbackShell` and `FluencyItem`
 * live under `app/(dashboard)/`, and a public page that imported them would
 * couple the signed-out surface to the authenticated shell's evolution. The
 * shared pieces (prompt card, ui primitives, verdict tiers) are reused.
 */
export function PublicConjugationItem({
  content,
  language,
  verdict,
  onSubmit,
  onNext,
  isLast,
}: PublicConjugationItemProps) {
  const [answer, setAnswer] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const advanceRef = React.useRef<HTMLButtonElement | null>(null);
  const locked = verdict !== null;

  // Clear and refocus for each new item; this component is reused across items.
  React.useEffect(() => {
    setAnswer('');
  }, [content]);

  React.useEffect(() => {
    if (!locked) inputRef.current?.focus();
  }, [content, locked]);

  // Once graded, the input goes `disabled` and drops focus to <body>. Without
  // this, reaching the advance control means tabbing past the page's header,
  // level and language links — for a sitting that is nothing but repeated
  // typing, that's real friction. Focusing the button also gets Enter-to-
  // advance for free, since Enter activates a focused <button>.
  React.useEffect(() => {
    if (locked) advanceRef.current?.focus();
  }, [locked]);

  const submit = React.useCallback(() => {
    if (locked || !answer.trim()) return;
    onSubmit(answer);
  }, [answer, locked, onSubmit]);

  const tier = verdict ? conjugationVerdict(verdict.correct ? 1 : 0) : null;
  const alsoAccepted = (content.acceptableForms ?? []).filter(
    (f) => f.trim().toLowerCase() !== content.targetForm.trim().toLowerCase(),
  );

  return (
    <div className="flex flex-col gap-s-4">
      <ConjugationPromptCard content={content} />

      <div className="flex flex-col gap-s-3">
        <Input
          ref={inputRef}
          aria-label="your answer"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={submitOnEnter(submit)}
          readOnly={locked}
          disabled={locked}
          className="font-display"
          style={{ fontSize: 22, paddingTop: 14, paddingBottom: 14 }}
        />
        <AccentPicker language={language} targetRef={inputRef} disabled={locked} />
      </div>

      {!locked && (
        <div className="flex justify-end">
          <Button variant="primary" onClick={submit} disabled={!answer.trim()}>
            submit
          </Button>
        </div>
      )}

      {verdict && tier && (
        <Card padding="lg">
          <div className="flex flex-col gap-s-4">
            <p className="t-small text-ink-mute">{tier.label}</p>
            <p className="t-display-m">{content.targetForm}</p>
            {alsoAccepted.length > 0 && (
              <p className="t-small text-ink-mute">
                also accepted: {alsoAccepted.join(', ')}
              </p>
            )}
            <p className="t-body-l text-ink-mute">{content.breakdown}</p>
            {content.exampleSentences.length > 0 && (
              <ul className="flex flex-col gap-s-2">
                {content.exampleSentences.map((sentence) => (
                  <li key={sentence} className="t-body">
                    {sentence}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-end">
              <Button ref={advanceRef} variant="primary" onClick={onNext}>
                {isLast ? 'see results' : 'next'}
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
