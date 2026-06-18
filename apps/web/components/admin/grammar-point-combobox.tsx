'use client';

import { useEffect, useRef, useState } from 'react';
import { Input } from '../ui';

export type GrammarPointOption = { key: string; name: string };

export function GrammarPointCombobox({
  options,
  value,
  onChange,
  disabled,
  placeholder = 'grammar point',
}: {
  options: GrammarPointOption[];
  /** Selected grammar point key, or '' for none. */
  value: string;
  onChange: (key: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const selected = options.find((o) => o.key === value) ?? null;
  const [query, setQuery] = useState(selected?.name ?? '');
  const [open, setOpen] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the displayed text in sync when the selection changes externally
  // (e.g. the language filter changes and clears the grammar point).
  useEffect(() => {
    setQuery(selected?.name ?? '');
  }, [value]);

  const q = query.trim().toLowerCase();
  const matches =
    q && q !== selected?.name.toLowerCase()
      ? options.filter((o) => o.name.toLowerCase().includes(q) || o.key.toLowerCase().includes(q))
      : options;

  return (
    <div className="relative">
      <Input
        aria-label="grammar point"
        role="combobox"
        aria-expanded={open}
        autoComplete="off"
        className="rounded-md"
        placeholder={placeholder}
        value={query}
        disabled={disabled}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          const text = e.target.value;
          setQuery(text);
          setOpen(true);
          if (text === '') onChange('');
        }}
        onBlur={() => {
          blurTimer.current = setTimeout(() => setOpen(false), 120);
        }}
      />
      {open && matches.length > 0 ? (
        <ul
          role="listbox"
          className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-md border border-rule bg-card shadow-md"
        >
          {matches.map((o) => (
            <li key={o.key} role="option" aria-selected={o.key === value}>
              <button
                type="button"
                className="flex w-full flex-col items-start gap-0.5 px-[14px] py-[8px] text-left hover:bg-paper"
                // Prevent the input's blur from firing (and closing the list)
                // before the click lands; selection happens in onClick.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  if (blurTimer.current) clearTimeout(blurTimer.current);
                  onChange(o.key);
                  setQuery(o.name);
                  setOpen(false);
                }}
              >
                <span className="text-[13px] text-ink">{o.name}</span>
                <span className="font-mono text-[11px] text-ink-soft">{o.key}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
