'use client';

import { useMemo, useState } from 'react';
import type { PoolStatusItem } from '@language-drill/api-client';

type Props = { items: PoolStatusItem[] };

type SortDir = 'asc' | 'desc';

function coverageBgClass(ratio: number): string {
  if (ratio < 0.5) return 'bg-red-100';
  if (ratio < 0.8) return 'bg-amber-100';
  return 'bg-green-100';
}

export function PoolCoverageTable({ items }: Props) {
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const sortedItems = useMemo(
    () =>
      [...items].sort((a, b) => {
        const ra = a.approved / a.targetSize;
        const rb = b.approved / b.targetSize;
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
          <th>Target</th>
          <th>
            <button
              type="button"
              onClick={() =>
                setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'))
              }
            >
              Coverage % {sortDir === 'asc' ? '▲' : '▼'}
            </button>
          </th>
        </tr>
      </thead>
      <tbody>
        {sortedItems.map((item) => {
          const ratio = item.approved / item.targetSize;
          return (
            <tr
              key={`${item.language}:${item.level}:${item.type}:${item.grammarPointKey}`}
              className={coverageBgClass(ratio)}
            >
              <td>{item.language}</td>
              <td>{item.level}</td>
              <td>{item.type}</td>
              <td>{item.grammarPointKey}</td>
              <td>{item.approved}</td>
              <td>{item.targetSize}</td>
              <td>{(ratio * 100).toFixed(1)}%</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
