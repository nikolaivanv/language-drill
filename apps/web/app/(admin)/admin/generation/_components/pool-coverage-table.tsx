'use client';

import { Fragment, useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import {
  createAuthenticatedFetch,
  type PoolStatusItem,
} from '@language-drill/api-client';
import { PoolCellDetail } from './pool-cell-detail';

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
    <table>
      <thead>
        <tr>
          <th>Language</th>
          <th>Level</th>
          <th>Type</th>
          <th>Grammar Point</th>
          <th>Approved</th>
          <th>Gen Target</th>
          <th>Demand</th>
          <th>
            <button
              type="button"
              onClick={() => setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'))}
            >
              Coverage % {sortDir === 'asc' ? '▲' : '▼'}
            </button>
          </th>
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
                <td>{item.language}</td>
                <td>{item.level}</td>
                <td>{item.type}</td>
                <td>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setExpanded((cur) => (cur === key ? null : key))}
                  >
                    {item.grammarPointKey} {isOpen ? '▼' : '▶'}
                  </button>
                </td>
                <td>{item.approved}</td>
                <td>{item.generationTarget}</td>
                <td>{item.targetSize}</td>
                <td>{(ratio * 100).toFixed(1)}%</td>
              </tr>
              {isOpen ? (
                <tr>
                  <td colSpan={8}>
                    <PoolCellDetail item={item} fetchFn={fetchFn} />
                  </td>
                </tr>
              ) : null}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
