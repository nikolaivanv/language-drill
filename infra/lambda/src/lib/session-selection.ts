/**
 * Targeted-first, deduped, capped merge of a grammar-point-targeted exercise
 * set with a mixed top-up set. Targeted rows keep their order and priority;
 * top-up rows fill the remainder up to `exerciseCount`, skipping any id already
 * present so a session never repeats an exercise.
 */
export function mergeSessionRows<T extends { id: string }>(
  targeted: T[],
  topUp: T[],
  exerciseCount: number,
): T[] {
  const seen = new Set(targeted.map((r) => r.id));
  const merged = [...targeted];
  for (const r of topUp) {
    if (merged.length >= exerciseCount) break;
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    merged.push(r);
  }
  return merged.slice(0, exerciseCount);
}
