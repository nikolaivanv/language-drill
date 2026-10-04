import Link from 'next/link';
import type { PublicLanguage } from '@language-drill/shared';
import { grammarIndexHref, LANGUAGE_LABEL } from '../../../lib/public-paths';

const SITE = 'https://www.langdrill.app';

/**
 * Visible breadcrumb trail + a matching `BreadcrumbList` JSON-LD block, so a
 * search result can show the trail Google renders for an article. The
 * language name comes from `LANGUAGE_LABEL` (keyed by `PublicLanguage`) rather
 * than indexing `LANGUAGE_NAMES` (keyed by the `Language` enum) with a cast —
 * see `lib/public-paths.ts` for why that map exists.
 */
export function TopicBreadcrumbs({
  lang,
  cefr,
  title,
}: {
  lang: PublicLanguage;
  cefr: string;
  title: string;
}) {
  const languageName = LANGUAGE_LABEL[lang];
  const hub = grammarIndexHref(lang);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'drill', item: SITE },
      { '@type': 'ListItem', position: 2, name: `${languageName} grammar`, item: `${SITE}${hub}` },
      { '@type': 'ListItem', position: 3, name: title },
    ],
  };
  return (
    <>
      <nav aria-label="Breadcrumb" className="t-small text-ink-mute">
        <ol className="m-0 flex list-none flex-wrap gap-s-2 p-0">
          <li><Link href="/" className="text-ink-mute">drill</Link></li>
          <li aria-hidden="true">›</li>
          <li><Link href={hub} className="text-ink-mute">{languageName} grammar</Link></li>
          <li aria-hidden="true">›</li>
          <li><Link href={`${hub}#${cefr.toLowerCase()}`} className="text-ink-mute">{cefr}</Link></li>
          <li aria-hidden="true">›</li>
          <li aria-current="page" className="text-ink">{title}</li>
        </ol>
      </nav>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </>
  );
}
