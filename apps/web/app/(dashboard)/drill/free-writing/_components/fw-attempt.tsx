'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  useFreeWritingAttempt,
  parseStoredFreeWritingEvaluation,
  type AuthenticatedFetch,
} from '@language-drill/api-client';
import { FwGraded } from './fw-graded';
import { formatAttemptDate } from '../_lib/format-attempt-date';

export const HISTORY_HREF = '/drill/free-writing/history';

export interface FwAttemptProps {
  submissionId: string;
  fetchFn: AuthenticatedFetch;
}

function readPrompt(content: unknown): { title: string | null; task: string | null } {
  const c = content && typeof content === 'object' ? (content as Record<string, unknown>) : {};
  return {
    title: typeof c.title === 'string' ? c.title : null,
    task: typeof c.task === 'string' ? c.task : null,
  };
}

function BackLink() {
  return (
    <Link href={HISTORY_HREF} className="t-mono text-[13px] text-ink-soft hover:text-ink">
      ← past attempts
    </Link>
  );
}

// One stored attempt, re-rendered through the same results → corrections →
// compare surfaces the learner saw right after grading.
export function FwAttempt({ submissionId, fetchFn }: FwAttemptProps) {
  const router = useRouter();
  const attempt = useFreeWritingAttempt({ submissionId, fetchFn });

  if (attempt.isPending) {
    return <div className="t-body">loading…</div>;
  }

  if (attempt.isError) {
    const notFound = (attempt.error as { status?: number }).status === 404;
    return (
      <div>
        <BackLink />
        <p className="t-body" role="alert" style={{ marginTop: 14 }}>
          {notFound
            ? 'This attempt wasn’t found.'
            : 'Couldn’t load this attempt. Try again in a moment.'}
        </p>
      </div>
    );
  }

  const data = attempt.data;
  const evaluation = parseStoredFreeWritingEvaluation(data.evaluation);
  const { title, task } = readPrompt(data.content);
  const date = formatAttemptDate(data.evaluatedAt);

  return (
    <div>
      <BackLink />
      <div className="card" style={{ marginTop: 14, marginBottom: 22, padding: '14px 20px' }}>
        <div className="t-micro">
          your prompt · {date}
          {data.difficulty ? ` · ${data.difficulty}` : ''}
        </div>
        {title && (
          <div className="t-body-l" style={{ fontWeight: 600, marginTop: 4 }}>
            {title}
          </div>
        )}
        {task && (
          <p className="t-body" style={{ margin: '4px 0 0', color: 'var(--color-ink-soft)' }}>
            {task}
          </p>
        )}
      </div>

      {evaluation && data.userAnswer !== null ? (
        <FwGraded
          evaluation={evaluation}
          original={data.userAnswer}
          onAnother={() => router.push(HISTORY_HREF)}
          anotherLabel="back to past attempts"
          eyebrow={`free writing · graded ${date}`}
        />
      ) : (
        <div className="card" style={{ padding: 20 }}>
          <p className="t-body" style={{ margin: 0 }}>
            This attempt was graded by an older version of the evaluator and can’t be displayed.
          </p>
          {data.userAnswer && (
            <>
              <div className="rv-h" style={{ marginTop: 16, marginBottom: 6 }}>
                what you wrote
              </div>
              <p className="t-body" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                {data.userAnswer}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
