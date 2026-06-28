'use client';

import * as React from 'react';
import { cn } from '../../lib/cn';
import { useIsMobile } from '../../lib/responsive';

export type AccentLanguage = 'ES' | 'DE' | 'TR';

export interface AccentPickerProps {
  language: AccentLanguage;
  targetRef: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
  className?: string;
  disabled?: boolean;
}

// [lower, upper] pairs. Upper forms are explicit (not derived via
// `toUpperCase()`) because a few characters have no sensible single-key capital:
// Spanish punctuation (¿ ¡) and German ß map to themselves, and Turkish ı
// uppercases to the dotless I.
const ACCENT_CHARS: Partial<Record<AccentLanguage, [string, string][]>> = {
  ES: [
    ['á', 'Á'],
    ['é', 'É'],
    ['í', 'Í'],
    ['ó', 'Ó'],
    ['ú', 'Ú'],
    ['ñ', 'Ñ'],
    ['¿', '¿'],
    ['¡', '¡'],
  ],
  DE: [
    ['ä', 'Ä'],
    ['ö', 'Ö'],
    ['ü', 'Ü'],
    ['ß', 'ß'],
  ],
  TR: [
    ['ç', 'Ç'],
    ['ğ', 'Ğ'],
    ['ı', 'I'],
    ['ö', 'Ö'],
    ['ş', 'Ş'],
    ['ü', 'Ü'],
  ],
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

// Shared sizing/behaviour for every key in the row.
const keyBase =
  'inline-flex items-center justify-center min-w-[32px] min-h-[32px] px-s-3 py-[6px] rounded-sm transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none';

// Letter keys: bordered, paper-white — the default "tile" look.
const charButtonClasses = `${keyBase} text-[13px] font-mono border border-rule bg-card text-ink hover:bg-paper-2 hover:border-ink`;

// The ⇧ key is deliberately set apart from the letter tiles: borderless, a
// solid tinted fill, a larger glyph, and a gap to its right so it reads as a
// modifier rather than another character. When active it inverts to a filled
// dark key (the glyph stays light — note `cn` here is a plain join, so the
// active and inactive text colors must live in mutually-exclusive branches,
// never stacked, or the later utility would win and hide the glyph).
const shiftButtonBase = `${keyBase} mr-s-2 text-[18px] leading-none border border-transparent`;
const shiftInactive = 'bg-paper-3 text-ink-soft hover:bg-rule hover:text-ink';
const shiftActive = 'bg-ink text-card hover:bg-ink';

export function AccentPicker({
  language,
  targetRef,
  className,
  disabled,
}: AccentPickerProps) {
  const chars = ACCENT_CHARS[language];

  const [hasTarget, setHasTarget] = React.useState(
    () => targetRef.current != null
  );

  // Re-evaluate target presence on each render via effect
  React.useEffect(() => {
    setHasTarget(targetRef.current != null);
  });

  // Uppercase mode: latched via the ⇧ toggle (touch) OR the physical Shift key
  // held down (desktop). Either source flips the panel to capital glyphs.
  const [latched, setLatched] = React.useState(false);
  const [shiftHeld, setShiftHeld] = React.useState(false);

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShiftHeld(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShiftHeld(false);
    };
    // Releasing Shift can be missed if focus leaves the window mid-hold; reset
    // so it can't get stuck "on".
    const onBlur = () => setShiftHeld(false);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  const isMobile = useIsMobile();

  // Hide on mobile: the device keyboard already provides accented characters
  // (long-press), so the on-screen row is redundant and steals vertical space.
  if (!chars || isMobile) return null;

  const isDisabled = !hasTarget || disabled === true;
  const isUpper = latched || shiftHeld;

  const handleClick = (char: string) => {
    const el = targetRef.current;
    if (!el) return;
    insertAtCursor(el, char);
  };

  return (
    <div className={cn('flex flex-wrap gap-s-1', className)}>
      <button
        type="button"
        onClick={() => setLatched((v) => !v)}
        disabled={isDisabled}
        className={cn(shiftButtonBase, isUpper ? shiftActive : shiftInactive)}
        aria-label="uppercase"
        aria-pressed={latched}
      >
        ⇧
      </button>
      {chars.map(([lower, upper]) => {
        const char = isUpper ? upper : lower;
        return (
          <button
            key={lower}
            type="button"
            onClick={() => handleClick(char)}
            disabled={isDisabled}
            className={charButtonClasses}
            aria-label={`insert ${char}`}
          >
            {char}
          </button>
        );
      })}
    </div>
  );
}
