import Link from 'next/link';
import type { VocabTopicSummary } from '@language-drill/api-client';
import { Chip } from '../../../../components/ui/chip';

type VocabTopicCardProps = {
  topic: VocabTopicSummary;
};

/**
 * One topic row in the vocab index: a link to the topic's word list showing
 * its name, CEFR chip, a mastery bar and a one-line summary (mirrors
 * theory-topic-row.tsx). The bar splits the topic's words into strong (best
 * score ≥ 0.7), shaky (practiced, below that) and not yet practiced, using the
 * same ok/hilite tokens as the word-cell tints on the detail page so the two
 * views read as one system.
 */
export function VocabTopicCard({ topic }: VocabTopicCardProps) {
  const total = Math.max(topic.wordCount, 1);
  const strong = Math.min(topic.strong, topic.wordCount);
  const shaky = Math.max(0, Math.min(topic.practiced, topic.wordCount) - strong);
  const started = topic.practiced > 0;

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
        <div
          className="vocab-mastery-bar mt-2"
          role="img"
          aria-label={`${strong} of ${topic.wordCount} words strong, ${shaky} shaky`}
        >
          <span
            className="vocab-mastery-bar__strong"
            data-testid="mastery-strong"
            style={{ width: `${(strong / total) * 100}%` }}
          />
          <span
            className="vocab-mastery-bar__shaky"
            data-testid="mastery-shaky"
            style={{ width: `${(shaky / total) * 100}%` }}
          />
        </div>
        <p className="t-small mt-1 text-ink-mute">
          {started ? (
            <>
              {strong} / {topic.wordCount} strong
              {shaky > 0 ? ` · ${shaky} shaky` : ''}
            </>
          ) : (
            <>
              {topic.wordCount} words · {topic.available} drillable · not started
            </>
          )}
        </p>
      </div>
      <span aria-hidden="true" className="text-[14px] text-ink-mute">
        →
      </span>
    </Link>
  );
}
