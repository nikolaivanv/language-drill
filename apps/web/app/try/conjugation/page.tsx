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

function parseLang(raw: string | undefined): PublicLanguage {
  const upper = (raw ?? '').toUpperCase();
  return (LANGS as string[]).includes(upper) ? (upper as PublicLanguage) : 'ES';
}

function parseLevel(raw: string | undefined): PublicLevel {
  const upper = (raw ?? '').toUpperCase();
  return (LEVELS as string[]).includes(upper) ? (upper as PublicLevel) : 'B1';
}

/**
 * Public, unauthenticated conjugation drill. `?lang=` / `?level=` make a posted
 * link pre-targeted (a Turkish link for a Turkish community, not a picker), and
 * anything unrecognised falls back to ES/B1 rather than erroring.
 */
export default async function TryConjugationPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string; level?: string }>;
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
        <nav className="flex gap-s-4">
          {LEVELS.map((l) => (
            <Link
              key={l}
              href={`/try/conjugation?lang=${lang}&level=${l}`}
              className={l === level ? 't-small' : 't-small text-ink-mute'}
            >
              {l}
            </Link>
          ))}
        </nav>
      </header>

      <div className="flex gap-s-4">
        {LANGS.map((l) => (
          <Link
            key={l}
            href={`/try/conjugation?lang=${l}&level=${level}`}
            className={l === lang ? 't-body' : 't-body text-ink-mute'}
          >
            {l}
          </Link>
        ))}
      </div>

      <PublicConjugationRunner lang={lang} level={level} />
    </main>
  );
}
