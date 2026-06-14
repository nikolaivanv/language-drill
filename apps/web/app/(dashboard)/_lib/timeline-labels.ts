// ---------------------------------------------------------------------------
// Timeline label helpers — slot prefix + type-label + title/subtitle composers
// ---------------------------------------------------------------------------
// The wire schema doesn't carry the prefix (`warm-up`, `core`, `production`,
// `cool-down`) — the client derives it deterministically from `index` so we
// can re-label later without a backend change. See design.md §"V1_PLAN_SHAPE".
//
// Pure functions — no globals, no side effects.
// ---------------------------------------------------------------------------

import { ExerciseType } from '@language-drill/shared';

type SlotPrefix = 'warm-up' | 'core' | 'production' | 'cool-down';

const PREFIX_BY_INDEX: Record<number, SlotPrefix> = {
  1: 'warm-up',
  2: 'core',
  3: 'production',
  4: 'core',
  5: 'cool-down',
};

export function slotPrefixForIndex(index: number): SlotPrefix {
  const prefix = PREFIX_BY_INDEX[index];
  if (!prefix) {
    throw new Error(`slotPrefixForIndex: index out of range (got ${index})`);
  }
  return prefix;
}

const TYPE_LABELS: Record<ExerciseType, string> = {
  [ExerciseType.CLOZE]: 'cloze',
  [ExerciseType.TRANSLATION]: 'translation',
  [ExerciseType.VOCAB_RECALL]: 'vocabulary recall',
  [ExerciseType.SENTENCE_CONSTRUCTION]: 'sentence construction',
  [ExerciseType.DICTATION]: 'dictation',
};

export function typeLabel(type: ExerciseType): string {
  return TYPE_LABELS[type];
}

export function composeTitle(index: number, type: ExerciseType): string {
  return `${slotPrefixForIndex(index)} · ${typeLabel(type)}`;
}

export function composeSubtitle(
  topicHint: string | null,
  type: ExerciseType,
  itemCount: number,
): string {
  const lead = topicHint ?? typeLabel(type);
  return `${lead} · ${itemCount} items`;
}
