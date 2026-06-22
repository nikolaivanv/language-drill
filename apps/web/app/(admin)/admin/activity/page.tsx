'use client';

import { Suspense, useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import {
  createAuthenticatedFetch,
  useActivitySessions,
  useActivitySessionDetail,
  useActivityFailures,
  useActivityRoster,
  useResolveContentExercise,
} from '@language-drill/api-client';

type Tab = 'sessions' | 'failures' | 'roster';

function SignalBadge({ signal }: { signal: string }) {
  const label = signal === 'low_score' ? 'low score' : signal;
  return (
    <span className="inline-block px-s-2 py-px rounded-sm text-[11px] bg-paper-2 text-ink-soft">
      {label}
    </span>
  );
}

function SessionsTab({
  userFilter,
  setUserFilter,
}: {
  userFilter: string;
  setUserFilter: (v: string) => void;
}) {
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  const [showAll, setShowAll] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const sessions = useActivitySessions({
    fetchFn,
    params: { all: showAll, userId: userFilter || undefined },
  });
  const detail = useActivitySessionDetail({ fetchFn, sessionId: selected });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-s-2 text-[13px]">
          <input
            type="checkbox"
            checked={showAll}
            onChange={(e) => setShowAll(e.target.checked)}
          />
          show all recent
        </label>
        <input
          aria-label="user id"
          placeholder="filter by user id"
          value={userFilter}
          onChange={(e) => setUserFilter(e.target.value)}
          className="px-s-2 py-s-1 border border-rule rounded-sm bg-card text-[13px] text-ink outline-none focus:border-ink"
        />
      </div>

      {sessions.isLoading && (
        <div className="text-ink-soft text-[13px]">Loading…</div>
      )}
      {sessions.isError && (
        <div className="text-red-700 text-[13px]">Failed to load sessions.</div>
      )}

      <ul className="flex flex-col gap-1 list-none p-0 m-0">
        {(sessions.data ?? []).map((s) => (
          <li key={s.sessionId}>
            <button
              onClick={() => setSelected(s.sessionId)}
              className="w-full flex items-center gap-s-3 text-left px-s-3 py-s-2 rounded-sm hover:bg-paper-2"
            >
              <span className="flex gap-s-1">
                {s.signals.map((sig) => (
                  <SignalBadge key={sig} signal={sig} />
                ))}
              </span>
              <span className="font-mono text-[12px] text-ink-soft">
                {s.userId.slice(0, 12)}…
              </span>
              <span className="text-[12px]">
                {s.language}·{s.difficulty}
              </span>
              <span className="text-[12px] text-ink-soft">
                {s.completedAt
                  ? `${s.correctCount} / ${s.exerciseCount}`
                  : 'abandoned'}
              </span>
              <span className="ml-auto font-mono text-[11px] text-ink-soft">
                {s.sessionId.slice(0, 8)}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {selected && (
        <SessionDetail
          detail={detail.data}
          loading={detail.isLoading}
          error={detail.isError}
        />
      )}
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
          <div className="flex items-center gap-s-2 text-[12px]">
            <span className="font-mono text-ink-soft">#{ex.order + 1}</span>
            <span>{ex.type}</span>
            <span className="text-ink-soft">score: {ex.score ?? '—'}</span>
            {ex.flag && <SignalBadge signal="flagged" />}
            {template && (
              <a
                className="ml-auto text-[11px] underline"
                href={template.replace('{cellKey}', ex.exerciseId)}
                target="_blank"
                rel="noreferrer"
              >
                Langfuse
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
                </span>
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

function RosterTab({ onOpenUser }: { onOpenUser: (userId: string) => void }) {
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
                <button
                  className="font-mono underline"
                  onClick={() => onOpenUser(u.userId)}
                >
                  {u.userId.slice(0, 12)}…
                </button>
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
  const [userFilter, setUserFilter] = useState('');
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
      {tab === 'sessions' && (
        <SessionsTab userFilter={userFilter} setUserFilter={setUserFilter} />
      )}
      {tab === 'failures' && <FailuresTab />}
      {tab === 'roster' && (
        <RosterTab
          onOpenUser={(id) => {
            setUserFilter(id);
            setTab('sessions');
          }}
        />
      )}
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
