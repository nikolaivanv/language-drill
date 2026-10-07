'use client';

import Link from 'next/link';
import type { Language } from '@language-drill/shared';
import {
  useFreeWritingHistory,
  type AuthenticatedFetch,
  type FreeWritingHistoryItem,
} from '@language-drill/api-client';
import { CEFRBadge } from './fw-atoms';
import { formatAttemptDate } from '../_lib/format-attempt-date';

export interface FwHistoryListProps {
  language: Language;
  fetchFn: AuthenticatedFetch;
}

function AttemptRow({ item }: { item: FreeWritingHistoryItem }) {
  return (
    <Link
      href={`/drill/free-writing/history/${item.id}`}
      className="card fw-history-row"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 18,
        padding: '16px 20px',
        textDecoration: 'none',
        color: 'inherit',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="t-mono" style={{ fontSize: 11.5, color: 'var(--color-ink-mute)' }}>
          {formatAttemptDate(item.evaluatedAt)}
          {item.difficulty ? ` · ${item.difficulty} prompt` : ''}
          {item.wordCount !== null ? ` · ${item.wordCount} words` : ''}
        </div>
        <div className="t-body-l" style={{ fontWeight: 600, marginTop: 2 }}>
          {item.title ?? 'Untitled prompt'}
        </div>
        {item.headline && (
          <div className="t-small" style={{ marginTop: 2, color: 'var(--color-ink-soft)' }}>
            {item.headline}
          </div>
        )}
      </div>
      <div style={{ textAlign: 'center', flexShrink: 0 }}>
        {item.overallCefr && <CEFRBadge level={item.overallCefr} />}
        {item.score !== null && (
          <div
            className="t-mono"
            style={{ fontSize: 11, color: 'var(--color-ink-mute)', marginTop: 4 }}
          >
            {item.score.toFixed(2)}
          </div>
        )}
      </div>
    </Link>
  );
}

// Newest-first list of the learner's graded essays in the active language.
export function FwHistoryList({ language, fetchFn }: FwHistoryListProps) {
  const history = useFreeWritingHistory({ language, fetchFn });
  const items = history.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div>
      <Link
        href="/drill/free-writing"
        className="t-mono text-[13px] text-ink-soft hover:text-ink"
      >
        ← free writing
      </Link>
      <div className="t-micro" style={{ marginTop: 14 }}>
        free writing · past attempts
      </div>
      <h1 className="t-display-l" style={{ margin: '2px 0 18px' }}>
        Your essays.
      </h1>

      {history.isPending ? (
        <div className="t-body">loading…</div>
      ) : history.isError ? (
        <div className="t-body" role="alert">
          Couldn&apos;t load your past attempts. Try again in a moment.
        </div>
      ) : items.length === 0 ? (
        <div className="card" style={{ padding: 20 }}>
          <p className="t-body" style={{ margin: 0 }}>
            No graded essays in this language yet.
          </p>
          <Link
            href="/drill/free-writing"
            className="t-mono mt-s-3 inline-block text-[13px] text-ink-soft hover:text-ink"
          >
            write one <span className="lk-arr" aria-hidden="true">→</span>
          </Link>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 820 }}>
          {items.map((item) => (
            <AttemptRow key={item.id} item={item} />
          ))}
          {history.hasNextPage && (
            <button
              className="btn"
              style={{ alignSelf: 'flex-start', marginTop: 6 }}
              onClick={() => history.fetchNextPage()}
              disabled={history.isFetchingNextPage}
            >
              {history.isFetchingNextPage ? 'loading…' : 'load older attempts'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
