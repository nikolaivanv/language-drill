'use client';

// ---------------------------------------------------------------------------
// ReadTopBar — header above every /read view
// ---------------------------------------------------------------------------
// Four view-switcher buttons on the right (current text · history N ·
// + generate · + paste new), with the active button raised to `primary` and
// marked `aria-current="page"` (Requirements 2.1, 2.5, 14.6). The bottom rule
// matches the prototype: a 1px `--rule` border with 14px breathing room.
// ---------------------------------------------------------------------------

import { Button } from '../../../../components/ui/button';
import type { View } from '../_state/read-page-reducer';

type Props = {
  view: View;
  onChange: (view: View) => void;
  /** Total entries for the active language. `undefined` shows a "—" placeholder while the query is in flight. */
  historyCount: number | undefined;
};

// Each view "owns" exactly one top-bar button. `empty` re-uses the
// "current text" slot since it is the entries-empty fallback for that view
// (Requirement 2.2).
function activeButton(view: View): 'current' | 'history' | 'generate' | 'paste' {
  switch (view) {
    case 'annotated':
    case 'empty':
      return 'current';
    case 'history':
      return 'history';
    case 'generating':
      return 'generate';
    case 'pasting':
      return 'paste';
  }
}

export function ReadTopBar({ view, onChange, historyCount }: Props) {
  const active = activeButton(view);

  return (
    <div className="flex items-center justify-between border-b border-rule pb-[14px]">
      <div>
        <div className="t-micro">reading</div>
        <h1 className="t-display-m mt-[4px]">read &amp; collect</h1>
      </div>
      <div className="flex gap-[6px]">
        <Button
          size="sm"
          variant={active === 'current' ? 'primary' : 'ghost'}
          aria-current={active === 'current' ? 'page' : undefined}
          onClick={() => onChange('annotated')}
        >
          current text
        </Button>
        <Button
          size="sm"
          variant={active === 'history' ? 'primary' : 'ghost'}
          aria-current={active === 'history' ? 'page' : undefined}
          onClick={() => onChange('history')}
        >
          history{' '}
          <span className="t-mono ml-[4px] text-[10px] opacity-70">
            {historyCount ?? '—'}
          </span>
        </Button>
        <Button
          size="sm"
          variant={active === 'generate' ? 'primary' : 'ghost'}
          aria-current={active === 'generate' ? 'page' : undefined}
          onClick={() => onChange('generating')}
        >
          + generate
        </Button>
        <Button
          size="sm"
          variant={active === 'paste' ? 'primary' : 'ghost'}
          aria-current={active === 'paste' ? 'page' : undefined}
          onClick={() => onChange('pasting')}
        >
          + paste new
        </Button>
      </div>
    </div>
  );
}
