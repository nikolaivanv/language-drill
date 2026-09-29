import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicConjugationRunner } from './_components/public-conjugation-runner';
import type { PublicLanguage, PublicLevel } from '@language-drill/api-client';

export const metadata: Metadata = {
  title: 'drill — try a conjugation set',
  description:
    'Ten conjugation prompts in Spanish, German or Turkish, graded instantly. No signup.',
};

const LANGS: PublicLanguage[] = ['ES', 'DE', 'TR'];
const LEVELS: PublicLevel[] = ['A1', 'A2', 'B1', 'B2'];

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

function parseLevel(raw: string | string[] | undefined): PublicLevel {
  const upper = (first(raw) ?? '').toUpperCase();
  return (LEVELS as string[]).includes(upper) ? (upper as PublicLevel) : 'B1';
}

/**
 * Public, unauthenticated conjugation drill. `?lang=` / `?level=` make a posted
 * link pre-targeted (a Turkish link for a Turkish community, not a picker), and
 * anything unrecognised — including a duplicated param — falls back to ES/B1
 * rather than erroring.
 */
export default async function TryConjugationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { lang: rawLang, level: rawLevel } = await searchParams;
  const lang = parseLang(rawLang);
  const level = parseLevel(rawLevel);

  return (
    <main className="mx-auto flex max-w-[640px] flex-col gap-s-6 px-s-4 py-s-8">
      <header className="flex items-baseline justify-between">
        <Link href="/" className="t-body">
          drill
        </Link>
        <nav aria-label="level" className="flex gap-s-4">
          {LEVELS.map((l) => (
            <Link
              key={l}
              href={`/try/conjugation?lang=${lang}&level=${l}`}
              aria-current={l === level ? 'page' : undefined}
              className={
                l === level ? 't-small' : 't-small text-ink-mute underline underline-offset-2'
              }
            >
              {l}
            </Link>
          ))}
        </nav>
      </header>

      <h1 className="t-display-m">try a conjugation set</h1>

      <nav aria-label="language" className="flex gap-s-4">
        {LANGS.map((l) => (
          <Link
            key={l}
            href={`/try/conjugation?lang=${l}&level=${level}`}
            aria-current={l === lang ? 'page' : undefined}
            className={
              l === lang ? 't-body' : 't-body text-ink-mute underline underline-offset-2'
            }
          >
            {l}
          </Link>
        ))}
      </nav>

      <PublicConjugationRunner lang={lang} level={level} />
    </main>
  );
}
