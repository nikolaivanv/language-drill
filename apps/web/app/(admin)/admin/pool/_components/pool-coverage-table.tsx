'use client';

import { Fragment, useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import {
  createAuthenticatedFetch,
  type PoolStatusItem,
} from '@language-drill/api-client';
import { PoolCellDetail } from './pool-cell-detail';
import { DataTable, Th, Td } from '../../../../../components/admin/data-table';

type Props = { items: PoolStatusItem[] };

type SortDir = 'asc' | 'desc';

function coverageBgClass(ratio: number): string {
  if (ratio < 0.5) return 'bg-red-100';
  if (ratio < 0.8) return 'bg-amber-100';
  return 'bg-green-100';
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
                <Td align="right">{item.approved}</Td>
                <Td align="right">{item.generationTarget}</Td>
                <Td align="right">{item.targetSize}</Td>
                <Td align="right" className="font-medium">{(ratio * 100).toFixed(1)}%</Td>
              </tr>
              {isOpen ? (
                <tr>
                  <td colSpan={8} className="border-b border-rule bg-paper p-0">
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
