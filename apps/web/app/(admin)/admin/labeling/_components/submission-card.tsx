'use client';

import * as React from 'react';
import type { LabelQueueItem } from '@language-drill/api-client';

type Evaluation = {
  score?: number;
  grammarAccuracy?: number;
  taskAchievement?: number;
  vocabularyRange?: number;
  estimatedCefrEvidence?: string;
  feedback?: string;
  errors?: Array<{ type?: string; grammarPointKey?: string | null; explanation?: string }>;
};

function Dimension({ label, value }: { label: string; value: number | undefined }) {
  if (typeof value !== 'number') return null;
  return (
    <span className="text-[12px] text-ink-soft">
      {label} <span className="text-ink tabular-nums">{value.toFixed(2)}</span>
    </span>
  );
}

function renderReference(value: unknown): string {
  if (Array.isArray(value)) return value.join(' / ');
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

export interface SubmissionCardProps {
  item: LabelQueueItem;
}

export function SubmissionCard({ item }: SubmissionCardProps) {
  const evaluation = (item.evaluation ?? null) as Evaluation | null;
  const refEntries = Object.entries(item.referenceAnswers ?? {});

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-rule bg-paper p-4">
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-soft">
        <span className="font-medium text-ink">{item.language ?? '—'} {item.cefrLevel ?? ''}</span>
        <span>· {item.exerciseType ?? '—'}</span>
        {item.grammarPointKey && <span>· {item.grammarPointKey}</span>}
        {item.evaluatedAt && <span>· {new Date(item.evaluatedAt).toLocaleDateString()}</span>}
        {item.optionsRevealed && <span>· options revealed</span>}
      </div>

      {/* Stimulus first: form the judgment before the model's answer is visible. */}
      <pre className="whitespace-pre-wrap font-sans text-[15px] leading-relaxed text-ink">
        {item.learnerView}
      </pre>

      <div className="flex flex-col gap-1 border-t border-rule pt-3 text-[14px]">
        <div>
          <span className="text-[12px] uppercase tracking-wide text-ink-soft">learner typed</span>{' '}
          <span className="font-medium text-ink">
            {typeof item.userAnswer === 'string' ? item.userAnswer : JSON.stringify(item.userAnswer)}
          </span>
        </div>
        {refEntries.map(([key, value]) => (
          <div key={key}>
            <span className="text-[12px] uppercase tracking-wide text-ink-soft">{key}</span>{' '}
            <span className="text-ink">{renderReference(value)}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2 border-t border-rule pt-3">
        {evaluation === null ? (
          <p className="text-[13px] text-ink-soft">No evaluation stored for this attempt.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[12px] uppercase tracking-wide text-ink-soft">Claude said</span>
              <Dimension label="score" value={evaluation.score} />
              <Dimension label="grammar" value={evaluation.grammarAccuracy} />
              <Dimension label="task" value={evaluation.taskAchievement} />
              <Dimension label="vocab" value={evaluation.vocabularyRange} />
            </div>
            {evaluation.feedback && <p className="text-[14px] text-ink">{evaluation.feedback}</p>}
            {(evaluation.errors ?? []).length > 0 && (
              <ul className="flex flex-col gap-1">
                {(evaluation.errors ?? []).map((err, i) => (
                  <li key={i} className="text-[13px] text-ink-soft">
                    [{err.type ?? '—'} → {err.grammarPointKey ?? 'unattributed'}] {err.explanation ?? ''}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
