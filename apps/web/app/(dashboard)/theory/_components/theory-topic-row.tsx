import Link from 'next/link';
import { Chip } from '../../../../components/ui/chip';
import {
  highlightMatch,
  type LibraryTopic,
} from '../../../../lib/theory-library/group-sort';

type TheoryTopicRowProps = {
  topic: LibraryTopic;
  /** Active search query, for in-title match highlighting. Empty = no search. */
  query: string;
};

/**
 * One topic row in the index: a link to the topic's detail page showing the
 * title (with the search match highlighted when filtering), its CEFR chip, and
 * a trailing → affordance (Requirements 2.2, 5.3, 6.1).
 */
export function TheoryTopicRow({ topic, query }: TheoryTopicRowProps) {
  const parts = highlightMatch(topic.title, query);

  return (
    <Link
      href={`/theory/${topic.id}`}
      className="theory-topic-row flex items-center gap-3 border-b border-rule px-[14px] py-[11px] text-ink no-underline hover:bg-paper-2"
    >
      <span className="flex-1 min-w-0 text-[14px] font-medium">
        {parts ? (
          <>
            {parts.before}
            <mark className="bg-[var(--hilite-soft)] p-0 text-inherit">
              {parts.match}
            </mark>
            {parts.after}
          </>
        ) : (
          topic.title
        )}
      </span>
      <Chip className="t-mono">{topic.cefr}</Chip>
      <span aria-hidden="true" className="text-[14px] text-ink-mute">
        →
      </span>
    </Link>
  );
}
