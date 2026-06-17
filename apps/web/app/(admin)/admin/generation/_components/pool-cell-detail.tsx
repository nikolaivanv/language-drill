'use client';

import type { AuthenticatedFetch, PoolStatusItem } from '@language-drill/api-client';
import { usePoolCell } from '@language-drill/api-client';
import { REASON_LABELS, type GenerationReasonCode } from '@language-drill/shared';

export function PoolCellDetail({ item, fetchFn }: { item: PoolStatusItem; fetchFn: AuthenticatedFetch }) {
  const detail = usePoolCell({
    fetchFn,
    cell: { language: item.language, level: item.level, type: item.type, grammarPoint: item.grammarPointKey },
  });

  if (detail.isLoading) return <p className="text-[12px] text-ink-soft p-3">Loading…</p>;
  if (detail.isError || !detail.data) return <p className="text-[12px] text-ink-soft p-3">Failed to load cell detail.</p>;

  const { floors, rejectionReasonCounts } = detail.data;
  const dist = item.coverageDistribution ?? {};
  const axes = Array.from(new Set([...Object.keys(floors), ...Object.keys(dist)])).sort();
  const rejections = Object.entries(rejectionReasonCounts).sort((a, b) => b[1] - a[1]);
  const contentHref =
    `/admin/content?language=${encodeURIComponent(item.language)}&level=${encodeURIComponent(item.level)}` +
    `&type=${encodeURIComponent(item.type)}&grammarPoint=${encodeURIComponent(item.grammarPointKey)}`;

  return (
    <div className="flex flex-col gap-3 p-3 text-[13px]">
      <section>
        <h4 className="text-ink-soft text-[12px] mb-1">Diversity vs. floors</h4>
        {axes.length === 0 ? (
          <p className="text-ink-soft">No coverage data.</p>
        ) : (
          <ul className="flex flex-col gap-1 list-none p-0 m-0">
            {axes.map((axis) => {
              const axisDist = dist[axis] ?? {};
              const axisFloors = floors[axis] ?? {};
              const values = Array.from(new Set([...Object.keys(axisFloors), ...Object.keys(axisDist)])).sort();
              return (
                <li key={axis}>
                  <span className="text-ink">{axis}</span>{' '}
                  {values.map((v) => {
                    const actual = axisDist[v] ?? 0;
                    const floor = axisFloors[v];
                    const below = floor !== undefined && actual < floor;
                    const suffix = below ? ' ✗' : floor !== undefined ? ' ✓' : '';
                    return (
                      <span
                        key={v}
                        data-testid={`axis-${axis}-${v}`}
                        className={below ? 'text-red-700' : 'text-ink-soft'}
                      >
                        {v} {actual}{floor !== undefined ? `/${floor}` : ''}{suffix}{'  '}
                      </span>
                    );
                  })}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h4 className="text-ink-soft text-[12px] mb-1">Rejection reasons</h4>
        {rejections.length === 0 ? (
          <p className="text-ink-soft">No rejections recorded.</p>
        ) : (
          <div className="flex gap-2 flex-wrap">
            {rejections.map(([code, n]) => (
              <span key={code} className="bg-paper-2 text-ink px-2 py-px rounded-full text-[12px]">
                {REASON_LABELS[code as GenerationReasonCode] ?? code}: {n}
              </span>
            ))}
          </div>
        )}
      </section>

      <p className="text-[12px] text-ink-soft">
        target {item.generationTarget} · demand {item.targetSize} · {item.depletionRate7d}/day · last refilled{' '}
        {item.lastRefilledAt ?? '—'}
      </p>

      <a href={contentHref} className="text-[13px] text-ink underline">
        View {item.approved} approved exercises →
      </a>
    </div>
  );
}
