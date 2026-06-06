'use client';

// ---------------------------------------------------------------------------
// GenerateView — topic + length/level/language form for /read
// ---------------------------------------------------------------------------
// Presentational sibling of PasteView. The page-level reducer owns every
// field of `GenerateState` plus the `isLoading` / `errorBody` / `rateLimited`
// status flags; this component is fully driven by props and never holds local
// state. The user picks/enters a topic (optionally via a suggestion chip),
// chooses a length, and optionally overrides the CEFR band, then hits
// Generate. While generating it surfaces a `role="status"` loader.
//
// Language is NOT editable here: the whole annotate/save/bank pipeline on the
// page is bound to the shell's `activeLanguage`, so the generation language is
// shown as a read-only indicator (changing it is done via the app's language
// switcher). This is the single source of truth that prevents generating text
// in one language but scoring/saving it under another.
//
// The topic input has no `maxLength`: the counter flips to `--accent` and
// disables the CTA at length > READING_GEN_TOPIC_MAX_CHARS, matching the
// "soft" enforcement PasteView uses for its passage counter. Server-side
// validation in `routes/read.ts` is the hard gate.
// ---------------------------------------------------------------------------

import {
  CefrLevel,
  ReadingTextLength,
  READING_GEN_TOPIC_MAX_CHARS,
} from '@language-drill/shared';
import { Button } from '../../../../components/ui/button';
import { Chip } from '../../../../components/ui/chip';
import { Input } from '../../../../components/ui/input';

export type GenerateLanguage = 'ES' | 'DE' | 'TR';
export type GenerateState = {
  topic: string;
  length: ReadingTextLength;
  cefr: CefrLevel;
  language: GenerateLanguage;
};

type Props = {
  state: GenerateState;
  chips: readonly string[];
  onChange: <K extends 'topic' | 'length' | 'cefr'>(
    field: K,
    value: GenerateState[K]
  ) => void;
  onChipPick: (topic: string) => void;
  onGenerate: () => void;
  onCancel: () => void;
  isLoading: boolean;
  /** Human-readable error string from a failed generation attempt; null hides the inline card. */
  errorBody: string | null;
  /**
   * When true the Generate button is disabled regardless of input validity.
   * The page sets this on rate-limit responses so the user cannot mash through
   * the daily cap.
   */
  rateLimited?: boolean;
};

const LENGTH_LABELS: Record<ReadingTextLength, string> = {
  [ReadingTextLength.SHORT]: 'short',
  [ReadingTextLength.MEDIUM]: 'medium',
  [ReadingTextLength.LONG]: 'long',
};

const LENGTHS: ReadingTextLength[] = [
  ReadingTextLength.SHORT,
  ReadingTextLength.MEDIUM,
  ReadingTextLength.LONG,
];
const LEVELS: CefrLevel[] = Object.values(CefrLevel);

const LANGUAGE_LABELS: Record<GenerateLanguage, string> = {
  ES: 'Spanish',
  DE: 'German',
  TR: 'Turkish',
};

const selectClasses =
  'w-full px-[14px] py-[12px] border border-rule rounded-r-md bg-card text-[14px] text-ink outline-none transition-[border-color,box-shadow] duration-150 focus:border-ink focus:shadow-[0_0_0_3px_rgba(26,22,18,0.08)] disabled:opacity-50 disabled:cursor-not-allowed';

export function GenerateView({
  state,
  chips,
  onChange,
  onChipPick,
  onGenerate,
  onCancel,
  isLoading,
  errorBody,
  rateLimited = false,
}: Props) {
  const len = state.topic.length;
  const tooLong = len > READING_GEN_TOPIC_MAX_CHARS;
  const isEmpty = state.topic.trim().length === 0;
  const cannotGenerate = isLoading || isEmpty || tooLong || rateLimited;

  return (
    <div className="mx-auto max-w-[720px] mobile:max-w-none">
      <div className="t-micro">new text</div>
      <h2 className="t-display-m mt-[4px] mb-[22px]">generate a passage</h2>

      {errorBody !== null && (
        <div
          role="alert"
          className="mb-[16px] rounded-r-md border border-rule bg-paper-2 p-s-4"
        >
          <div className="t-display-s">couldn&apos;t generate this</div>
          <p className="t-small text-ink-soft mt-[6px]">{errorBody}</p>
        </div>
      )}

      {rateLimited && (
        <div
          role="alert"
          className="mb-[16px] rounded-r-md border border-rule bg-paper-2 p-s-4"
        >
          <div className="t-display-s">daily limit reached</div>
          <p className="t-small text-ink-soft mt-[6px]">
            you&apos;ve hit today&apos;s generation cap — try again tomorrow.
          </p>
        </div>
      )}

      <label htmlFor="read-generate-topic" className="t-small block mb-[6px]">
        topic
      </label>
      <Input
        id="read-generate-topic"
        placeholder="e.g. a day trip to the coast, climate change, a job interview"
        value={state.topic}
        onChange={(e) => onChange('topic', e.target.value)}
        disabled={isLoading}
      />
      <div
        aria-live="polite"
        className={`t-mono text-[11px] mt-[6px] ${
          tooLong ? 'text-accent' : 'text-ink-mute'
        }`}
      >
        {len.toLocaleString('en-US')} /{' '}
        {READING_GEN_TOPIC_MAX_CHARS.toLocaleString('en-US')}
        {tooLong ? ' · too long' : ''}
      </div>

      {chips.length > 0 && (
        <div className="mt-[12px]">
          <div className="t-small text-ink-mute mb-[8px]">
            need an idea? tap one
          </div>
          <div className="flex flex-wrap gap-[8px]">
            {chips.map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => onChipPick(chip)}
                disabled={isLoading}
                className="disabled:opacity-50 disabled:cursor-not-allowed mobile:min-h-[44px]"
              >
                <Chip variant="default">{chip}</Chip>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-[22px] grid grid-cols-3 gap-[12px] mobile:grid-cols-1">
        <div>
          <label
            htmlFor="read-generate-length"
            className="t-small block mb-[6px]"
          >
            length
          </label>
          <select
            id="read-generate-length"
            value={state.length}
            onChange={(e) =>
              onChange('length', e.target.value as ReadingTextLength)
            }
            disabled={isLoading}
            className={selectClasses}
          >
            {LENGTHS.map((l) => (
              <option key={l} value={l}>
                {LENGTH_LABELS[l]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="read-generate-level"
            className="t-small block mb-[6px]"
          >
            level
          </label>
          <select
            id="read-generate-level"
            value={state.cefr}
            onChange={(e) => onChange('cefr', e.target.value as CefrLevel)}
            disabled={isLoading}
            className={selectClasses}
          >
            {LEVELS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div>
          <span className="t-small block mb-[6px]">language</span>
          <div
            className="flex items-center gap-[8px] px-[14px] py-[12px] border border-rule rounded-r-md bg-paper-2 text-[14px] text-ink"
            title="generation follows the app's language — change it with the language switcher"
          >
            <Chip variant="default">{state.language}</Chip>
            <span className="t-small text-ink-mute">
              {LANGUAGE_LABELS[state.language]} · set via the app&apos;s language
              switcher
            </span>
          </div>
        </div>
      </div>

      {isLoading && (
        <div
          role="status"
          aria-live="polite"
          className="mt-[18px] flex items-center gap-[10px] rounded-r-md border border-rule bg-paper-2 p-[12px]"
        >
          <svg
            className="animate-spin text-ink-soft"
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <circle
              cx="8"
              cy="8"
              r="6"
              stroke="currentColor"
              strokeOpacity="0.25"
              strokeWidth="2"
            />
            <path
              d="M8 2a6 6 0 0 1 6 6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          <span className="t-small">generating your text…</span>
        </div>
      )}

      <div className="flex items-center justify-end mt-[18px] gap-[8px]">
        <Button variant="ghost" onClick={onCancel} disabled={isLoading}>
          cancel
        </Button>
        <Button
          variant="primary"
          onClick={onGenerate}
          disabled={cannotGenerate}
        >
          {isLoading ? 'generating…' : 'generate →'}
        </Button>
      </div>
    </div>
  );
}
