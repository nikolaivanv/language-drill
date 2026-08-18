/**
 * Per-cell diversity MECHANISM status for the `/admin/pool` table — "does this
 * cell declare a way to vary its drafts at all", as distinct from
 * `diversity-chip.ts`, which classifies how well a declared mechanism is being
 * REALIZED. A cell can be perfectly realized against nothing at all; that is
 * the case this module exists to make visible at a glance.
 *
 * Two independent mechanism families, because a cell can have either, both, or
 * neither:
 *   - `spec` — the point's `coverageSpec` declares controlled axes with floors,
 *     so the scheduler steers drafts toward short values.
 *   - `seed` — what each draft rotates over (construction variants, a curated
 *     pool, the frequency band, the curated vocab-target list).
 *
 * Pure and JSX-free so the derivation is unit-testable and the page stays thin.
 */
import type { DiversityCell, DiversityPoint, DiversitySeed } from '@language-drill/api-client';

export type MechanismState = 'present' | 'missing' | 'not-applicable';

export type CellDiversityStatus = {
  spec: { state: MechanismState; controlledAxes: number };
  seed: { state: MechanismState; kind: DiversitySeed['kind']; label: string };
  provenIssues: number;
  unknowns: number;
  /** Whether this cell's point kind is EXPECTED to declare mechanisms at all —
   *  i.e. it is a `grammar` point. Not derivable from the two `state` fields: a
   *  vocab umbrella may legally carry a `wordClass` coverageSpec, which makes
   *  `spec.state` 'present' on a kind that declares nothing else. The negative
   *  seed filters need it to stay off the umbrellas. */
  mechanismsExpected: boolean;
};

/**
 * Only `grammar` points are EXPECTED to declare mechanisms. The synthetic
 * umbrella kinds (`dictation`, `free-writing`, `paraphrase`, `vocab`) carry no
 * grammar-point semantics and have no `coverageSpec` BY DESIGN — see
 * packages/shared/src/curriculum-types.ts. Painting those as "missing" would
 * flood the very filter this module exists to serve, so they resolve to
 * `not-applicable` and never match a `missing-*` filter.
 */
const KINDS_DECLARING_MECHANISMS = new Set(['grammar']);

const SEED_LABELS: Record<DiversitySeed['kind'], string> = {
  'construction-variants': 'variants',
  curated: 'curated',
  'frequency-band': 'freq band',
  'vocab-target': 'vocab list',
  none: 'none',
};

export function cellDiversityStatus(
  cell: DiversityCell,
  pointKind: string,
): CellDiversityStatus {
  const expected = KINDS_DECLARING_MECHANISMS.has(pointKind);

  // A `monitored` axis is tagged for measurement only — it carries no floors,
  // so it steers nothing. Only `controlled` axes count as a mechanism.
  const controlledAxes = cell.axes.filter((a) => a.role === 'controlled').length;
  const specState: MechanismState =
    controlledAxes > 0 ? 'present' : expected ? 'missing' : 'not-applicable';

  // `seed: none` on a grammar point means the generator has nothing to rotate
  // over: every draft in the cell gets an identical prompt. The one way to
  // declare that deliberately is `conjugationSeedKind: 'none'`, which no live
  // curriculum point uses, so treat it as missing rather than opted out.
  const seedState: MechanismState =
    cell.seed.kind !== 'none' ? 'present' : expected ? 'missing' : 'not-applicable';

  return {
    spec: { state: specState, controlledAxes },
    seed: { state: seedState, kind: cell.seed.kind, label: SEED_LABELS[cell.seed.kind] },
    provenIssues: cell.provenIssues,
    unknowns: cell.unknowns,
    mechanismsExpected: expected,
  };
}

/**
 * MUST mirror `buildCellKey` in @language-drill/db, which lowercases the
 * language, level and type but NOT the grammar-point key. `pool-status` serves
 * 'ES'/'B1' while the diversity endpoint keys on 'es:b1:…', so a raw join
 * matches no cell at all — and the failure is silent: every row renders as
 * having no mechanisms rather than erroring.
 */
export function poolCellKey(item: {
  language: string;
  level: string;
  type: string;
  grammarPointKey: string;
}): string {
  return `${item.language.toLowerCase()}:${item.level.toLowerCase()}:${item.type.toLowerCase()}:${item.grammarPointKey}`;
}

/** The table row's chips need `status`; the expanded drawer needs the raw
 *  `cell`. Both come from the same response, so resolve them together once. */
export type CellDiversity = { cell: DiversityCell; status: CellDiversityStatus };

/** Flattens the point-grouped response into a per-cell lookup for the table. */
export function diversityByCellKey(
  points: DiversityPoint[],
): Map<string, CellDiversity> {
  const byKey = new Map<string, CellDiversity>();
  for (const point of points) {
    for (const cell of point.cells) {
      byKey.set(cell.cellKey, { cell, status: cellDiversityStatus(cell, point.kind) });
    }
  }
  return byKey;
}

export const DIVERSITY_FILTER_GROUPS = [
  {
    label: 'missing',
    options: [
      { value: 'missing-all', label: 'no mechanism at all' },
      { value: 'missing-spec', label: 'no coverage spec' },
      { value: 'missing-seed', label: 'no seed source' },
      { value: 'missing-variants', label: 'no construction variants' },
      { value: 'missing-curated', label: 'no curated seeds' },
      { value: 'missing-frequency-band', label: 'no frequency band' },
    ],
  },
  {
    label: 'has issues',
    options: [
      { value: 'proven-issues', label: 'proven issues' },
      { value: 'unknowns', label: 'unknowns (tagging gaps)' },
    ],
  },
  {
    label: 'has',
    options: [
      { value: 'has-variants', label: 'construction variants' },
      { value: 'has-curated', label: 'curated seeds' },
      { value: 'has-frequency-band', label: 'frequency band' },
      { value: 'has-spec', label: 'coverage spec' },
    ],
  },
] as const;

export type DiversityFilter =
  (typeof DIVERSITY_FILTER_GROUPS)[number]['options'][number]['value'];

export function isDiversityFilter(value: string): value is DiversityFilter {
  return DIVERSITY_FILTER_GROUPS.some((g) =>
    g.options.some((o) => (o.value as string) === value),
  );
}

export function matchesDiversityFilter(
  status: CellDiversityStatus | undefined,
  filter: DiversityFilter,
): boolean {
  // An unresolved status — the diversity fetch is still in flight, errored, or
  // this cell is absent from the response — cannot be claimed to match ANY
  // filter. Letting unknowns through a `missing-*` filter would manufacture
  // exactly the false positive this page exists to remove.
  if (!status) return false;

  switch (filter) {
    case 'missing-all':
      return status.spec.state === 'missing' && status.seed.state === 'missing';
    case 'missing-spec':
      return status.spec.state === 'missing';
    case 'missing-seed':
      return status.seed.state === 'missing';
    // The exact negations of the three `has-<seed kind>` filters, scoped to the
    // cells that are expected to declare a mechanism. Seed kinds are
    // mutually exclusive, so "no variants" means "seeded by something else, or
    // by nothing" — including the cells whose exercise type could never carry
    // variants. Gating on that type list would mean re-stating `seedKindFor`'s
    // gate in the web package, which drifts (sentence_construction joined it on
    // 2026-08-14); the chips on each row already say which seed it does have.
    case 'missing-variants':
      return status.mechanismsExpected && status.seed.kind !== 'construction-variants';
    case 'missing-curated':
      return status.mechanismsExpected && status.seed.kind !== 'curated';
    case 'missing-frequency-band':
      return status.mechanismsExpected && status.seed.kind !== 'frequency-band';
    case 'proven-issues':
      return status.provenIssues > 0;
    case 'unknowns':
      return status.unknowns > 0;
    case 'has-variants':
      return status.seed.kind === 'construction-variants';
    case 'has-curated':
      return status.seed.kind === 'curated';
    case 'has-frequency-band':
      return status.seed.kind === 'frequency-band';
    case 'has-spec':
      return status.spec.state === 'present';
  }
}
