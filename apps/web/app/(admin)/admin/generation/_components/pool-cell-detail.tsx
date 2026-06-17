'use client';

import { useState } from 'react';
import type { AuthenticatedFetch, PoolStatusItem } from '@language-drill/api-client';
import { usePoolCell, useGenerateCell } from '@language-drill/api-client';
import { REASON_LABELS, type GenerationReasonCode } from '@language-drill/shared';

export function PoolCellDetail({ item, fetchFn }: { item: PoolStatusItem; fetchFn: AuthenticatedFetch }) {
  const detail = usePoolCell({
    fetchFn,
    cell: { language: item.language, level: item.level, type: item.type, grammarPoint: item.grammarPointKey },
  });

  const generate = useGenerateCell({ fetchFn });
  const [refillCount, setRefillCount] = useState(() =>
    Math.min(50, Math.max(1, item.generationTarget - item.approved)),
  );
  const [genMessage, setGenMessage] = useState<string | null>(null);
  const onRefill = async () => {
    if (!window.confirm(`Generate ~${refillCount} exercises for this cell?`)) return;
    try {
      const res = await generate.mutateAsync({
        language: item.language, level: item.level, type: item.type,
        grammarPoint: item.grammarPointKey, count: refillCount,
      });
      setGenMessage(`Queued (job ${res.jobId.slice(0, 8)})`);
    } catch (err) {
      const status = (err as { status?: number }).status;
      setGenMessage(status === 409 ? 'A job for this cell is already in progress.' : 'Failed to queue generation.');
    }
  };

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

      <section className="flex flex-col gap-1">
        <h4 className="text-ink-soft text-[12px] mb-1">Refill</h4>
        <div className="flex items-center gap-2">
          <label className="text-[12px] text-ink-soft" htmlFor="refill-count">Refill count</label>
          <input
            id="refill-count"
            aria-label="Refill count"
            type="number"
            min={1}
            max={50}
            value={refillCount}
            onChange={(e) => setRefillCount(Math.min(50, Math.max(1, Number(e.target.value) || 1)))}
            className="w-16 text-[13px]"
          />
          <button
            type="button"
            onClick={onRefill}
            disabled={generate.isPending}
            className="text-[13px] text-ink underline disabled:opacity-40"
          >
            Refill
          </button>
        </div>
        {genMessage ? <p className="text-[12px] text-ink-soft">{genMessage}</p> : null}
      </section>

      <a href={contentHref} className="text-[13px] text-ink underline">
        View {item.approved} approved exercises →
      </a>
    </div>
  );
}
