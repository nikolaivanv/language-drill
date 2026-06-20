import type { SchedulerDelta, VocabReviewStatus } from '@language-drill/shared';

const STATE_PHRASE: Record<VocabReviewStatus, string> = {
  new: 'just getting started',
  learning: 'still learning',
  mature: 'solid',
  known: 'known cold',
  leech: 'needs work',
  suspended: 'paused',
};

function timing(intervalToDays: number): string {
  const n = Math.round(intervalToDays);
  if (n <= 0) return 'next review soon';
  if (n === 1) return 'next review tomorrow';
  return `next review in ~${n} days`;
}

/** A single human line replacing the raw FSRS interval/stability/state dump. */
export function nextReviewLine(delta: SchedulerDelta): string {
  return `${timing(delta.intervalTo)} · ${STATE_PHRASE[delta.stateTo]}`;
}
