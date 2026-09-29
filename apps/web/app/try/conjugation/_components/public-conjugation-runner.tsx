'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  gradeFluencyAnswer,
  isConjugationContent,
  type ConjugationContent,
  type ExerciseContent,
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
  /**
   * The levels this language actually has approved content for (see
   * `PUBLIC_LEVELS_BY_LANGUAGE`), so the empty state can point the visitor
   * somewhere that works rather than a bare "try another level."
   */
  availableLevels: PublicLevel[];
}

type Answered = {
  id: string;
  lemma: string;
  targetForm: string;
  userAnswer: string;
  correct: boolean;
};

/**
 * One exercise narrowed to conjugation content. `contentJson` arrives off the
 * wire as `unknown` (it's a polymorphic column); we assert it once to the
 * declared `ExerciseContent` union — the type the value actually is at
 * runtime — and let the `isConjugationContent` predicate do the narrowing
 * from there, so nothing downstream needs a second, unchecked cast.
 */
type ConjugationItem = { id: string; content: ConjugationContent };

/**
 * The anonymous sitting. Fetches one set, then grades every answer in the
 * browser with `gradeFluencyAnswer` — the same pure function the authenticated
 * submit path calls, so the Turkish İ/I dual case-fold and the
 * diacritics-are-significant rule come along unchanged.
 *
 * Nothing is persisted: no history row, no mastery update, no anonymous session.
 * The debrief says so rather than implying saved progress.
 */
export function PublicConjugationRunner({
  lang,
  level,
  availableLevels,
}: PublicConjugationRunnerProps) {
  const fetchFn = React.useMemo(() => createPublicFetch(), []);
  const { data, isLoading, isError, isFetching, refetch } = usePublicConjugationSet({
    lang,
    level,
    fetchFn,
  });

  const [index, setIndex] = React.useState(0);
  const [verdict, setVerdict] = React.useState<PublicVerdict>(null);
  const [done, setDone] = React.useState(false);
  const [restartError, setRestartError] = React.useState(false);
  const answersRef = React.useRef<Answered[]>([]);

  const items = React.useMemo<ConjugationItem[]>(() => {
    const exercises = data?.exercises ?? [];
    const result: ConjugationItem[] = [];
    for (const exercise of exercises) {
      const content = exercise.contentJson as ExerciseContent;
      if (isConjugationContent(content)) {
        result.push({ id: exercise.id, content });
      }
    }
    return result;
  }, [data]);

  // Deliberately does not reset the sitting (index/verdict/done) until the
  // refetch has actually landed. Resetting eagerly would either flash the
  // stale set under the visitor once fresh data arrives, or — if the
  // network blips — throw away the debrief they were just reading with no
  // way back to it. On failure the debrief stays up and reports the blip
  // inline instead.
  function restart() {
    setRestartError(false);
    void refetch().then((result) => {
      if (result.isSuccess) {
        answersRef.current = [];
        setIndex(0);
        setVerdict(null);
        setDone(false);
      } else {
        setRestartError(true);
      }
    });
  }

  if (isLoading) {
    return (
      <p role="status" className="t-body text-ink-mute">
        loading…
      </p>
    );
  }

  // Gated on there being no usable data rather than on `isError` alone:
  // React Query keeps `isError` true after a failed refetch of a query that
  // already has data, and a failed "practise more" refetch must not blank
  // out a sitting already in progress or a debrief already on screen.
  if (isError && items.length === 0) {
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
    const otherLevels = availableLevels.filter((l) => l !== level);
    return (
      <Card padding="lg">
        <p className="t-body">
          There&apos;s nothing to practise here yet for {lang} {level}.{' '}
          {otherLevels.length > 0
            ? `${lang} has content at ${otherLevels.join(', ')}.`
            : `Try a different language.`}
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
          <div className="flex flex-col gap-s-2">
            <p className="t-display-m">
              {correct} / {answersRef.current.length}
            </p>
            {/* Prominent, not an afterthought: statelessness is the entire
                justification for the no-reclaim design, so being honest about
                it belongs next to the score, not buried under a long list. */}
            <p className="t-body">
              This practice wasn&apos;t saved. Sign up to track which forms
              you actually know.
            </p>
          </div>
          {missed.length > 0 && (
            <ul className="flex flex-col gap-s-2">
              {missed.map((a) => (
                <li key={a.id} className="t-body">
                  {a.lemma}: you wrote <em>{a.userAnswer}</em> — {a.targetForm}
                </li>
              ))}
            </ul>
          )}
          {restartError && (
            <p className="t-small text-ink-mute">
              Couldn&apos;t load a new set just now.
            </p>
          )}
          <div className="flex items-center gap-s-3">
            <Link href="/sign-up" className="link-arrow">
              sign up{' '}
              <span className="lk-arr" aria-hidden="true">
                →
              </span>
            </Link>
            <Button variant="ghost" onClick={restart} disabled={isFetching}>
              {isFetching ? 'loading…' : 'practise more'}
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  const current = items[index]!;
  const content = current.content;

  function handleSubmit(answer: string) {
    const correct = gradeFluencyAnswer(content, answer);
    answersRef.current.push({
      id: current.id,
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
