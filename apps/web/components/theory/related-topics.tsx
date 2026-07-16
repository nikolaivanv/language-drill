'use client';

import type { RelatedTheoryTopics, RelatedTopicRef } from '@language-drill/api-client';
import { Chip } from '../ui/chip';

type RelatedTopicsProps = {
  related: RelatedTheoryTopics;
  /**
   * Display label for the sibling group, e.g. 'moods & conditionals' →
   * "more in moods & conditionals". Falls back to plain 'related' when the
   * current topic's category is unknown.
   */
  categoryLabel: string | null;
  onSwitchTopic: (topicId: string) => void;
};

/**
 * "Related topics" block at the end of a theory article. Three tiers derived
 * server-side from the curriculum (see infra/lambda/src/lib/theory-related.ts),
 * already filtered to topics with an approved page — every chip is a live
 * in-app navigation, never a dead link.
 */
export function RelatedTopics({ related, categoryLabel, onSwitchTopic }: RelatedTopicsProps) {
  const groups: ReadonlyArray<[string, readonly RelatedTopicRef[]]> = [
    ['builds on', related.buildsOn],
    ['leads to', related.leadsTo],
    [categoryLabel ? `more in ${categoryLabel}` : 'related', related.siblings],
  ];
  const visible = groups.filter(([, refs]) => refs.length > 0);
  if (visible.length === 0) return null;

  return (
    <section aria-label="related topics" style={{ marginTop: 36 }}>
      <div className="t-micro">related topics</div>
      {visible.map(([label, refs]) => (
        <div key={label} style={{ marginTop: 12 }}>
          <div className="t-small text-ink-soft">{label}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
            {refs.map((ref) => (
              <button
                key={ref.topicId}
                type="button"
                onClick={() => onSwitchTopic(ref.topicId)}
                className="inline-flex items-center gap-2 rounded-pill border border-rule bg-paper px-3 py-1.5 t-small text-ink hover:border-ink"
              >
                {ref.title}
                <Chip>{ref.cefr}</Chip>
              </button>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
