'use client';

import type { ConjugationContent } from '@language-drill/shared';

export interface ConjugationFeatureBundleProps {
  content: ConjugationContent;
  /** 'card' = pronoun badge + chips (drill prompt); 'inline' = compact text (debrief). */
  variant?: 'card' | 'inline';
}

// Static literal classes — Tailwind's scanner cannot see interpolated names.
// Rank 5+ (never produced by generation today) simply keeps DOM order.
const MOBILE_ORDER_CLASSES = [
  'mobile:order-1',
  'mobile:order-2',
  'mobile:order-3',
  'mobile:order-4',
] as const;

// A chip's rendered width tracks its wider line (term vs gloss).
function chipWidthProxy(f: { term: string; gloss: string }): number {
  return Math.max(f.term.length, f.gloss.length);
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

  // Mobile-only packing: rank chips shortest-first so short chips share the
  // subject badge's row instead of each long chip forcing its own row. DOM
  // order stays semantic (stored feature order) for wide viewports.
  const mobileOrderClass = new Map<number, string>(
    features
      .map((f, i) => ({ i, w: chipWidthProxy(f) }))
      .sort((a, b) => a.w - b.w || a.i - b.i)
      .map((e, rank) => [e.i, MOBILE_ORDER_CLASSES[rank] ?? '']),
  );

  return (
    <div className="mt-s-2 flex flex-wrap items-stretch gap-s-2">
      {subject && (
        <div
          className="flex flex-col justify-center rounded-lg px-s-3 py-[5px] text-center"
          style={{ background: 'var(--color-accent)' }}
        >
          <span
            className="leading-none font-display font-semibold"
            style={{ color: '#fff', fontSize: '18px' }}
          >
            {subject.pronoun}
          </span>
          <span className="t-micro mt-[2px]" style={{ color: 'rgba(255,255,255,0.78)' }}>
            {subject.gloss}
          </span>
        </div>
      )}
      {features.map((f, i) => (
        <div
          key={`${f.term}|${f.gloss}`}
          className={`flex flex-col justify-center rounded-lg border border-rule bg-paper-2 px-s-3 py-[5px] ${mobileOrderClass.get(i) ?? ''}`.trim()}
        >
          <span className="t-body font-medium text-ink leading-tight">{f.term}</span>
          <span className="t-micro text-ink-mute mt-[2px]">{f.gloss}</span>
        </div>
      ))}
    </div>
  );
}
