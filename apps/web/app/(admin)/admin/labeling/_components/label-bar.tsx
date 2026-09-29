'use client';

import * as React from 'react';
import { LABEL_TAGS, type LabelTag } from '@language-drill/shared';

export interface LabelDraft {
  gradeOk: boolean | null;
  feedbackOk: boolean | null;
  tags: LabelTag[];
  critique: string;
}

export interface LabelBarProps {
  draft: LabelDraft;
  onChange: (next: LabelDraft) => void;
  error: string | null;
  disabled?: boolean;
  critiqueRef: React.RefObject<HTMLTextAreaElement | null>;
}

function Verdict({ label, value }: { label: string; value: boolean | null }) {
  const text = value === null ? 'unsure' : value ? 'ok' : 'wrong';
  return (
    <span className="text-[13px] text-ink-soft">
      {label}: <span className="font-medium text-ink">{text}</span>
    </span>
  );
}

export function LabelBar({ draft, onChange, error, disabled, critiqueRef }: LabelBarProps) {
  const toggleTag = (tag: LabelTag) => {
    const tags = draft.tags.includes(tag) ? draft.tags.filter((t) => t !== tag) : [...draft.tags, tag];
    onChange({ ...draft, tags });
  };

  return (
    // Sticky to the bottom of the scrollable admin `<main>`: a submission's
    // stimulus + Claude's feedback can run long enough to push this bar (and
    // the shortcut legend a labeler leans on for an hour straight) below the
    // fold. Pinning it keeps the controls and legend in view regardless of
    // how tall the card above happens to be.
    <div className="sticky bottom-0 z-10 flex flex-col gap-3 rounded-lg border border-rule bg-paper p-4">
      <div className="flex flex-wrap items-center gap-4">
        <Verdict label="grade" value={draft.gradeOk} />
        <Verdict label="feedback" value={draft.feedbackOk} />
      </div>

      <div className="flex flex-wrap gap-2">
        {LABEL_TAGS.map((tag, i) => (
          <button
            key={tag}
            type="button"
            disabled={disabled}
            onClick={() => toggleTag(tag)}
            className={`rounded-full border px-3 py-1 text-[12px] ${
              draft.tags.includes(tag)
                ? 'border-ink bg-ink-soft/10 font-medium text-ink'
                : 'border-rule text-ink-soft'
            }`}
          >
            <span className="tabular-nums">{i + 1}</span> {tag}
          </button>
        ))}
      </div>

      <label className="flex flex-col gap-1 text-[12px] uppercase tracking-wide text-ink-soft">
        critique
        <textarea
          ref={critiqueRef}
          value={draft.critique}
          disabled={disabled}
          onChange={(e) => onChange({ ...draft, critique: e.target.value })}
          rows={2}
          className="rounded-md border border-rule bg-paper p-2 text-[14px] normal-case tracking-normal text-ink"
        />
      </label>

      {error && <p className="text-[13px] text-ink">{error}</p>}

      <p className="text-[12px] text-ink-soft">
        <span className="font-medium text-ink">j</span>/<span className="font-medium text-ink">f</span> grade ok/wrong ·{' '}
        <span className="font-medium text-ink">k</span>/<span className="font-medium text-ink">d</span> feedback ok/wrong ·{' '}
        <span className="font-medium text-ink">u</span> unsure · <span className="font-medium text-ink">1-7</span> tag ·{' '}
        <span className="font-medium text-ink">/</span> critique · <span className="font-medium text-ink">Enter</span> save ·{' '}
        <span className="font-medium text-ink">←/→</span> move
      </p>
    </div>
  );
}
