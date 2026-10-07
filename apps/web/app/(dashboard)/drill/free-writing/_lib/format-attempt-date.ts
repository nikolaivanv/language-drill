// "3 Oct 2026" — the attempt's grading date in the viewer's locale. Null or an
// unparsable timestamp renders as an em dash rather than "Invalid Date".
export function formatAttemptDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
