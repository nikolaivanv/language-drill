import { describe, it, expect } from 'vitest';
import type { SchedulerDelta } from '@language-drill/shared';
import { nextReviewLine } from '../schedule-phrase';

const delta = (over: Partial<SchedulerDelta> = {}): SchedulerDelta => ({
  intervalFrom: 0,
  intervalTo: 24,
  stabilityFrom: 2.3,
  stabilityTo: 24,
  stateFrom: 'learning',
  stateTo: 'mature',
  ...over,
});

describe('nextReviewLine', () => {
  it('formats a multi-day interval with the mature phrase', () => {
    expect(nextReviewLine(delta())).toBe('next review in ~24 days · solid');
  });

  it('says "soon" for a same-day (0) interval', () => {
    expect(nextReviewLine(delta({ intervalTo: 0, stateTo: 'learning' }))).toBe('next review soon · still learning');
  });

  it('says "tomorrow" for a 1-day interval', () => {
    expect(nextReviewLine(delta({ intervalTo: 1, stateTo: 'learning' }))).toBe('next review tomorrow · still learning');
  });

  it('rounds a fractional interval', () => {
    expect(nextReviewLine(delta({ intervalTo: 23.6, stateTo: 'mature' }))).toBe('next review in ~24 days · solid');
  });

  it('maps each lifecycle state to its phrase', () => {
    expect(nextReviewLine(delta({ intervalTo: 5, stateTo: 'new' }))).toBe('next review in ~5 days · just getting started');
    expect(nextReviewLine(delta({ intervalTo: 5, stateTo: 'known' }))).toBe('next review in ~5 days · known cold');
    expect(nextReviewLine(delta({ intervalTo: 5, stateTo: 'leech' }))).toBe('next review in ~5 days · needs work');
    expect(nextReviewLine(delta({ intervalTo: 5, stateTo: 'suspended' }))).toBe('next review in ~5 days · paused');
  });
});
