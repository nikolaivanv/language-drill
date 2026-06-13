const MS_PER_DAY = 86_400_000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

export type FluencyAttemptRow = {
  latencyMs: number;
  correct: boolean;
  attemptedAt: Date;
};

export type FluencyWeekBucket = {
  /** Weeks ago: 0 = current week, increasing into the past. */
  weeksAgo: number;
  attempts: number;
  medianLatencyMs: number | null;
  accuracy: number; // [0,1]; 0 when no attempts
};

export type FluencyStats = {
  totalAttempts: number;
  overallAccuracy: number; // [0,1]
  overallMedianLatencyMs: number | null;
  weeks: FluencyWeekBucket[]; // length === weeks; chronological (oldest first)
};

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function accuracy(rows: readonly FluencyAttemptRow[]): number {
  if (rows.length === 0) return 0;
  const correct = rows.filter((r) => r.correct).length;
  return correct / rows.length;
}

/**
 * Aggregate fluency attempts into `weeks` chronological buckets ending with the
 * current week, plus overall totals. Pure; `now` and `weeks` are injected.
 * Rows older than the window are excluded from buckets but still count toward
 * overall totals (the caller scopes the SQL window; this is defensive).
 */
export function aggregateFluencyStats(
  rows: readonly FluencyAttemptRow[],
  now: Date,
  weeks: number,
): FluencyStats {
  const buckets: FluencyAttemptRow[][] = Array.from({ length: weeks }, () => []);
  for (const r of rows) {
    const weeksAgo = Math.floor((now.getTime() - r.attemptedAt.getTime()) / MS_PER_WEEK);
    if (weeksAgo < 0 || weeksAgo >= weeks) continue;
    buckets[weeks - 1 - weeksAgo].push(r);
  }

  const weekStats: FluencyWeekBucket[] = buckets.map((bucket, idx) => ({
    weeksAgo: weeks - 1 - idx,
    attempts: bucket.length,
    medianLatencyMs: median(bucket.map((r) => r.latencyMs)),
    accuracy: accuracy(bucket),
  }));

  return {
    totalAttempts: rows.length,
    overallAccuracy: accuracy(rows),
    overallMedianLatencyMs: median(rows.map((r) => r.latencyMs)),
    weeks: weekStats,
  };
}
