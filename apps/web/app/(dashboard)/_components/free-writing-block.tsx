// ---------------------------------------------------------------------------
// FreeWritingBlock — the today plan's free-writing block (Plan 1)
// ---------------------------------------------------------------------------
// A distinct timeline block (not an inline rail item): on a language's cadence
// day the dashboard surfaces this card, which launches the standalone
// multi-stage free-writing flow at /drill/free-writing. The href is static —
// the free-writing page resolves its own prompt for the active language.
// ---------------------------------------------------------------------------

import { Button } from '../../../components/ui';

type Props = {
  estimatedMinutes: number;
};

export function FreeWritingBlock({ estimatedMinutes }: Props) {
  return (
    <section
      aria-label="free writing"
      className="mt-s-4 flex items-center justify-between gap-s-4 rounded-lg border border-accent bg-card p-s-5"
    >
      <div className="min-w-0 flex-1">
        <h3 className="t-display-s">free writing</h3>
        <p className="t-body mt-s-1 text-ink-2">
          Write a paragraph to a constrained prompt, then get IELTS-style
          feedback with every error marked in place.
        </p>
      </div>
      <div className="flex flex-shrink-0 items-center gap-s-3">
        <span className="t-mono text-[12px] text-ink-mute">
          {estimatedMinutes} min
        </span>
        <Button variant="primary" size="md" href="/drill/free-writing">
          start →
        </Button>
      </div>
    </section>
  );
}
