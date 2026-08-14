/**
 * The DECLARED diversity mechanisms for one cell — which coverage axes it
 * tags and which it controls with floors, and where its per-draft seed comes
 * from. Pure: no I/O, no realization counts. The admin diversity endpoint
 * joins this to SQL-aggregated realization; `audit:collapse` reads the same
 * curriculum fields through its own path.
 *
 * Deliberately delegates the two hard rules to their existing owners —
 * `seedKindFor` (the generator's own seed precedence) and `coverageAxesFor`
 * (the validator's monitoring ∪ controlled union) — so this module cannot
 * drift from what generation actually does.
 */
import { cefrRankWindow } from '@language-drill/ai';
import {
  ExerciseType,
  coverageAxesFor,
  resolveCellTargetFor,
  type CoverageAxis,
} from '@language-drill/shared';

import type { Cell } from './cells';
import { seedKindFor } from './seed-kind';

export type DeclaredAxis = {
  name: CoverageAxis;
  /** `controlled` = named by the point's `coverageSpec`, so it carries floors
   *  and the scheduler targets it. `monitored` = tagged for measurement only. */
  role: 'controlled' | 'monitored';
  /** Present iff `role === 'controlled'`. */
  floors?: Record<string, number>;
};

export type DeclaredSeed =
  | {
      kind: 'construction-variants';
      variants: Array<{ id: string; directive: string; share: number }>;
    }
  | {
      kind: 'curated';
      source:
        | 'conjugationSeedWords'
        | 'elicitationSeedValues'
        | 'paraphrase.seeds';
      values: string[];
    }
  | {
      kind: 'frequency-band';
      band: 'verb' | 'noun' | 'content-word';
      rankMax: number;
    }
  | { kind: 'vocab-target' }
  | { kind: 'none' };

export type DiversityMechanisms = {
  axes: DeclaredAxis[];
  seed: DeclaredSeed;
  target: number;
  targetOverride: number | null;
};

export function resolveCellMechanisms(cell: Cell): DiversityMechanisms {
  const gp = cell.grammarPoint;
  const spec = gp.coverageSpec;

  // Floors live on the spec; `coverageAxesFor` owns which axes appear at all.
  const floorsByAxis = new Map<CoverageAxis, Record<string, number>>();
  for (const axis of spec?.axes ?? []) {
    const floors: Record<string, number> = {};
    for (const [value, n] of Object.entries(axis.floors)) {
      if (typeof n === 'number') floors[value] = n;
    }
    floorsByAxis.set(axis.name, floors);
  }

  const axes: DeclaredAxis[] = coverageAxesFor(cell.exerciseType, spec).map(
    (name) => {
      const floors = floorsByAxis.get(name);
      return floors
        ? { name, role: 'controlled' as const, floors }
        : { name, role: 'monitored' as const };
    },
  );

  return {
    axes,
    seed: resolveSeed(cell),
    target: resolveCellTargetFor({
      exerciseType: cell.exerciseType,
      cefrLevel: cell.cefrLevel,
      grammarPoint: gp,
    }),
    targetOverride: gp.targetOverride ?? null,
  };
}

function resolveSeed(cell: Cell): DeclaredSeed {
  const gp = cell.grammarPoint;
  const kind = seedKindFor(cell);
  if (kind === null) return { kind: 'none' };

  switch (kind) {
    case 'construction-variants':
      return {
        kind: 'construction-variants',
        variants: (gp.constructionVariants ?? []).map((v) => ({
          id: v.id,
          directive: v.directive,
          share: v.share ?? 1,
        })),
      };

    case 'elicitation-values':
      // Both paths persist to `content_json.seedWord` and both are bounded
      // curated pools; only the curriculum field they draw from differs.
      return cell.exerciseType === ExerciseType.CONTEXTUAL_PARAPHRASE
        ? {
            kind: 'curated',
            source: 'paraphrase.seeds',
            values: [...(gp.paraphrase?.seeds ?? [])],
          }
        : {
            kind: 'curated',
            source: 'elicitationSeedValues',
            values: [...(gp.elicitationSeedValues ?? [])],
          };

    case 'predicate-nominal':
      return {
        kind: 'curated',
        source: 'conjugationSeedWords',
        values: [...(gp.conjugationSeedWords ?? [])],
      };

    case 'vocab-target':
      return { kind: 'vocab-target' };

    case 'noun':
    case 'verb': {
      // A curated list REPLACES the DB band for both nominal and verb
      // conjugation cells (`run-one-cell.ts` picks `conjugationSeedWords`
      // over the band when it is non-empty), so report what generation will
      // actually draw from rather than the nominal seed kind.
      const curated = gp.conjugationSeedWords;
      if (curated && curated.length > 0) {
        return {
          kind: 'curated',
          source: 'conjugationSeedWords',
          values: [...curated],
        };
      }
      return {
        kind: 'frequency-band',
        band: kind,
        rankMax: cefrRankWindow(cell.cefrLevel).rankMax,
      };
    }

    case 'frequency':
      return {
        kind: 'frequency-band',
        band: 'content-word',
        rankMax: cefrRankWindow(cell.cefrLevel).rankMax,
      };
  }
}
