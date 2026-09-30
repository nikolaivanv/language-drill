'use client';

import * as React from 'react';
import Link from 'next/link';
import type { PublicLanguage, PublicLevel, PublicPoint } from '@language-drill/api-client';
import { cn } from '../../../../lib/cn';

/**
 * What the visitor is drilling, and how to change it.
 *
 * Deliberately NOT a search box with a pinned-favourites row: there are only
 * 10-16 conjugation points per language, and the whole list fits on a screen.
 * Search over twelve items adds a decision without removing effort, and
 * "pinned popular" is a second list to maintain when ordering already does the
 * job — the server returns points in curriculum order, so the basics come
 * first, and grouping by category separates tenses from cases (which matters
 * here: half the German and Turkish pool is declension, not conjugation).
 *
 * Collapsed by default. The drill is the page's job; choosing what to drill is
 * a detour a visitor takes at most once.
 */

export interface PointPickerProps {
  lang: PublicLanguage;
  level: PublicLevel;
  points: readonly PublicPoint[];
  /** The point currently being drilled, or undefined for the mixed set. */
  activePoint?: string;
  isLoading?: boolean;
}

const CATEGORY_LABEL: Record<string, string> = {
  tenses: 'Tenses',
  moods: 'Moods',
  pairs: 'Easily confused',
  morphology: 'Word forms',
  cases: 'Cases',
  syntax: 'Sentence structure',
  pronouns: 'Pronouns',
  articles: 'Articles',
  orthography: 'Spelling',
  other: 'Other',
};

function href(lang: PublicLanguage, level: PublicLevel, point?: string): string {
  const params = new URLSearchParams({ lang, level });
  if (point) params.set('point', point);
  return `/try/forms?${params.toString()}`;
}

export function PointPicker({
  lang,
  level,
  points,
  activePoint,
  isLoading = false,
}: PointPickerProps) {
  const [open, setOpen] = React.useState(false);

  const active = activePoint ? points.find((p) => p.key === activePoint) : undefined;
  const currentLabel = active ? active.name : `Everything at ${level}`;

  // Preserve the server's curriculum order within each group.
  const groups = React.useMemo(() => {
    const byCategory = new Map<string, PublicPoint[]>();
    for (const point of points) {
      const list = byCategory.get(point.category) ?? [];
      list.push(point);
      byCategory.set(point.category, list);
    }
    return [...byCategory.entries()];
  }, [points]);

  return (
    <div className="flex flex-col gap-s-2">
      <div className="flex flex-wrap items-baseline justify-between gap-s-2">
        <p className="t-body text-ink-2">
          Drilling <span className="text-ink">{currentLabel}</span>
        </p>
        {points.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="t-small text-ink-mute underline underline-offset-2 hover:text-ink"
          >
            {open ? 'close' : 'choose a topic'}
          </button>
        )}
      </div>

      {isLoading && points.length === 0 && (
        <p className="t-small text-ink-mute">loading topics…</p>
      )}

      {open && (
        <div className="flex flex-col gap-s-3 rounded-lg border border-rule bg-card p-s-4">
          <Link
            href={href(lang, level)}
            aria-current={activePoint ? undefined : 'page'}
            className={cn(
              't-body no-underline',
              activePoint ? 'text-ink-mute hover:text-ink' : 'text-ink',
            )}
          >
            Everything at {level}
          </Link>

          {groups.map(([category, categoryPoints]) => (
            <div key={category} className="flex flex-col gap-[2px]">
              <p className="t-small text-ink-mute">
                {CATEGORY_LABEL[category] ?? CATEGORY_LABEL.other}
              </p>
              {categoryPoints.map((point) => {
                const isActive = point.key === activePoint;
                return (
                  <Link
                    key={point.key}
                    href={href(lang, level, point.key)}
                    aria-current={isActive ? 'page' : undefined}
                    className={cn(
                      'flex items-baseline justify-between gap-s-3 border-t border-rule py-[6px] no-underline',
                      isActive ? 'text-ink' : 'text-ink-2 hover:text-ink',
                    )}
                  >
                    <span className="text-[14px]">{point.name}</span>
                    <span className="shrink-0 font-mono text-[12px] text-ink-mute">
                      {point.count}
                    </span>
                  </Link>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
