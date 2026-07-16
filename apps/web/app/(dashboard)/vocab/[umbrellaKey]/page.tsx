'use client';

import { use, useMemo } from 'react';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { createAuthenticatedFetch, useVocabTopicDetail } from '@language-drill/api-client';
import { Chip } from '../../../../components/ui/chip';
import { VocabWordCell } from '../_components/vocab-word-cell';
import { DrillThisTopic } from '../_components/drill-this-topic';
import { VocabListLoading, VocabListError } from '../_components/vocab-list-states';

interface VocabDetailPageProps {
  params: Promise<{ umbrellaKey: string }>;
}

/**
 * Deep-linkable vocab topic detail route: the word grid for one umbrella
 * topic, gloss-on-tap, plus a gated "drill this topic" launch. Mirrors
 * theory/[topicId]/page.tsx's params-Promise unwrap (Next encodes path
 * segments, so a direct deep link / refresh must be decoded back).
 */
export default function VocabDetailPage({ params }: VocabDetailPageProps) {
  const { umbrellaKey } = use(params);
  const key = decodeURIComponent(umbrellaKey);
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  const { data, isLoading, isError, refetch } = useVocabTopicDetail({
    umbrellaKey: key,
    fetchFn,
  });

  const drillable = useMemo(
    () => (data?.words ?? []).some((w) => w.state !== 'not-yet'),
    [data],
  );

  // Rendered in every state (loading, error, loaded) so a slow or failed
  // topic fetch never strands the user without a way back to the list.
  const backLink = (
    <Link
      href="/progress?tab=words"
      aria-label="Back to all topics"
      className="inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-[1.2px] text-ink-mute transition-colors hover:text-ink"
    >
      <span aria-hidden="true">&larr;</span> all topics
    </Link>
  );

  if (isLoading) {
    return (
      <div className="space-y-s-5">
        {backLink}
        <VocabListLoading />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="space-y-s-5">
        {backLink}
        <VocabListError onRetry={() => void refetch()} />
      </div>
    );
  }

  return (
    <div className="space-y-s-5">
      <header className="flex items-center justify-between gap-3">
        <div>
          {backLink}
          <div className="mt-[4px] flex items-baseline gap-2">
            <h1 className="t-display-l">{data.name}</h1>
            <Chip className="t-mono">{data.cefrLevel}</Chip>
          </div>
        </div>
        <DrillThisTopic umbrellaKey={data.umbrellaKey} drillable={drillable} />
      </header>
      <div className="grid grid-cols-2 gap-s-2 sm:grid-cols-3">
        {data.words.map((word) => (
          <VocabWordCell key={word.lemma} word={word} />
        ))}
      </div>
    </div>
  );
}
