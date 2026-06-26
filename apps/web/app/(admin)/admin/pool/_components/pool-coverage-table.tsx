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

type Props = { items: PoolStatusItem[] };

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

function cellKeyOf(item: PoolStatusItem): string {
  return `${item.language}:${item.level}:${item.type}:${item.grammarPointKey}`;
}

export function PoolCoverageTable({ items }: Props) {
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
          const key = cellKeyOf(item);
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
                    className="inline-flex items-center gap-1 font-medium text-ink hover:text-accent-2"
                    onClick={() => setExpanded((cur) => (cur === key ? null : key))}
                  >
                    <span className="t-mono">{item.grammarPointKey}</span> {isOpen ? '▼' : '▶'}
                  </button>
                </Td>
                <Td><StatusBadge status={item.status} /></Td>
                <Td align="right">{item.approved}</Td>
                <Td align="right">{item.generationTarget}</Td>
                <Td align="right">{item.targetSize}</Td>
                <Td align="right" className="font-medium">{(ratio * 100).toFixed(1)}%</Td>
              </tr>
              {isOpen ? (
                <tr>
                  <td colSpan={9} className="border-b border-rule bg-paper p-0">
                    <PoolCellDetail item={item} fetchFn={fetchFn} />
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
