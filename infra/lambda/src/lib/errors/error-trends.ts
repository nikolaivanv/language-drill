export interface ErrorRow {
  grammarPointKey: string | null; // effective (errorGrammarPointKey ?? hostGrammarPointKey)
  errorType: string;
  severity: string;
  wrongText: string;
  correction: string;
  occurredAt: Date;
}

export interface AttemptRow {
  grammarPointKey: string;
  attemptedAt: Date;
}

export type ErrorTrendStatus = 'recurring' | 'improving' | 'quiet';

export interface ErrorTrendTheme {
  grammarPointKey: string | null;
  grammarPointName: string | null;
  errorType: string;
  sample: { wrongText: string; correction: string };
  firstSeen: Date;
  lastSeen: Date;
  totalErrors: number;
  weeklyErrors: number[];
  status: ErrorTrendStatus;
  lastSeenDaysAgo: number;
  fromRatePct: number | null;
  toRatePct: number | null;
  quietWeeks: number | null;
}

const WEEKS = 8;
const MS_PER_WEEK = 7 * 86_400_000;
const MS_PER_DAY = 86_400_000;
const RECENT_WEEKS = 2;
const IMPROVING_RATIO = 0.6;

/** Count timestamps into `weeks` oldest→newest weekly buckets (index weeks-1 = most recent). */
export function bucketWeekly(timestamps: readonly Date[], now: Date, weeks: number): number[] {
  const buckets = new Array<number>(weeks).fill(0);
  for (const t of timestamps) {
    const weeksAgo = Math.floor((now.getTime() - t.getTime()) / MS_PER_WEEK);
    if (weeksAgo < 0 || weeksAgo >= weeks) continue;
    buckets[weeks - 1 - weeksAgo] += 1;
  }
  return buckets;
}

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
const rate = (errors: number, attempts: number): number | null => (attempts > 0 ? errors / attempts : null);

export function resolveErrorTrend(
  weeklyErrors: readonly number[],
  weeklyAttempts: readonly number[],
  lastSeen: Date,
  now: Date,
): { status: ErrorTrendStatus; lastSeenDaysAgo: number; fromRatePct: number | null; toRatePct: number | null; quietWeeks: number | null } {
  const lastSeenDaysAgo = Math.floor((now.getTime() - lastSeen.getTime()) / MS_PER_DAY);
  const recentErr = sum(weeklyErrors.slice(-RECENT_WEEKS));
  const earlierErr = sum(weeklyErrors.slice(0, -RECENT_WEEKS));
  const recentRate = rate(recentErr, sum(weeklyAttempts.slice(-RECENT_WEEKS)));
  const earlierRate = rate(earlierErr, sum(weeklyAttempts.slice(0, -RECENT_WEEKS)));

  if (recentErr === 0) {
    // weeks since the last non-zero error bucket
    let quietWeeks = 0;
    for (let i = weeklyErrors.length - 1; i >= 0; i -= 1) {
      if (weeklyErrors[i] > 0) break;
      quietWeeks += 1;
    }
    return { status: 'quiet', lastSeenDaysAgo, fromRatePct: null, toRatePct: null, quietWeeks };
  }
  if (earlierRate !== null && recentRate !== null && recentRate <= IMPROVING_RATIO * earlierRate) {
    return {
      status: 'improving',
      lastSeenDaysAgo,
      fromRatePct: Math.round(earlierRate * 100),
      toRatePct: Math.round(recentRate * 100),
      quietWeeks: null,
    };
  }
  return { status: 'recurring', lastSeenDaysAgo, fromRatePct: null, toRatePct: null, quietWeeks: null };
}

const STATUS_ORDER: Record<ErrorTrendStatus, number> = { recurring: 0, improving: 1, quiet: 2 };

export function buildErrorTrends(
  errors: readonly ErrorRow[],
  attempts: readonly AttemptRow[],
  now: Date,
  opts: { weeks?: number; limit?: number } = {},
): Omit<ErrorTrendTheme, 'grammarPointName'>[] {
  const weeks = opts.weeks ?? WEEKS;
  const limit = opts.limit ?? 8;

  // attempts bucketed per grammar point
  const attemptsByPoint = new Map<string, Date[]>();
  for (const a of attempts) {
    const list = attemptsByPoint.get(a.grammarPointKey) ?? [];
    list.push(a.attemptedAt);
    attemptsByPoint.set(a.grammarPointKey, list);
  }

  const groups = new Map<string, ErrorRow[]>();
  for (const e of errors) {
    const key = `${e.grammarPointKey ?? '∅'}::${e.errorType}`;
    const list = groups.get(key) ?? [];
    list.push(e);
    groups.set(key, list);
  }

  const themes: Omit<ErrorTrendTheme, 'grammarPointName'>[] = [];
  for (const rows of groups.values()) {
    if (rows.length < 2) continue;
    const sorted = [...rows].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const weeklyErrors = bucketWeekly(sorted.map((r) => r.occurredAt), now, weeks);
    const pointAttempts = first.grammarPointKey ? (attemptsByPoint.get(first.grammarPointKey) ?? []) : [];
    const weeklyAttempts = bucketWeekly(pointAttempts, now, weeks);
    const trend = resolveErrorTrend(weeklyErrors, weeklyAttempts, last.occurredAt, now);
    themes.push({
      grammarPointKey: first.grammarPointKey,
      errorType: first.errorType,
      sample: { wrongText: last.wrongText, correction: last.correction },
      firstSeen: first.occurredAt,
      lastSeen: last.occurredAt,
      totalErrors: rows.length,
      weeklyErrors,
      ...trend,
    });
  }

  return themes
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.totalErrors - a.totalErrors)
    .slice(0, limit);
}
