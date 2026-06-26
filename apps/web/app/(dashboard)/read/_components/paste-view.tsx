'use client';

// ---------------------------------------------------------------------------
// PasteView — title + passage form for /read (redesigned)
// ---------------------------------------------------------------------------
// The single "TITLE OR SOURCE" field binds to `paste.source`. The `title`
// field in PasteState is kept for API compatibility but not rendered here —
// the page layer can use `source` as the display title when `title` is empty.
//
// The textarea has no `maxLength`: the counter flips to `text-accent` and
// disables the CTA at length > READ_TEXT_MAX_CHARS, matching the prototype's
// "soft" enforcement. Server-side validation in `routes/read.ts` is the hard
// gate.
// ---------------------------------------------------------------------------

import { READ_TEXT_MAX_CHARS } from '@language-drill/shared';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Textarea } from '../../../../components/ui/textarea';

export type PasteState = { title: string; source: string; text: string };

type Props = {
  paste: PasteState;
  onChange: (field: 'title' | 'source' | 'text', value: string) => void;
  onCancel: () => void;
  onAnnotate: () => void;
  isLoading: boolean;
  /** Human-readable error string from a failed annotation attempt; null hides the inline card. */
  errorBody: string | null;
  /**
   * When true, the annotate button is disabled regardless of input validity.
   * The page sets this on rate-limit responses so the user cannot mash through
   * the daily cap (Requirement 11.4).
   */
  rateLimited?: boolean;
};

export function PasteView({
  paste,
  onChange,
  onCancel,
  onAnnotate,
  isLoading,
  errorBody,
  rateLimited = false,
}: Props) {
  const len = paste.text.length;
  const tooLong = len > READ_TEXT_MAX_CHARS;
  const isEmpty = paste.text.trim().length === 0;
  const cannotAnnotate = isLoading || isEmpty || tooLong || rateLimited;

  return (
    <div className="mx-auto max-w-[720px] mobile:max-w-none">
      <div className="t-micro">NEW TEXT</div>
      <h2 className="t-display-m mt-[4px] mb-[8px]">paste a passage</h2>
      <p className="t-body text-ink-soft mb-[24px]">
        Bring something you&apos;re already reading — an article, a chapter, a
        message. I&apos;ll flag the words above your level, just like a
        generated text.
      </p>

      {errorBody !== null && (
        <div
          role="alert"
          className="mb-[16px] rounded-md border border-rule bg-paper-2 p-s-4"
        >
          <div className="t-display-s">couldn&apos;t annotate this</div>
          <p className="t-small text-ink-soft mt-[6px]">{errorBody}</p>
        </div>
      )}

      <label
        htmlFor="read-paste-source"
        className="t-micro block mb-[6px]"
      >
        TITLE OR SOURCE{' '}
        <span className="text-ink-mute">· optional</span>
      </label>
      <Input
        id="read-paste-source"
        className="mb-[18px]"
        placeholder="e.g. El País — opinión"
        value={paste.source}
        onChange={(e) => onChange('source', e.target.value)}
        disabled={isLoading}
      />

      <div className="flex items-baseline justify-between mb-[6px]">
        <label htmlFor="read-paste-text" className="t-micro">
          PASSAGE
        </label>
        <div
          aria-live="polite"
          className={`t-mono text-[11px] ${tooLong ? 'text-accent' : 'text-ink-mute'}`}
        >
          {len.toLocaleString('en-US')} / 2,000{tooLong ? ' · too long' : ''}
        </div>
      </div>
      <Textarea
        id="read-paste-text"
        rows={12}
        placeholder="paste a paragraph or two here — prose works better than lists or code."
        value={paste.text}
        onChange={(e) => onChange('text', e.target.value)}
        disabled={isLoading}
        className="min-h-[240px] text-[16px] leading-[1.6]"
        style={{ fontFamily: 'var(--font-display)' }}
      />

      <div className="mt-[16px] rounded-md bg-paper-2 p-s-4 mb-[16px]">
        <div className="t-micro mb-[4px]">HEADS UP</div>
        <p className="t-small text-ink-soft">
          annotation runs on your text only — nothing is shared. words you save
          flow into your drills.
        </p>
      </div>

      <div className="flex items-center justify-end gap-[8px]">
        <Button variant="ghost" onClick={onCancel} disabled={isLoading}>
          cancel
        </Button>
        <Button
          variant="primary"
          onClick={onAnnotate}
          disabled={cannotAnnotate}
        >
          {isLoading ? 'annotating…' : 'annotate →'}
        </Button>
      </div>
    </div>
  );
}
