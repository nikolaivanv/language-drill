import type { MetadataRoute } from 'next';
import type { PublicLanguage } from '@language-drill/shared';
import { fetchPublicTopicList } from '../lib/public-theory';
import { grammarIndexHref, grammarTopicHref } from '../lib/public-paths';

/**
 * The pages that should be found in search.
 *
 * `/try/forms` is listed without its query string: the same page serves every
 * language and level through `?lang=`/`?level=`, so indexing the permutations
 * would spread the same content over dozens of near-duplicate URLs. The
 * language landings are the canonical entry points and carry the content a
 * crawler should actually read.
 *
 * The grammar surface (`/<language>/grammar` and its topics) is appended below
 * for the same reason, but it has to fetch the live topic list to do it — see
 * `grammarEntries` for why that fetch's error policy inverts the one
 * `fetchPublicTopicList` otherwise guarantees.
 *
 * Signed-in surfaces are absent by construction — everything under the
 * dashboard requires an account, so there is nothing for a crawler to reach.
 */
const SITE = 'https://www.langdrill.app';

// `next build` must not call the live API — see F2 in the final-fix findings.
// Previously this carried `export const revalidate = 3600` (matching
// `REVALIDATE_SECONDS` in `lib/public-theory.ts`), which let `next build`
// prerender the whole sitemap by fetching every language's topic list at
// build time. `force-dynamic` forces every fetch here to `{ cache: 'no-store' }`
// instead, which supersedes — and would make misleading — a `revalidate`
// export, so that is intentionally gone: a crawler sweep now costs one live
// API call per language per request, not a cached document.
export const dynamic = 'force-dynamic';

const LANGS: PublicLanguage[] = ['ES', 'DE', 'TR'];

/**
 * `fetchPublicTopicList` is written to throw on anything but a genuine 404,
 * and every page that calls it must let that throw propagate — rendering an
 * empty library during an outage would lie to a reader. A sitemap is
 * different: Next serves `sitemap.ts`'s thrown error as a 500 for the WHOLE
 * document, which means an outage in one language would take down the
 * `/`, the landings, and every other language's URLs along with it — URLs
 * that already rank. So here, and only here, a per-language failure is
 * caught and swallowed: the hub URL for that language still ships (it is a
 * real route regardless of whether the API answered), its topics are simply
 * omitted for this revalidation window, and the other languages are
 * unaffected. Losing one language's topic URLs for an hour is strictly
 * better than losing all 322.
 */
async function grammarEntries(): Promise<MetadataRoute.Sitemap> {
  const perLanguage = await Promise.all(
    LANGS.map(async (lang) => {
      const hub = {
        url: `${SITE}${grammarIndexHref(lang)}`,
        changeFrequency: 'weekly' as const,
        priority: 0.8,
      };
      try {
        const topics = await fetchPublicTopicList(lang);
        return [
          hub,
          ...topics.map((t) => ({
            url: `${SITE}${grammarTopicHref(lang, t.id)}`,
                changeFrequency: 'monthly' as const,
            priority: 0.6,
          })),
        ];
      } catch {
        return [hub];
      }
    }),
  );
  return perLanguage.flat();
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // No `lastModified`: this document is force-dynamic, so `new Date()` would
  // stamp every URL as changed on every fetch. Google ignores a lastmod that is
  // never accurate, so omitting it is the honest signal until pages carry a
  // real content timestamp.
  return [
    { url: `${SITE}/`, changeFrequency: 'monthly', priority: 1 },
    { url: `${SITE}/spanish`, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${SITE}/german`, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${SITE}/turkish`, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${SITE}/try/forms`, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${SITE}/why-not-chatgpt`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${SITE}/academic-rigour`, changeFrequency: 'monthly', priority: 0.5 },
    ...(await grammarEntries()),
  ];
}
