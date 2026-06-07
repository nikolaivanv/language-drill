'use client';

// ---------------------------------------------------------------------------
// GeneratingView — calm indeterminate loading state during text generation
// ---------------------------------------------------------------------------
// Shown while a POST /read/generate request is in flight (the non-streaming
// generation pass). Once the text lands the caller switches to the annotated
// reader; this component just needs to communicate what is being generated
// and that work is in progress.
//
// Role "status" + aria-live="polite" so screen readers announce the state
// without interrupting ongoing speech.
// ---------------------------------------------------------------------------

import type { CefrLevel, ReadingTextLength } from '@language-drill/shared';
import { ReadingCategory } from '@language-drill/shared';

type Provenance = {
  category: ReadingCategory | null;
  cefr: CefrLevel;
  length: ReadingTextLength;
  prompt: string;
};

type Props = {
  languageLabel: string;
  provenance: Provenance;
};

const LENGTH_NAME: Record<ReadingTextLength, string> = {
  short: 'short',
  medium: 'medium',
  long: 'long',
};

export function GeneratingView({ languageLabel, provenance }: Props) {
  const { category, cefr, length } = provenance;
  const lengthName = LENGTH_NAME[length] ?? length;
  const categoryLabel = category ?? 'passage';

  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-auto max-w-[720px] mobile:max-w-none py-[48px]"
    >
      {/* Eyebrow */}
      <div className="t-hand text-accent text-[22px] mb-[10px]">
        read at your level
      </div>

      {/* Heading */}
      <h2 className="t-display-m">writing your passage…</h2>

      {/* Subline */}
      <p className="t-small text-ink-soft mt-[10px] mb-[32px]">
        tuning a {lengthName} {categoryLabel} to {cefr} in {languageLabel},
        then calibrating the words worth collecting.
      </p>

      {/* Indeterminate pulsing progress bar — mirrors the CalibrationStrip bar style */}
      <div
        aria-label="generating"
        className="h-[2px] bg-rule rounded-full overflow-hidden"
      >
        <div className="h-full bg-accent rounded-full animate-pulse w-full" />
      </div>
    </div>
  );
}
