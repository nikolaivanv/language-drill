'use client';

import { useId, useState } from 'react';

/**
 * Filters the server-rendered rows in place via `[data-topic-row]`. The list is
 * NOT re-rendered from state: the complete set of topics must stay in the HTML
 * for a crawler, so search is an enhancement over markup that already exists.
 */
export function GrammarIndexSearch() {
  const id = useId();
  const [query, setQuery] = useState('');

  function onChange(value: string) {
    setQuery(value);
    const needle = value.trim().toLowerCase();
    const rows = document.querySelectorAll<HTMLElement>('[data-topic-row]');
    for (const row of rows) {
      const hit = !needle || (row.dataset.search ?? '').includes(needle);
      row.hidden = !hit;
    }
    for (const section of document.querySelectorAll<HTMLElement>('[data-grammar-index] section')) {
      const anyVisible = [...section.querySelectorAll<HTMLElement>('[data-topic-row]')].some(
        (r) => !r.hidden,
      );
      section.hidden = !anyVisible;
    }
  }

  return (
    <div className="flex flex-col gap-s-2">
      <label htmlFor={id} className="t-small text-ink-mute">
        Search topics
      </label>
      <input
        id={id}
        type="search"
        value={query}
        onChange={(e) => onChange(e.target.value)}
        placeholder="subjunctive, past tense, cases…"
        className="rounded-md border border-rule bg-card px-s-3 py-s-2 text-ink"
      />
    </div>
  );
}
