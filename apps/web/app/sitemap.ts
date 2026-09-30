import type { MetadataRoute } from 'next';

/**
 * The pages that should be found in search.
 *
 * `/try/forms` is listed without its query string: the same page serves every
 * language and level through `?lang=`/`?level=`, so indexing the permutations
 * would spread the same content over dozens of near-duplicate URLs. The
 * language landings are the canonical entry points and carry the content a
 * crawler should actually read.
 *
 * Signed-in surfaces are absent by construction — everything under the
 * dashboard requires an account, so there is nothing for a crawler to reach.
 */
const SITE = 'https://www.langdrill.app';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${SITE}/`, lastModified: now, changeFrequency: 'monthly', priority: 1 },
    { url: `${SITE}/spanish`, lastModified: now, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${SITE}/german`, lastModified: now, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${SITE}/turkish`, lastModified: now, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${SITE}/try/forms`, lastModified: now, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${SITE}/why-not-chatgpt`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${SITE}/academic-rigour`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
  ];
}
