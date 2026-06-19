'use client';

import type { ConjugationContent } from '@language-drill/shared';

export interface ConjugationFeatureBundleProps {
  content: ConjugationContent;
  /** 'card' = pronoun badge + chips (drill prompt); 'inline' = compact text (debrief). */
  variant?: 'card' | 'inline';
}

export function ConjugationFeatureBundle({
  content,
  variant = 'card',
}: ConjugationFeatureBundleProps) {
  const features = content.features ?? [];
  const subject = content.subject;
  const structured = features.length > 0;

  if (!structured) {
    if (variant === 'inline') return <>{content.featureBundle}</>;
    return <p className="t-body text-ink-mute mt-s-2">{content.featureBundle}</p>;
  }

  if (variant === 'inline') {
    const parts = [
      ...(subject ? [`${subject.pronoun} (${subject.gloss})`] : []),
      ...features.map((f) => `${f.term} (${f.gloss})`),
    ];
    return <>{parts.join(' · ')}</>;
  }

  return (
    <div className="mt-s-3 flex flex-wrap items-stretch gap-s-2">
      {subject && (
        <div
          className="flex flex-col justify-center rounded-lg px-s-3 py-s-2 text-center"
          style={{ background: 'var(--color-accent)' }}
        >
          <span className="t-display-s leading-none" style={{ color: 'var(--color-paper)' }}>
            {subject.pronoun}
          </span>
          <span className="t-micro mt-s-1" style={{ color: 'var(--color-accent-soft)' }}>
            {subject.gloss}
          </span>
        </div>
      )}
      {features.map((f) => (
        <div
          key={`${f.term}|${f.gloss}`}
          className="flex flex-col justify-center rounded-lg border border-rule bg-paper-2 px-s-3 py-s-2"
        >
          <span className="t-body font-medium text-ink leading-tight">{f.term}</span>
          <span className="t-micro text-ink-mute mt-s-1">{f.gloss}</span>
        </div>
      ))}
    </div>
  );
}
