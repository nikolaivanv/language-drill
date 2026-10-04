import Link from 'next/link';
import {
  PUBLIC_LEVELS_BY_LANGUAGE,
  PublicPointsResponseSchema,
  type PublicLanguage,
  type PublicLevel,
  type PublicPoint,
} from '@language-drill/api-client';
import { PublicHeader } from './public-header';
import { LandingTryBlock } from './landing-try-block';
import { LANDING_PATH, grammarIndexHref } from '../../lib/public-paths';

export { LANDING_PATH };

/**
 * A language's entry point, and the page meant to be found in search.
 *
 * The list of what you can drill IS the indexable content and IS the picker —
 * one thing doing both jobs, rather than a marketing page that describes a
 * product sitting behind it. That is why the points are fetched on the SERVER:
 * a client-rendered list is not content a crawler can read.
 *
 * The hero is the working drill rather than a headline or a screenshot,
 * because the claim being made is that you produce forms instead of
 * recognising them, and a visitor can test that claim in one keystroke.
 */

/** The level the hero draws from: B1 has content in all three languages. */
const HERO_LEVEL: PublicLevel = 'B1';

const COPY: Record<PublicLanguage, { title: string; lede: string; blurb: string }> = {
  ES: {
    title: 'Spanish forms, typed.',
    lede: 'Not multiple choice.',
    blurb:
      'Preterite, imperfect, conditional, future and the present subjunctive — you type the form, and it is checked the moment you press enter.',
  },
  DE: {
    title: 'German forms, typed.',
    lede: 'Not multiple choice.',
    blurb:
      'Present and Präteritum verb forms, modal verbs, adjective endings and weak nouns — you type the form, and it is checked the moment you press enter.',
  },
  TR: {
    title: 'Turkish forms, typed.',
    lede: 'Not multiple choice.',
    blurb:
      'Tenses from the present continuous to the evidential past, plus case and possessive suffixes — you type the form, and it is checked the moment you press enter.',
  },
};

const CATEGORY_LABEL: Record<string, string> = {
  tenses: 'Tenses',
  moods: 'Moods',
  pairs: 'Easily confused',
  morphology: 'Word forms',
  cases: 'Cases',
  syntax: 'Sentence structure',
  pronouns: 'Pronouns',
  articles: 'Articles',
  orthography: 'Spelling',
  other: 'Other',
};

function drillHref(lang: PublicLanguage, level: PublicLevel, point?: string): string {
  const params = new URLSearchParams({ lang, level });
  if (point) params.set('point', point);
  return `/try/forms?${params.toString()}`;
}

/**
 * Server-side, cached for an hour. The pool changes when generation runs, not
 * per request, and a stale-by-an-hour list is far better than a list a crawler
 * cannot see at all.
 */
async function fetchPoints(
  lang: PublicLanguage,
  level: PublicLevel,
): Promise<PublicPoint[]> {
  const base = process.env.NEXT_PUBLIC_API_URL;
  // Without an absolute base there is nothing to fetch server-side. The page
  // still renders — it just leads with the hero and the call to action.
  if (!base) return [];
  try {
    const res = await fetch(
      `${base}/public/conjugation/points?lang=${lang}&level=${level}`,
      { next: { revalidate: 3600 } },
    );
    if (!res.ok) return [];
    return PublicPointsResponseSchema.parse(await res.json()).points;
  } catch {
    return [];
  }
}

export async function LanguageLanding({ lang }: { lang: PublicLanguage }) {
  const levels = PUBLIC_LEVELS_BY_LANGUAGE[lang];
  const copy = COPY[lang];

  const byLevel = await Promise.all(
    levels.map(async (level) => ({ level, points: await fetchPoints(lang, level) })),
  );
  const populated = byLevel.filter((entry) => entry.points.length > 0);

  return (
    <div className="mx-auto flex max-w-[720px] flex-col px-s-4 py-s-6">
      <PublicHeader
        activeLanguage={lang}
        languageHref={(l) => LANDING_PATH[l]}
      />

      <main className="flex flex-col gap-s-8 pt-s-7">
        <section className="flex flex-col gap-s-5">
          <div className="flex flex-col gap-s-3">
            <h1 className="font-display text-[40px] leading-[1.08] font-medium tracking-[-0.8px] text-ink">
              {copy.title}
              <br />
              <span className="text-ink-mute">{copy.lede}</span>
            </h1>
            <p className="t-body-l max-w-[52ch]">{copy.blurb}</p>
            <p className="t-small text-ink-mute">
              Nothing is saved — no signup.
            </p>
          </div>

          <LandingTryBlock
            lang={lang}
            level={HERO_LEVEL}
            drillHref={drillHref(lang, HERO_LEVEL)}
          />
        </section>

        {populated.length > 0 && (
          <section className="flex flex-col gap-s-5">
            <div className="flex items-baseline justify-between gap-s-3">
              <h2 className="t-display-m">What you can drill</h2>
              {/* This is the edge that makes the grammar hub reachable by a
                  crawler from an already-indexed page. Worded as reading
                  rather than drilling — the hub explains, it doesn't grade. */}
              <Link
                href={grammarIndexHref(lang)}
                className="t-small shrink-0 text-ink-mute underline underline-offset-2 hover:text-ink"
              >
                Grammar explained →
              </Link>
            </div>
            {populated.map(({ level, points }) => (
              <div key={level} className="flex flex-col gap-s-2">
                <div className="flex items-baseline justify-between gap-s-3">
                  <h3 className="t-body font-medium text-ink">{level}</h3>
                  <Link href={drillHref(lang, level)} className="t-small text-ink-mute underline underline-offset-2 hover:text-ink">
                    drill everything at {level}
                  </Link>
                </div>
                {groupByCategory(points).map(([category, categoryPoints]) => (
                  <div key={category} className="flex flex-col">
                    <p className="t-small text-ink-mute">
                      {CATEGORY_LABEL[category] ?? CATEGORY_LABEL.other}
                    </p>
                    {categoryPoints.map((point) => (
                      <Link
                        key={point.key}
                        href={drillHref(lang, level, point.key)}
                        className="flex items-baseline justify-between gap-s-3 border-t border-rule py-[7px] text-ink-2 no-underline hover:text-ink"
                      >
                        <span className="text-[14px]">{point.name}</span>
                        <span className="shrink-0 font-mono text-[12px] text-ink-mute">
                          {point.count}
                        </span>
                      </Link>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </section>
        )}

        <section className="flex flex-col gap-s-2 border-t border-rule pt-s-5">
          <p className="t-body">
            Drilling here is not saved. An account keeps track of which forms
            you actually know, and what to practise next.
          </p>
          <Link href="/sign-up" className="link-arrow self-start">
            Create an account
            <span className="lk-arr" aria-hidden="true">
              →
            </span>
          </Link>
        </section>
      </main>
    </div>
  );
}

function groupByCategory(points: readonly PublicPoint[]): [string, PublicPoint[]][] {
  const byCategory = new Map<string, PublicPoint[]>();
  for (const point of points) {
    const list = byCategory.get(point.category) ?? [];
    list.push(point);
    byCategory.set(point.category, list);
  }
  return [...byCategory.entries()];
}
