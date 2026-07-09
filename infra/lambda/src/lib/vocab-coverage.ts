/**
 * Pure coverage-state derivation for the vocab browse hub. Coverage is derived
 * from existing history (no per-word mastery table): a curated vocab_target word
 * is `not-yet` if no approved exercise tests it, `untested` if one exists but the
 * user never answered it, and `practiced-*` once answered (strong vs weak by best
 * score). See docs/superpowers/specs/2026-07-09-vocab-coverage-hub-design.md.
 */

export type CoverageState =
  | 'not-yet'
  | 'untested'
  | 'practiced-weak'
  | 'practiced-strong';

export type ExerciseWordStat = { attempts: number; bestScore: number | null };

const STRONG_SCORE = 0.7;

export function deriveWordCoverage(stat: ExerciseWordStat | undefined): CoverageState {
  if (stat === undefined) return 'not-yet';
  if (stat.attempts === 0) return 'untested';
  if (stat.bestScore !== null && stat.bestScore >= STRONG_SCORE) return 'practiced-strong';
  return 'practiced-weak';
}

const ARTICLES = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas']);

export function normalizeWord(s: string): string {
  const lowered = s.trim().toLowerCase();
  const tokens = lowered.split(/\s+/);
  if (tokens.length > 1 && ARTICLES.has(tokens[0])) return tokens.slice(1).join(' ');
  return lowered;
}

export function pickWordStat(
  target: { displayForm: string; lemma: string },
  byWord: Map<string, ExerciseWordStat>,
): ExerciseWordStat | undefined {
  return byWord.get(normalizeWord(target.lemma)) ?? byWord.get(normalizeWord(target.displayForm));
}

export function summarizeCoverage(states: readonly CoverageState[]): {
  total: number;
  available: number;
  practiced: number;
} {
  let available = 0;
  let practiced = 0;
  for (const s of states) {
    if (s !== 'not-yet') available += 1;
    if (s === 'practiced-weak' || s === 'practiced-strong') practiced += 1;
  }
  return { total: states.length, available, practiced };
}
