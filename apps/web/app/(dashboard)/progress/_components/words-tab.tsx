'use client';

import type { VocabTopicsResponse } from '@language-drill/api-client';
import { VocabTopicCard } from '../../vocab/_components/vocab-topic-card';
import {
  VocabListLoading,
  VocabListError,
  VocabEmpty,
} from '../../vocab/_components/vocab-list-states';

type WordsTabProps = {
  data: VocabTopicsResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
};

// The curated vocab-coverage grid, surfaced as a Progress mastery lens beside
// the grammar Map. Topic rows link to the standalone /vocab/[umbrellaKey]
// detail. Presentational — /progress owns the useVocabTopics query so it fires
// in parallel with the other tabs on mount.
export function WordsTab({ data, isLoading, isError, onRetry }: WordsTabProps) {
  if (isLoading) return <VocabListLoading />;
  if (isError) return <VocabListError onRetry={onRetry} />;
  if (!data || data.topics.length === 0) return <VocabEmpty />;
  return (
    <div className="mt-s-4 overflow-hidden rounded-lg border border-rule bg-card">
      {data.topics.map((topic) => (
        <VocabTopicCard key={topic.umbrellaKey} topic={topic} />
      ))}
    </div>
  );
}
