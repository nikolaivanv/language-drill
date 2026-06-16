import { redirect } from 'next/navigation';
import {
  GenerationStatsSchema,
  PoolStatusItemSchema,
  type GenerationStats,
  type PoolStatusItem,
} from '@language-drill/api-client';
import { apiFetch } from '../../../../lib/api-server';
import { PoolCoverageTable } from './_components/pool-coverage-table';

type PanelResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

async function loadJson<T>(
  res: Response,
  parser: (raw: unknown) => { success: true; data: T } | { success: false; error: { message: string } },
): Promise<PanelResult<T>> {
  let raw: unknown;
  try {
    raw = await res.json();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Invalid JSON' };
  }
  const parsed = parser(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.message };
  return { ok: true, data: parsed.data };
}

export default async function AdminGenerationPage() {
  const [poolRes, statsRes] = await Promise.all([
    apiFetch('/admin/pool-status'),
    apiFetch('/admin/generation-stats'),
  ]);

  if (poolRes.status === 403 || statsRes.status === 403) {
    redirect('/');
  }

  const poolResult = await loadJson<PoolStatusItem[]>(poolRes, (raw) =>
    PoolStatusItemSchema.array().safeParse(raw),
  );
  const statsResult = await loadJson<GenerationStats>(statsRes, (raw) =>
    GenerationStatsSchema.safeParse(raw),
  );

  return (
    <div>
      <section>
        <h2>Generation Cost</h2>
        {statsResult.ok ? (
          <>
            <p>$ This Week: ${statsResult.data.costThisWeekUsd.toFixed(4)}</p>
            <p>$ This Month: ${statsResult.data.costThisMonthUsd.toFixed(4)}</p>
          </>
        ) : (
          <p className="text-red-600">Failed to load: {statsResult.error}</p>
        )}
      </section>

      <section>
        <h2>Jobs This Week (7d)</h2>
        {statsResult.ok ? (
          <>
            <p>Succeeded: {statsResult.data.jobsThisWeek.succeeded}</p>
            <p>Failed: {statsResult.data.jobsThisWeek.failed}</p>
            <p>Running: {statsResult.data.jobsThisWeek.running}</p>
            <p>Queued: {statsResult.data.jobsThisWeek.queued}</p>
          </>
        ) : (
          <p className="text-red-600">Failed to load: {statsResult.error}</p>
        )}
      </section>

      <section>
        <h2>Approval Rates (30d)</h2>
        {statsResult.ok ? (
          statsResult.data.approvalRates.length === 0 ? (
            <p>No generation jobs in the past 30 days.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Language</th>
                  <th>Level</th>
                  <th>Type</th>
                  <th>Approved</th>
                  <th>Flagged</th>
                  <th>Rejected</th>
                  <th title="Slots where all dedup retries collided — search-space exhaustion, not validator rejection. Already included in Rejected.">
                    Dedup
                  </th>
                  <th title="approved / (approved + flagged + (rejected − dedup))">
                    Rate %
                  </th>
                </tr>
              </thead>
              <tbody>
                {statsResult.data.approvalRates.map((row) => (
                  <tr key={`${row.language}:${row.level}:${row.type}`}>
                    <td>{row.language}</td>
                    <td>{row.level}</td>
                    <td>{row.type}</td>
                    <td>{row.approvedCount}</td>
                    <td>{row.flaggedCount}</td>
                    <td>{row.rejectedCount}</td>
                    <td>{row.dedupGivenUpCount}</td>
                    <td>{(row.approvalRate * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : (
          <p className="text-red-600">Failed to load: {statsResult.error}</p>
        )}
      </section>

      <section>
        <h2>Pool Coverage</h2>
        {poolResult.ok ? (
          poolResult.data.length === 0 ? (
            <p>No curriculum cells found.</p>
          ) : (
            <PoolCoverageTable items={poolResult.data} />
          )
        ) : (
          <p className="text-red-600">Failed to load: {poolResult.error}</p>
        )}
      </section>
    </div>
  );
}
