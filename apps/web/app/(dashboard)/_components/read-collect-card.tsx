// ---------------------------------------------------------------------------
// ReadCollectCard — promotional card for the upcoming Read & Collect feature
// ---------------------------------------------------------------------------
// Static; no props. Renders below the skill snapshot. Layout mirrors the
// prototype reference at:
//   docs/design-archive/design_handoff_language_drill/prototypes/web/hifi/dashboard.jsx (lines 117–136)
// ---------------------------------------------------------------------------

import { Button, Card, Chip } from '../../../components/ui';

export function ReadCollectCard() {
  return (
    <Card padding="lg">
      {/* Stacks on mobile (icon+heading row, then a full-width CTA) so the card
          stays compact; the original horizontal layout returns at ≥sm. The
          explanatory paragraph is desktop-only to save vertical space on phones. */}
      <div className="flex flex-col gap-s-3 sm:flex-row sm:items-center sm:gap-s-4">
        <div className="flex min-w-0 flex-1 items-center gap-s-3 sm:gap-s-4">
          <div
            className="flex h-[40px] w-[40px] flex-shrink-0 items-center justify-center rounded-r-md bg-accent-soft text-accent-2 sm:h-[44px] sm:w-[44px]"
            aria-hidden
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 5h6a3 3 0 013 3v12a2 2 0 00-2-2H3z" />
              <path d="M21 5h-6a3 3 0 00-3 3v12a2 2 0 012-2h7z" />
            </svg>
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-s-2 sm:mb-s-1">
              <h3 className="t-display-s">reading something this week?</h3>
              <Chip variant="accent">new</Chip>
            </div>
            <p className="t-small hidden sm:block">
              paste a paragraph — i&apos;ll mark words above your level and weave
              them into your next session.
            </p>
          </div>
        </div>

        <Button
          variant="primary"
          size="md"
          href="/read"
          className="w-full shrink-0 sm:w-auto"
        >
          open reader →
        </Button>
      </div>
    </Card>
  );
}
