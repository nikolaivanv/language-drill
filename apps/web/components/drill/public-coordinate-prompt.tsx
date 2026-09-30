'use client';

import type { ConjugationContent } from '@language-drill/shared';

/**
 * The prompt for the public drill, as a coordinate block.
 *
 * The task this surface sets is "produce the form at these coordinates", so the
 * prompt is rendered as the address itself: a lemma, then one row per
 * grammatical dimension, then the cell the learner fills. That is the native
 * shape of an inflection table, and it is why this does not reuse the
 * dashboard's `ConjugationPromptCard` — that renders the same data as a row of
 * pills, with the subject in a filled accent badge and both glosses in
 * `t-micro`, which is `text-transform: uppercase`. Shouting WE and PRESENT
 * SUBJUNCTIVE at a first-time visitor is noise, and the pills give the subject
 * a visual weight the grammar doesn't.
 *
 * `features` is present on 100% of approved rows in all three languages, so it
 * is the reliable coordinate carrier; `subject` is present on 100% of Spanish
 * but only ~53% of German, because an adjective-declension item like
 * "den wichtigen Informationen" genuinely has no subject pronoun. So the
 * subject is one more optional row rather than a fixed slot — a block with
 * fewer rows, not a block with a hole in it.
 *
 * Typeface carries meaning here: the target language is set in the display
 * serif (also load-bearing — its latin-ext subset is what renders Turkish
 * ğ/ş/İ), the grammatical terms in mono because they are coded values, and
 * English in the UI sans.
 */

export interface PublicCoordinatePromptProps {
  content: ConjugationContent;
  /** 1-based position in the sitting, shown on the lemma's baseline. */
  position?: { index: number; total: number };
}

export function PublicCoordinatePrompt({
  content,
  position,
}: PublicCoordinatePromptProps) {
  const features = content.features ?? [];
  const subject = content.subject;

  const rows: { term: string; gloss: string }[] = [
    ...(subject ? [{ term: subject.pronoun, gloss: subject.gloss }] : []),
    ...features.map((f) => ({ term: f.term, gloss: f.gloss })),
  ];

  return (
    <div className="flex flex-col gap-s-3">
      <div className="flex flex-col gap-[2px]">
        <div className="flex items-baseline justify-between gap-s-3">
          <p
            lang={contentLang(content)}
            className="font-display text-[34px] leading-[1.1] font-medium tracking-[-0.4px] text-ink"
          >
            {content.lemma}
          </p>
          {position && (
            <p className="shrink-0 font-mono text-[12px] text-ink-mute">
              {position.index} / {position.total}
            </p>
          )}
        </div>
        <p className="t-body text-ink-mute">{content.lemmaGloss}</p>
      </div>

      {rows.length > 0 ? (
        <dl className="m-0 flex flex-col">
          {rows.map((row) => (
            <div
              key={`${row.term}|${row.gloss}`}
              className="flex items-baseline justify-between gap-s-4 border-t border-rule py-[7px]"
            >
              <dt className="font-mono text-[13px] leading-[1.4] text-ink">{row.term}</dt>
              <dd className="m-0 text-right text-[13px] leading-[1.4] text-ink-mute">{row.gloss}</dd>
            </div>
          ))}
        </dl>
      ) : (
        // Older rows carry only the flat string. Keep it readable rather than
        // trying to split a field that was never structured.
        <p className="border-t border-rule pt-[7px] font-mono text-[13px] text-ink-soft">
          {content.featureBundle}
        </p>
      )}
    </div>
  );
}

/**
 * Tags the lemma with its language so a screen reader switches voice, and so
 * the browser picks the right shaping. The content type carries no language
 * field, so this is inferred from the characters present rather than guessed.
 */
function contentLang(content: ConjugationContent): string | undefined {
  const text = `${content.lemma}${content.targetForm}`;
  if (/[ğışİĞŞ]/.test(text)) return 'tr';
  if (/[ñáéíóú¿¡]/i.test(text)) return 'es';
  if (/[äöüß]/i.test(text)) return 'de';
  return undefined;
}
