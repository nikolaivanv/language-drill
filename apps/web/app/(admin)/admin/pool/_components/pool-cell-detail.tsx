'use client';

import { useState } from 'react';
import type { AuthenticatedFetch, PoolStatusItem } from '@language-drill/api-client';
import { usePoolCell, useGenerateCell, useRevalidateCell, type RevalidateResponse } from '@language-drill/api-client';
import { REASON_LABELS, type GenerationReasonCode } from '@language-drill/shared';
import { Chip } from '../../../../../components/ui';
import { LangfuseTracesLink } from '../../../../../components/admin/langfuse-traces-link';
import { cellKeyFor } from '../../../../../lib/admin/langfuse';
import { cn } from '../../../../../lib/cn';

const sectionLabel = 'text-[11px] font-semibold uppercase tracking-wide text-ink-mute';

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
    setGenMessage(null);
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

  const revalidate = useRevalidateCell({ fetchFn });
  const [revalSummary, setRevalSummary] = useState<RevalidateResponse | null>(null);
  const [revalMessage, setRevalMessage] = useState<string | null>(null);
  const cellArgs = { language: item.language, level: item.level, type: item.type, grammarPoint: item.grammarPointKey };

  const onPreview = async () => {
    setRevalMessage(null);
    try {
      const s = await revalidate.mutateAsync({ ...cellArgs, apply: false });
      setRevalSummary(s);
    } catch {
      setRevalSummary(null);
      setRevalMessage('Preview failed.');
    }
  };
  const onApply = async () => {
    const n = (revalSummary?.demotedToFlagged ?? 0) + (revalSummary?.demotedToRejected ?? 0);
    if (!window.confirm(`Demote ${n} exercise(s) in this cell?`)) return;
    setRevalMessage(null);
    try {
      const s = await revalidate.mutateAsync({ ...cellArgs, apply: true });
      setRevalSummary(s);
      setRevalMessage(`Applied: ${s.demotedToFlagged} → flagged, ${s.demotedToRejected} → rejected.`);
    } catch {
      setRevalMessage('Apply failed.');
    }
  };
  const canApply =
    !revalSummary?.apply && (revalSummary?.demotedToFlagged ?? 0) + (revalSummary?.demotedToRejected ?? 0) > 0;

  if (detail.isLoading) return <div className="m-2 rounded-md border border-rule bg-paper-2 p-4"><p className="text-[12px] text-ink-soft">Loading…</p></div>;
  if (detail.isError || !detail.data) return <div className="m-2 rounded-md border border-rule bg-paper-2 p-4"><p className="text-[12px] text-ink-soft">Failed to load cell detail.</p></div>;

  const { floors, rejectionReasonCounts } = detail.data;
  const dist = item.coverageDistribution ?? {};
  const axes = Array.from(new Set([...Object.keys(floors), ...Object.keys(dist)])).sort();
  const rejections = Object.entries(rejectionReasonCounts).sort((a, b) => b[1] - a[1]);
  const contentHref =
    `/admin/content?language=${encodeURIComponent(item.language)}&level=${encodeURIComponent(item.level)}` +
    `&type=${encodeURIComponent(item.type)}&grammarPoint=${encodeURIComponent(item.grammarPointKey)}`;

  const actionBtn =
    'rounded-sm border border-rule bg-card px-3 py-[6px] text-[12px] font-medium text-ink transition-colors hover:border-ink-soft disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <div className="m-2 flex flex-col gap-4 rounded-md border border-rule bg-paper-2 p-4 text-[13px]">
      <div className="grid gap-4 md:grid-cols-2">
        <section className="flex flex-col gap-2">
          <h4 className={sectionLabel}>Diversity vs. floors</h4>
          {axes.length === 0 ? (
            <p className="text-ink-soft">No coverage data.</p>
          ) : (
            <ul className="flex flex-col gap-2 list-none p-0 m-0">
              {axes.map((axis) => {
                const axisDist = dist[axis] ?? {};
                const axisFloors = floors[axis] ?? {};
                const values = Array.from(new Set([...Object.keys(axisFloors), ...Object.keys(axisDist)])).sort();
                return (
                  <li key={axis} className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink min-w-[88px]">{axis}</span>
                    {values.map((v) => {
                      const actual = axisDist[v] ?? 0;
                      const floor = axisFloors[v];
                      const below = floor !== undefined && actual < floor;
                      const suffix = below ? ' ✗' : floor !== undefined ? ' ✓' : '';
                      return (
                        <span
                          key={v}
                          data-testid={`axis-${axis}-${v}`}
                          className={cn(
                            'inline-flex items-center rounded-pill border px-2 py-px text-[12px]',
                            below
                              ? 'border-red-200 bg-red-50 text-red-700'
                              : floor !== undefined
                                ? 'border-ok-soft bg-ok-soft text-ok'
                                : 'border-rule bg-card text-ink-soft',
                          )}
                        >
                          {v} {actual}{floor !== undefined ? `/${floor}` : ''}{suffix}
                        </span>
                      );
                    })}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <h4 className={sectionLabel}>Rejection reasons</h4>
          {rejections.length === 0 ? (
            <p className="text-ink-soft">No rejections recorded.</p>
          ) : (
            <div className="flex gap-2 flex-wrap">
              {rejections.map(([code, n]) => (
                <Chip key={code}>
                  {REASON_LABELS[code as GenerationReasonCode] ?? code}: {n}
                </Chip>
              ))}
            </div>
          )}
        </section>
      </div>

      <dl className="flex flex-wrap gap-x-6 gap-y-2 border-y border-rule py-3">
        <Stat label="target" value={String(item.generationTarget)} />
        <Stat label="demand" value={String(item.targetSize)} />
        <Stat label="depletion" value={`${item.depletionRate7d}/day`} />
        <Stat label="last refilled" value={item.lastRefilledAt ?? '—'} />
      </dl>

      <section className="flex flex-col gap-1 border-b border-rule pb-3">
        <h4 className={sectionLabel}>Last generation run</h4>
        {item.lastJob ? (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-soft">
            <span>
              {item.lastJob.approvedCount} / {item.lastJob.requestedCount} approved
            </span>
            <span>dedup given up: {item.lastJob.dedupGivenUpCount}</span>
            <span>curriculum version: {item.lastJob.curriculumVersion ?? '—'}</span>
          </div>
        ) : (
          <p className="text-[12px] text-ink-soft">No generation run yet.</p>
        )}
        {item.status === 'low-yield' || item.status === 'saturated-dedup' ? (
          <p className="text-[12px] text-ink-soft">
            Suppressed — re-runs once the curriculum version is bumped.
          </p>
        ) : null}
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="flex flex-col gap-2">
          <h4 className={sectionLabel}>Refill</h4>
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
              className="w-16 rounded-sm border border-rule bg-card px-2 py-[6px] text-[13px] text-ink outline-none focus:border-ink"
            />
            <button
              type="button"
              onClick={onRefill}
              disabled={generate.isPending}
              className={actionBtn}
            >
              Refill
            </button>
          </div>
          {genMessage ? <p className="text-[12px] text-ink-soft">{genMessage}</p> : null}
        </section>

        <section className="flex flex-col gap-2">
          <h4 className={sectionLabel}>Revalidate</h4>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onPreview}
              disabled={revalidate.isPending}
              className={actionBtn}
            >
              Preview
            </button>
            <button
              type="button"
              onClick={onApply}
              disabled={revalidate.isPending || !canApply}
              className={actionBtn}
            >
              Apply
            </button>
          </div>
          {revalSummary ? (
            <p className="text-[12px] text-ink-soft">
              scanned {revalSummary.scanned} · {revalSummary.apply ? 'demoted' : 'would demote'} → flagged{' '}
              {revalSummary.demotedToFlagged} · → rejected {revalSummary.demotedToRejected} · skipped{' '}
              {revalSummary.skipped} · est ${revalSummary.estCostUsd.toFixed(4)}
            </p>
          ) : null}
          {revalSummary?.truncated ? (
            <p className="text-[12px] text-ink-soft">
              Showing first 25 of {revalSummary.totalCandidates}; use pnpm revalidate:cloze for the full pass.
            </p>
          ) : null}
          {revalMessage ? <p className="text-[12px] text-ink-soft">{revalMessage}</p> : null}
        </section>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-rule pt-3">
        <a href={contentHref} className="text-[13px] font-medium text-accent-2 hover:underline">
          View {item.approved} approved exercises →
        </a>
        <LangfuseTracesLink
          cellKey={cellKeyFor({
            language: item.language,
            level: item.level,
            type: item.type,
            grammarPoint: item.grammarPointKey,
          })}
        />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11px] uppercase tracking-wide text-ink-mute">{label}</dt>
      <dd className="text-[13px] text-ink">{value}</dd>
    </div>
  );
}
