import type { Metadata } from 'next';

export const SITE_NAME = 'drill';

/** The shared-link card rendered by `app/opengraph-image.tsx`. */
export const OG_IMAGE = {
  url: '/opengraph-image',
  width: 1200,
  height: 630,
  alt: 'drill — type it, don’t tap it. Spanish, German and Turkish practice.',
};

/**
 * Metadata for a public, indexable page: title, description, canonical, and
 * the Open Graph / Twitter tags a shared link renders its card from.
 *
 * Next merges metadata SHALLOWLY per top-level key, so a page that sets
 * `title` but not `openGraph` inherits the root layout's `openGraph` whole —
 * its `og:title` and `og:url` would describe the home page, not this one.
 * Every public page therefore builds all three blocks here, from one set of
 * strings. The image is named explicitly for the same reason: Next attaches
 * the root `app/opengraph-image.tsx` only to routes that set no `openGraph` of
 * their own, so every page built here would otherwise ship without one.
 *
 * `title` goes through the root `title.template` (`%s · drill`); pass
 * `absoluteTitle` for a page whose title already carries the brand. `og:title`
 * is always the bare title — `og:site_name` carries the brand there.
 */
export function publicPageMetadata({
  title,
  description,
  path,
  absoluteTitle = false,
}: {
  title: string;
  description: string;
  path: string;
  absoluteTitle?: boolean;
}): Metadata {
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: 'website',
      siteName: SITE_NAME,
      locale: 'en',
      url: path,
      title,
      description,
      images: [OG_IMAGE],
    },
    twitter: { card: 'summary_large_image', title, description, images: [OG_IMAGE] },
  };
}
