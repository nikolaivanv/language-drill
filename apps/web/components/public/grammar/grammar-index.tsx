import Link from 'next/link';
import type { PublicLanguage } from '@language-drill/shared';
import type { PublicTopicSummary } from '@language-drill/api-client';
import { fetchPublicTopicList } from '../../../lib/public-theory';
import { grammarIndexHref, grammarTopicHref, LANGUAGE_LABEL } from '../../../lib/public-paths';
import { PublicHeader } from '../public-header';
import { GrammarIndexSearch } from './grammar-index-search';

const LEVEL_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const LEVEL_NAME: Record<string, string> = {
  A1: 'Beginner',
  A2: 'Elementary',
  B1: 'Intermediate',
  B2: 'Upper intermediate',
  C1: 'Advanced',
  C2: 'Mastery',
};

export type LevelGroup = { level: string; topics: PublicTopicSummary[] };

/**
 * CEFR-grouped, curriculum-ordered. A null `order` sorts last with a title
 * tie-break: a curriculum key the backfill never assigned an order to still
 * needs a stable position, and an unstable sort would reorder the list on
 * every ISR refresh. An unrecognised CEFR value keeps its own group rather
 * than vanishing — the whole point of the hub is that every topic is reachable.
 */
export function groupTopicsByLevel(topics: PublicTopicSummary[]): LevelGroup[] {
  const byLevel = new Map<string, PublicTopicSummary[]>();
  for (const topic of topics) {
    const bucket = byLevel.get(topic.cefr);
    if (bucket) bucket.push(topic);
    else byLevel.set(topic.cefr, [topic]);
  }
  return [...byLevel.entries()]
    .sort(([a], [b]) => {
      const ia = LEVEL_ORDER.indexOf(a);
      const ib = LEVEL_ORDER.indexOf(b);
      return (ia === -1 ? LEVEL_ORDER.length : ia) - (ib === -1 ? LEVEL_ORDER.length : ib);
    })
    .map(([level, group]) => ({
      level,
      topics: [...group].sort(
        (x, y) =>
          (x.order ?? Number.MAX_SAFE_INTEGER) - (y.order ?? Number.MAX_SAFE_INTEGER) ||
          x.title.localeCompare(y.title),
      ),
    }));
}

/**
 * Pure presentational list — no fetching, so it is testable without mocking
 * `fetch`. `GrammarIndex` below is the async component that supplies `topics`.
 */
export function GrammarIndexBody({
  lang,
  topics,
}: {
  lang: PublicLanguage;
  topics: PublicTopicSummary[];
}) {
  const groups = groupTopicsByLevel(topics);
  return (
    <div data-grammar-index>
      {groups.map(({ level, topics: rows }) => (
        <section key={level} id={level.toLowerCase()} className="pt-s-5">
          <div className="flex items-baseline gap-s-3 border-b border-rule pb-s-2">
            <span className="t-mono text-[11px] tracking-[1px] text-ink-mute">{level}</span>
            <span className="t-small text-ink-soft">{LEVEL_NAME[level] ?? level}</span>
            <span className="t-small ml-auto text-ink-mute">{rows.length} topics</span>
          </div>
          <ul className="m-0 list-none p-0">
            {rows.map((topic) => (
              <li
                key={topic.id}
                data-topic-row
                data-search={`${topic.title} ${topic.subtitle}`.toLowerCase()}
              >
                <Link
                  href={grammarTopicHref(lang, topic.id)}
                  className="flex flex-col gap-[2px] border-b border-rule py-s-3 no-underline"
                >
                  <span className="t-body font-medium text-ink">{topic.title}</span>
                  <span className="t-small text-ink-mute">{topic.subtitle}</span>
                  {topic.hasConjugationDrill && (
                    <span className="t-mono text-[11px] text-accent-2">
                      free conjugation drill
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export async function GrammarIndex({ lang }: { lang: PublicLanguage }) {
  const topics = await fetchPublicTopicList(lang);
  const languageName = LANGUAGE_LABEL[lang];
  return (
    <div className="mx-auto flex max-w-[860px] flex-col px-s-4 py-s-6">
      <PublicHeader activeLanguage={lang} languageHref={(l) => grammarIndexHref(l)} />
      <main className="flex flex-col gap-s-5 pt-s-6">
        <div className="flex flex-col gap-s-2">
          <h1 className="t-display-l">{languageName} grammar</h1>
          <p className="t-body text-ink-mute">
            {topics.length} explanations, ordered the way the course teaches them.
            Free to read, no account.
          </p>
        </div>
        <GrammarIndexSearch />
        <GrammarIndexBody lang={lang} topics={topics} />
      </main>
    </div>
  );
}
