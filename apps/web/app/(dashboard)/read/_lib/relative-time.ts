// ---------------------------------------------------------------------------
// relativeTime — deterministic relative-time helper
// ---------------------------------------------------------------------------
// Takes an ISO timestamp and the current timestamp (as a number, for
// deterministic unit testing). Returns a human-readable label bucketed as:
//   • < 60s   → "just now"
//   • < 24h   → "today"
//   • < 7d    → "Nd ago"
//   • < 14d   → "last week"
//   • else    → short locale date (e.g. "6/1/2025")
// ---------------------------------------------------------------------------

export function relativeTime(iso: string, now: number): string {
  const diffMs = now - new Date(iso).getTime();
  const diffSec = diffMs / 1_000;

  if (diffSec < 60) {
    return 'just now';
  }

  const diffHours = diffMs / (1_000 * 60 * 60);
  if (diffHours < 24) {
    return 'today';
  }

  const diffDays = diffMs / (1_000 * 60 * 60 * 24);
  if (diffDays < 7) {
    return `${Math.floor(diffDays)}d ago`;
  }

  if (diffDays < 14) {
    return 'last week';
  }

  return new Date(iso).toLocaleDateString();
}
