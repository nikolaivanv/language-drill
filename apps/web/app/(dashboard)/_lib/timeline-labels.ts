// ---------------------------------------------------------------------------
// Timeline label helpers — slot prefix + type-label + title/subtitle composers
// ---------------------------------------------------------------------------
// The wire schema doesn't carry the prefix (`warm-up`, `core`, `cool-down`)
// — the client derives it deterministically from `(index, total)` so we can
// re-label later without a backend change. See design.md §"V1_PLAN_SHAPE".
//
// Pure functions — no globals, no side effects.
// ---------------------------------------------------------------------------

import { ExerciseType } from '@language-drill/shared';

type SlotPrefix = 'warm-up' | 'core' | 'cool-down';

/**
 * Returns the slot prefix for a given `index` within a plan of `total` items.
 * - index 1            → "warm-up"
 * - index === total    → "cool-down"
 * - everything else    → "core"
 */
export function slotPrefixForIndex(index: number, total: number): SlotPrefix {
  if (index === 1) return 'warm-up';
  if (index === total) return 'cool-down';
  return 'core';
}

const TYPE_LABELS: Record<ExerciseType, string> = {
  [ExerciseType.CLOZE]: 'cloze',
  [ExerciseType.TRANSLATION]: 'translation',
  [ExerciseType.VOCAB_RECALL]: 'vocabulary recall',
  [ExerciseType.SENTENCE_CONSTRUCTION]: 'sentence construction',
  [ExerciseType.DICTATION]: 'dictation',
  [ExerciseType.FREE_WRITING]: 'free writing',
  [ExerciseType.CONJUGATION]: 'conjugation',
};

export function typeLabel(type: ExerciseType): string {
  return TYPE_LABELS[type];
}

export function composeTitle(index: number, total: number, type: ExerciseType): string {
  return `${slotPrefixForIndex(index, total)} · ${typeLabel(type)}`;
}

export function composeSubtitle(
  grammarPointName: string | null,
  topicHint: string | null,
  type: ExerciseType,
  itemCount: number,
): string {
  // Prefer the curriculum grammar-point name over the free-text topic
  // (decision D5); fall back to the topic, then the exercise-type label.
  const lead = grammarPointName ?? topicHint ?? typeLabel(type);
  return `${lead} · ${itemCount} items`;
}
