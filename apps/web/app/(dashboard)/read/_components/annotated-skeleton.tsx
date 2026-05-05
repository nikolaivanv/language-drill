// ---------------------------------------------------------------------------
// AnnotatedSkeleton — loading shimmer for the annotated reader pane
// ---------------------------------------------------------------------------
// Mirrors the final layout (title + source row, then text body) so the page
// does not visually jump when the entry resolves. The text body is a row of
// shimmer-tinted spans with deterministic widths — same widths on server and
// client so SSR and the first client paint match (Requirement 11.1).
// ---------------------------------------------------------------------------

import { Chip } from '../../../../components/ui/chip';

const SHIMMER_COUNT = 38;

// Linear-congruential PRNG seeded by index. Deterministic; no Math.random
// involvement so SSR / hydration agree on the rendered widths.
function widthForIndex(i: number): number {
  const r = ((i * 9301 + 49297) % 233280) / 233280;
  return Math.round(40 + r * 60); // 40px – 100px
}

export function AnnotatedSkeleton() {
  return (
    <div data-testid="annotated-skeleton">
      <div className="flex items-baseline gap-[10px] mb-[14px]">
        <span
          aria-hidden
          className="block h-[24px] w-[200px] rounded-r-sm bg-paper-3 animate-pulse"
        />
        <Chip variant="default">annotating…</Chip>
      </div>
      <span
        aria-hidden
        className="mb-[24px] block h-[12px] w-[140px] rounded-r-sm bg-paper-2 animate-pulse"
      />
      <div className="flex flex-wrap gap-[8px] gap-y-[14px]" aria-hidden>
        {Array.from({ length: SHIMMER_COUNT }).map((_, i) => (
          <span
            key={i}
            data-testid="shimmer-span"
            className="block h-[14px] rounded-r-sm bg-paper-3 animate-pulse"
            style={{ width: `${widthForIndex(i)}px` }}
          />
        ))}
      </div>
    </div>
  );
}
