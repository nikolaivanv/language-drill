/**
 * Evidence scoping is what makes a prompt or curriculum fix visible to the
 * ranking. If this loader silently returns nothing the ranking degrades to
 * `need × prior` — the old deficit order — rather than breaking loudly, so
 * these tests pin the shape and the coercion.
 */

import { describe, expect, it } from 'vitest';

import { evidenceKey, loadScopedApprovalEvidence } from './approval-evidence';

function fakeDb(rows: readonly Record<string, unknown>[]) {
  return { execute: async () => ({ rows }) } as never;
}

describe('evidenceKey', () => {
  it('keys on cell AND fingerprint so an edited point cannot reuse old evidence', () => {
    expect(evidenceKey('de:a1:cloze:x', 'fp1')).not.toBe(
      evidenceKey('de:a1:cloze:x', 'fp2'),
    );
  });

  it('gives a stable key for a null fingerprint', () => {
    expect(evidenceKey('de:a1:cloze:x', null)).toBe(
      evidenceKey('de:a1:cloze:x', null),
    );
  });
});

describe('loadScopedApprovalEvidence', () => {
  it('keys rows by cell and fingerprint', async () => {
    const map = await loadScopedApprovalEvidence(
      fakeDb([
        {
          cell_key: 'de:a1:cloze:x',
          grammar_point_fingerprint: 'fp1',
          approved: 8,
          produced: 10,
        },
      ]),
      new Date('2026-08-18T00:00:00Z'),
    );
    expect(map.get(evidenceKey('de:a1:cloze:x', 'fp1'))).toEqual({
      approved: 8,
      produced: 10,
    });
  });

  it('does not return evidence under a different fingerprint', async () => {
    // The reset: after a directive fix the point's fingerprint changes, so the
    // scheduler's lookup misses and p̂ falls back to the prior.
    const map = await loadScopedApprovalEvidence(
      fakeDb([
        {
          cell_key: 'de:a1:cloze:x',
          grammar_point_fingerprint: 'OLD',
          approved: 0,
          produced: 40,
        },
      ]),
      new Date('2026-08-18T00:00:00Z'),
    );
    expect(map.get(evidenceKey('de:a1:cloze:x', 'NEW'))).toBeUndefined();
  });

  it('coerces pg string aggregates to numbers', async () => {
    // node-postgres returns SUM() as a string; left alone the shrinkage would
    // do string arithmetic and produce garbage.
    const map = await loadScopedApprovalEvidence(
      fakeDb([
        {
          cell_key: 'de:a1:cloze:x',
          grammar_point_fingerprint: 'fp1',
          approved: '8',
          produced: '10',
        },
      ]),
      new Date('2026-08-18T00:00:00Z'),
    );
    const row = map.get(evidenceKey('de:a1:cloze:x', 'fp1'));
    expect(row).toEqual({ approved: 8, produced: 10 });
    expect(typeof row?.produced).toBe('number');
  });
});
