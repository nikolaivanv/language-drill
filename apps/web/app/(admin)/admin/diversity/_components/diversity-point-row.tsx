'use client';

import { useState } from 'react';
import type { DiversityCell, DiversityPoint } from '@language-drill/api-client';

import { cn } from '../../../../../lib/cn';

const chipBase =
  'inline-flex items-center rounded-pill border px-2 py-px text-[12px]';
const ok = 'border-ok-soft bg-ok-soft text-ok';
const bad = 'border-red-200 bg-red-50 text-red-700';
// Deliberately NOT the failure style: an unknown is a measurement gap, and
// styling it as a failure is what gets sound rows demoted.
const unknown = 'border-rule bg-card text-ink-soft';

export function DiversityPointRow({ point }: { point: DiversityPoint }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="flex flex-col gap-1 border-b border-rule py-1">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex flex-wrap items-center gap-2 text-left text-[13px]"
      >
        <span className="font-mono text-ink">{point.key}</span>
        <span className="text-ink">{point.name}</span>
        <span className="text-ink-soft">{point.cefrLevel}</span>
        {point.provenIssues > 0 && (
          <span className={cn(chipBase, bad)}>✗ {point.provenIssues}</span>
        )}
        {point.unknowns > 0 && (
          <span className={cn(chipBase, unknown)}>⚠ {point.unknowns} unknown</span>
        )}
        {point.provenIssues === 0 && point.unknowns === 0 && (
          <span className="text-[12px] text-ink-soft">— ok</span>
        )}
      </button>
      {open && (
        <div className="flex flex-col gap-3 pl-2">
          {point.cells.map((cell) => (
            <CellPanel key={cell.cellKey} cell={cell} />
          ))}
        </div>
      )}
    </li>
  );
}

function CellPanel({ cell }: { cell: DiversityCell }) {
  return (
    <section className="flex flex-col gap-1 text-[12px]">
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-ink-mute">
        {cell.type} · {cell.level} · {cell.approved}/{cell.target}
      </h4>

      {cell.atTarget && cell.shortfalls.length > 0 && (
        <p className="text-red-700">
          At target with unmet floors — the scheduler has no deficit here, so it
          will never revisit this cell and the floors will never fire. Needs{' '}
          <code>pnpm demote:pool</code>.
        </p>
      )}

      {cell.axes.map((axis) => (
        <div key={axis.name} className="flex flex-wrap items-center gap-2">
          <span className="min-w-[88px] font-medium text-ink">
            {axis.name}
            {axis.role === 'controlled' ? '*' : ''}
          </span>
          {axis.values.map((v) => {
            const proven = v.count === 0 && v.floor !== null && axis.untagged === 0;
            const unsure = v.count === 0 && v.floor !== null && axis.untagged > 0;
            return (
              <span
                key={v.value}
                data-testid={`axis-${axis.name}-${v.value}`}
                className={cn(chipBase, proven ? bad : unsure ? unknown : ok)}
              >
                {v.value} {v.count}
                {v.floor !== null ? `/${v.floor}` : ''}
                {proven ? ' ✗' : unsure ? ' ⚠' : ' ✓'}
              </span>
            );
          })}
          {axis.untagged > 0 && (
            <span className="text-ink-soft">
              {axis.untagged} rows untagged — a zero here may be a tagging gap
            </span>
          )}
        </div>
      ))}

      <SeedPanel seed={cell.seed} />
    </section>
  );
}

function SeedPanel({ seed }: { seed: DiversityCell['seed'] }) {
  if (seed.kind === 'construction-variants') {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-[88px] font-medium text-ink">variants</span>
        {seed.variants.map((v) => {
          const proven = v.count === 0 && seed.unlabelledRows === 0;
          const unsure = v.count === 0 && seed.unlabelledRows > 0;
          return (
            <span
              key={v.id}
              title={v.directive}
              data-testid={`variant-${v.id}`}
              className={cn(chipBase, proven ? bad : unsure ? unknown : ok)}
            >
              {v.id} {v.count}/{Math.round(v.quota)}
              {proven ? ' ✗' : unsure ? ' ⚠' : ' ✓'}
            </span>
          );
        })}
        {seed.unlabelledRows > 0 && (
          <span className="text-ink-soft">
            {seed.unlabelledRows} rows unlabelled (pre-#640) — a variant at zero
            here is unmeasured, not absent
          </span>
        )}
      </div>
    );
  }
  if (seed.kind === 'curated') {
    return (
      <p className="text-ink-soft">
        seeds: curated <code>{seed.source}</code> — {seed.usedCount} of{' '}
        {seed.poolSize} used
        {seed.usedCount >= seed.poolSize && seed.poolSize > 0
          ? ' — pool exhausted; this cell has stopped generating'
          : ''}
      </p>
    );
  }
  if (seed.kind === 'frequency-band') {
    return (
      <p className="text-ink-soft">
        seeds: {seed.band} band (ranks ≤ {seed.rankMax}) — {seed.distinctSeeds}{' '}
        distinct realized
      </p>
    );
  }
  if (seed.kind === 'vocab-target') {
    return <p className="text-ink-soft">seeds: curated vocab-target list</p>;
  }
  return <p className="text-ink-soft">seeds: none (unseeded cell)</p>;
}
