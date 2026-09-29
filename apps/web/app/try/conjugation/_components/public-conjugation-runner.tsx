'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  gradeFluencyAnswer,
  isConjugationContent,
  type ConjugationContent,
} from '@language-drill/shared';
import {
  createPublicFetch,
  usePublicConjugationSet,
  type PublicLanguage,
  type PublicLevel,
} from '@language-drill/api-client';
import { Button, Card } from '../../../../components/ui';
import {
  PublicConjugationItem,
  type PublicVerdict,
} from '../../../../components/drill/public-conjugation-item';

export interface PublicConjugationRunnerProps {
  lang: PublicLanguage;
  level: PublicLevel;
}

type Answered = { lemma: string; targetForm: string; userAnswer: string; correct: boolean };

/**
 * The anonymous sitting. Fetches one set, then grades every answer in the
 * browser with `gradeFluencyAnswer` — the same pure function the authenticated
 * submit path calls, so the Turkish İ/I dual case-fold and the
 * diacritics-are-significant rule come along unchanged.
 *
 * Nothing is persisted: no history row, no mastery update, no anonymous session.
 * The debrief says so rather than implying saved progress.
 */
export function PublicConjugationRunner({ lang, level }: PublicConjugationRunnerProps) {
  const fetchFn = React.useMemo(() => createPublicFetch(), []);
  const { data, isLoading, isError, refetch } = usePublicConjugationSet({
    lang,
    level,
    fetchFn,
  });

  const [index, setIndex] = React.useState(0);
  const [verdict, setVerdict] = React.useState<PublicVerdict>(null);
  const [done, setDone] = React.useState(false);
  const answersRef = React.useRef<Answered[]>([]);

  const items = React.useMemo(
    () =>
      (data?.exercises ?? []).filter((e) => isConjugationContent(e.contentJson as never)),
    [data],
  );

  function restart() {
    answersRef.current = [];
    setIndex(0);
    setVerdict(null);
    setDone(false);
    void refetch();
  }

  if (isLoading) return <p className="t-body text-ink-mute">loading…</p>;

  if (isError) {
    return (
      <Card padding="lg">
        <p className="t-body">Couldn&apos;t load the drill just now.</p>
        <Button variant="primary" onClick={() => void refetch()}>
          try again
        </Button>
      </Card>
    );
  }

  if (items.length === 0) {
    return (
      <Card padding="lg">
        <p className="t-body">
          There&apos;s nothing to practise here yet for {lang} {level}. Try another
          level.
        </p>
      </Card>
    );
  }

  if (done) {
    const correct = answersRef.current.filter((a) => a.correct).length;
    const missed = answersRef.current.filter((a) => !a.correct);
    return (
      <Card padding="lg">
        <div className="flex flex-col gap-s-4">
          <p className="t-display-m">
            {correct} / {answersRef.current.length}
          </p>
          {missed.length > 0 && (
            <ul className="flex flex-col gap-s-2">
              {missed.map((a) => (
                <li key={`${a.lemma}-${a.userAnswer}`} className="t-body">
                  {a.lemma}: you wrote <em>{a.userAnswer}</em> — {a.targetForm}
                </li>
              ))}
            </ul>
          )}
          <p className="t-small text-ink-mute">
            This practice wasn&apos;t saved. Sign up to track which forms you
            actually know.
          </p>
          <div className="flex gap-s-3">
            <Link href="/sign-up" className="t-body">
              sign up
            </Link>
            <Button variant="ghost" onClick={restart}>
              practise more
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  const current = items[index]!;
  const content = current.contentJson as ConjugationContent;

  function handleSubmit(answer: string) {
    const correct = gradeFluencyAnswer(content, answer);
    answersRef.current.push({
      lemma: content.lemma,
      targetForm: content.targetForm,
      userAnswer: answer,
      correct,
    });
    setVerdict({ correct });
  }

  function handleNext() {
    if (index + 1 >= items.length) {
      setDone(true);
      return;
    }
    setIndex((i) => i + 1);
    setVerdict(null);
  }

  return (
    <div className="flex flex-col gap-s-4">
      <p className="t-small text-ink-mute">
        {index + 1} of {items.length}
      </p>
      <PublicConjugationItem
        content={content}
        language={lang}
        verdict={verdict}
        onSubmit={handleSubmit}
        onNext={handleNext}
        isLast={index + 1 >= items.length}
      />
    </div>
  );
}
