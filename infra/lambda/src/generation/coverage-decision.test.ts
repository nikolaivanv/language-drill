import { describe, it, expect } from 'vitest';
import { Language } from '@language-drill/shared';
import { decideCoverageTargets, GIVE_UP_MIN_ATTEMPTS } from './coverage-decision';

describe('decideCoverageTargets', () => {
  it('water-fills the most-starved persons first (TR, 6 persons)', () => {
    const { personTargets } = decideCoverageTargets({
      language: Language.TR,
      need: 8,
      approvedByPerson: { '1sg': 8, '2sg': 6, '3sg': 9, '1pl': 4, '2pl': 1, '3pl': 2 },
      recentOutcome: null,
    });
    expect(personTargets).toHaveLength(8);
    const counts = tally(personTargets);
    expect(counts['2pl']).toBeGreaterThanOrEqual(counts['1pl'] ?? 0);
    expect(counts['3sg'] ?? 0).toBe(0);
  });

  it('returns [] when need <= 0', () => {
    expect(
      decideCoverageTargets({
        language: Language.TR, need: 0, approvedByPerson: {}, recentOutcome: null,
      }).personTargets,
    ).toEqual([]);
  });

  it('distributes evenly from an empty pool (== ceil(target/N) floor)', () => {
    const { personTargets } = decideCoverageTargets({
      language: Language.TR, need: 6, approvedByPerson: {}, recentOutcome: null,
    });
    expect(tally(personTargets)).toEqual({
      '1sg': 1, '2sg': 1, '3sg': 1, '1pl': 1, '2pl': 1, '3pl': 1,
    });
  });

  it('omits 2pl for Spanish (5-person paradigm)', () => {
    const { personTargets } = decideCoverageTargets({
      language: Language.ES, need: 5, approvedByPerson: {}, recentOutcome: null,
    });
    expect(personTargets).not.toContain('2pl');
    expect(new Set(personTargets)).toEqual(
      new Set(['1sg', '2sg', '3sg', '1pl', '3pl']),
    );
  });

  it('suppresses a zero-yield bucket and reports it', () => {
    const { personTargets, suppressed } = decideCoverageTargets({
      language: Language.TR,
      need: 6,
      approvedByPerson: { '1sg': 5, '2sg': 5, '3sg': 5, '1pl': 5, '3pl': 5 },
      recentOutcome: { '2pl': { requested: 5, approved: 0 } },
    });
    expect(suppressed).toEqual(['2pl']);
    expect(personTargets).not.toContain('2pl');
    expect(personTargets).toHaveLength(6);
  });

  it('does not suppress on a single attempt (< GIVE_UP_MIN_ATTEMPTS)', () => {
    expect(GIVE_UP_MIN_ATTEMPTS).toBe(2);
    const { suppressed, personTargets } = decideCoverageTargets({
      language: Language.TR,
      need: 6,
      approvedByPerson: { '1sg': 5, '2sg': 5, '3sg': 5, '1pl': 5, '3pl': 5 },
      recentOutcome: { '2pl': { requested: 1, approved: 0 } },
    });
    expect(suppressed).toEqual([]);
    expect(personTargets).toContain('2pl');
  });

  it('does not suppress a bucket that yielded at least once', () => {
    const { suppressed } = decideCoverageTargets({
      language: Language.TR,
      need: 6,
      approvedByPerson: {},
      recentOutcome: { '2pl': { requested: 5, approved: 1 } },
    });
    expect(suppressed).toEqual([]);
  });

  it('ignores approvedByPerson/recentOutcome keys not in the language paradigm', () => {
    // ES has no 2pl. A stale 2pl entry in either input must not appear in the
    // output and must not cause a spurious suppression.
    const { personTargets, suppressed } = decideCoverageTargets({
      language: Language.ES,
      need: 5,
      approvedByPerson: { '2pl': 99 },
      recentOutcome: { '2pl': { requested: 5, approved: 0 } },
    });
    expect(personTargets).not.toContain('2pl');
    expect(suppressed).toEqual([]);
    expect(new Set(personTargets)).toEqual(
      new Set(['1sg', '2sg', '3sg', '1pl', '3pl']),
    );
  });

  it('null recentOutcome suppresses nothing (curriculum bump cleared it)', () => {
    const { suppressed, personTargets } = decideCoverageTargets({
      language: Language.TR, need: 6, approvedByPerson: {}, recentOutcome: null,
    });
    expect(suppressed).toEqual([]);
    expect(personTargets).toHaveLength(6);
  });

  it('returns [] when every person is suppressed (blind fallback)', () => {
    const recentOutcome = Object.fromEntries(
      ['1sg', '2sg', '3sg', '1pl', '2pl', '3pl'].map((p) => [
        p, { requested: 3, approved: 0 },
      ]),
    );
    const { personTargets, suppressed } = decideCoverageTargets({
      language: Language.TR, need: 6, approvedByPerson: {}, recentOutcome,
    });
    expect(personTargets).toEqual([]);
    expect(suppressed).toHaveLength(6);
  });
});

function tally(codes: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of codes) out[c] = (out[c] ?? 0) + 1;
  return out;
}
