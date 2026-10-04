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
import {
  PublicConjugationItem,
  type PublicVerdict,
} from '../drill/public-conjugation-item';
import { track } from '../../lib/analytics/track';

/**
 * The landing hero: one real item, answerable before the visitor has read
 * anything.
 *
 * The product's whole claim is production over recognition, so the most
 * characteristic thing in its world is a form being produced — which makes the
 * working drill a better hero than a screenshot or a headline stat. Answering
 * it costs nothing and needs no account, which is also the page's argument.
 *
 * One item, not a sitting: finishing belongs on the drill page, and this keeps
 * the landing's job (decide what to practise) separate from the drill's.
 */

export interface LandingTryBlockProps {
  lang: PublicLanguage;
  level: PublicLevel;
  /** Where "keep going" sends them once they have answered. */
  drillHref: string;
}

export function LandingTryBlock({ lang, level, drillHref }: LandingTryBlockProps) {
  const fetchFn = React.useMemo(() => createPublicFetch(), []);
  const { data, isLoading, isError } = usePublicConjugationSet({
    lang,
    level,
    count: 1,
    fetchFn,
  });
  const [verdict, setVerdict] = React.useState<PublicVerdict>(null);

  const first = data?.exercises[0];
  const content =
    first && isConjugationContent(first.contentJson as ExerciseContent)
      ? (first.contentJson as ConjugationContent)
      : undefined;

  if (isLoading) {
    return (
      <div role="status" className="t-small text-ink-mute">
        loading a prompt…
      </div>
    );
  }

  // The hero is an invitation, not the product — if it cannot load, the page
  // still has a point list and a call to action, so say nothing and let those
  // do the work rather than leading with an error.
  if (isError || !content) {
    return (
      <Link href={drillHref} className="link-arrow">
        Start drilling
        <span className="lk-arr" aria-hidden="true">
          →
        </span>
      </Link>
    );
  }

  return (
    <div className="flex flex-col gap-s-3">
      <PublicConjugationItem
        content={content}
        language={lang}
        verdict={verdict}
        onSubmit={(answer) => {
          const correct = gradeFluencyAnswer(content, answer);
          track('public_item_answered', { surface: 'landing_hero', language: lang, cefr: level, correct });
          setVerdict({ correct });
        }}
        onNext={() => undefined}
        isLast
      />
      {verdict && (
        <Link href={drillHref} className="link-arrow self-end">
          Keep going
          <span className="lk-arr" aria-hidden="true">
            →
          </span>
        </Link>
      )}
    </div>
  );
}
