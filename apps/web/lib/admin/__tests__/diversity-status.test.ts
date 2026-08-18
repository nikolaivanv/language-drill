import { describe, it, expect } from 'vitest';
import type { DiversityCell, DiversityPoint } from '@language-drill/api-client';

import {
  cellDiversityStatus,
  matchesDiversityFilter,
  poolCellKey,
  diversityByCellKey,
  isDiversityFilter,
} from '../diversity-status';

function cell(overrides: Partial<DiversityCell> = {}): DiversityCell {
  return {
    cellKey: 'es:b1:cloze:es-b1-point',
    type: 'cloze',
    level: 'B1',
    approved: 20,
    target: 36,
    atTarget: false,
    axes: [],
    seed: { kind: 'none' },
    shortfalls: [],
    provenIssues: 0,
    unknowns: 0,
    ...overrides,
  };
}

const controlledAxis = {
  name: 'person',
  role: 'controlled' as const,
  values: [{ value: '1sg', count: 4, floor: 6 }],
  untagged: 0,
};
const monitoredAxis = { ...controlledAxis, role: 'monitored' as const };

describe('cellDiversityStatus', () => {
  it('reports both families present when the cell declares floors and a seed', () => {
    const status = cellDiversityStatus(
      cell({
        axes: [controlledAxis],
        seed: { kind: 'frequency-band', band: 'verb', rankMax: 2000, distinctSeeds: 9, unlabelledRows: 0 },
      }),
      'grammar',
    );
    expect(status.spec).toEqual({ state: 'present', controlledAxes: 1 });
    expect(status.seed.state).toBe('present');
    expect(status.seed.label).toBe('freq band');
  });

  it('reports a grammar point with neither family as missing on both', () => {
    const status = cellDiversityStatus(cell(), 'grammar');
    expect(status.spec.state).toBe('missing');
    expect(status.seed.state).toBe('missing');
  });

  // A monitored axis carries no floors, so it steers nothing — counting it as
  // a mechanism would hide precisely the points this page is meant to surface.
  it('does NOT count a monitored-only axis as a coverage spec', () => {
    const status = cellDiversityStatus(cell({ axes: [monitoredAxis] }), 'grammar');
    expect(status.spec).toEqual({ state: 'missing', controlledAxes: 0 });
  });

  // The synthetic umbrella kinds have no coverageSpec BY DESIGN. Painting them
  // as "missing" would flood the missing-* filters with false positives.
  it.each(['dictation', 'free-writing', 'paraphrase', 'vocab'])(
    'reports %s umbrellas as not-applicable, never missing',
    (kind) => {
      const status = cellDiversityStatus(cell(), kind);
      expect(status.spec.state).toBe('not-applicable');
      expect(status.seed.state).toBe('not-applicable');
    },
  );

  it('carries the per-cell issue counts through unchanged', () => {
    const status = cellDiversityStatus(cell({ provenIssues: 3, unknowns: 2 }), 'grammar');
    expect(status.provenIssues).toBe(3);
    expect(status.unknowns).toBe(2);
  });
});

describe('matchesDiversityFilter', () => {
  const bare = cellDiversityStatus(cell(), 'grammar');
  const specced = cellDiversityStatus(
    cell({ axes: [controlledAxis], provenIssues: 1 }),
    'grammar',
  );
  const variants = cellDiversityStatus(
    cell({ seed: { kind: 'construction-variants', variants: [], unlabelledRows: 0 } }),
    'grammar',
  );
  const umbrella = cellDiversityStatus(cell(), 'free-writing');

  it('matches a bare grammar cell on every missing filter', () => {
    expect(matchesDiversityFilter(bare, 'missing-all')).toBe(true);
    expect(matchesDiversityFilter(bare, 'missing-spec')).toBe(true);
    expect(matchesDiversityFilter(bare, 'missing-seed')).toBe(true);
  });

  it('does not match missing-all when only one family is absent', () => {
    expect(matchesDiversityFilter(specced, 'missing-spec')).toBe(false);
    expect(matchesDiversityFilter(specced, 'missing-seed')).toBe(true);
    expect(matchesDiversityFilter(specced, 'missing-all')).toBe(false);
  });

  it('never matches a not-applicable umbrella on a missing filter', () => {
    expect(matchesDiversityFilter(umbrella, 'missing-all')).toBe(false);
    expect(matchesDiversityFilter(umbrella, 'missing-spec')).toBe(false);
    expect(matchesDiversityFilter(umbrella, 'missing-seed')).toBe(false);
  });

  it('filters positively by seed kind and by declared spec', () => {
    expect(matchesDiversityFilter(variants, 'has-variants')).toBe(true);
    expect(matchesDiversityFilter(bare, 'has-variants')).toBe(false);
    expect(matchesDiversityFilter(specced, 'has-spec')).toBe(true);
    expect(matchesDiversityFilter(bare, 'has-spec')).toBe(false);
  });

  it('filters by issue counts', () => {
    expect(matchesDiversityFilter(specced, 'proven-issues')).toBe(true);
    expect(matchesDiversityFilter(bare, 'proven-issues')).toBe(false);
    expect(
      matchesDiversityFilter(cellDiversityStatus(cell({ unknowns: 1 }), 'grammar'), 'unknowns'),
    ).toBe(true);
  });

  // An unresolved status is not evidence of absence. Sweeping it into a
  // missing-* result is the false positive this whole surface exists to avoid.
  it('matches nothing when the status is unresolved', () => {
    expect(matchesDiversityFilter(undefined, 'missing-all')).toBe(false);
    expect(matchesDiversityFilter(undefined, 'has-spec')).toBe(false);
    expect(matchesDiversityFilter(undefined, 'proven-issues')).toBe(false);
  });
});

describe('poolCellKey', () => {
  // The silent-failure trap: pool-status serves 'ES'/'B1', the diversity
  // endpoint keys on 'es:b1:…'. A raw join matches no cell and every row
  // renders as mechanism-less rather than erroring.
  it('lowercases language, level and type to match buildCellKey', () => {
    expect(
      poolCellKey({
        language: 'ES',
        level: 'B1',
        type: 'cloze',
        grammarPointKey: 'es-b1-point',
      }),
    ).toBe('es:b1:cloze:es-b1-point');
  });

  it('joins a pool-status row to the diversity response', () => {
    const point: DiversityPoint = {
      key: 'es-b1-point',
      name: 'Point',
      language: 'ES',
      cefrLevel: 'B1',
      kind: 'grammar',
      targetOverride: null,
      provenIssues: 0,
      unknowns: 0,
      cells: [cell()],
    };
    const byKey = diversityByCellKey([point]);
    const key = poolCellKey({
      language: 'ES',
      level: 'B1',
      type: 'cloze',
      grammarPointKey: 'es-b1-point',
    });
    expect(byKey.get(key)).toBeDefined();
  });
});

describe('isDiversityFilter', () => {
  it('accepts a declared filter and rejects anything else', () => {
    expect(isDiversityFilter('missing-all')).toBe(true);
    expect(isDiversityFilter('')).toBe(false);
    expect(isDiversityFilter('mechanism=none')).toBe(false);
  });
});
