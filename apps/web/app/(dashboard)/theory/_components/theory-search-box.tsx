'use client';

import { useEffect, useRef } from 'react';
import { Input } from '../../../../components/ui/input';

type TheorySearchBoxProps = {
  value: string;
  onChange: (value: string) => void;
};

const PLACEHOLDER = 'search "por para", "subjuntivo", "vowel harmony"…';

// True when the user is already typing in a field — we must not steal focus
// with the ⌘K shortcut in that case (Requirement 5.6).
function isEditableTarget(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    (el as HTMLElement).isContentEditable === true
  );
}

/**
 * Controlled search input for the index: search icon, a clear (×) button when
 * non-empty, a desktop ⌘K hint, and a window-level ⌘K/Ctrl+K shortcut that
 * focuses the input (unless focus is already in a text field). State lives in
 * the page; this component is purely presentational + the focus shortcut.
 */
export function TheorySearchBox({ value, onChange }: TheorySearchBoxProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        if (isEditableTarget(document.activeElement)) return;
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="theory-search-box" style={{ position: 'relative' }}>
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        aria-hidden="true"
        style={{ position: 'absolute', left: 14, top: 14, color: 'var(--ink-mute)' }}
      >
        <circle cx="7" cy="7" r="4.5" />
        <path d="M10.5 10.5l3 3" />
      </svg>

      <Input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={PLACEHOLDER}
        aria-label="search theory topics"
        className="pl-[40px] pr-[64px]"
      />

      {value !== '' ? (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="clear search box"
          className="absolute right-[10px] top-[8px] h-7 w-7 rounded-full border-none bg-transparent text-[18px] leading-none text-ink-mute hover:text-ink"
        >
          ×
        </button>
      ) : (
        <span
          className="t-mono theory-search-hint"
          aria-hidden="true"
          style={{
            position: 'absolute',
            right: 12,
            top: 10,
            fontSize: 10,
            color: 'var(--ink-mute)',
            padding: '3px 7px',
            border: '1px solid var(--rule)',
            borderRadius: 4,
            background: 'var(--paper-2)',
          }}
        >
          ⌘K
        </span>
      )}
    </div>
  );
}
