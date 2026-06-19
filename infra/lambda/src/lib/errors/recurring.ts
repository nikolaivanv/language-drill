export interface RecurringErrorInput {
  hostGrammarPointKey: string | null;
  errorGrammarPointKey: string | null;
  errorType: string;
  severity: string;
  wrongText: string;
  correction: string;
  occurredAt: Date;
}

export interface RecurringErrorTheme {
  grammarPointKey: string | null;
  errorType: string;
  count: number;
  majorCount: number;
  lastOccurredAt: Date;
  sample: { wrongText: string; correction: string };
  score: number;
  grammarPointName?: string | null;
}

const DEFAULT_HALF_LIFE_DAYS = 14;
const DEFAULT_LIMIT = 5;

/**
 * Pure: collapse raw observations into themes keyed on
 * (effective grammar point, error type), scored by recency-weighted frequency.
 * `errorGrammarPointKey` wins over `hostGrammarPointKey` when present.
 */
export function rankRecurringErrors(
  rows: readonly RecurringErrorInput[],
  now: Date,
  opts: { halfLifeDays?: number; limit?: number } = {},
): RecurringErrorTheme[] {
  const halfLife = opts.halfLifeDays ?? DEFAULT_HALF_LIFE_DAYS;
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const decay = Math.log(2) / halfLife;

  const groups = new Map<string, RecurringErrorTheme>();
  for (const r of rows) {
    const point = r.errorGrammarPointKey ?? r.hostGrammarPointKey;
    const key = `${point ?? '∅'}::${r.errorType}`;
    const ageDays = Math.max(0, (now.getTime() - r.occurredAt.getTime()) / 86_400_000);
    const weight = Math.exp(-decay * ageDays);

    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        grammarPointKey: point,
        errorType: r.errorType,
        count: 1,
        majorCount: r.severity === 'major' ? 1 : 0,
        lastOccurredAt: r.occurredAt,
        sample: { wrongText: r.wrongText, correction: r.correction },
        score: weight,
      });
      continue;
    }
    existing.count += 1;
    if (r.severity === 'major') existing.majorCount += 1;
    existing.score += weight;
    if (r.occurredAt.getTime() > existing.lastOccurredAt.getTime()) {
      existing.lastOccurredAt = r.occurredAt;
      existing.sample = { wrongText: r.wrongText, correction: r.correction };
    }
  }

  return [...groups.values()]
    .sort((a, b) => b.score - a.score || b.majorCount - a.majorCount)
    .slice(0, limit);
}

/**
 * Pure: attach a resolved display name to each theme using the injected
 * resolver (the route passes a getGrammarPoint-based resolver). Returns new
 * objects; does not mutate the input.
 */
export function attachGrammarPointNames(
  themes: RecurringErrorTheme[],
  resolve: (key: string | null) => string | null,
): RecurringErrorTheme[] {
  return themes.map((t) => ({ ...t, grammarPointName: resolve(t.grammarPointKey) }));
}
