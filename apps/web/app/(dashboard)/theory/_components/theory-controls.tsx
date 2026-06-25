'use client';

import { cn } from '../../../../lib/cn';
import { useIsMobile } from '../../../../lib/responsive';
import type { GroupBy, SortBy } from '../../../../lib/theory-library/group-sort';

type Option<T extends string> = { id: T; label: string };

const GROUP_OPTIONS: Option<GroupBy>[] = [
  { id: 'category', label: 'category' },
  { id: 'level', label: 'CEFR level' },
  { id: 'none', label: 'flat list' },
];

const SORT_OPTIONS: Option<SortBy>[] = [
  { id: 'curriculum', label: 'curriculum' },
  { id: 'alpha', label: 'A → Z' },
];

type TheoryControlsProps = {
  groupBy: GroupBy;
  sortBy: SortBy;
  onGroupByChange: (value: GroupBy) => void;
  onSortByChange: (value: SortBy) => void;
};

/**
 * Group-by (category / CEFR level / flat) and sort (curriculum / A→Z) controls.
 * On desktop they render as inline segmented pill groups; on mobile each set is
 * a horizontally scrollable chip strip (Requirements 3.1, 4.1, 7.1, 7.2). Fully
 * controlled — value + onChange owned by the page.
 */
export function TheoryControls({
  groupBy,
  sortBy,
  onGroupByChange,
  onSortByChange,
}: TheoryControlsProps) {
  const isMobile = useIsMobile();

  return (
    <div className={cn('theory-controls', isMobile && 'theory-controls-mobile')}>
      <ControlGroup
        label="group by"
        value={groupBy}
        options={GROUP_OPTIONS}
        onChange={onGroupByChange}
        isMobile={isMobile}
      />
      <ControlGroup
        label="sort"
        value={sortBy}
        options={SORT_OPTIONS}
        onChange={onSortByChange}
        isMobile={isMobile}
      />
    </div>
  );
}

function ControlGroup<T extends string>({
  label,
  value,
  options,
  onChange,
  isMobile,
}: {
  label: string;
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  isMobile: boolean;
}) {
  return (
    <div
      className="theory-control-group"
      role="group"
      aria-label={label}
    >
      <span className="t-micro" style={{ fontSize: 10 }}>
        {label}
      </span>
      <div
        className={cn(
          'theory-control-options',
          isMobile ? 'flex gap-[6px] overflow-x-auto' : 'inline-flex gap-[6px]',
        )}
      >
        {options.map((opt) => {
          const active = opt.id === value;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onChange(opt.id)}
              aria-pressed={active}
              className={cn(
                'whitespace-nowrap rounded-full px-3 py-[6px] text-[12px] transition-colors duration-150 flex-shrink-0',
                active
                  ? 'bg-ink text-paper border border-ink hover:bg-ink-hover hover:border-ink-hover'
                  : 'bg-card text-ink-soft border border-rule hover:text-ink hover:border-rule-strong',
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
