import Link from 'next/link';
import { Language, type LearningLanguage, type PublicLanguage } from '@language-drill/shared';
import type { PublicTopicSummary } from '@language-drill/api-client';
import { fetchPublicTopic, fetchPublicTopicList } from '../../../lib/public-theory';
import {
  grammarIndexHref,
  grammarTopicHref,
  LANGUAGE_LABEL,
  publicLevelFor,
  tryFormsHref,
} from '../../../lib/public-paths';
import { PublicHeader } from '../public-header';
import { AppFooter } from '../../shell/app-footer';
import { TheorySections } from '../../theory/theory-sections';
import { TopicBreadcrumbs } from './topic-breadcrumbs';
import { TopicToc } from './topic-toc';
import { PracticeRail } from './practice-rail';
import { QuickCheck } from './quick-check';
import { RelatedTopicsGrid } from './related-topics-grid';

/**
 * `TheorySections` is keyed by the `Language` enum (`LearningLanguage`), while
 * every public surface passes the string-literal `PublicLanguage`. Mapping the
 * three keys explicitly keeps one source of truth without casting a string
 * literal onto an enum member — same reasoning as `LANGUAGE_LABEL` in
 * `lib/public-paths.ts`.
 */
const LEARNING_LANGUAGE: Record<PublicLanguage, LearningLanguage> = {
  ES: Language.ES,
  DE: Language.DE,
  TR: Language.TR,
};

export type PagerNeighbour = { id: string; title: string; cefr: string };

/**
 * Neighbours within the same CEFR level, in the hub's own sort order.
 *
 * `current.id` must be the URL SLUG (`a2-ser-vs-estar`), matching
 * `PublicTopicSummary.id` from the hub list — NOT the full grammar-point key
 * (`es-a2-ser-vs-estar`) that `TheoryTopic.id` carries. The two id spaces meet
 * right here, which is why `GrammarTopic` below passes the route's `topicId`
 * param rather than `topic.id`.
 */
export function pagerNeighbours(
  topics: PublicTopicSummary[],
  current: { id: string; cefr: string },
): { previous: PagerNeighbour | null; next: PagerNeighbour | null } {
  const sameLevel = topics
    .filter((t) => t.cefr === current.cefr)
    .sort(
      (x, y) =>
        (x.order ?? Number.MAX_SAFE_INTEGER) - (y.order ?? Number.MAX_SAFE_INTEGER) ||
        x.title.localeCompare(y.title),
    );
  const i = sameLevel.findIndex((t) => t.id === current.id);
  if (i === -1) return { previous: null, next: null };
  const at = (n: number): PagerNeighbour | null => {
    const t = sameLevel[n];
    return t ? { id: t.id, title: t.title, cefr: t.cefr } : null;
  };
  return { previous: at(i - 1), next: at(i + 1) };
}

/**
 * Prev/next within the current CEFR level. Renders nothing (no `<nav>` at
 * all) when a level has only one topic — both arms absent is not a degraded
 * state, it is the honest edge case.
 */
export function TopicPager({
  lang,
  previous,
  next,
}: {
  lang: PublicLanguage;
  previous: PagerNeighbour | null;
  next: PagerNeighbour | null;
}) {
  if (!previous && !next) return null;
  return (
    <nav
      aria-label="More in this level"
      className="flex flex-col gap-s-3 border-t border-rule pt-s-5 sm:flex-row sm:justify-between"
    >
      {previous && (
        <Link
          href={grammarTopicHref(lang, previous.id)}
          className="flex flex-col gap-[2px] rounded-lg border border-rule p-s-4 no-underline"
        >
          <span className="t-mono text-[11px] text-ink-mute">← previous</span>
          <span className="t-body font-medium text-ink">{previous.title}</span>
        </Link>
      )}
      {next && (
        <Link
          href={grammarTopicHref(lang, next.id)}
          className="ml-auto flex flex-col gap-[2px] rounded-lg border border-rule p-s-4 text-right no-underline"
        >
          <span className="t-mono text-[11px] text-ink-mute">next →</span>
          <span className="t-body font-medium text-ink">{next.title}</span>
        </Link>
      )}
    </nav>
  );
}

/**
 * The topic page itself: hero, breadcrumbs, TOC, article body, practise rail,
 * related topics, prev/next pager. Everything here runs server-side with no
 * hooks of its own — `renderTheoryTopicJson` (inside `fetchPublicTopic`) is a
 * pure function, so the whole article is in the initial HTML a crawler sees.
 * `TopicToc` is the one client component in the tree, and only for the
 * scroll-spy highlight; its anchors are plain server-rendered `<a href="#…">`.
 *
 * The hub list is fetched alongside the topic (not after) purely to compute
 * the pager — nothing else on this page needs it, so there is no reason to
 * wait for it serially.
 */
export async function GrammarTopic({
  lang,
  topicId,
}: {
  lang: PublicLanguage;
  topicId: string;
}) {
  const [{ topic, envelope, readingMinutes }, topics] = await Promise.all([
    fetchPublicTopic(lang, topicId),
    fetchPublicTopicList(lang),
  ]);

  const { previous, next } = pagerNeighbours(topics, { id: topicId, cefr: topic.cefr });
  const tocSections = topic.sections.map((s) => ({ id: s.id, title: s.title }));
  // `topic.cefr` is a plain string from content_json — narrowed via
  // `publicLevelFor` rather than asserted, so an out-of-range level omits the
  // quick check's drill link instead of building a `tryFormsHref` that 400s.
  const drillLevel = publicLevelFor(lang, topic.cefr);

  return (
    <div className="mx-auto flex max-w-[1080px] flex-col px-s-4 py-s-6">
      <PublicHeader activeLanguage={lang} languageHref={(l) => grammarIndexHref(l)} />
      <main className="flex flex-col gap-s-6 pt-s-6">
        <TopicBreadcrumbs lang={lang} cefr={topic.cefr} title={topic.title} />

        <div className="flex flex-col gap-s-3">
          <div className="flex items-center gap-s-3">
            <span className="t-mono text-[11px] tracking-[1px] text-ink-mute uppercase">
              {topic.cefr} · {LANGUAGE_LABEL[lang]}
            </span>
            <span className="t-small text-ink-mute">{readingMinutes} min read</span>
          </div>
          <h1 className="t-display-l">{topic.title}</h1>
          <p className="t-body m-0 text-ink-mute">{topic.subtitle}</p>
        </div>

        <div className="grid grid-cols-1 gap-s-6 lg:grid-cols-[1fr_260px] lg:items-start">
          <article className="theory-public flex flex-col">
            <TheorySections
              topic={topic}
              language={LEARNING_LANGUAGE[lang]}
              onSwitchTopic={() => undefined}
            />
            <QuickCheck
              items={envelope.quickCheck}
              drillHref={
                envelope.hasConjugationDrill && drillLevel
                  ? tryFormsHref(lang, drillLevel, topic.id)
                  : null
              }
            />
          </article>
          <aside aria-label="Topic navigation" className="flex flex-col gap-s-5">
            <TopicToc sections={tocSections} />
            <PracticeRail
              lang={lang}
              cefr={topic.cefr}
              grammarPointKey={topic.id}
              hasConjugationDrill={envelope.hasConjugationDrill}
            />
          </aside>
        </div>

        <RelatedTopicsGrid lang={lang} related={envelope.related} />
        <TopicPager lang={lang} previous={previous} next={next} />
      </main>
      <AppFooter />
    </div>
  );
}
