'use client';

// ---------------------------------------------------------------------------
// DrillHub — the /drill landing (Plan 2)
// ---------------------------------------------------------------------------
// On-demand launcher surface shown when /drill is opened with no `?start=`
// intent. A thin today-status strip up top, then a row of launchers:
//   - Quick drill   → onStartQuick (5-item mixed session)
//   - Dictation     → onStartDictation (dictation-only run)
//   - Free writing  → the existing standalone flow at /drill/free-writing
// Presentational: the page owns difficulty + start intent and passes callbacks.
// ---------------------------------------------------------------------------

import Link from 'next/link';
import { CefrLevel } from '@language-drill/shared';
import { DrillTodayStatus } from './drill-today-status';

type Props = {
  difficulty: CefrLevel;
  onDifficultyChange: (level: CefrLevel) => void;
  onStartQuick: () => void;
  onStartDictation: () => void;
};

export function DrillHub({
  difficulty,
  onDifficultyChange,
  onStartQuick,
  onStartDictation,
}: Props) {
  return (
    <div className="p-s-6">
      <h1 className="t-display-l mb-s-6">drill</h1>

      <DrillTodayStatus />

      <label className="mb-s-6 flex w-fit flex-col gap-1 text-sm font-medium text-gray-700">
        Difficulty
        <select
          value={difficulty}
          onChange={(e) => onDifficultyChange(e.target.value as CefrLevel)}
          className="rounded border border-gray-300 bg-white px-3 py-2"
        >
          {Object.values(CefrLevel).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>

      <div className="flex flex-col gap-s-4">
        <button
          type="button"
          onClick={onStartQuick}
          className="flex items-center justify-between gap-s-4 rounded-r-lg border border-rule bg-card p-s-5 text-left hover:border-accent"
        >
          <span className="min-w-0">
            <span className="t-display-s block">quick drill</span>
            <span className="t-body block text-ink-2">
              a 5-item mix — cloze, sentence building, translation, vocab.
            </span>
          </span>
          <span className="t-mono flex-shrink-0 text-accent-2">start →</span>
        </button>

        <button
          type="button"
          onClick={onStartDictation}
          className="flex items-center justify-between gap-s-4 rounded-r-lg border border-rule bg-card p-s-5 text-left hover:border-accent"
        >
          <span className="min-w-0">
            <span className="t-display-s block">dictation</span>
            <span className="t-body block text-ink-2">
              listen and transcribe — a short audio-only run.
            </span>
          </span>
          <span className="t-mono flex-shrink-0 text-accent-2">start →</span>
        </button>

        <Link
          href="/drill/free-writing"
          className="flex items-center justify-between gap-s-4 rounded-r-lg border border-accent bg-card p-s-5 no-underline"
        >
          <span className="min-w-0">
            <span className="t-display-s block">free writing</span>
            <span className="t-body block text-ink-2">
              write a paragraph to a prompt, then get IELTS-style feedback.
            </span>
          </span>
          <span className="t-mono flex-shrink-0 text-accent-2">start →</span>
        </Link>
      </div>
    </div>
  );
}
