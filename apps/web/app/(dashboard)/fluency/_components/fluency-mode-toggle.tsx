'use client';

export const FLUENCY_MODES = ['all', 'conjugation'] as const;
export type FluencyMode = (typeof FLUENCY_MODES)[number];

const LABELS: Record<FluencyMode, string> = {
  all: 'all',
  conjugation: 'conjugation',
};

/**
 * In-place mode selector for fluency mode. `all` runs the mixed per-language
 * pool; `conjugation` filters the session to conjugation items only. The page
 * owns URL sync + session restart (see use-fluency-mode-url-state).
 */
export function FluencyModeToggle({
  mode,
  onSelect,
}: {
  mode: FluencyMode;
  onSelect: (mode: FluencyMode) => void;
}) {
  return (
    <div role="tablist" aria-label="fluency mode" className="flex gap-s-2">
      {FLUENCY_MODES.map((m) => (
        <button
          key={m}
          type="button"
          role="tab"
          aria-selected={m === mode}
          onClick={() => onSelect(m)}
          className={`t-small rounded-md border px-s-3 py-s-1 ${
            m === mode ? 'border-accent-2 text-accent-2' : 'border-rule text-ink-2'
          }`}
        >
          {LABELS[m]}
        </button>
      ))}
    </div>
  );
}
