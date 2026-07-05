'use client';

import { useState } from 'react';
import { useExplainSubmission } from '@language-drill/api-client';
import type { AuthenticatedFetch } from '@language-drill/api-client';

export interface ExplainWhyProps {
  exerciseId: string;
  submissionId: string;
  /** The canned deterministic feedback line, shown until an explanation loads. */
  fallbackFeedback: string;
  fetchFn: AuthenticatedFetch;
}

/** Post-answer enrichment for instant-graded (deterministic) results: shows
 * the canned "Correct" line with an on-demand, metered LLM explanation. */
export function ExplainWhy({
  exerciseId,
  submissionId,
  fallbackFeedback,
  fetchFn,
}: ExplainWhyProps) {
  const explain = useExplainSubmission({ fetchFn });
  const [explanation, setExplanation] = useState<string | null>(null);

  if (explanation) {
    return <p className="t-body">{explanation}</p>;
  }

  return (
    <div className="flex flex-col gap-s-1">
      <p className="t-body">{fallbackFeedback}</p>
      <button
        type="button"
        className="t-small text-ink-mute underline underline-offset-2 self-start disabled:opacity-50"
        disabled={explain.isPending}
        onClick={() => {
          explain
            .mutateAsync({ exerciseId, submissionId })
            .then((r) => setExplanation(r.explanation))
            .catch(() => {
              /* error state rendered below via explain.isError */
            });
        }}
      >
        {explain.isPending ? 'Explaining…' : 'Explain why'}
      </button>
      {explain.isError && (
        <p className="t-small text-ink-mute">
          Couldn&apos;t load the explanation — try again.
        </p>
      )}
    </div>
  );
}
