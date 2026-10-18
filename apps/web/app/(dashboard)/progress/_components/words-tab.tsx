'use client';

import type { VocabTopicsResponse, VocabTopicSummary } from '@language-drill/api-client';
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

const LEVEL_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

/** Topics sectioned by CEFR level, A1 first; unknown levels after, in first-seen order. */
export function groupTopicsByLevel(
  topics: readonly VocabTopicSummary[],
): { level: string; topics: VocabTopicSummary[] }[] {
  const byLevel = new Map<string, VocabTopicSummary[]>();
  for (const t of topics) {
    const list = byLevel.get(t.cefrLevel);
    if (list) list.push(t);
    else byLevel.set(t.cefrLevel, [t]);
  }
  const rank = (l: string) => {
    const i = LEVEL_ORDER.indexOf(l);
    return i === -1 ? LEVEL_ORDER.length : i;
  };
  return [...byLevel.entries()]
    .map(([level, list], seen) => ({ level, topics: list, seen }))
    .sort((a, b) => rank(a.level) - rank(b.level) || a.seen - b.seen)
    .map(({ level, topics: list }) => ({ level, topics: list }));
}

// The curated vocab-coverage grid, surfaced as a Progress mastery lens beside
// the grammar Map. Topic rows link to the standalone /vocab/[umbrellaKey]
// detail. Presentational — /progress owns the useVocabTopics query so it fires
// in parallel with the other tabs on mount.
export function WordsTab({ data, isLoading, isError, onRetry }: WordsTabProps) {
  if (isLoading) return <VocabListLoading />;
  if (isError) return <VocabListError onRetry={onRetry} />;
  if (!data || data.topics.length === 0) return <VocabEmpty />;
  return (
    <div className="mt-s-4 flex flex-col gap-s-4">
      {groupTopicsByLevel(data.topics).map(({ level, topics }) => (
        <section key={level} aria-labelledby={`words-level-${level}`}>
          <h3 id={`words-level-${level}`} className="t-mono mb-s-2 text-[12px] text-ink-mute">
            {level}
          </h3>
          <div className="overflow-hidden rounded-lg border border-rule bg-card">
            {topics.map((topic) => (
              <VocabTopicCard key={topic.umbrellaKey} topic={topic} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
