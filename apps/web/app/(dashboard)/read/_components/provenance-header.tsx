'use client';

// ---------------------------------------------------------------------------
// ProvenanceHeader — shows the generation provenance (prompt + tags + rewrite)
// ---------------------------------------------------------------------------
// Props: prompt, category, cefr, length, languageLabel, onRewrite, rewriting
// A bg-paper-2 card with a glyph, the prompt in italic quotes, tag chips, and
// a circular rewrite button.
// ---------------------------------------------------------------------------

import { ReadingCategory, CefrLevel, ReadingTextLength } from '@language-drill/shared';
import { Chip } from '../../../../components/ui/chip';
import { Button } from '../../../../components/ui/button';

type Props = {
  prompt: string;
  category: ReadingCategory | null;
  cefr: CefrLevel;
  length: ReadingTextLength;
  languageLabel: string;
  onRewrite: () => void;
  rewriting?: boolean;
};

export function ProvenanceHeader({
  prompt,
  category,
  cefr,
  length,
  languageLabel,
  onRewrite,
  rewriting = false,
}: Props) {
  return (
    <div className="bg-paper-2 rounded-r-md p-s-4 flex items-start gap-[12px]">
      {/* Accent-soft glyph square */}
      <div
        className="bg-accent-soft rounded-r-sm flex items-center justify-center shrink-0"
        style={{ width: 32, height: 32 }}
        aria-hidden="true"
      >
        <span className="text-[14px]">📖</span>
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        {/* Prompt in italic quotes */}
        <p className="t-body italic text-ink">&ldquo;{prompt}&rdquo;</p>

        {/* Tag row */}
        <div className="flex flex-wrap gap-[6px] mt-[8px]">
          {category !== null && (
            <Chip variant="accent">{category.toUpperCase()}</Chip>
          )}
          <Chip variant="default">{cefr}</Chip>
          <Chip variant="default">{length.toUpperCase()}</Chip>
          <Chip variant="default">{languageLabel.toUpperCase()}</Chip>
        </div>
      </div>

      {/* Rewrite button */}
      <Button
        variant="ghost"
        size="sm"
        aria-label="rewrite"
        onClick={onRewrite}
        disabled={rewriting}
        className="shrink-0 rounded-full"
      >
        ↻
      </Button>
    </div>
  );
}
