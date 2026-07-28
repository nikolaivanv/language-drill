/**
 * Per-draft topic-domain assignment via deficit water-fill — the topic analogue
 * of `decideCoverageTargets`, but over a single global domain set with no floors
 * or give-up logic. Greedily assigns each draft to the domain currently lowest
 * in the approved pool (seed) plus running assignments, so the pool cannot
 * re-collapse onto one scenario. Applies to ALL exercise types.
 */
export type TopicDecisionInput = {
  domains: readonly string[];
  need: number;
  /** Approved-pool counts per domain (legacy/unknown hints bucketed as "other"). */
  approvedByDomain: Readonly<Record<string, number>>;
};

export function decideTopicTargets(input: TopicDecisionInput): string[] {
  const { domains, need, approvedByDomain } = input;
  if (need <= 0 || domains.length === 0) return [];

  const counts = new Map<string, number>();
  for (const d of domains) counts.set(d, approvedByDomain[d] ?? 0);

  const out: string[] = [];
  for (let i = 0; i < need; i++) {
    let best = domains[0];
    let bestCount = counts.get(best) ?? 0;
    for (const d of domains) {
      const c = counts.get(d) ?? 0;
      if (c < bestCount) {
        best = d;
        bestCount = c;
      }
    }
    out.push(best);
    counts.set(best, bestCount + 1);
  }
  return out;
}
