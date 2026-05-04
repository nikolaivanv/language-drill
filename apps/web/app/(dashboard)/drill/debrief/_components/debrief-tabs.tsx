'use client';

import {
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

// ---------------------------------------------------------------------------
// DebriefTabs — WAI-ARIA tablist for the post-session debrief screen.
//   role="tablist"  →  two role="tab" buttons (debrief / review)
//   left/right arrows cycle, Home/End jump to ends, Enter/Space activate
//   automatic activation: arrow keys also call onChange (matches
//   `progress-tabs.tsx`, the reference implementation in this codebase)
//
// Two-tab variant of the pattern at:
//   apps/web/app/(dashboard)/progress/_components/progress-tabs.tsx
// Kept as a separate component (not abstracted into a primitive) because the
// active-tab type and copy differ; one consumer per tablist for now.
// ---------------------------------------------------------------------------

export type DebriefTabId = 'debrief' | 'review';

const DEBRIEF_TAB_IDS: readonly DebriefTabId[] = ['debrief', 'review'] as const;

const TAB_LABELS: Record<DebriefTabId, string> = {
  debrief: 'debrief',
  review: 'review',
};

export type DebriefTabsProps = {
  active: DebriefTabId;
  onChange: (id: DebriefTabId) => void;
  children: ReactNode;
};

export function DebriefTabs({ active, onChange, children }: DebriefTabsProps) {
  const buttonRefs = useRef<Record<DebriefTabId, HTMLButtonElement | null>>({
    debrief: null,
    review: null,
  });

  function focusAndActivate(id: DebriefTabId): void {
    onChange(id);
    buttonRefs.current[id]?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>): void {
    const ids = DEBRIEF_TAB_IDS;
    const idx = ids.indexOf(active);

    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        focusAndActivate(ids[(idx - 1 + ids.length) % ids.length]);
        break;
      case 'ArrowRight':
        e.preventDefault();
        focusAndActivate(ids[(idx + 1) % ids.length]);
        break;
      case 'Home':
        e.preventDefault();
        focusAndActivate(ids[0]);
        break;
      case 'End':
        e.preventDefault();
        focusAndActivate(ids[ids.length - 1]);
        break;
      // Enter / Space are handled natively by <button>; no extra wiring needed.
      default:
        break;
    }
  }

  const panelId = `debrief-panel-${active}`;
  const activeTabId = `debrief-tab-${active}`;

  return (
    <>
      <div
        role="tablist"
        aria-label="debrief views"
        style={{
          marginTop: 28,
          borderBottom: '1px solid var(--color-rule)',
          display: 'flex',
          gap: 4,
        }}
      >
        {DEBRIEF_TAB_IDS.map((id) => {
          const isActive = id === active;
          return (
            <button
              key={id}
              id={`debrief-tab-${id}`}
              ref={(el) => {
                buttonRefs.current[id] = el;
              }}
              role="tab"
              type="button"
              aria-selected={isActive}
              aria-controls={`debrief-panel-${id}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onChange(id)}
              onKeyDown={onKeyDown}
              style={{
                padding: '12px 16px',
                border: 'none',
                background: 'transparent',
                borderBottom: `2px solid ${isActive ? 'var(--color-ink)' : 'transparent'}`,
                color: isActive ? 'var(--color-ink)' : 'var(--color-ink-soft)',
                fontWeight: isActive ? 500 : 400,
                fontSize: 14,
                marginBottom: -1,
                cursor: 'pointer',
              }}
            >
              {TAB_LABELS[id]}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={panelId}
        aria-labelledby={activeTabId}
        tabIndex={0}
      >
        {children}
      </div>
    </>
  );
}
