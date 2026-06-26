'use client';

// ---------------------------------------------------------------------------
// GenerateView — composer for /read text generation
// ---------------------------------------------------------------------------
// Fully controlled presentational surface. The page-level reducer owns every
// field of `GenerateState` (topic / length / cefr / category, plus the bound
// `language`) and the `isLoading` / `errorBody` / `rateLimited` status flags;
// this component holds no local state.
//
// The user describes a topic (free-text, or seeded by an idea chip), picks a
// length and CEFR band on segmented controls, sees a live "you'll get" summary,
// then hits Generate. While generating, the CTA reads "generating…".
//
// Language is NOT a form field: the whole annotate/save/bank pipeline is bound
// to the shell's `activeLanguage`. It only appears in copy (the subtitle and
// the "you'll get" summary), using the native language name passed in as
// `languageLabel`. This prevents generating text in one language but
// scoring/saving it under another.
//
// The topic textarea is soft-limited: the counter flips to `text-accent` and
// the CTA disables past READING_GEN_TOPIC_MAX_CHARS. Server-side validation in
// `routes/read.ts` is the hard gate.
// ---------------------------------------------------------------------------

import {
  CefrLevel,
  ReadingTextLength,
  READING_GEN_TOPIC_MAX_CHARS,
  READING_LENGTH_APPROX,
  type ReadingIdea,
} from '@language-drill/shared';
import { Button } from '../../../../components/ui/button';
import { Textarea } from '../../../../components/ui/textarea';
import { cn } from '../../../../lib/cn';
import type { GenerateState } from '../_state/read-page-reducer';
import { IdeaCards } from './idea-cards';
import { LengthControl } from './length-control';
import { LevelLadder } from './level-ladder';

type Props = {
  state: GenerateState;
  ideas: readonly ReadingIdea[];
  languageLabel: string;
  yourLevel: CefrLevel | null;
  onChange: <K extends keyof GenerateState>(
    field: K,
    value: GenerateState[K]
  ) => void;
  onPickIdea: (idea: ReadingIdea) => void;
  onGenerate: () => void;
  onCancel: () => void;
  isLoading: boolean;
  /** Human-readable error string from a failed generation attempt; null hides the alert. */
  errorBody: string | null;
  /**
   * When true the Generate button is disabled regardless of input validity and
   * a daily-limit alert is shown. The page sets this on rate-limit responses.
   */
  rateLimited?: boolean;
};

const LENGTH_NAME: Record<ReadingTextLength, string> = {
  [ReadingTextLength.SHORT]: 'short',
  [ReadingTextLength.MEDIUM]: 'medium',
  [ReadingTextLength.LONG]: 'long',
};

export function GenerateView({
  state,
  ideas,
  languageLabel,
  yourLevel,
  onChange,
  onPickIdea,
  onGenerate,
  onCancel,
  isLoading,
  errorBody,
  rateLimited = false,
}: Props) {
  const len = state.topic.length;
  const tooLong = len > READING_GEN_TOPIC_MAX_CHARS;
  const isEmpty = state.topic.trim().length === 0;
  const cannotGenerate = isLoading || isEmpty || tooLong;

  const lengthName = LENGTH_NAME[state.length];
  const approx = READING_LENGTH_APPROX[state.length];
  const categoryLabel = state.category ?? 'passage';

  return (
    <div className="mx-auto max-w-[720px] mobile:max-w-none">
      <div className="t-micro text-ink-mute">NEW TEXT</div>
      <h2 className="t-display-m mt-[4px]">generate a passage</h2>
      <p className="t-body text-ink-soft mt-[8px] mb-[22px]">
        Describe what you&apos;d like to read. I&apos;ll write it in {languageLabel},
        tuned to your level — then flag the words worth collecting.
      </p>

      {(rateLimited || errorBody !== null) && (
        <div
          role="alert"
          className="mb-[16px] rounded-md border border-rule bg-paper-2 p-s-4"
        >
          <p className="t-small text-ink-soft">
            {rateLimited ? 'daily generation limit reached' : errorBody}
          </p>
        </div>
      )}

      {/* Topic */}
      <div className="flex items-center justify-between mb-[6px]">
        <label htmlFor="read-generate-topic" className="t-micro">
          WHAT TO READ ABOUT
        </label>
        <span
          aria-live="polite"
          className={cn('t-mono text-[11px]', tooLong ? 'text-accent' : 'text-ink-mute')}
        >
          {len} / 200
        </span>
      </div>
      <Textarea
        id="read-generate-topic"
        placeholder="a letter from someone leaving their hometown..."
        value={state.topic}
        maxLength={READING_GEN_TOPIC_MAX_CHARS}
        onChange={(e) => onChange('topic', e.target.value)}
        disabled={isLoading}
      />

      {/* Ideas */}
      <div className="mt-[16px]">
        <div className="t-small text-ink-soft mb-[8px]">
          <span className="text-accent italic">or</span> start from an idea
        </div>
        <IdeaCards
          variant="chip"
          ideas={ideas}
          selectedPrompt={state.topic}
          onPick={onPickIdea}
          disabled={isLoading}
        />
      </div>

      {/* Length */}
      <div className="mt-[22px]">
        <div className="t-micro mb-[8px]">LENGTH</div>
        <LengthControl
          value={state.length}
          onChange={(l) => onChange('length', l)}
          disabled={isLoading}
        />
      </div>

      {/* Level */}
      <div className="mt-[22px]">
        <LevelLadder
          value={state.cefr}
          yourLevel={yourLevel}
          onChange={(c) => onChange('cefr', c)}
          disabled={isLoading}
        />
      </div>

      {/* "you'll get" summary */}
      <p className="t-small text-ink-soft mt-[18px]">
        you&apos;ll get a {lengthName} (~{approx} word) {categoryLabel} at{' '}
        {state.cefr} in {languageLabel}.
      </p>

      {/* Actions */}
      <div className="flex items-center justify-end mt-[18px] gap-[8px]">
        <Button variant="ghost" onClick={onCancel} disabled={isLoading}>
          cancel
        </Button>
        <Button variant="primary" onClick={onGenerate} disabled={cannotGenerate}>
          {isLoading ? 'generating…' : 'generate a passage →'}
        </Button>
      </div>
    </div>
  );
}
