'use client';

import {
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  PROGRESS_TAB_IDS,
  type ProgressTabId,
} from '../_lib/use-tab-url-state';

// ---------------------------------------------------------------------------
// ProgressTabs — WAI-ARIA tablist for /progress.
//   role="tablist"  →  three role="tab" buttons (shape / heatmap / history)
//   left/right arrows cycle, Home/End jump to ends, Enter/Space activate
//   automatic activation: arrow keys also call onChange (matches the
//   prototype's simple toggle UX)
// Design reference: design.md §"Component 3 — ProgressTabs"
// ---------------------------------------------------------------------------

const TAB_LABELS: Record<ProgressTabId, string> = {
  shape: 'shape',
  fluency: 'fluency',
  history: 'history',
};

export type ProgressTabsProps = {
  active: ProgressTabId;
  onChange: (id: ProgressTabId) => void;
  children: ReactNode;
};

export function ProgressTabs({ active, onChange, children }: ProgressTabsProps) {
  const buttonRefs = useRef<Record<ProgressTabId, HTMLButtonElement | null>>({
    shape: null,
    fluency: null,
    history: null,
  });

  function focusAndActivate(id: ProgressTabId): void {
    onChange(id);
    buttonRefs.current[id]?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>): void {
    const ids = PROGRESS_TAB_IDS;
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

  const panelId = `progress-panel-${active}`;
  const activeTabId = `progress-tab-${active}`;

  return (
    <>
      <div
        role="tablist"
        aria-label="progress views"
        style={{
          marginTop: 28,
          borderBottom: '1px solid var(--color-rule)',
          display: 'flex',
          gap: 4,
        }}
      >
        {PROGRESS_TAB_IDS.map((id) => {
          const isActive = id === active;
          return (
            <button
              key={id}
              id={`progress-tab-${id}`}
              ref={(el) => {
                buttonRefs.current[id] = el;
              }}
              role="tab"
              type="button"
              aria-selected={isActive}
              aria-controls={`progress-panel-${id}`}
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
