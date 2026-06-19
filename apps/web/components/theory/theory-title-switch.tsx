import { Chip } from '../ui/chip';

// Mobile-only: the topic title rendered as a tappable control that opens the
// `TopicSwitcherSheet`. On desktop the title stays a plain heading and the
// 240px sidebar handles cross-topic switching, so this is only mounted under
// the ≤760px branch. The visible title carries `titleId` so the host dialog's
// `aria-labelledby` still resolves to the topic name.

type TheoryTitleSwitchProps = {
  title: string;
  cefr: string;
  /** id applied to the title text (aria-labelledby target for the host dialog). */
  titleId?: string;
  onOpen: () => void;
};

export function TheoryTitleSwitch({
  title,
  cefr,
  titleId,
  onOpen,
}: TheoryTitleSwitchProps) {
  return (
    <button
      type="button"
      className="theory-title-switch"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-label={`switch topic — currently ${title}`}
    >
      <span id={titleId} className="t-display-l theory-title-text">
        {title}
      </span>
      <Chip>{cefr}</Chip>
      <span className="theory-switch-cue" aria-hidden="true">
        <svg
          width="13"
          height="13"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
      </span>
    </button>
  );
}
