/**
 * The scheduler's low-yield floor for target-seeded cells reads
 * `consecutiveZeroApprovedRuns`. If this loader stops supplying it the rule
 * goes quietly inert — the same way the give-up gates sat dead for three
 * nights in Aug 2026 because the columns they read were NULL. These tests
 * pin the mapping, including the type coercion.
 */

import { describe, expect, it } from 'vitest';

import { loadMostRecentSucceededJobPerCell } from './recent-jobs';

/** Minimal stand-in for the Db surface this loader touches. */
function fakeDb(rows: readonly Record<string, unknown>[]) {
  return { execute: async () => ({ rows }) } as never;
}

const BASE_ROW = {
  cell_key: 'de:a1:vocab_recall:de-a1-vocab-city-transport',
  approved_count: 0,
  requested_count: 1,
  dedup_given_up_count: 0,
  curriculum_version: '2026-08-29',
  grammar_point_fingerprint: 'abc123',
  coverage_outcome: null,
  finished_at: '2026-08-29T04:40:00.000Z',
};

describe('loadMostRecentSucceededJobPerCell', () => {
  it('carries the zero-approval streak through to the RecentJob', async () => {
    const map = await loadMostRecentSucceededJobPerCell(
      fakeDb([{ ...BASE_ROW, consecutive_zero_approved_runs: 5 }]),
    );
    expect(map.get(BASE_ROW.cell_key)?.consecutiveZeroApprovedRuns).toBe(5);
  });

  it('coerces the streak to a number', async () => {
    // node-postgres returns COUNT() and integer arithmetic as strings. Left as
    // a string, `'10' < 3` is a string compare and the floor misfires.
    const map = await loadMostRecentSucceededJobPerCell(
      fakeDb([{ ...BASE_ROW, consecutive_zero_approved_runs: '10' }]),
    );
    const streak = map.get(BASE_ROW.cell_key)?.consecutiveZeroApprovedRuns;
    expect(streak).toBe(10);
    expect(typeof streak).toBe('number');
  });

  it('reads a missing streak as 0 rather than NaN', async () => {
    // 0 means "no evidence", which keeps the exemption — suppressing on
    // missing data would be the dangerous direction.
    const map = await loadMostRecentSucceededJobPerCell(fakeDb([{ ...BASE_ROW }]));
    expect(map.get(BASE_ROW.cell_key)?.consecutiveZeroApprovedRuns).toBe(0);
  });

  it('parses finished_at from a string timestamp', async () => {
    const map = await loadMostRecentSucceededJobPerCell(
      fakeDb([{ ...BASE_ROW, consecutive_zero_approved_runs: 0 }]),
    );
    expect(map.get(BASE_ROW.cell_key)?.finishedAt).toBeInstanceOf(Date);
  });
});
