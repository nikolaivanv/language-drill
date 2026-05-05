'use client';

// ---------------------------------------------------------------------------
// PasteView — title + passage form for /read
// ---------------------------------------------------------------------------
// Controlled by the page-level reducer: the parent owns `paste.title` /
// `paste.text` and the `isLoading` / `errorBody` fields. v1 collapses the
// prototype's separate title/source inputs into a single "title or source"
// field — the reducer's `paste.source` slot is always `''` and the save
// mutation sends `{ title: paste.title, source: '' }`. See task 24's
// "Title/source decision (v1)" note.
//
// The textarea has no `maxLength`: the counter flips to `--accent` and
// disables the CTA at length > READ_TEXT_MAX_CHARS, matching the prototype's
// "soft" enforcement. Server-side validation in `routes/read.ts` is the
// hard gate.
// ---------------------------------------------------------------------------

import {
  READ_TEXT_MAX_CHARS,
  READ_TITLE_MAX_CHARS,
} from '@language-drill/shared';
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
    <div className="mx-auto max-w-[720px]">
      <div className="t-micro">new text</div>
      <h2 className="t-display-m mt-[4px] mb-[22px]">paste a passage</h2>

      {errorBody !== null && (
        <div
          role="alert"
          className="mb-[16px] rounded-r-md border border-rule bg-paper-2 p-s-4"
        >
          <div className="t-display-s">couldn&apos;t annotate this</div>
          <p className="t-small text-ink-soft mt-[6px]">{errorBody}</p>
        </div>
      )}

      <label
        htmlFor="read-paste-title"
        className="t-small block mb-[6px]"
      >
        title or source{' '}
        <span className="text-ink-mute">(optional)</span>
      </label>
      <Input
        id="read-paste-title"
        className="mb-[18px]"
        placeholder="e.g. Cien años de soledad — ch. 1"
        maxLength={READ_TITLE_MAX_CHARS}
        value={paste.title}
        onChange={(e) => onChange('title', e.target.value)}
        disabled={isLoading}
      />

      <label htmlFor="read-paste-text" className="t-small block mb-[6px]">
        passage
      </label>
      <Textarea
        id="read-paste-text"
        rows={12}
        placeholder="paste a paragraph here. just one or two — quality over quantity. i'll work better with prose than with code or lists."
        value={paste.text}
        onChange={(e) => onChange('text', e.target.value)}
        disabled={isLoading}
        className="min-h-[240px] text-[16px] leading-[1.6]"
        style={{ fontFamily: 'var(--font-display)' }}
      />

      <div className="flex items-center justify-between mt-[8px]">
        <div
          aria-live="polite"
          className={`t-mono text-[11px] ${tooLong ? 'text-accent' : 'text-ink-mute'}`}
        >
          {len.toLocaleString('en-US')} / 2,000{tooLong ? ' · too long' : ''}
        </div>
        <div className="flex gap-[8px]">
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

      <div className="mt-[18px] flex items-center gap-[10px] rounded-r-md bg-paper-2 p-[12px]">
        <span className="t-hand text-[17px] text-ink-soft">tip</span>
        <span className="t-small flex-1">
          your text is stored only in your account — never shared with other
          users.
        </span>
      </div>
    </div>
  );
}
