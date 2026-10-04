import {
  LANGUAGE_NAMES,
  Language,
  PUBLIC_LEVELS_BY_LANGUAGE,
  type PublicLanguage,
  type PublicLevel,
} from '@language-drill/shared';

/**
 * One source for every public URL. `/spanish` rather than `/es` is deliberate:
 * those paths shipped in #748 and are already in the sitemap, and the language
 * name is the term people search.
 */
export const LANDING_PATH: Record<PublicLanguage, string> = {
  ES: '/spanish',
  DE: '/german',
  TR: '/turkish',
};

/** Inverse of LANDING_PATH, for route wrappers that know only their folder. */
export const LANGUAGE_FOR_PATH: Record<string, PublicLanguage> = {
  spanish: 'ES',
  german: 'DE',
  turkish: 'TR',
};

/**
 * `LANGUAGE_NAMES` is keyed by the `Language` enum while every public surface
 * passes the string-literal `PublicLanguage`. Mapping the three keys explicitly
 * keeps one source of truth for the names without casting a string literal onto
 * an enum member at each use — the same reason `components/public/public-header.tsx`
 * builds its own `NATIVE_NAME` map rather than indexing with a cast.
 */
export const LANGUAGE_LABEL: Record<PublicLanguage, string> = {
  ES: LANGUAGE_NAMES[Language.ES],
  DE: LANGUAGE_NAMES[Language.DE],
  TR: LANGUAGE_NAMES[Language.TR],
};

export function grammarIndexHref(lang: PublicLanguage): string {
  return `${LANDING_PATH[lang]}/grammar`;
}

export function grammarTopicHref(lang: PublicLanguage, topicId: string): string {
  return `${grammarIndexHref(lang)}/${encodeURIComponent(topicId)}`;
}

/**
 * `cefr` on a topic/point comes from `content_json` as a plain string, not a
 * validated `PublicLevel` — narrowed here rather than asserted with `as
 * PublicLevel`, because a level the public drill does not offer for this
 * language (e.g. a stray "C1") would otherwise produce a `tryFormsHref` link
 * that falls back to a different level while still carrying `point=`, which
 * the API rejects with a 400 — a reader lands on an empty drill.
 */
export function publicLevelFor(lang: PublicLanguage, cefr: string): PublicLevel | null {
  const levels = PUBLIC_LEVELS_BY_LANGUAGE[lang] as string[];
  return levels.includes(cefr) ? (cefr as PublicLevel) : null;
}

export function tryFormsHref(
  lang: PublicLanguage,
  level: PublicLevel,
  point?: string,
): string {
  const params = new URLSearchParams({ lang, level });
  if (point) params.set('point', point);
  return `/try/forms?${params.toString()}`;
}
