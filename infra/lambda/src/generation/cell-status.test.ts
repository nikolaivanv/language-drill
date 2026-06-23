import { describe, expect, it } from 'vitest';

import { cellStatusFromDecision } from './cell-status';
import type { RecentJob } from './scheduler-decision';

const recentJob: RecentJob = {
  approvedCount: 5,
  requestedCount: 20,
  dedupGivenUpCount: 1,
  curriculumVersion: '2026-06-23',
  coverageOutcome: null,
  finishedAt: new Date('2026-06-20T04:00:00Z'),
};

describe('cellStatusFromDecision', () => {
  it('maps enqueue with a recent job to active', () => {
    expect(cellStatusFromDecision({ kind: 'enqueue', need: 10 }, recentJob)).toBe('active');
  });

  it('maps enqueue with no recent job to never-run', () => {
    expect(cellStatusFromDecision({ kind: 'enqueue', need: 10 }, null)).toBe('never-run');
  });

  it('maps skip-target-reached to target-reached', () => {
    expect(cellStatusFromDecision({ kind: 'skip-target-reached' }, recentJob)).toBe(
      'target-reached',
    );
  });

  it('maps skip-low-yield to low-yield', () => {
    expect(cellStatusFromDecision({ kind: 'skip-low-yield' }, recentJob)).toBe('low-yield');
  });

  it('maps skip-saturated-dedup to saturated-dedup', () => {
    expect(cellStatusFromDecision({ kind: 'skip-saturated-dedup' }, recentJob)).toBe(
      'saturated-dedup',
    );
  });

  it('maps skip-c2 to out-of-scope', () => {
    expect(cellStatusFromDecision({ kind: 'skip-c2' }, null)).toBe('out-of-scope');
  });
});
