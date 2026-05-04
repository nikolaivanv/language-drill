'use client';

// ---------------------------------------------------------------------------
// DebriefSkeleton — loading placeholder for the post-session debrief page.
// Renders the same chrome footprint as the real page (header band + tab strip
// + 3 placeholder cards) so the layout stays stable when the query resolves.
// Matches the shimmer style of `_components/loading-skeleton.tsx` via Tailwind
// `animate-pulse` and `bg-paper-2` / `bg-paper-3` tokens.
// ---------------------------------------------------------------------------

export function DebriefSkeleton() {
  return (
    <div className="animate-pulse">
      {/* Header band — eyebrow + display title + body line */}
      <div className="h-3 w-32 rounded bg-paper-3" />
      <div className="mt-s-3 h-12 w-1/2 rounded bg-paper-2" />
      <div className="mt-s-3 h-4 w-2/3 rounded bg-paper-3" />

      {/* Tab strip — bottom rule + two stubs */}
      <div className="mt-s-7 border-b border-rule flex gap-2 pb-s-3">
        <div className="h-4 w-16 rounded bg-paper-2" />
        <div className="h-4 w-16 rounded bg-paper-3" />
      </div>

      {/* Three placeholder cards */}
      <div className="mt-s-6 flex flex-col gap-s-3">
        <div className="h-20 w-full rounded-r-md bg-paper-2" />
        <div className="h-20 w-full rounded-r-md bg-paper-2" />
        <div className="h-20 w-full rounded-r-md bg-paper-2" />
      </div>
    </div>
  );
}
