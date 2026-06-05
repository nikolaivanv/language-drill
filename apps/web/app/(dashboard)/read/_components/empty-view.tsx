'use client';

// ---------------------------------------------------------------------------
// EmptyView — first-launch landing for /read
// ---------------------------------------------------------------------------
// Centered hero (Caveat eyebrow + display-l title + body paragraph + primary
// CTA) above a "how it works" card with a 4-step ordered list. Step 2's
// `~CEFR+` parenthetical only renders when the user already has a profile
// for the active language — Requirement 3.4's "your current band" fallback.
// ---------------------------------------------------------------------------

import type { CefrLevel } from '@language-drill/shared';
import { Button } from '../../../../components/ui/button';

type Props = {
  onPaste: () => void;
  /** Open the generate-a-passage launchpad. */
  onGenerate: () => void;
  /** User's CEFR for the active language; `null` when no profile row exists yet. */
  cefrToken: CefrLevel | null;
};

export function EmptyView({ onPaste, onGenerate, cefrToken }: Props) {
  const step2 =
    cefrToken === null
      ? 'i highlight words rarer than your current band.'
      : `i highlight words rarer than your current band (~${cefrToken}+).`;

  return (
    <div className="mx-auto mt-[60px] max-w-[640px] text-center mobile:mt-[32px] mobile:max-w-none">
      <div className="t-hand text-accent text-[26px] leading-[1.2] mb-[4px]">
        read in the wild
      </div>
      <h2 className="t-display-l my-[8px]">paste anything you&apos;re reading.</h2>
      <p className="t-body-l text-ink-soft mt-[16px]">
        a paragraph from a book, an article, a conversation. i&apos;ll mark the
        words above your level and surface them in your next sessions.
      </p>
      <div className="mt-[32px] flex items-center justify-center gap-[12px] mobile:flex-col">
        <Button variant="primary" size="lg" onClick={onPaste}>
          paste a text →
        </Button>
        <Button variant="ghost" size="lg" onClick={onGenerate}>
          generate a text →
        </Button>
      </div>
      <div className="mt-[48px] rounded-r-lg border border-dashed border-rule bg-paper-2 p-s-6 text-left">
        <div className="t-micro mb-[10px]">how it works</div>
        <ol className="list-decimal pl-[20px] text-[14px] leading-[1.7] text-ink-2 space-y-[2px]">
          <li>paste a paragraph (≤ 2,000 chars).</li>
          <li>{step2}</li>
          <li>
            tap a word to see meaning + an example. tap &ldquo;save&rdquo; to add
            to your bank.
          </li>
          <li>
            saved words show up in cloze, vocab recall, and translation drills,
            tagged &ldquo;from your reading.&rdquo;
          </li>
        </ol>
      </div>
    </div>
  );
}
