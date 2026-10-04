import Link from 'next/link';
import type { PublicLanguage, RelatedTheoryTopics } from '@language-drill/api-client';
import { grammarTopicHref } from '../../../lib/public-paths';

const GROUP_LABEL: Record<keyof RelatedTheoryTopics, string> = {
  buildsOn: 'Builds on',
  leadsTo: 'Leads to',
  siblings: 'Related',
};

const GROUP_KEYS = ['buildsOn', 'leadsTo', 'siblings'] as const;

/**
 * Plain `<a>` cards to each related topic. `ref.topicId` is the URL slug
 * (grammar-point key minus the language prefix) — `filterApprovedRelated` on
 * the API side already dropped any reference without an approved page, so
 * every card here resolves.
 *
 * Only groups with at least one reference render a heading; the whole section
 * is omitted when all three are empty rather than showing an empty shell.
 */
export function RelatedTopicsGrid({
  lang,
  related,
}: {
  lang: PublicLanguage;
  related: RelatedTheoryTopics;
}) {
  const groups = GROUP_KEYS.map((key) => ({ key, refs: related[key] })).filter(
    (g) => g.refs.length > 0,
  );

  if (groups.length === 0) return null;

  return (
    <section aria-label="Related topics" className="flex flex-col gap-s-5 border-t border-rule pt-s-6">
      {groups.map(({ key, refs }) => (
        <div key={key} className="flex flex-col gap-s-3">
          <div className="t-mono text-[11px] tracking-[1.6px] text-ink-mute uppercase">
            {GROUP_LABEL[key]}
          </div>
          <div className="grid grid-cols-1 gap-s-3 sm:grid-cols-2">
            {refs.map((ref) => (
              <Link
                key={ref.topicId}
                href={grammarTopicHref(lang, ref.topicId)}
                className="flex flex-col gap-[2px] rounded-lg border border-rule bg-card p-s-4 no-underline"
              >
                <span className="t-mono text-[11px] text-ink-mute">{ref.cefr}</span>
                <span className="t-body font-medium text-ink">{ref.title}</span>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
