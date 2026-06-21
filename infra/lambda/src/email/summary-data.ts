export interface HistoryRow {
  grammarPointKey: string | null;
  language: string;
  score: number | null;
  evaluatedAt: Date;
}

export interface MasteryRow {
  grammarPointKey: string;
  score: number;
}

export interface SummaryInput {
  historyRows: HistoryRow[];
  masteryRows: MasteryRow[];
  labelFor: (grammarPointKey: string) => string;
  languageNameFor: (code: string) => string;
}

export interface SummaryData {
  hasActivity: boolean;
  exercisesCompleted: number;
  languagesPracticed: string[];
  daysActive: number;
  movers: string[];
  focus: string[];
}

const MOVERS_MIN_SCORE = 0.8;
const MAX_MOVERS = 3;
const MAX_FOCUS = 3;

function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Pure: shape raw history + mastery rows into the weekly-summary template
 * props. "Movers" = grammar points the user scored well on this week
 * (best average first). "Focus" = the user's lowest-mastery grammar points
 * (weakest first). Both are de-duplicated by label.
 */
export function buildWeeklySummaryData(input: SummaryInput): SummaryData {
  const { historyRows, masteryRows, labelFor, languageNameFor } = input;

  const exercisesCompleted = historyRows.length;
  const hasActivity = exercisesCompleted > 0;

  const languages = new Set<string>();
  const days = new Set<string>();
  // grammarPointKey -> { sum, n }
  const byPoint = new Map<string, { sum: number; n: number }>();

  for (const row of historyRows) {
    languages.add(row.language);
    days.add(utcDay(row.evaluatedAt));
    if (row.grammarPointKey && row.score !== null) {
      const acc = byPoint.get(row.grammarPointKey) ?? { sum: 0, n: 0 };
      acc.sum += row.score;
      acc.n += 1;
      byPoint.set(row.grammarPointKey, acc);
    }
  }

  const movers = [...byPoint.entries()]
    .map(([key, { sum, n }]) => ({ key, avg: sum / n }))
    .filter((p) => p.avg >= MOVERS_MIN_SCORE)
    .sort((a, b) => b.avg - a.avg)
    .slice(0, MAX_MOVERS)
    .map((p) => labelFor(p.key));

  const focus = [...masteryRows]
    .sort((a, b) => a.score - b.score)
    .slice(0, MAX_FOCUS)
    .map((m) => labelFor(m.grammarPointKey));

  return {
    hasActivity,
    exercisesCompleted,
    languagesPracticed: [...languages].map(languageNameFor),
    daysActive: days.size,
    movers,
    focus,
  };
}
