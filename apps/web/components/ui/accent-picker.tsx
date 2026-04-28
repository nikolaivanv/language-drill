'use client';

import * as React from 'react';
import { cn } from '../../lib/cn';

export type AccentLanguage = 'ES' | 'DE' | 'TR';

export interface AccentPickerProps {
  language: AccentLanguage;
  targetRef: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
  className?: string;
}

const ACCENT_CHARS: Partial<Record<AccentLanguage, string[]>> = {
  ES: ['á', 'é', 'í', 'ó', 'ú', 'ñ', '¿', '¡'],
  DE: ['ä', 'ö', 'ü', 'ß'],
  TR: ['ç', 'ğ', 'ı', 'ö', 'ş', 'ü'],
};

function getNativeValueSetter(
  el: HTMLInputElement | HTMLTextAreaElement
): ((value: string) => void) | null {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
  return descriptor?.set ? (descriptor.set.bind(el) as (value: string) => void) : null;
}

function insertAtCursor(
  el: HTMLInputElement | HTMLTextAreaElement,
  char: string
) {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  const before = el.value.slice(0, start);
  const after = el.value.slice(end);
  const newValue = before + char + after;

  // Use native setter so React's onChange picks up the value
  const setter = getNativeValueSetter(el);
  if (setter) {
    setter(newValue);
  } else {
    el.value = newValue;
  }

  el.dispatchEvent(new Event('input', { bubbles: true }));

  const cursor = start + char.length;
  el.setSelectionRange(cursor, cursor);
  el.focus();
}

const buttonClasses =
  'inline-flex items-center justify-center min-w-[32px] min-h-[32px] px-s-3 py-[6px] text-[13px] font-mono border border-rule rounded-r-sm bg-card text-ink transition-all duration-150 hover:bg-paper-2 hover:border-ink disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none';

export function AccentPicker({
  language,
  targetRef,
  className,
}: AccentPickerProps) {
  const chars = ACCENT_CHARS[language];

  const [hasTarget, setHasTarget] = React.useState(
    () => targetRef.current != null
  );

  // Re-evaluate target presence on each render via effect
  React.useEffect(() => {
    setHasTarget(targetRef.current != null);
  });

  if (!chars) return null;

  const handleClick = (char: string) => {
    const el = targetRef.current;
    if (!el) return;
    insertAtCursor(el, char);
  };

  return (
    <div className={cn('flex flex-wrap gap-s-1', className)}>
      {chars.map((char) => (
        <button
          key={char}
          type="button"
          onClick={() => handleClick(char)}
          disabled={!hasTarget}
          className={buttonClasses}
          aria-label={`insert ${char}`}
        >
          {char}
        </button>
      ))}
    </div>
  );
}
