'use client';

import { Fragment, useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import {
  createAuthenticatedFetch,
  type PoolCellStatus,
  type PoolStatusItem,
} from '@language-drill/api-client';
import { PoolCellDetail } from './pool-cell-detail';
import { DataTable, Th, Td } from '../../../../../components/admin/data-table';
import { cn } from '../../../../../lib/cn';
import {
  DIVERSITY_CHIP_BASE,
  DIVERSITY_CHIP_CLASSNAMES,
} from '../../../../../lib/admin/diversity-chip';
import {
  poolCellKey,
  type CellDiversity,
  type CellDiversityStatus,
  type MechanismState,
} from '../../../../../lib/admin/diversity-status';

type Props = {
  items: PoolStatusItem[];
  /** cellKey → declared mechanisms + realization, or undefined while the
   *  diversity fetch is in flight. A row with no entry renders '—', never a
   *  claimed absence. */
  diversityByCell?: Map<string, CellDiversity>;
};

type SortDir = 'asc' | 'desc';

// Row tint encodes coverage (red <50%, amber 50–80%, green ≥80%). The light
// pastels don't flip with the token-driven dark theme, so the cream `text-ink`
// cells become near-invisible on them — pair each with a dark, desaturated tint
// scoped to `dark:` (enabled via the `.dark` custom variant in globals.css).
function coverageBgClass(ratio: number): string {
  if (ratio < 0.5) return 'bg-red-100 dark:bg-red-950/60';
  if (ratio < 0.8) return 'bg-amber-100 dark:bg-amber-950/60';
  return 'bg-green-100 dark:bg-green-950/55';
}

// Mirror of the scheduler's next-tick decision: label + chip color, plus a
// hover hint. `active`/`never-run` are go states; the rest are no-ops or
// suppressions. Suppression clears on a curriculum-version bump.
const STATUS_BADGE: Record<
  PoolCellStatus,
  { label: string; className: string; title: string }
> = {
  active: {
    label: 'Active',
    className: 'bg-green-100 text-green-900',
    title: 'Under target — the scheduler will generate for this cell.',
  },
  'target-reached': {
    label: 'Target reached',
    className: 'bg-sky-100 text-sky-900',
    title: 'Approved count has reached the generation target.',
  },
  'low-yield': {
    label: 'Low-yield',
    className: 'bg-amber-100 text-amber-900',
    title:
      'Suppressed: the last run produced fewer than 3 net-new approvals. Clears on a curriculum bump.',
  },
  'saturated-dedup': {
    label: 'Saturated',
    className: 'bg-red-100 text-red-900',
    title:
      'Suppressed: the last run was dedup-heavy (the search space is exhausted). Clears on a curriculum bump.',
  },
  'never-run': {
    label: 'Never run',
    className: 'bg-paper-2 text-ink-soft',
    title: 'No succeeded generation job yet — the scheduler will pick it up.',
  },
  'out-of-scope': {
    label: 'Out of scope',
    className: 'bg-paper-2 text-ink-soft',
    title: 'Outside the Round-1 CEFR set — not scheduled.',
  },
};

function StatusBadge({ status }: { status: PoolCellStatus }) {
  const badge = STATUS_BADGE[status];
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-[12px] font-medium ${badge.className}`}
      title={badge.title}
    >
      {badge.label}
    </span>
  );
}

// `not-applicable` deliberately borrows the 'unknown' neutral style rather
// than the failure style — an umbrella kind with no coverageSpec is correct by
// design, not a defect. See lib/admin/diversity-status.ts.
const MECHANISM_CHIP_CLASSNAMES: Record<MechanismState, string> = {
  present: DIVERSITY_CHIP_CLASSNAMES.ok,
  missing: DIVERSITY_CHIP_CLASSNAMES.bad,
  'not-applicable': DIVERSITY_CHIP_CLASSNAMES.unknown,
};

function MechanismChip({
  label,
  state,
  testId,
}: {
  label: string;
  state: MechanismState;
  testId: string;
}) {
  return (
    <span
      data-testid={testId}
      className={cn(DIVERSITY_CHIP_BASE, MECHANISM_CHIP_CLASSNAMES[state])}
    >
      {label}
      {state === 'present' ? ' ✓' : state === 'missing' ? ' ✗' : ''}
    </span>
  );
}

function DiversityChips({ status }: { status: CellDiversityStatus | undefined }) {
  // Absence of evidence is not evidence of absence: while the diversity fetch
  // is unresolved the row must claim nothing at all.
  if (!status) return <span className="text-ink-soft">—</span>;

  const specLabel =
    status.spec.state === 'present'
      ? `spec ${status.spec.controlledAxes}ax`
      : status.spec.state === 'missing'
        ? 'spec —'
        : 'spec n/a';
  const seedLabel =
    status.seed.state === 'not-applicable' ? 'seed n/a' : `seed ${status.seed.label}`;

  return (
    // Never wrap: the chips are short, and letting a 10th column squeeze them
    // into three-line stacks triples every row's height. The DataTable wrapper
    // already scrolls horizontally.
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <MechanismChip label={specLabel} state={status.spec.state} testId="mechanism-spec" />
      <MechanismChip label={seedLabel} state={status.seed.state} testId="mechanism-seed" />
      {status.provenIssues > 0 && (
        <span
          data-testid="mechanism-proven-issues"
          title="Deficiencies this cell's own denominators prove."
          className={cn(DIVERSITY_CHIP_BASE, DIVERSITY_CHIP_CLASSNAMES.bad)}
        >
          ✗ {status.provenIssues}
        </span>
      )}
      {status.unknowns > 0 && (
        <span
          data-testid="mechanism-unknowns"
          title="Possible measurement gaps — rows remain untagged or unlabelled."
          className={cn(DIVERSITY_CHIP_BASE, DIVERSITY_CHIP_CLASSNAMES.unknown)}
        >
          ⚠ {status.unknowns}
        </span>
      )}
    </span>
  );
}

export function PoolCoverageTable({ items, diversityByCell }: Props) {
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [expanded, setExpanded] = useState<string | null>(null);

  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);

  // Coverage is measured against the generation target — the number the
  // scheduler actually tops the cell up to — not the demand-derived
  // `targetSize`, so an idle cell isn't shown as perpetually under-filled.
  const sortedItems = useMemo(
    () =>
      [...items].sort((a, b) => {
        const ra = a.approved / a.generationTarget;
        const rb = b.approved / b.generationTarget;
        return sortDir === 'asc' ? ra - rb : rb - ra;
      }),
    [items, sortDir],
  );

  return (
    <DataTable>
      <thead>
        <tr>
          <Th>Language</Th>
          <Th>Level</Th>
          <Th>Type</Th>
          <Th>Grammar Point</Th>
          <Th title="Declared diversity mechanisms: coverage-spec floors and seed source, plus this cell's proven (✗) and unknown (⚠) deficiencies.">
            Diversity
          </Th>
          <Th>Status</Th>
          <Th align="right">Approved</Th>
          <Th align="right">Gen Target</Th>
          <Th align="right">Demand</Th>
          <Th align="right">
            <button
              type="button"
              className="inline-flex items-center gap-1 hover:text-ink"
              onClick={() => setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'))}
            >
              Coverage % {sortDir === 'asc' ? '▲' : '▼'}
            </button>
          </Th>
        </tr>
      </thead>
      <tbody>
        {sortedItems.map((item) => {
          const ratio = item.approved / item.generationTarget;
          const key = poolCellKey(item);
          const diversity = diversityByCell?.get(key);
          const isOpen = expanded === key;
          return (
            <Fragment key={key}>
              <tr className={coverageBgClass(ratio)}>
                <Td>{item.language}</Td>
                <Td>{item.level}</Td>
                <Td>{item.type}</Td>
                <Td>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    className="inline-flex items-center gap-1 text-left font-medium text-ink hover:text-accent-2"
                    onClick={() => setExpanded((cur) => (cur === key ? null : key))}
                  >
                    <span className="t-mono">{item.grammarPointKey}</span> {isOpen ? '▼' : '▶'}
                  </button>
                </Td>
                <Td className="whitespace-nowrap"><DiversityChips status={diversity?.status} /></Td>
                <Td><StatusBadge status={item.status} /></Td>
                <Td align="right">{item.approved}</Td>
                <Td align="right">{item.generationTarget}</Td>
                <Td align="right">{item.targetSize}</Td>
                <Td align="right" className="font-medium">{(ratio * 100).toFixed(1)}%</Td>
              </tr>
              {isOpen ? (
                <tr>
                  <td colSpan={10} className="border-b border-rule bg-paper p-0">
                    <PoolCellDetail item={item} fetchFn={fetchFn} diversityCell={diversity?.cell} />
                  </td>
                </tr>
              ) : null}
            </Fragment>
          );
        })}
      </tbody>
    </DataTable>
  );
}
