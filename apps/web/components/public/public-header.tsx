import Link from 'next/link';
import { LANGUAGE_NATIVE_NAMES, Language } from '@language-drill/shared';
import type { PublicLanguage } from '@language-drill/api-client';
import { cn } from '../../lib/cn';
import { ThemeCycleButton } from './theme-cycle-button';

/**
 * Chrome for the signed-out surfaces: the wordmark, a language rail, and the
 * theme control. Nothing here configures the drill — level and grammar-point
 * selection live with the content, so the header stays the same on every public
 * page and a visitor learns it once.
 *
 * The wordmark matches the marketing pages' `.df-brand-name` (Fraunces 22/600,
 * -0.5px) rather than inventing a second mark, and the rail echoes their
 * language pills. Those styles live under a `.df` scope that is not global, so
 * they are rebuilt here on the app's own tokens — which also means the chrome
 * flips with the theme for free.
 *
 * `languageHref` is supplied by the page because the rail means different
 * things in different places: on a language landing page it navigates to
 * another language's page, on the drill it re-targets the current sitting.
 *
 * The sign-up link is here, and quiet, for one reason: every other entry point
 * on these pages is at the END — the debrief after ten items, the footer of a
 * landing page. Someone who abandons at item three currently never sees one at
 * all. It is a text link rather than a button because the page's primary action
 * is the drill, and a button here would compete with it.
 */

const LANGS: readonly PublicLanguage[] = ['ES', 'DE', 'TR'];

/**
 * `LANGUAGE_NATIVE_NAMES` is keyed by the `Language` ENUM, while every public
 * surface passes the string-literal `PublicLanguage`. Mapping the three keys
 * explicitly keeps one source of truth for the names without casting a string
 * literal onto an enum member at each use.
 */
const NATIVE_NAME: Record<PublicLanguage, string> = {
  ES: LANGUAGE_NATIVE_NAMES[Language.ES],
  DE: LANGUAGE_NATIVE_NAMES[Language.DE],
  TR: LANGUAGE_NATIVE_NAMES[Language.TR],
};

export interface PublicHeaderProps {
  /** Rendered as the current language in the rail. Omit on pages with no language. */
  activeLanguage?: PublicLanguage;
  /** Destination for each language pill. Omit to hide the rail entirely. */
  languageHref?: (language: PublicLanguage) => string;
  className?: string;
}

export function PublicHeader({
  activeLanguage,
  languageHref,
  className,
}: PublicHeaderProps) {
  return (
    <header
      className={cn(
        'flex items-center justify-between gap-s-4 border-b border-rule py-s-3',
        className,
      )}
    >
      <Link
        href="/"
        aria-label="drill — home"
        className="font-display text-[22px] font-semibold tracking-[-0.5px] text-ink no-underline"
      >
        drill
      </Link>

      <div className="flex flex-wrap items-center justify-end gap-s-3">
        {languageHref && (
          <nav aria-label="language" className="flex items-center gap-[4px] rounded-[10px] bg-paper-2 p-[4px]">
            {LANGS.map((language) => {
              const active = language === activeLanguage;
              return (
                <Link
                  key={language}
                  href={languageHref(language)}
                  aria-current={active ? 'page' : undefined}
                  lang={language.toLowerCase()}
                  className={cn(
                    'rounded-[7px] px-[10px] py-[5px] text-[13px] no-underline transition-colors duration-150',
                    active
                      ? 'border border-rule bg-card text-ink'
                      : 'border border-transparent text-ink-mute hover:text-ink',
                  )}
                >
                  {NATIVE_NAME[language]}
                </Link>
              );
            })}
          </nav>
        )}
        <ThemeCycleButton />
        <Link
          href="/sign-up"
          className="text-[13px] whitespace-nowrap text-ink-mute underline underline-offset-2 hover:text-ink"
        >
          sign up
        </Link>
      </div>
    </header>
  );
}
