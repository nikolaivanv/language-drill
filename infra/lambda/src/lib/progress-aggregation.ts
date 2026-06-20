// ---------------------------------------------------------------------------
// Progress aggregation — core types and exercise-type → axis mapping
// ---------------------------------------------------------------------------
// The progress page reduces the user's exercise history into six fixed skill
// axes. This module is the single source of truth for that mapping; both the
// /progress/radar route and the heatmap route consume it.
//
// Design reference: .claude/specs/progress-page/design.md
//   §"Exercise type → axis mapping (v1)"
//
// Pure functions only — no DB or network dependencies.
// ---------------------------------------------------------------------------

import { CefrLevel, ExerciseType } from '@language-drill/shared';

// ---------------------------------------------------------------------------
// Axis taxonomy
// ---------------------------------------------------------------------------

export type RadarAxisKey =
  | 'listening'
  | 'reading'
  | 'speaking'
  | 'writing'
  | 'grammar'
  | 'vocabulary';

/**
 * Fixed axis order. The /progress/radar response always emits axes in this
 * sequence so the client can render the SVG vertices deterministically.
 */
export const RADAR_AXIS_ORDER: readonly RadarAxisKey[] = [
  'listening',
  'reading',
  'speaking',
  'writing',
  'grammar',
  'vocabulary',
] as const;

// ---------------------------------------------------------------------------
// Row + axis shapes
// ---------------------------------------------------------------------------

/**
 * One contributing exercise attempt projected from the SQL join of
 * `user_exercise_history` × `exercises`.
 */
export type ContributingRow = {
  score: number;
  difficulty: CefrLevel;
  type: string;
  evaluatedAt: Date;
};

/**
 * One axis of the radar response. The wire schema in
 * `packages/api-client/src/schemas/progress.ts` mirrors this shape.
 */
export type RadarAxis = {
  key: RadarAxisKey;
  label: string;
  currentMastery: number;
  previousMastery: number;
  lastPracticedAt: string | null;
  evidenceCount: number;
};

// ---------------------------------------------------------------------------
// Exercise type → axis mapping
// ---------------------------------------------------------------------------
// Implemented today: cloze, translation, vocab_recall.
// Reserved (recognised here so future seed data lights up the right axis
// without a code change, though no seed exercises exist yet):
//   listening → listening, speaking → speaking, reading_* → reading.
// ---------------------------------------------------------------------------

const RESERVED_LISTENING = 'listening';
const RESERVED_SPEAKING = 'speaking';
const RESERVED_READING_PREFIX = 'reading';

// Vocabulary Review evidence sentinels (Req 9.1, 9.3). These are the literal
// values of `REVIEW_VOCAB_TYPE` / `REVIEW_GRAMMAR_TYPE` exported from
// `review/evidence.ts`; spelled out here (rather than imported) because
// evidence.ts imports from this module, so importing back would form a cycle.
// They MUST match the constants there. Without these cases a review
// ContributingRow falls through to `default → null` and is silently dropped.
const REVIEW_VOCAB_TYPE = 'vocab_review_vocab';
const REVIEW_GRAMMAR_TYPE = 'vocab_review_grammar';

export function axisForExerciseType(type: string): RadarAxisKey | null {
  switch (type) {
    case ExerciseType.CLOZE:
      return 'grammar';
    case ExerciseType.CONJUGATION:
      return 'grammar';
    case ExerciseType.TRANSLATION:
      return 'writing';
    case ExerciseType.FREE_WRITING:
      return 'writing';
    case ExerciseType.VOCAB_RECALL:
      return 'vocabulary';
    case ExerciseType.DICTATION:
      return 'listening';
    case RESERVED_LISTENING:
      return 'listening';
    case RESERVED_SPEAKING:
      return 'speaking';
    case REVIEW_VOCAB_TYPE:
      return 'vocabulary';
    case REVIEW_GRAMMAR_TYPE:
      return 'grammar';
    default:
      if (type.startsWith(RESERVED_READING_PREFIX)) return 'reading';
      return null;
  }
}

// ---------------------------------------------------------------------------
// Mastery formula
// ---------------------------------------------------------------------------
// mastery = Σ(score · difficultyWeight · recencyWeight) / Σ(weights)
// clamped to [0, 1]; empty input → 0. Design reference: §"Mastery formula".
// ---------------------------------------------------------------------------

const DIFFICULTY_WEIGHTS: Record<CefrLevel, number> = {
  [CefrLevel.A1]: 0.5,
  [CefrLevel.A2]: 0.7,
  [CefrLevel.B1]: 0.9,
  [CefrLevel.B2]: 1.1,
  [CefrLevel.C1]: 1.3,
  [CefrLevel.C2]: 1.5,
};

const MS_PER_DAY = 86_400_000;
const RECENCY_HALF_LIFE_DAYS = 30;

export function difficultyWeight(level: CefrLevel): number {
  return DIFFICULTY_WEIGHTS[level];
}

export function recencyWeight(evaluatedAt: Date, now: Date): number {
  const daysAgo = (now.getTime() - evaluatedAt.getTime()) / MS_PER_DAY;
  return Math.exp(-daysAgo / RECENCY_HALF_LIFE_DAYS);
}

export function aggregateAxisMastery(
  rows: readonly ContributingRow[],
  now: Date,
): number {
  if (rows.length === 0) return 0;

  let weightedSum = 0;
  let totalWeight = 0;

  for (const row of rows) {
    const w = difficultyWeight(row.difficulty) * recencyWeight(row.evaluatedAt, now);
    weightedSum += row.score * w;
    totalWeight += w;
  }

  if (totalWeight === 0) return 0;

  const mastery = weightedSum / totalWeight;
  if (mastery < 0) return 0;
  if (mastery > 1) return 1;
  return mastery;
}

// ---------------------------------------------------------------------------
// Radar aggregation orchestrator
// ---------------------------------------------------------------------------
// Buckets rows by axis, computes current + 30-day-ago mastery per axis, and
// returns exactly six axes in `RADAR_AXIS_ORDER`. Axes with no contributing
// rows return all-zero values and `evidenceCount: 0` — the empty radar
// shape itself is informative.
// ---------------------------------------------------------------------------

const PREVIOUS_WINDOW_DAYS = 30;

const AXIS_LABELS: Record<RadarAxisKey, string> = {
  listening: 'listening',
  reading: 'reading',
  speaking: 'speaking',
  writing: 'writing',
  grammar: 'grammar',
  vocabulary: 'vocabulary',
};

export function aggregateRadar(
  rows: readonly ContributingRow[],
  now: Date,
): RadarAxis[] {
  const buckets = new Map<RadarAxisKey, ContributingRow[]>();
  for (const key of RADAR_AXIS_ORDER) buckets.set(key, []);

  for (const row of rows) {
    const axis = axisForExerciseType(row.type);
    if (axis === null) continue;
    buckets.get(axis)!.push(row);
  }

  const previousCutoff = new Date(
    now.getTime() - PREVIOUS_WINDOW_DAYS * MS_PER_DAY,
  );

  return RADAR_AXIS_ORDER.map<RadarAxis>((key) => {
    const bucket = buckets.get(key)!;

    if (bucket.length === 0) {
      return {
        key,
        label: AXIS_LABELS[key],
        currentMastery: 0,
        previousMastery: 0,
        lastPracticedAt: null,
        evidenceCount: 0,
      };
    }

    const currentMastery = aggregateAxisMastery(bucket, now);
    const olderRows = bucket.filter((r) => r.evaluatedAt < previousCutoff);
    const previousMastery =
      olderRows.length === 0
        ? currentMastery
        : aggregateAxisMastery(olderRows, now);

    let latest = bucket[0].evaluatedAt;
    for (const row of bucket) {
      if (row.evaluatedAt > latest) latest = row.evaluatedAt;
    }

    return {
      key,
      label: AXIS_LABELS[key],
      currentMastery,
      previousMastery,
      lastPracticedAt: latest.toISOString(),
      evidenceCount: bucket.length,
    };
  });
}

