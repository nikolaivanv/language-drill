import Link from 'next/link';
import type { PublicLanguage } from '@language-drill/shared';
import { publicLevelFor, tryFormsHref } from '../../../lib/public-paths';

/**
 * The drill card renders only when the point genuinely has a public
 * conjugation pool — true of 38 of 312 topics. On the rest the rail is the
 * sign-up box alone, which is the honest state; the index's per-topic pill is
 * where a reader learns which topics are drillable.
 *
 * There is deliberately no "coached session" card: that surface is specced but
 * not built, and offering it would be the one thing the public pages must never
 * do — promise something that does not exist.
 */
export function PracticeRail({
  lang,
  cefr,
  grammarPointKey,
  hasConjugationDrill,
}: {
  lang: PublicLanguage;
  cefr: string;
  grammarPointKey: string;
  hasConjugationDrill: boolean;
}) {
  // `cefr` is a plain string from content_json — narrowed via `publicLevelFor`
  // rather than asserted, so an out-of-range level omits the link instead of
  // building a `tryFormsHref` that 400s. In practice `hasConjugationDrill` is
  // already false whenever the level is out of range, so this changes no
  // current behaviour; it just stops relying on that coincidence.
  const level = publicLevelFor(lang, cefr);
  return (
    <aside aria-label="Practise" className="flex flex-col gap-s-3">
      <div className="t-mono text-[11px] tracking-[1.6px] text-ink-mute uppercase">
        Practise this topic
      </div>
      {hasConjugationDrill && level && (
        <Link
          href={tryFormsHref(lang, level, grammarPointKey)}
          className="flex flex-col gap-s-2 rounded-lg border border-rule bg-card p-s-4 no-underline"
        >
          <span className="t-mono text-[11px] text-accent-2">free · unlimited</span>
          <span className="t-body font-medium text-ink">Drill these forms</span>
          <span className="t-small text-ink-mute">
            Type each form, graded the moment you press enter. No account needed.
          </span>
          <span className="t-small text-accent-2">Start drilling →</span>
        </Link>
      )}
      <div className="rounded-lg border border-dashed border-rule-strong p-s-4">
        <p className="t-small m-0 text-ink-soft">
          With a free account, drill tracks this topic and brings it back when you
          start to slip.
        </p>
        <Link href="/sign-up" className="link-arrow mt-s-3 inline-flex">
          Sign up free
        </Link>
      </div>
    </aside>
  );
}
