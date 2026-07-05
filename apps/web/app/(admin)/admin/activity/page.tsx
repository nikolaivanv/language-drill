'use client';

import { Fragment, Suspense, useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import {
  createAuthenticatedFetch,
  useActivitySessions,
  useActivitySessionDetail,
  useActivityFailures,
  useActivityRoster,
  useResolveContentExercise,
  type ActivityRisk,
  type ActivitySessionListItem,
} from '@language-drill/api-client';
import { DataTable, Th, Td } from '../../../../components/admin/data-table';
import { CopyId } from '../../../../components/admin/copy-id';

type Tab = 'sessions' | 'failures' | 'roster';

function SignalBadge({ signal }: { signal: string }) {
  const label = signal === 'low_score' ? 'low score' : signal;
  return (
    <span className="inline-block px-s-2 py-px rounded-sm text-[11px] bg-paper-2 text-ink-soft">
      {label}
    </span>
  );
}

const PAGE_SIZE = 25;
const RISK_OPTIONS: { value: ActivityRisk; label: string }[] = [
  { value: 'abandoned', label: 'abandoned' },
  { value: 'low_score', label: 'low score' },
  { value: 'flagged', label: 'flagged' },
];

function displayUser(r: ActivitySessionListItem): string {
  const name = [r.firstName, r.lastName].filter(Boolean).join(' ').trim();
  return name || r.email || `${r.userId.slice(0, 12)}…`;
}

function formatDate(iso: string): string {
  return iso.replace('T', ' ').slice(0, 16);
}

function SessionsTab() {
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  const [user, setUser] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [risk, setRisk] = useState<ActivityRisk[]>([]);
  const [hasIncorrect, setHasIncorrect] = useState(false);
  const [offset, setOffset] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const sessions = useActivitySessions({
    fetchFn,
    params: {
      user: user || undefined,
      from: from || undefined,
      to: to || undefined,
      risk: risk.length ? risk : undefined,
      hasIncorrect: hasIncorrect || undefined,
      limit: PAGE_SIZE,
      offset,
    },
  });
  const detail = useActivitySessionDetail({ fetchFn, sessionId: expandedId });

  const total = sessions.data?.total ?? 0;
  const items = sessions.data?.items ?? [];

  const toggleRisk = (v: ActivityRisk) => {
    setOffset(0);
    setRisk((prev) => (prev.includes(v) ? prev.filter((r) => r !== v) : [...prev, v]));
  };
  const onFilter = (set: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setOffset(0);
    set(e.target.value);
  };

  const fieldClass = 'px-s-2 py-s-1 border border-rule rounded-sm bg-card text-[13px] text-ink outline-none focus:border-ink';

  return (
    <div className="flex flex-col gap-s-4">
      <div className="flex flex-wrap items-center gap-s-3">
        <input aria-label="user" placeholder="name, email, or id" value={user} onChange={onFilter(setUser)} className={fieldClass} />
        <label className="flex items-center gap-s-1 text-[12px] text-ink-soft">from
          <input aria-label="from" type="date" value={from} onChange={onFilter(setFrom)} className={fieldClass} />
        </label>
        <label className="flex items-center gap-s-1 text-[12px] text-ink-soft">to
          <input aria-label="to" type="date" value={to} onChange={onFilter(setTo)} className={fieldClass} />
        </label>
        <span className="flex gap-s-1">
          {RISK_OPTIONS.map((o) => (
            <button
              key={o.value}
              onClick={() => toggleRisk(o.value)}
              aria-pressed={risk.includes(o.value)}
              className={
                risk.includes(o.value)
                  ? 'px-s-2 py-px rounded-sm text-[11px] bg-ink text-paper'
                  : 'px-s-2 py-px rounded-sm text-[11px] bg-paper-2 text-ink-soft'
              }
            >
              {o.label}
            </button>
          ))}
        </span>
        {/* AND-composed with the risk chips (which OR among themselves), hence
            visually separated: ≥1 answer scored below 1.0. */}
        <button
          onClick={() => {
            setOffset(0);
            setHasIncorrect((v) => !v);
          }}
          aria-pressed={hasIncorrect}
          className={
            hasIncorrect
              ? 'px-s-2 py-px rounded-sm text-[11px] bg-ink text-paper'
              : 'px-s-2 py-px rounded-sm text-[11px] bg-paper-2 text-ink-soft'
          }
        >
          has incorrect
        </button>
      </div>

      {sessions.isLoading && <div className="text-ink-soft text-[13px]">Loading…</div>}
      {sessions.isError && <div className="text-red-700 text-[13px]">Failed to load sessions.</div>}

      <DataTable>
        <thead>
          <tr>
            <Th>Date</Th>
            <Th>User</Th>
            <Th>Lang</Th>
            <Th>Score</Th>
            <Th>Risk</Th>
            <Th>Ids</Th>
          </tr>
        </thead>
        <tbody>
          {items.map((s) => {
            const open = expandedId === s.sessionId;
            return (
              <Fragment key={s.sessionId}>
                <tr
                  onClick={() => setExpandedId(open ? null : s.sessionId)}
                  className="cursor-pointer hover:bg-paper-2"
                >
                  <Td className="whitespace-nowrap font-mono text-[12px] text-ink-soft">{formatDate(s.startedAt)}</Td>
                  <Td>
                    {/* The whole row toggles (above); this button keeps the
                        expander keyboard-focusable. stopPropagation prevents the
                        row handler from also firing (which would net cancel). */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedId(open ? null : s.sessionId);
                      }}
                      aria-expanded={open}
                      className="text-left underline-offset-2 hover:underline"
                    >
                      {displayUser(s)}
                    </button>
                  </Td>
                  <Td className="text-[12px]">{s.language}·{s.difficulty}</Td>
                  <Td className="text-[12px] text-ink-soft">
                    {s.completedAt ? `${s.correctCount} / ${s.exerciseCount}` : 'incomplete'}
                  </Td>
                  <Td>
                    <span className="flex gap-s-1">
                      {s.signals.map((sig) => <SignalBadge key={sig} signal={sig} />)}
                    </span>
                  </Td>
                  <Td>
                    <span className="flex gap-s-1">
                      <CopyId id={s.sessionId} label="session" />
                      <CopyId id={s.userId} label="user" />
                    </span>
                  </Td>
                </tr>
                {open && (
                  <tr>
                    <td colSpan={6} className="border-b border-rule bg-paper-2 px-3 py-2">
                      <SessionDetail detail={detail.data} loading={detail.isLoading} error={detail.isError} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </DataTable>

      <div className="flex items-center gap-s-3 text-[13px]">
        <button disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))} className="text-ink-soft disabled:opacity-40">‹ prev</button>
        <button disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset((o) => o + PAGE_SIZE)} className="text-ink-soft disabled:opacity-40">next ›</button>
        <span className="text-[12px] text-ink-soft">{total} session{total === 1 ? '' : 's'} · page {Math.floor(offset / PAGE_SIZE) + 1}/{Math.max(1, Math.ceil(total / PAGE_SIZE))}</span>
      </div>
    </div>
  );
}

function SessionDetail({
  detail,
  loading,
  error,
}: {
  detail: ReturnType<typeof useActivitySessionDetail>['data'];
  loading: boolean;
  error: boolean;
}) {
  const template = process.env.NEXT_PUBLIC_LANGFUSE_TRACE_URL_TEMPLATE;
  if (loading)
    return <div className="text-ink-soft text-[13px]">Loading session…</div>;
  if (error)
    return (
      <div className="text-red-700 text-[13px]">Failed to load session.</div>
    );
  if (!detail) return null;
  return (
    <div className="flex flex-col gap-s-3 border-t border-rule pt-s-3">
      {detail.exercises.map((ex) => (
        <div
          key={ex.exerciseId}
          className="flex flex-col gap-s-1 border border-rule rounded-sm p-s-3"
        >
          <div className="flex flex-wrap items-center gap-s-2 text-[12px]">
            <span className="font-mono text-ink-soft">#{ex.order + 1}</span>
            <span>{ex.type}</span>
            <span className="text-ink-soft">score: {ex.score ?? '—'}</span>
            <CopyId id={ex.exerciseId} label="exercise" />
            {ex.historyId && <CopyId id={ex.historyId} label="eval" />}
            {ex.flag && <SignalBadge signal="flagged" />}
            {template && (
              // Inline (not ml-auto): pinning it to the far right pushed it off
              // the right edge of the wide detail row, so it needed a long
              // horizontal scroll to find. Keep it next to the metadata.
              <a
                className="text-[11px] font-medium text-accent-2 underline underline-offset-2 hover:text-accent"
                href={template.replace('{cellKey}', ex.exerciseId)}
                target="_blank"
                rel="noreferrer"
              >
                Langfuse ↗
              </a>
            )}
          </div>
          <pre className="text-[11px] bg-paper-2 rounded-sm p-s-2 overflow-x-auto">
            {JSON.stringify(ex.response, null, 2)}
          </pre>
          {ex.errors.length > 0 && (
            <ul className="text-[11px] list-none p-0 m-0">
              {ex.errors.map((e, i) => (
                <li key={i}>
                  <span className="text-red-700">{e.wrongText}</span> →{' '}
                  <span className="text-ok">{e.correction}</span>
                  <span className="text-ink-soft">
                    {' '}
                    ({e.errorType}/{e.severity})
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

function FailuresTab() {
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  const [filters, setFilters] = useState<{ language?: string; level?: string }>({});
  const failures = useActivityFailures({ fetchFn, params: filters });
  const resolve = useResolveContentExercise({ fetchFn });

  return (
    <div className="flex flex-col gap-s-3">
      <div className="flex items-center gap-2">
        <select
          aria-label="language"
          value={filters.language ?? ''}
          onChange={(e) =>
            setFilters((prev) => ({ ...prev, language: e.target.value || undefined }))
          }
          className="px-s-2 py-s-1 border border-rule rounded-sm bg-card text-[13px] text-ink outline-none focus:border-ink"
        >
          <option value="">all languages</option>
          <option value="ES">ES</option>
          <option value="DE">DE</option>
          <option value="TR">TR</option>
        </select>
        <select
          aria-label="level"
          value={filters.level ?? ''}
          onChange={(e) =>
            setFilters((prev) => ({ ...prev, level: e.target.value || undefined }))
          }
          className="px-s-2 py-s-1 border border-rule rounded-sm bg-card text-[13px] text-ink outline-none focus:border-ink"
        >
          <option value="">all levels</option>
          <option value="A1">A1</option>
          <option value="A2">A2</option>
          <option value="B1">B1</option>
          <option value="B2">B2</option>
        </select>
      </div>
      {failures.isLoading && (
        <div className="text-ink-soft text-[13px]">Loading…</div>
      )}
      {failures.isError && (
        <div className="text-red-700 text-[13px]">Failed to load failures.</div>
      )}
      <table className="w-full text-[12px] border-collapse">
        <thead>
          <tr className="text-left text-ink-soft">
            <th className="py-s-1">exercise</th>
            <th>fail rate</th>
            <th>attempts</th>
            <th>users</th>
            <th>avg</th>
            <th>quality</th>
            <th>flags</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {(failures.data ?? []).map((f) => (
            <tr key={f.exerciseId} className="border-t border-rule">
              <td className="py-s-1">
                <span className="font-mono">{f.grammarPointKey ?? f.type ?? '—'}</span>{' '}
                <span className="text-ink-soft">
                  {f.language ?? '—'}·{f.difficulty ?? '—'}
                </span>{' '}
                <CopyId id={f.exerciseId} label="exercise" />
              </td>
              <td>{Math.round(f.failRate * 100)}%</td>
              <td>{f.attempts}</td>
              <td>{f.distinctUsers} users</td>
              <td>{f.avgScore.toFixed(2)}</td>
              <td>{f.qualityScore == null ? '—' : f.qualityScore.toFixed(2)}</td>
              <td>{f.openFlags}</td>
              <td className="flex gap-s-1">
                <button
                  onClick={() =>
                    resolve.mutate({ id: f.exerciseId, action: 'demote' })
                  }
                  className="px-s-2 py-px rounded-sm bg-paper-2 hover:bg-paper-2"
                >
                  demote
                </button>
                <button
                  onClick={() =>
                    resolve.mutate({ id: f.exerciseId, action: 'reject' })
                  }
                  className="px-s-2 py-px rounded-sm bg-paper-2 hover:bg-paper-2"
                >
                  reject
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RosterTab() {
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  const roster = useActivityRoster({ fetchFn });
  return (
    <div className="flex flex-col gap-s-3">
      {roster.isLoading && (
        <div className="text-ink-soft text-[13px]">Loading…</div>
      )}
      {roster.isError && (
        <div className="text-red-700 text-[13px]">Failed to load roster.</div>
      )}
      <table className="w-full text-[12px] border-collapse">
        <thead>
          <tr className="text-left text-ink-soft">
            <th className="py-s-1">user</th>
            <th>last active</th>
            <th>sessions 7d</th>
            <th>sessions 30d</th>
            <th>drills 7d</th>
            <th>drills 30d</th>
            <th>langs</th>
            <th>avg 30d</th>
            <th>ai 7d</th>
          </tr>
        </thead>
        <tbody>
          {(roster.data ?? []).map((u) => (
            <tr key={u.userId} className="border-t border-rule">
              <td className="py-s-1">
                <CopyId id={u.userId} label="user" />
              </td>
              <td>{u.lastActiveAt ? u.lastActiveAt.slice(0, 10) : '—'}</td>
              <td>{u.sessions7d}</td>
              <td>{u.sessions30d}</td>
              <td>{u.drills7d}</td>
              <td>{u.drills30d}</td>
              <td>{u.languages.join(', ')}</td>
              <td>{u.avgScore30d == null ? '—' : u.avgScore30d.toFixed(2)}</td>
              <td>{u.aiEvents7d}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ActivityPageInner() {
  const [tab, setTab] = useState<Tab>('sessions');
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-[24px] font-semibold text-ink">
        Activity
      </h1>
      <div className="flex gap-2" role="tablist">
        {(['sessions', 'failures', 'roster'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            aria-current={tab === t ? 'page' : undefined}
            className={
              tab === t
                ? 'font-semibold text-ink'
                : 'text-ink-soft'
            }
          >
            {t}
          </button>
        ))}
      </div>
      {tab === 'sessions' && <SessionsTab />}
      {tab === 'failures' && <FailuresTab />}
      {tab === 'roster' && <RosterTab />}
    </div>
  );
}

export default function ActivityPage() {
  return (
    <Suspense fallback={<div className="p-s-6" />}>
      <ActivityPageInner />
    </Suspense>
  );
}
