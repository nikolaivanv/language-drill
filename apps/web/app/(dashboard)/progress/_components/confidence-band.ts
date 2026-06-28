// Converts the 0–100 Bayesian confidence value into a qualitative band so the
// drawer reads in plain language instead of a misleading raw percentage.
export function confidenceBand(conf: number): { label: string } {
  if (conf >= 70) return { label: 'high' };
  if (conf >= 40) return { label: 'building' };
  return { label: 'low' };
}
