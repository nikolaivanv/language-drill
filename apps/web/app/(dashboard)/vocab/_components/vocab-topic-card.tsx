import Link from 'next/link';
import type { VocabTopicSummary } from '@language-drill/api-client';
import { Chip } from '../../../../components/ui/chip';

type VocabTopicCardProps = {
  topic: VocabTopicSummary;
};

/**
 * One topic row in the vocab index: a link to the topic's word list showing
 * its name, CEFR chip, and word/drillable counts (mirrors theory-topic-row.tsx).
 */
export function VocabTopicCard({ topic }: VocabTopicCardProps) {
  return (
    <Link
      href={`/vocab/${topic.umbrellaKey}`}
      className="vocab-topic-card flex items-center justify-between gap-3 border-b border-rule px-[14px] py-[11px] text-ink no-underline hover:bg-paper-2"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[14px] font-medium">{topic.name}</span>
          <Chip className="t-mono">{topic.cefrLevel}</Chip>
        </div>
        <p className="t-small mt-1 text-ink-mute">
          {topic.wordCount} words · {topic.available} drillable
        </p>
      </div>
      <span aria-hidden="true" className="text-[14px] text-ink-mute">
        →
      </span>
    </Link>
  );
}
