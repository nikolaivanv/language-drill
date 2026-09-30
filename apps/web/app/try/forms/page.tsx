import type { Metadata } from 'next';
import Link from 'next/link';
import { LANGUAGE_NAMES, Language } from '@language-drill/shared';
import { PublicHeader } from '../../../components/public/public-header';
import { PublicConjugationRunner } from './_components/public-conjugation-runner';
import {
  PUBLIC_LEVELS_BY_LANGUAGE,
  type PublicLanguage,
  type PublicLevel,
} from '@language-drill/api-client';

export const metadata: Metadata = {
  title: 'drill — type the form',
  description:
    'Practise producing Spanish, German and Turkish forms — verb tenses, cases, ' +
    'adjective endings — typed, not tapped, and graded the moment you press enter. ' +
    'No signup.',
};

const LANGS: PublicLanguage[] = ['ES', 'DE', 'TR'];

// B1 has content for every language in PUBLIC_LEVELS_BY_LANGUAGE, so it is a
// safe universal fallback for an unrecognised or duplicated `?level=` — and
// for a `?lang=` switch that lands on a level the new language doesn't offer.
const DEFAULT_LEVEL: PublicLevel = 'B1';

/**
 * Next's App Router hands every search param as `string | string[] | undefined`
 * — a repeated query key (`?lang=ES&lang=DE`, exactly what a hand-edited or
 * tool-generated share link produces) arrives as an array. Picking the first
 * entry keeps this deterministic without ever calling `.toUpperCase()` on an
 * array and throwing.
 */
function first(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

function parseLang(raw: string | string[] | undefined): PublicLanguage {
  const upper = (first(raw) ?? '').toUpperCase();
  return (LANGS as string[]).includes(upper) ? (upper as PublicLanguage) : 'ES';
}

/**
 * Validates against the LANGUAGE-SPECIFIC level list, not the union of all
 * four — the pool has zero approved rows for ES/DE at B2, so a level that is
 * merely a valid `PublicLevel` in general must still fall back if it isn't
 * one this language actually offers. Also the guard for a `?lang=` switch:
 * calling this with the new language and the old level lands on
 * `DEFAULT_LEVEL` rather than an empty cell.
 */
function levelForLanguage(raw: string, lang: PublicLanguage): PublicLevel {
  const upper = raw.toUpperCase();
  const allowed = PUBLIC_LEVELS_BY_LANGUAGE[lang] as string[];
  return allowed.includes(upper) ? (upper as PublicLevel) : DEFAULT_LEVEL;
}

/**
 * Public, unauthenticated conjugation drill. `?lang=` / `?level=` make a posted
 * link pre-targeted (a Turkish link for a Turkish community, not a picker), and
 * anything unrecognised — including a duplicated param, or a level the current
 * language doesn't offer — falls back gracefully rather than erroring or
 * landing on an empty cell.
 */
export default async function TryConjugationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { lang: rawLang, level: rawLevel, point: rawPoint } = await searchParams;
  const lang = parseLang(rawLang);
  const level = levelForLanguage(first(rawLevel) ?? '', lang);
  const levels = PUBLIC_LEVELS_BY_LANGUAGE[lang];
  // Passed through unvalidated on purpose: the server checks it against the
  // curriculum and 400s an unknown key, so validating here as well would mean
  // shipping the curriculum to the browser to duplicate a check that already
  // exists where it can be trusted.
  const grammarPoint = first(rawPoint);

  return (
    <div className="mx-auto flex max-w-[640px] flex-col px-s-4 py-s-6">
      <PublicHeader
        activeLanguage={lang}
        languageHref={(l) => `/try/forms?lang=${l}&level=${levelForLanguage(level, l)}`}
      />

      <main className="flex flex-col gap-s-6 pt-s-6">
        <div className="flex flex-col gap-s-2">
          <h1 className="t-display-m">{LANGUAGE_NAMES[lang as Language]} forms</h1>
          <p className="t-body text-ink-mute">Type the form the cues ask for.</p>
          <p className="t-small text-ink-mute">Nothing is saved — no signup.</p>
        </div>

        <nav aria-label="level" className="flex items-center gap-s-3">
          {levels.map((l) => (
            <Link
              key={l}
              href={`/try/forms?lang=${lang}&level=${l}`}
              aria-current={l === level ? 'page' : undefined}
              className={
                l === level
                  ? 't-small text-ink'
                  : 't-small text-ink-mute underline underline-offset-2'
              }
            >
              {l}
            </Link>
          ))}
        </nav>

        <PublicConjugationRunner
          lang={lang}
          level={level}
          grammarPoint={grammarPoint}
          availableLevels={levels}
        />
      </main>
    </div>
  );
}
