'use client';

import { useEffect, useMemo, useState } from 'react';
import { useCombobox } from 'downshift';
import { Input } from '../ui';
import { cn } from '../../lib/cn';

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
  const selectedItem = useMemo(
    () => options.find((o) => o.key === value) ?? null,
    [options, value],
  );

  const [inputValue, setInputValue] = useState(selectedItem?.name ?? '');

  // Keep the displayed text in sync when the selection changes externally:
  // the language filter clearing the grammar point, or a deep-link
  // (?grammarPoint=) whose name only resolves once options arrive.
  useEffect(() => {
    setInputValue(selectedItem?.name ?? '');
  }, [selectedItem]);

  const items = useMemo(() => {
    const q = inputValue.trim().toLowerCase();
    if (!q || q === selectedItem?.name.toLowerCase()) return options;
    return options.filter(
      (o) => o.name.toLowerCase().includes(q) || o.key.toLowerCase().includes(q),
    );
  }, [options, inputValue, selectedItem]);

  const {
    isOpen,
    highlightedIndex,
    getInputProps,
    getMenuProps,
    getItemProps,
  } = useCombobox<GrammarPointOption>({
    items,
    selectedItem,
    inputValue,
    itemToString: (item) => item?.name ?? '',
    onInputValueChange: ({ inputValue: next }) => {
      const text = next ?? '';
      setInputValue(text);
      if (text === '') onChange('');
    },
    onSelectedItemChange: ({ selectedItem: next }) => onChange(next?.key ?? ''),
  });

  const menuOpen = isOpen && items.length > 0;

  return (
    <div className="relative">
      <Input
        {...getInputProps({ disabled, placeholder, autoComplete: 'off' })}
        aria-label="grammar point"
        className="rounded-md"
      />
      <ul
        {...getMenuProps()}
        className={cn(
          'absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-md border border-rule bg-card shadow-md',
          !menuOpen && 'hidden',
        )}
      >
        {menuOpen &&
          items.map((o, index) => (
            <li
              key={o.key}
              {...getItemProps({ item: o, index })}
              className={cn(
                'flex cursor-pointer flex-col items-start gap-0.5 px-[14px] py-[8px] text-left',
                highlightedIndex === index ? 'bg-paper' : 'bg-card',
              )}
            >
              <span className="text-[13px] text-ink">{o.name}</span>
              <span className="font-mono text-[11px] text-ink-soft">{o.key}</span>
            </li>
          ))}
      </ul>
    </div>
  );
}
