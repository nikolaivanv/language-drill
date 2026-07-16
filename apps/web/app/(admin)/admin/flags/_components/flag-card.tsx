'use client';

import * as React from 'react';
import type { UserFlagQueueItem } from '@language-drill/api-client';
import { CopyId } from '../../../../../components/admin/copy-id';

const CATEGORY_LABEL: Record<string, string> = {
  wrong_answer: 'Accepted answer is wrong',
  misleading_explanation: 'Explanation is wrong/misleading',
  confusing_prompt: 'Prompt is confusing',
  other: 'Other',
};

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

export interface FlagCardProps {
  flag: UserFlagQueueItem;
  onReject: () => void;
  onDismiss: () => void;
  disabled?: boolean;
}

export function FlagCard({ flag, onReject, onDismiss, disabled }: FlagCardProps) {
  const ex = flag.exercise;
  return (
    <div className="rounded-lg border border-rule bg-paper p-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-soft">
        <span className="font-medium text-ink">{CATEGORY_LABEL[flag.category] ?? flag.category}</span>
        <span>· {ex.language ?? '—'} {ex.level ?? ''} {ex.type ?? ''}</span>
        {ex.grammarPointKey && <span>· {ex.grammarPointKey}</span>}
        <span>· status: {ex.reviewStatus ?? '—'}</span>
        {flag.createdAt && <span>· {new Date(flag.createdAt).toLocaleString()}</span>}
      </div>

      <div className="flex flex-wrap items-center gap-s-1">
        {flag.sessionId && <CopyId id={flag.sessionId} label="session" />}
        <CopyId id={flag.exerciseId} label="exercise" />
        <CopyId id={flag.submissionId} label="eval" />
      </div>

      {flag.note && <p className="text-[13px] text-ink">"{flag.note}"</p>}

      <details>
        <summary className="cursor-pointer text-[12px] text-ink-soft">Exercise</summary>
        <pre className="mt-1 whitespace-pre-wrap break-words text-[12px]">{renderValue(ex.contentJson)}</pre>
      </details>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <div>
          <p className="text-[12px] text-ink-soft">User&apos;s answer</p>
          <pre className="mt-1 whitespace-pre-wrap break-words text-[13px]">{renderValue(flag.userAnswer)}</pre>
        </div>
        <div>
          <p className="text-[12px] text-ink-soft">Evaluator response</p>
          <pre className="mt-1 whitespace-pre-wrap break-words text-[12px]">{renderValue(flag.evaluation)}</pre>
        </div>
      </div>

      {flag.status === 'open' ? (
        <div className="flex gap-2">
          <button type="button" disabled={disabled} onClick={onReject} className="rounded-md bg-[var(--color-accent)] px-3 py-1 text-[13px] text-paper disabled:opacity-40">Reject exercise</button>
          <button type="button" disabled={disabled} onClick={onDismiss} className="rounded-md bg-paper-3 px-3 py-1 text-[13px] disabled:opacity-40">Dismiss</button>
        </div>
      ) : (
        <p className="text-[12px] text-ink-soft">Resolved: {flag.status === 'resolved_rejected' ? 'rejected' : 'dismissed'}</p>
      )}
    </div>
  );
}
